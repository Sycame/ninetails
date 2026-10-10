import { Injectable, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { ENDPOINTS } from './api-endpoints';
import { LiveStatusService } from './live-status.service';
import { NodeState, NodeUpdate, StatusSnapshot, VmUpdate } from './models';

/**
 * The live state (status, health checks, link up/down) of everything in the baseline.
 * Loaded once as a snapshot (GET /status), then kept current by the event stream:
 * `node.updated` / `vm.updated` patch the snapshot, `resync` reloads it.
 * It knows nothing about racks or environments - RackService merges it with the baseline.
 */
@Injectable({ providedIn: 'root' })
export class StatusService {
  private readonly api = inject(ApiService);

  private readonly snapshotSubject = new BehaviorSubject<StatusSnapshot | null>(null);
  private readonly updatedAtSubject = new BehaviorSubject<Date | null>(null);
  private readonly errorSubject = new BehaviorSubject<string | null>(null);

  /** null until the first snapshot has arrived. */
  readonly snapshot$ = this.snapshotSubject.asObservable();
  readonly updatedAt$ = this.updatedAtSubject.asObservable();
  readonly error$ = this.errorSubject.asObservable();

  constructor() {
    inject(LiveStatusService).events$.subscribe((e) => {
      if (e.type === 'node.updated') this.applyNodeUpdate(e.data);
      else if (e.type === 'vm.updated') this.applyVmUpdate(e.data);
      else if (e.type === 'resync') this.load();
    });
  }

  get snapshotLoaded(): boolean {
    return this.snapshotSubject.value !== null;
  }

  load(): void {
    this.api.get<StatusSnapshot>(ENDPOINTS.status).subscribe({
      next: (s) => {
        this.snapshotSubject.next(s);
        this.updatedAtSubject.next(new Date());
        this.errorSubject.next(null);
      },
      error: (e) => this.errorSubject.next(e.message), // keep the last known state
    });
  }

  applyNodeUpdate(u: NodeUpdate): void {
    const s = this.snapshotSubject.value;
    if (!s) return; // the snapshot that follows will contain this change anyway
    this.snapshotSubject.next({ ...s, nodes: { ...s.nodes, [u.id]: StatusService.patchState(s.nodes[u.id], u) } });
    this.updatedAtSubject.next(new Date());
  }

  applyVmUpdate(u: VmUpdate): void {
    const s = this.snapshotSubject.value;
    if (!s || !u.status) return;
    this.snapshotSubject.next({ ...s, vms: { ...s.vms, [u.id]: u.status } });
    this.updatedAtSubject.next(new Date());
  }

  /** Pure: a copy of the node state with the partial update applied (fields not in the update are kept). */
  static patchState(prev: NodeState | undefined, u: NodeUpdate): NodeState {
    const links = { ...prev?.links };
    u.interfaces?.forEach((i) => (links[i.name] = i.linkUp));
    return {
      status: u.status ?? prev?.status ?? 'OK',
      checks: u.checks ?? prev?.checks ?? [],
      links,
    };
  }
}
