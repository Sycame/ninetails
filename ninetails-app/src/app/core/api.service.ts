import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, retry, throwError, timer } from 'rxjs';
import { environment } from '../../environments/environment';

type Params = Record<string, string | number | boolean>;

/** Normalised error so components never have to inspect HttpErrorResponse. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Machine-readable code from the backend's error envelope, e.g. 'env_locked'. */
    public readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * The single place that talks HTTP to the Go backend: builds URLs, retries safe reads, maps errors.
 *
 *  - Base URL is `environment.apiBaseUrl` (e.g. /api/v1). The bearer token is added by authInterceptor.
 *  - GETs are retried twice (300ms, 600ms) on network errors and 502/503/504 only. Writes are never
 *    retried automatically (a second POST could start a second deployment).
 *  - Errors are expected as { "error": { "code": "...", "message": "..." } } (see docs/api.md).
 *  - In mock mode GET `config` reads /mock/config.json; writes are handled by the services themselves.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Params): Observable<T> {
    const url = environment.useMock ? `/mock/${path}.json` : this.url(path);
    return this.http.get<T>(url, { params: environment.useMock ? undefined : params }).pipe(
      retry({
        count: 2,
        delay: (err: HttpErrorResponse, attempt) =>
          isTransient(err) ? timer(300 * 2 ** (attempt - 1)) : throwError(() => err),
      }),
      catchError(toApiError),
    );
  }

  post<T>(path: string, body: unknown = {}): Observable<T> {
    return this.write(() => this.http.post<T>(this.url(path), body));
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.write(() => this.http.put<T>(this.url(path), body));
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.write(() => this.http.patch<T>(this.url(path), body));
  }

  delete<T>(path: string): Observable<T> {
    return this.write(() => this.http.delete<T>(this.url(path)));
  }

  /** Absolute URL for a path, also used by LiveStatusService for the event stream. */
  url(path: string): string {
    return `${environment.apiBaseUrl}/${path}`;
  }

  private write<T>(request: () => Observable<T>): Observable<T> {
    return request().pipe(catchError(toApiError));
  }
}

function isTransient(err: HttpErrorResponse): boolean {
  return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504;
}

function toApiError(err: HttpErrorResponse) {
  const body = err.error?.error; // { error: { code, message } }
  const message =
    err.status === 0 ? 'Cannot reach the server.' : body?.message ?? err.error?.message ?? `Request failed (${err.status}).`;
  return throwError(() => new ApiError(message, err.status, body?.code));
}
