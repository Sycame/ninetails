import { AsyncPipe, DatePipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { LiveStatusService } from '../core/live-status.service';
import { RackService } from '../core/rack.service';
import { StatusBadgeComponent } from '../shared/status-badge.component';

/** Bottom bar: version, last sync time, overall health summary, copyright. */
@Component({
  selector: 'app-footer',
  imports: [AsyncPipe, DatePipe, StatusBadgeComponent],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss',
})
export class FooterComponent {
  protected readonly racks = inject(RackService);
  protected readonly live = inject(LiveStatusService);
  protected readonly connLabel = { live: 'Live', connecting: 'Connecting…', offline: 'Offline' };
  protected readonly connTitle = {
    live: 'Status changes are pushed instantly.',
    connecting: 'Connecting to the live status stream.',
    offline: 'Live stream unavailable - data is refreshed periodically.',
  };
  protected readonly version = environment.appVersion;
  protected readonly year = new Date().getFullYear();
}
