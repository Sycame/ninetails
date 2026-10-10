import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { ConfigService } from './config.service';
import { EnvSummary, Server, Switch, Team, worstStatus } from './models';
import { RackService } from './rack.service';

/**
 * Logical topology: environments + teams (from the baseline), joined with the physical inventory
 * and live status from RackService. Holds no state of its own - it is a view over other streams.
 */
@Injectable({ providedIn: 'root' })
export class EnvService {
  private readonly config = inject(ConfigService);
  private readonly racks = inject(RackService);

  readonly envs$ = this.config.environments$;
  readonly teams$ = this.config.teams$;

  /** Every environment with its team, nodes, VMs and rolled-up status. Recomputed when any source changes. */
  readonly summaries$: Observable<EnvSummary[]> = combineLatest([
    this.envs$, this.teams$, this.racks.nodes$, this.racks.vms$,
  ]).pipe(
    map(([envs, teams, nodes, vms]) =>
      envs.map((env) => {
        const mine = nodes.filter((n) => n.envId === env.id);
        const envVms = vms.filter((v) => v.envId === env.id);
        const servers = mine.filter((n): n is Server => n.type === 'server');
        return {
          env,
          team: teams.find((t) => t.id === env.teamId),
          servers,
          switches: mine.filter((n): n is Switch => n.type === 'switch'),
          vms: envVms,
          // server -> its VMs (only this environment's VMs)
          hosts: servers.map((server) => ({ server, vms: envVms.filter((v) => v.hostId === server.id) })),
          // VMs of this environment running on hardware that belongs to another environment
          foreignVms: envVms
            .filter((v) => !servers.some((s) => s.id === v.hostId))
            .map((vm) => ({ vm, hostName: nodes.find((n) => n.id === vm.hostId)?.name ?? vm.hostId })),
          status: worstStatus([...mine.map((n) => n.status), ...envVms.map((v) => v.status)]),
        };
      }),
    ),
  );

  /** Start loading the baseline and the live state (safe to call more than once). */
  load(): void {
    this.racks.load();
  }

  summary$(envId: string): Observable<EnvSummary | undefined> {
    return this.summaries$.pipe(map((s) => s.find((x) => x.env.id === envId)));
  }

  team$(teamId?: string): Observable<Team | undefined> {
    return this.teams$.pipe(map((t) => t.find((x) => x.id === teamId)));
  }
}
