import { Component, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { MaterialModule } from '../../shared/material.module';

/**
 * GitLab redirects here with ?code & ?state (or ?error when the user declined / the app is
 * misconfigured). We finish the PKCE exchange and go to the page the user originally wanted.
 */
@Component({
  selector: 'app-callback',
  imports: [MaterialModule, RouterLink],
  templateUrl: './callback.component.html',
  styleUrl: './callback.component.scss',
})
export class CallbackComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  // Query params arrive as inputs thanks to withComponentInputBinding().
  readonly code = input<string>();
  readonly state = input<string>();
  readonly error_description = input<string>();
  readonly error$ = input<string>(undefined, { alias: 'error' });
  protected readonly error = signal('');

  constructor() {
    // Inputs are bound right after construction, so read them on the next microtask.
    queueMicrotask(() => this.finish());
  }

  private async finish(): Promise<void> {
    try {
      const denied = this.error$();
      if (denied) {
        throw new Error(denied === 'access_denied' ? 'Access was denied in GitLab.' : (this.error_description() ?? denied));
      }
      const code = this.code();
      const state = this.state();
      if (!code || !state) throw new Error('Missing code or state.');
      await this.router.navigateByUrl(await this.auth.completeLogin(code, state), { replaceUrl: true });
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
