import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { combineLatest, map } from 'rxjs';
import { EnvService } from '../../core/env.service';
import { MaterialModule } from '../../shared/material.module';

/** Which team owns which environment. Clicking an env count jumps to the filtered Environments page. */
@Component({
  selector: 'app-teams',
  imports: [MaterialModule, AsyncPipe, RouterLink],
  templateUrl: './teams.component.html',
  styleUrl: './teams.component.scss',
})
export class TeamsComponent {
  private readonly envs = inject(EnvService);
  // Start from the teams list so teams without environments still appear.
  protected readonly teams$ = combineLatest([this.envs.teams$, this.envs.envs$]).pipe(
    map(([teams, envs]) => teams.map((team) => ({ team, envs: envs.filter((e) => e.teamId === team.id) }))),
  );
}
