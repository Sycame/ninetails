import { Component, input } from '@angular/core';
import { MaterialModule } from './material.module';
import { Status } from '../core/models';

const ICONS: Record<Status, string> = { OK: 'check_circle', WARN: 'warning', FAIL: 'error' };

/** Reusable OK / WARN / FAIL indicator: <app-status-badge [status]="node.status" /> */
@Component({
  selector: 'app-status-badge',
  imports: [MaterialModule],
  templateUrl: './status-badge.component.html',
  styleUrl: './status-badge.component.scss',
})
export class StatusBadgeComponent {
  readonly status = input.required<Status>();
  /** Icon only (used inside tight rack slots). */
  readonly compact = input(false);
  protected readonly icons = ICONS;
}
