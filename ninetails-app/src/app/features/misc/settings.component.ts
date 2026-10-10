import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { environment } from '../../../environments/environment';
import { ConfigService } from '../../core/config.service';
import { MaterialModule } from '../../shared/material.module';

/** Shows which configuration baseline the app is running and lets you check for a newer one. */
@Component({
  selector: 'app-settings',
  imports: [MaterialModule, AsyncPipe, DatePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  protected readonly env = environment;
  protected readonly config = inject(ConfigService);
}
