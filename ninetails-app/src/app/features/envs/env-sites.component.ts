import { Component, input } from '@angular/core';
import { Website } from '../../core/models';
import { MaterialModule } from '../../shared/material.module';

/** The websites an environment serves, one link each; every link opens in its own new tab. */
@Component({
  selector: 'app-env-sites',
  imports: [MaterialModule],
  templateUrl: './env-sites.component.html',
  styleUrl: './env-sites.component.scss',
})
export class EnvSitesComponent {
  readonly sites = input<Website[] | undefined>([]);
}
