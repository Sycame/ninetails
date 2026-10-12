import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject, input, output } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { combineLatest, map, switchMap } from 'rxjs';
import { EnvService } from '../../core/env.service';
import { RackService } from '../../core/rack.service';
import { MaterialModule } from '../../shared/material.module';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

/**
 * Node details - read-only monitoring of the PHYSICAL machine (health, model, network). Deployments
 * and VMs are NOT shown here; both live in the Environments tab (env-detail).
 * Used inside the rack view's side drawer (emits `closed` when the X is clicked).
 */
@Component({
  selector: 'app-node-details',
  imports: [MaterialModule, AsyncPipe, DatePipe, RouterLink, StatusBadgeComponent],
  templateUrl: './node-details.component.html',
  styleUrl: './node-details.component.scss',
})
export class NodeDetailsComponent {
  private readonly racks = inject(RackService);
  private readonly envs = inject(EnvService);

  readonly id = input.required<string>();
  readonly closed = output();

  /** Everything the template needs, resolved in one stream that re-runs when `id` changes. */
  protected readonly vm$ = toObservable(this.id).pipe(
    switchMap((id) =>
      combineLatest([
        this.racks.getNode$(id), this.envs.envs$, this.envs.teams$, this.racks.racks$,
      ]),
    ),
    map(([node, envs, teams, racks]) => ({
      node,
      chassis: racks.flatMap((r) => r.chassis).find((c) => c.id === node?.chassisId),
      env: envs.find((e) => e.id === node?.envId),
      team: teams.find((t) => t.id === node?.teamId),
    })),
  );
}
