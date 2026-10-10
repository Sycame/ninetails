import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, Subject, finalize, map, of, switchMap, timer } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';
import { ENDPOINTS } from './api-endpoints';
import { LiveStatusService } from './live-status.service';
import { ConfigBaseline, ConfigVersion } from './models';
import { validateRack } from './rack-rules';

const CACHE_KEY = 'ninetails.config';

/**
 * The baselined system configuration (racks, chassis, servers, switches, network settings, VMs,
 * environments, teams) as published by the backend.
 *
 * The baseline is not expected to change on its own - changes go through a process and are then
 * published as a new `version`. The app keeps one immutable snapshot and swaps it atomically:
 *
 *   start    -> show the cached baseline right away (localStorage), then check for a newer one
 *   check    -> GET /config/version (tiny); only if the version differs: GET /config (full snapshot)
 *   triggers -> the `config.changed` event (push), a periodic check (pull, `environment.config.pollMs`),
 *               a `resync` after a reconnect, and the manual "Check for updates" button in Settings
 *
 * Nothing else in the app needs to know how it got here: components just read the streams below.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly api = inject(ApiService);

  private readonly configSubject = new BehaviorSubject<ConfigBaseline | null>(readCache());
  private readonly checkedAtSubject = new BehaviorSubject<Date | null>(null);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  private readonly updatesSubject = new Subject<{ from: string; to: ConfigBaseline }>();
  private checking = false;

  readonly config$ = this.configSubject.asObservable();
  readonly checkedAt$ = this.checkedAtSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();
  /** Emits when a NEW version replaces an earlier one (not on the first load). Used for the "updated" toast. */
  readonly updates$ = this.updatesSubject.asObservable();

  readonly racks$ = this.config$.pipe(map((c) => c?.racks ?? []));
  readonly vms$ = this.config$.pipe(map((c) => c?.vms ?? []));
  readonly environments$ = this.config$.pipe(map((c) => c?.environments ?? []));
  readonly teams$ = this.config$.pipe(map((c) => c?.teams ?? []));

  constructor() {
    inject(LiveStatusService).events$.subscribe((e) => {
      if (e.type === 'config.changed' || e.type === 'resync') this.sync();
    });
    // Pull fallback / safety net: also check periodically, in case a push was missed.
    timer(environment.config.pollMs, environment.config.pollMs).subscribe(() => this.sync());
  }

  get current(): ConfigBaseline | null {
    return this.configSubject.value;
  }

  /**
   * Make sure we hold the newest published baseline. Cheap when nothing changed: with a baseline
   * already in memory it only asks for the version document.
   */
  sync(): void {
    if (this.checking) return;
    this.checking = true;
    const have = this.current;

    const version$: Observable<ConfigVersion | null> = have
      ? this.api.get<ConfigVersion>(ENDPOINTS.configVersion)
      : of(null);
    version$
      .pipe(
        switchMap((v): Observable<ConfigBaseline | null> =>
          have && v && v.version === have.version ? of(null) : this.api.get<ConfigBaseline>(ENDPOINTS.config),
        ),
        finalize(() => (this.checking = false)),
      )
      .subscribe({
        next: (fresh) => {
          if (fresh) this.apply(fresh);
          this.checkedAtSubject.next(new Date());
          this.errorSubject.next(null);
        },
        error: (e) => this.errorSubject.next(e.message), // keep serving the baseline we already have
      });
  }

  private apply(fresh: ConfigBaseline): void {
    // The baseline is authoritative, but flag layout mistakes loudly so the change owner notices.
    fresh.racks.forEach((r) => validateRack(r).forEach((issue) => console.warn(`[config ${fresh.version}] ${r.name}: ${issue}`)));

    const previous = this.current;
    this.configSubject.next(fresh);
    writeCache(fresh);
    if (previous && previous.version !== fresh.version) this.updatesSubject.next({ from: previous.version, to: fresh });
  }
}

function readCache(): ConfigBaseline | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as ConfigBaseline) : null;
  } catch {
    return null;
  }
}

function writeCache(c: ConfigBaseline): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* quota/blocked: fine, just no cache */ }
}
