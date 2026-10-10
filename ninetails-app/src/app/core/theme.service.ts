import { DOCUMENT } from '@angular/common';
import { Injectable, effect, inject, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

export type ThemeMode = 'light' | 'dark';
const KEY = 'ninetails.theme';

/** Light/dark switch. Defaults to dark, remembers the user's choice. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT);

  readonly mode = signal<ThemeMode>(this.initial());
  /** Stream version of `mode` for components that prefer RxJS. */
  readonly theme$ = toObservable(this.mode);

  constructor() {
    // Runs on start and on every change: set the class that styles.scss maps to `color-scheme`.
    effect(() => {
      const m = this.mode();
      const cl = this.doc.documentElement.classList;
      cl.remove('light-theme', 'dark-theme');
      cl.add(`${m}-theme`);
      try { localStorage.setItem(KEY, m); } catch { /* storage may be blocked */ }
    });
  }

  toggle(): void {
    this.mode.update((m) => (m === 'dark' ? 'light' : 'dark'));
  }

  private initial(): ThemeMode {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return 'dark'; // default theme; a saved choice (above) wins once the user has toggled
  }
}
