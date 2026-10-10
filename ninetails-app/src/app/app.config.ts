import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { authInterceptor } from './core/auth.interceptor';
import { routes } from './app.routes';

// GitLab tanuki mark, single color (takes the text color of the button it sits in). 24 px grid.
const GITLAB_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
  '<path d="M23.6004 9.5927l-.0337-.0862L20.3.9814a.851.851 0 0 0-.3362-.405.8748.8748 0 0 0-.9997.0539.8748.8748 0 0 0-.29.4399l-2.2055 6.748H7.5375l-2.2057-6.748a.8573.8573 0 0 0-.29-.4412.8748.8748 0 0 0-.9997-.0537.8585.8585 0 0 0-.3362.4049L.4332 9.5015l-.0325.0862a6.0657 6.0657 0 0 0 2.0119 7.0105l.0113.0087.03.0213 4.976 3.7264 2.462 1.8633 1.4995 1.1321a1.0085 1.0085 0 0 0 1.2197 0l1.4995-1.1321 2.4619-1.8633 5.006-3.7466.0125-.01a6.0682 6.0682 0 0 0 2.0094-7.003z"/>' +
  '</svg>';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // All <mat-icon> use the self-hosted Material Symbols Outlined font (see src/fonts.scss).
    provideAppInitializer(() => {
      const icons = inject(MatIconRegistry);
      icons.setDefaultFontSetClass('material-symbols-outlined');
      // Brand icons are not in Material Symbols; registered inline (no network) as <mat-icon svgIcon="gitlab" />.
      icons.addSvgIconLiteral('gitlab', inject(DomSanitizer).bypassSecurityTrustHtml(GITLAB_ICON));
    }),
    // withComponentInputBinding: route/query params -> component input() signals
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
  ],
};
