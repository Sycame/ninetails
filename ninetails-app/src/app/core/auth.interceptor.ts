import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Adds the bearer token to our own API calls only (never to GitLab or other hosts).
 * On a 401 it refreshes the token once and retries the request; if that fails the user is signed out.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const isApi = req.url.startsWith(environment.apiBaseUrl);
  if (!isApi) return next(req);

  const withToken = (r: HttpRequest<unknown>) =>
    auth.accessToken ? r.clone({ setHeaders: { Authorization: `Bearer ${auth.accessToken}` } }) : r;

  return next(withToken(req)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      return from(auth.refresh()).pipe(
        switchMap((ok) => {
          if (ok) return next(withToken(req));
          auth.logout();
          return throwError(() => err);
        }),
      );
    }),
  );
};
