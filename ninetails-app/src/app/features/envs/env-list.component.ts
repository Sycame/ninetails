import { Component, computed, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { EnvService } from '../../core/env.service';
import { EnvSummary, Team } from '../../core/models';
import { MaterialModule } from '../../shared/material.module';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { DeployButtonComponent } from './deploy-button.component';
import { EnvTreeComponent } from './env-tree.component';

interface EnvGroup {
  key: string;
  /** null => ungrouped "flat list" mode. */
  team: Team | null;
  title: string;
  envs: EnvSummary[];
}

/**
 * Environments tab. Environments are free-form names, so the list is built to scale:
 *  - search (matches the environment name, its team, or any machine / VM in it),
 *  - team filter (kept in the URL: ?team=..., the Teams page links here),
 *  - "By team" grouping or a flat list,
 *  - every environment is an expandable panel: servers -> VMs, switches (see EnvTreeComponent).
 * Deploying happens here, from the expanded environment.
 */
@Component({
  selector: 'app-env-list',
  imports: [MaterialModule, RouterLink, StatusBadgeComponent, EnvTreeComponent, DeployButtonComponent],
  templateUrl: './env-list.component.html',
  styleUrl: './env-list.component.scss',
})
export class EnvListComponent {
  protected readonly envs = inject(EnvService);
  private readonly router = inject(Router);

  /** ?team=... query param (bound by withComponentInputBinding). */
  readonly team = input<string>();

  protected readonly search = signal('');
  protected readonly grouped = signal(true);
  /** Ids of the expanded environments (state lives here so Expand/Collapse all works). */
  protected readonly open = signal<ReadonlySet<string>>(new Set());
  protected readonly emptySet: ReadonlySet<string> = new Set();

  protected readonly all = toSignal(this.envs.summaries$, { initialValue: [] as EnvSummary[] });
  protected readonly teams = toSignal(this.envs.teams$, { initialValue: [] as Team[] });

  /** Filter by team + free-text search over env name, team name, description and member names. */
  protected readonly filtered = computed(() => {
    const team = this.team();
    const q = this.search().trim().toLowerCase();
    return this.all()
      .filter((s) => !team || s.env.teamId === team)
      .filter((s) => {
        if (!q) return true;
        const haystack = [
          s.env.name, s.env.description ?? '', s.team?.name ?? '',
          ...s.servers.map((x) => x.name), ...s.switches.map((x) => x.name), ...s.vms.map((x) => x.name),
        ];
        return haystack.some((t) => t.toLowerCase().includes(q));
      })
      .sort((a, b) => a.env.name.localeCompare(b.env.name, undefined, { numeric: true, sensitivity: 'base' }));
  });

  protected readonly visibleCount = computed(() => this.filtered().length);

  protected readonly groups = computed<EnvGroup[]>(() => {
    const list = this.filtered();
    if (!list.length) return [];
    if (!this.grouped()) return [{ key: 'all', team: null, title: 'All environments', envs: list }];

    const byTeam = new Map<string, EnvGroup>();
    for (const s of list) {
      const key = s.team?.id ?? '__none';
      if (!byTeam.has(key)) {
        byTeam.set(key, { key, team: s.team ?? null, title: s.team?.name ?? 'No team', envs: [] });
      }
      byTeam.get(key)!.envs.push(s);
    }
    return [...byTeam.values()].sort((a, b) => a.title.localeCompare(b.title));
  });

  protected toggle(id: string, isOpen: boolean): void {
    this.open.update((set) => {
      const next = new Set(set);
      if (isOpen) next.add(id); else next.delete(id);
      return next;
    });
  }

  protected expandAll(): void {
    this.open.set(new Set(this.filtered().map((s) => s.env.id)));
  }

  protected setTeam(team: string): void {
    void this.router.navigate([], { queryParams: { team: team || null } });
  }
}
