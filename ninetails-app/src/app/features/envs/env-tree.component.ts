import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EnvSummary } from '../../core/models';
import { MaterialModule } from '../../shared/material.module';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

/**
 * The contents of one environment: its servers (expandable when they host VMs of this environment),
 * its switches, and any of its VMs that run on hardware belonging to another environment.
 * Used inside each environment panel in the list and on the environment detail page.
 */
@Component({
  selector: 'app-env-tree',
  imports: [MaterialModule, RouterLink, StatusBadgeComponent],
  templateUrl: './env-tree.component.html',
  styleUrl: './env-tree.component.scss',
})
export class EnvTreeComponent {
  readonly summary = input.required<EnvSummary>();
}
