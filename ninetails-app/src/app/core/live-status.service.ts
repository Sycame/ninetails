import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';
import { ENDPOINTS } from './api-endpoints';
import { AuthService } from './auth.service';
import { ConfigBaseline, ConnectionState, LiveEvent, Status } from './models';
import { SseParser } from './sse-parser';

/** No bytes (data or ": ping" heartbeat) for this long => treat the connection as dead and reconnect. */
const SILENCE_TIMEOUT_MS = 45_000;
const MAX_BACKOFF_MS = 30_000;

/**
 * Live status updates from the backend.
 *
 * WHY SERVER-SENT EVENTS (not WebSocket / polling): updates only flow server -> browser, SSE is plain
 * HTTP (works through proxies, same auth, trivial in Go with http.Flusher), and it is simple to reason about.
 * We read the stream with fetch() instead of EventSource so the Authorization header can be sent.
 *
 * Contract: GET {apiBaseUrl}/events, `Accept: text/event-stream`. Each message is
 *     event: config.changed | node.updated | vm.updated | deployment.updated | resync
 *     data: <JSON, see LiveEvent in models.ts>
 * and the server sends a ": ping" comment every ~15 s. Details in docs/api.md.
 *
 * Robustness:
 *  - reconnects with exponential backoff + jitter;
 *  - events can be lost while disconnected, so every successful RE-connect emits `resync`
 *    (consumers refetch their data) - no replay protocol needed on the server;
 *  - while the stream is down, `resync` is also emitted every `pollFallbackMs` (plain polling fallback);
 *  - a 401 triggers one token refresh before giving up and signing the user out.
 */
@Injectable({ providedIn: 'root' })
export class LiveStatusService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly eventsSubject = new Subject<LiveEvent>();
  private readonly stateSubject = new BehaviorSubject<ConnectionState>('offline');
  readonly events$ = this.eventsSubject.asObservable();
  readonly state$ = this.stateSubject.asObservable();

  private running = false;
  private everConnected = false;
  private attempts = 0;
  private abort: AbortController | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private simTimer: ReturnType<typeof setInterval> | undefined;

  /** Start (idempotent). Called by the authenticated shell. */
  start(): void {
    if (this.running || !environment.live.enabled) return;
    this.running = true;
    if (environment.useMock) {
      if (environment.live.simulateInMock) this.startSimulation();
      else this.stateSubject.next('offline');
      return;
    }
    void this.connect();
  }

  /** Stop and release everything (on logout / leaving the shell). */
  stop(): void {
    this.running = false;
    this.abort?.abort();
    clearTimeout(this.silenceTimer);
    clearTimeout(this.retryTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.simTimer);
    this.pollTimer = undefined;
    this.stateSubject.next('offline');
  }

  // ---- real connection -----------------------------------------------------------------

  private async connect(): Promise<void> {
    if (!this.running) return;
    this.stateSubject.next('connecting');
    this.abort = new AbortController();
    const { signal } = this.abort;

    try {
      const res = await fetch(this.api.url(ENDPOINTS.events), {
        signal,
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${this.auth.accessToken ?? ''}` },
      });

      if (res.status === 401) {
        if (await this.auth.refresh()) return void this.connect(); // new token, try again right away
        this.auth.logout();
        return;
      }
      if (!res.ok || !res.body) throw new Error(`events stream failed (${res.status})`);

      this.onConnected();
      await this.read(res.body.getReader());
    } catch {
      // network error, abort on silence, or the stream ended: fall through to reconnect
    }
    if (this.running) this.scheduleReconnect(); // stream ended, failed, or was aborted by the silence timer
  }

  private async read(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    const parser = new SseParser();
    for (;;) {
      this.armSilenceTimer();
      const { done, value } = await reader.read();
      if (done) return;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) this.dispatch(m.event, m.data);
    }
  }

  private dispatch(event: string, data: string): void {
    try {
      if (event === 'resync') this.eventsSubject.next({ type: 'resync' });
      else if (event === 'config.changed' || event === 'node.updated' || event === 'vm.updated' || event === 'deployment.updated') {
        this.eventsSubject.next({ type: event, data: JSON.parse(data) } as LiveEvent);
      } // unknown event types are ignored so the server can add new ones safely
    } catch {
      /* malformed JSON: ignore this message, keep the stream */
    }
  }

  private onConnected(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.stateSubject.next('live');
    // Events may have been missed while we were away: ask consumers to refetch.
    if (this.everConnected || this.attempts > 0) this.eventsSubject.next({ type: 'resync' });
    this.everConnected = true;
    this.attempts = 0;
  }

  private armSilenceTimer(): void {
    clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.abort?.abort(), SILENCE_TIMEOUT_MS);
  }

  private scheduleReconnect(): void {
    clearTimeout(this.silenceTimer);
    this.stateSubject.next('offline');
    const backoff = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** this.attempts);
    this.attempts++;
    // Fallback: keep the data fresh by polling while the stream is down.
    this.pollTimer ??= setInterval(() => this.eventsSubject.next({ type: 'resync' }), environment.live.pollFallbackMs);
    this.retryTimer = setTimeout(() => void this.connect(), backoff + Math.random() * 500);
  }

  // ---- mock mode -----------------------------------------------------------------------

  /** Pretends to be the backend: occasionally changes a random node/VM status. */
  private startSimulation(): void {
    this.stateSubject.next('live');
    let nodeIds: string[] = [];
    let vmIds: string[] = [];
    this.api.get<ConfigBaseline>(ENDPOINTS.config).subscribe((c) => {
      nodeIds = c.racks.flatMap((r) => r.nodes.map((n) => n.id));
      vmIds = c.vms.map((v) => v.id);
    });

    const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const randomStatus = (): Status => {
      const r = Math.random();
      return r < 0.7 ? 'OK' : r < 0.95 ? 'WARN' : 'FAIL';
    };

    this.simTimer = setInterval(() => {
      if (nodeIds.length && Math.random() < 0.7) {
        this.eventsSubject.next({ type: 'node.updated', data: { id: pick(nodeIds), status: randomStatus() } });
      } else if (vmIds.length) {
        this.eventsSubject.next({ type: 'vm.updated', data: { id: pick(vmIds), status: randomStatus() } });
      }
    }, environment.live.simulateEveryMs);
  }
}
