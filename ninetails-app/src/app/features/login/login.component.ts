import { Component, inject, input, signal } from '@angular/core';
import { AuthService } from '../../core/auth.service';
import { LogoComponent } from '../../shared/logo.component';
import { MaterialModule } from '../../shared/material.module';

/** Shown to unauthenticated users. `returnUrl` is bound from the query string by the router. */
@Component({
  selector: 'app-login',
  imports: [MaterialModule, LogoComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  readonly returnUrl = input('/racks');
  /** Set e.g. when the GitLab application is not configured or the user was refused. */
  protected readonly error = signal('');

  protected async signIn(): Promise<void> {
    this.error.set('');
    try {
      await this.auth.login(this.returnUrl());
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
