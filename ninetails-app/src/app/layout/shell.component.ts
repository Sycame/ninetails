import { BreakpointObserver } from '@angular/cdk/layout';
import { Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { ConfigService } from '../core/config.service';
import { EnvService } from '../core/env.service';
import { LiveStatusService } from '../core/live-status.service';
import { MaterialModule } from '../shared/material.module';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { NavbarComponent } from './navbar.component';

/**
 * Authenticated layout: header / [navbar | content] / footer.
 * On narrow screens the navbar becomes an overlay drawer toggled from the header.
 * Also the one place that kicks off the initial data load.
 */
@Component({
  selector: 'app-shell',
  imports: [MaterialModule, RouterOutlet, HeaderComponent, FooterComponent, NavbarComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly breakpoints = inject(BreakpointObserver);
  protected readonly isMobile = toSignal(
    this.breakpoints.observe('(max-width: 800px)').pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  constructor() {
    inject(EnvService).load(); // loads the baseline config + live status

    // Tell the user when a newly published baseline replaced the one they were looking at.
    const snack = inject(MatSnackBar);
    inject(ConfigService).updates$.pipe(takeUntilDestroyed()).subscribe(({ from, to }) =>
      snack.open(`Configuration updated: ${from} → ${to.version}${to.description ? ' (' + to.description + ')' : ''}`, 'OK', { duration: 8000 }),
    );
    // Live status stream for as long as the signed-in layout is on screen.
    const live = inject(LiveStatusService);
    live.start();
    inject(DestroyRef).onDestroy(() => live.stop());
  }
}
