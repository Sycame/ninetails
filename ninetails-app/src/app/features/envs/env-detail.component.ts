import { AsyncPipe } from '@angular/common';
import { Component, inject, input } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { switchMap } from 'rxjs';
import { EnvService } from '../../core/env.service';
import { MaterialModule } from '../../shared/material.module';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { DeployButtonComponent } from './deploy-button.component';
import { EnvTreeComponent } from './env-tree.component';

/** One environment on its own page (deep link): owner, status, deploy, and the same tree as the list. */
@Component({
  selector: 'app-env-detail',
  imports: [MaterialModule, AsyncPipe, RouterLink, StatusBadgeComponent, DeployButtonComponent, EnvTreeComponent],
  templateUrl: './env-detail.component.html',
  styleUrl: './env-detail.component.scss',
})
export class EnvDetailComponent {
  private readonly envs = inject(EnvService);
  readonly id = input.required<string>();
  protected readonly summary$ = toObservable(this.id).pipe(switchMap((id) => this.envs.summary$(id)));
}
