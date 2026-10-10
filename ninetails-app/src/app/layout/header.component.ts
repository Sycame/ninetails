import { AsyncPipe } from '@angular/common';
import { Component, inject, output, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { ThemeService } from '../core/theme.service';
import { LogoComponent } from '../shared/logo.component';
import { MaterialModule } from '../shared/material.module';

/** Top bar: logo (far left, doubles as the show/hide-navigation button), title, avatar, user name, logout. */
@Component({
  selector: 'app-header',
  imports: [MaterialModule, AsyncPipe, LogoComponent],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);

  readonly menuToggle = output();

  /** Set when the profile picture cannot be loaded (blocked, deleted, offline): the generic icon is shown instead. */
  protected readonly avatarFailed = signal(false);
}
