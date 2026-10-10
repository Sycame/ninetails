import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, catchError, delay, map, of, startWith, tap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';
import { ENDPOINTS } from './api-endpoints';
import { AuthService } from './auth.service';
import { LiveStatusService } from './live-status.service';
import { Deployment, DeploymentUpdate, DeployState } from './models';

/**
 * Deployments: start one and keep the history.
 *
 *   POST {api}/environments/{envId}/deployments   -> 202 Deployment (status 'queued')
 *   GET  {api}/deployments?limit=50               -> Deployment[]  (newest first)
 *   live: `deployment.updated` events move a deployment queued -> running -> succeeded | failed
 *
 * The environment is addressed by id (names are free-form and may contain spaces/symbols).
 * deploy() returns a stream of button states: loading first, then success (= the backend accepted
 * and queued the pipeline) or error. The pipeline's own progress shows up on the Deployments tab.
 */
@Injectable({ providedIn: 'root' })
export class DeployService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly historySubject = new BehaviorSubject<Deployment[]>([]);
  readonly history$ = this.historySubject.asObservable();

  constructor() {
    inject(LiveStatusService).events$.subscribe((e) => {
      if (e.type === 'deployment.updated') this.applyUpdate(e.data);
      else if (e.type === 'resync') this.loadHistory();
    });
  }

  loadHistory(): void {
    this.api.get<Deployment[]>(ENDPOINTS.deployments, { limit: 50 }).subscribe({
      next: (list) => this.historySubject.next(list),
      error: () => { /* keep what we have; the Deployments tab shows the existing list */ },
    });
  }

  deploy(envId: string, envName: string): Observable<DeployState> {
    const call$ = environment.useMock
      ? this.fakeDeploy(envId, envName)
      : this.api.post<Deployment>(ENDPOINTS.deployEnvironment(envId));

    return call$.pipe(
      tap((d) => this.historySubject.next([d, ...this.historySubject.value.filter((x) => x.id !== d.id)])),
      map((d): DeployState => ({ phase: 'success', message: d.message ?? `Deployment ${d.id} ${d.status}.` })),
      catchError((e) => of<DeployState>({ phase: 'error', message: e.message })),
      startWith<DeployState>({ phase: 'loading' }),
    );
  }

  /** Merge a pushed status change into the history. */
  applyUpdate(u: DeploymentUpdate): void {
    this.historySubject.next(
      this.historySubject.value.map((d) =>
        d.id === u.id ? { ...d, status: u.status, finishedAt: u.finishedAt ?? d.finishedAt, message: u.message ?? d.message } : d,
      ),
    );
  }

  // ---- mock mode -------------------------------------------------------------------------

  /**
   * Pretends to be the backend: accepts after 0.8 s, then walks the deployment through
   * running -> succeeded (the "legacy" environment is locked and is rejected outright).
   */
  private fakeDeploy(envId: string, envName: string): Observable<Deployment> {
    if (envName === 'legacy') {
      return throwError(() => new Error('Environment is locked.')).pipe(delay(800));
    }
    const id = `d-${Math.floor(Math.random() * 9000 + 1000)}`;
    const deployment: Deployment = {
      id, envId, envName, status: 'queued',
      startedBy: this.auth.user?.username ?? 'unknown',
      startedAt: new Date().toISOString(),
      pipelineUrl: `https://gitlab.example.com/acme/app/-/pipelines/${id.slice(2)}`,
      message: `Pipeline #${id.slice(2)} queued.`,
    };
    setTimeout(() => this.applyUpdate({ id, status: 'running' }), 2500);
    setTimeout(
      () => this.applyUpdate({ id, status: 'succeeded', finishedAt: new Date().toISOString(), message: `Pipeline #${id.slice(2)} passed.` }),
      7000,
    );
    return of(deployment).pipe(delay(800));
  }
}
