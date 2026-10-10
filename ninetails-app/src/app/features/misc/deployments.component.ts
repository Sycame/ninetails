import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { DeployService } from '../../core/deploy.service';
import { DeploymentStatus } from '../../core/models';
import { MaterialModule } from '../../shared/material.module';

const ICONS: Record<DeploymentStatus, string> = {
  queued: 'schedule', running: 'sync', succeeded: 'check_circle', failed: 'error',
};

/** Deployment history from the backend (GET /deployments), updated live while pipelines run. */
@Component({
  selector: 'app-deployments',
  imports: [MaterialModule, AsyncPipe, DatePipe],
  templateUrl: './deployments.component.html',
  styleUrl: './deployments.component.scss',
})
export class DeploymentsComponent {
  protected readonly deployer = inject(DeployService);
  protected readonly icons = ICONS;

  constructor() {
    this.deployer.loadHistory();
  }
}
