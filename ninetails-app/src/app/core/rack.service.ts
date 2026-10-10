import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest, map, shareReplay } from 'rxjs';
import { ConfigService } from './config.service';
import { mergeRacks, mergeVms } from './merge';
import { Rack, RackConfig, RackNode, Slot, Status, Vm, worstStatus } from './models';
import { computeSlotOccupancy, validateRack } from './rack-rules';
import { StatusService } from './status.service';

/**
 * Physical inventory as the UI sees it: the baselined configuration (ConfigService) merged with the
 * live state (StatusService). Nothing is stored here except which rack is on screen:
 *
 *   racks$ = merge(baseline racks, live status)    <- recomputed when either side changes
 *
 * So a published baseline swaps the structure, a status event only changes colours/LEDs, and both
 * flow to every component through the same streams.
 */
@Injectable({ providedIn: 'root' })
export class RackService {
  private readonly config = inject(ConfigService);
  private readonly status = inject(StatusService);

  /** Rack shown in the single-rack view; null = "the first rack". */
  private readonly currentRackIdSubject = new BehaviorSubject<string | null>(null);
  private latestRacks: Rack[] = [];

  /** Merged racks. shareReplay: computed once and shared by every subscriber. */
  readonly racks$: Observable<Rack[]> = combineLatest([this.config.racks$, this.status.snapshot$]).pipe(
    map(([racks, snapshot]) => mergeRacks(racks, snapshot)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly vms$: Observable<Vm[]> = combineLatest([this.config.vms$, this.status.snapshot$]).pipe(
    map(([vms, snapshot]) => mergeVms(vms, snapshot)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  readonly currentRackId$ = this.currentRackIdSubject.asObservable();
  readonly error$ = combineLatest([this.config.error$, this.status.error$]).pipe(map(([a, b]) => a ?? b));

  /** Most recent successful sync of the baseline check or a status update (footer "Last sync"). */
  readonly lastSync$: Observable<Date | null> = combineLatest([this.config.checkedAt$, this.status.updatedAt$]).pipe(
    map(([a, b]) => (a && b ? (a > b ? a : b) : a ?? b)),
  );

  /** The rack currently on screen (falls back to the first rack until one is selected). */
  readonly currentRack$: Observable<Rack | undefined> = combineLatest([this.racks$, this.currentRackId$]).pipe(
    map(([racks, id]) => racks.find((r) => r.id === id) ?? racks[0]),
  );

  /** Flat list of every server and switch. */
  readonly nodes$: Observable<RackNode[]> = this.racks$.pipe(map((r) => r.flatMap((x) => x.nodes)));

  /** Overall health shown in the footer. */
  readonly health$: Observable<Status> = combineLatest([this.nodes$, this.vms$]).pipe(
    map(([n, v]) => worstStatus([...n.map((x) => x.status), ...v.map((x) => x.status)])),
  );

  constructor() {
    this.racks$.subscribe((r) => (this.latestRacks = r)); // keeps `indexOf`/`neighbourId` synchronous
  }

  /** Load the baseline (cached copy first, then a version check) and the live state. Idempotent. */
  load(): void {
    this.config.sync();
    if (!this.status.snapshotLoaded) this.status.load();
  }

  getNode$(id: string): Observable<RackNode | undefined> {
    return this.nodes$.pipe(map((n) => n.find((x) => x.id === id)));
  }

  vmsOf$(serverId: string): Observable<Vm[]> {
    return this.vms$.pipe(map((v) => v.filter((x) => x.hostId === serverId)));
  }

  // ---- single-rack selection ---------------------------------------------

  get currentRackId(): string | null {
    return this.currentRackIdSubject.value ?? this.latestRacks[0]?.id ?? null;
  }

  /** Position of a rack in the list (-1 if unknown). Used to pick the slide direction. */
  indexOf(id: string | null): number {
    return this.latestRacks.findIndex((r) => r.id === id);
  }

  select(id: string): void {
    if (this.latestRacks.some((r) => r.id === id)) this.currentRackIdSubject.next(id);
  }

  /** Id of the rack `step` places away from the current one, wrapping around the ends. */
  neighbourId(step: 1 | -1): string | null {
    const racks = this.latestRacks;
    if (!racks.length) return null;
    const i = Math.max(this.indexOf(this.currentRackId), 0);
    return racks[(i + step + racks.length) % racks.length].id;
  }

  next(): void {
    const id = this.neighbourId(1);
    if (id) this.select(id);
  }

  prev(): void {
    const id = this.neighbourId(-1);
    if (id) this.select(id);
  }

  // ---- layout rules (pure; see rack-rules.ts) -------------------------------

  static computeSlotOccupancy(rack: RackConfig): Slot[] {
    return computeSlotOccupancy(rack);
  }

  static validateRack(rack: RackConfig): string[] {
    return validateRack(rack);
  }
}
