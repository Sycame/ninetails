import { AsyncPipe, NgTemplateOutlet } from '@angular/common';
import { Component, effect, inject, input, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { RackNode } from '../../core/models';
import { RackService } from '../../core/rack.service';
import { ThemeService } from '../../core/theme.service';
import { MaterialModule } from '../../shared/material.module';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { NodeDetailsComponent } from './node-details.component';
import { buildLayout } from './rack-layout';

/**
 * Single-rack viewer. Shows ONE rack at a time with prev/next + dropdown to swap.
 * The URL is the source of truth: /racks/:id picks the rack (bound to `id`), swap controls navigate.
 * Layout maths lives in rack-layout.ts; this class only holds UI state.
 */
@Component({
  selector: 'app-rack-view',
  imports: [MaterialModule, AsyncPipe, NgTemplateOutlet, StatusBadgeComponent, NodeDetailsComponent],
  templateUrl: './rack-view.component.html',
  styleUrl: './rack-view.component.scss',
  host: {
    // Theme integration: colors come from CSS variables, the class lets rack-only tweaks
    // (see rack-view.component.scss) react to the header toggle.
    '[class]': 'themeClass()',
    // Keyboard shortcut for swapping racks (PageUp / PageDown), ignored while typing/using the dropdown.
    '(document:keydown.pageup)': 'onKey($event, -1)',
    '(document:keydown.pagedown)': 'onKey($event, 1)',
  },
})
export class RackViewComponent {
  protected readonly racks = inject(RackService);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  /** Optional route param /racks/:id. */
  readonly id = input<string>();

  protected readonly selectedId = signal<string | null>(null);
  /** Which way the new rack slides in from; set when the rack changes. */
  protected readonly direction = signal<'next' | 'prev'>('next');

  protected readonly themeClass = toSignal(
    this.theme.theme$.pipe(map((m) => `${m}-theme`)),
    { initialValue: `${this.theme.mode()}-theme` },
  );

  /** Everything the template needs for the current rack, rebuilt when racks or selection change. */
  protected readonly vm$ = combineLatest([this.racks.racks$, this.racks.currentRack$]).pipe(
    map(([all, rack]) =>
      rack
        ? { all, rack, index: all.indexOf(rack), layout: buildLayout(rack), issues: RackService.validateRack(rack) }
        : null,
    ),
  );

  constructor() {
    // URL -> state. Also decides the slide direction by comparing positions.
    effect(() => {
      const id = this.id();
      if (!id || id === this.racks.currentRackId) return;
      const dir = this.racks.indexOf(id) < this.racks.indexOf(this.racks.currentRackId) ? 'prev' : 'next';
      this.direction.set(dir);
      this.selectedId.set(null); // close the details panel when the rack changes
      this.racks.select(id);
    });
  }

  /** Swap controls only navigate; the effect above applies the change. */
  protected go(id: string | null): void {
    if (id) void this.router.navigate(['/racks', id]);
  }

  protected step(delta: 1 | -1): void {
    this.go(this.racks.neighbourId(delta));
  }

  protected onKey(event: Event, delta: 1 | -1): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('mat-select, input, textarea, .mat-mdc-select-panel')) return;
    event.preventDefault();
    this.step(delta);
  }

  protected select(node: RackNode): void {
    this.selectedId.set(node.id);
  }

  /** Dropdown change handler; direction is computed by the effect once the URL changes. */
  protected onPick(id: string): void {
    this.go(id);
  }
}
