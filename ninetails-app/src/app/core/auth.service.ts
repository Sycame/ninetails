import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { User } from './models';

const SESSION_KEY = 'ninetails.session';
const VERIFIER_KEY = 'ninetails.pkce.verifier';
const STATE_KEY = 'ninetails.pkce.state';
const RETURN_KEY = 'ninetails.pkce.return';
/** Refresh this many ms before the access token actually expires. */
const REFRESH_SKEW_MS = 30_000;

/** Shown to the user (login page / callback page) when sign-in cannot continue. */
export class AuthError extends Error {}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number; // seconds
}

interface UserInfo {
  sub: string;
  name: string;
  nickname: string;
  picture?: string;
  /** Full paths of the groups the user belongs to (needs the `openid` scope). */
  groups?: string[];
}

interface Session {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // epoch ms
  user: User;
}

/**
 * Authentication + authorisation through a GitLab Application (OAuth 2.0 Authorization Code + PKCE,
 * with OpenID Connect for the user's identity).
 *
 *  1. login()          -> redirect to {gitlab}/oauth/authorize with a PKCE challenge + random state
 *  2. GitLab           -> user signs in and approves -> redirects to /auth/callback?code=..&state=..
 *  3. completeLogin()  -> POST {gitlab}/oauth/token (code + PKCE verifier, no client secret)
 *                         GET  {gitlab}/oauth/userinfo -> identity + group memberships
 *                         authorize() -> allowed groups only, or reject
 *  4. refresh()        -> silently swaps the refresh token for a new access token before expiry
 *  5. logout()         -> revokes the token at GitLab and clears local state
 *
 * TOKEN STORAGE (demo): kept in memory and mirrored to sessionStorage so a page refresh keeps you
 * signed in. sessionStorage is readable by any script on the page (XSS), so for production prefer a
 * backend that does the code exchange and sets an HttpOnly, SameSite cookie (see README).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly userSubject = new BehaviorSubject<User | null>(null);
  readonly user$ = this.userSubject.asObservable();

  private session: Session | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor() {
    this.restoreSession();
    // DEV BYPASS: in mock mode skip the login entirely and be the configured dev user.
    if (environment.auth.mode === 'mock') this.signInAsDevUser();
  }

  get isAuthenticated(): boolean {
    return this.userSubject.value !== null;
  }

  get user(): User | null {
    return this.userSubject.value;
  }

  get accessToken(): string | null {
    return this.session?.accessToken ?? null;
  }

  /**
   * Used by the route guard: true if the user is signed in with a usable token, refreshing it first
   * when it is (about to be) expired. False means "send them to /login".
   */
  async ensureSession(): Promise<boolean> {
    if (!this.session) return false;
    if (Date.now() < this.session.expiresAt - REFRESH_SKEW_MS) return true;
    return this.refresh();
  }

  /** Start the sign-in. Redirects the browser to GitLab (or fakes it in mock mode). */
  async login(returnUrl = '/racks'): Promise<void> {
    if (environment.auth.mode === 'mock') {
      this.signInAsDevUser();
      await this.router.navigateByUrl(safeReturnUrl(returnUrl));
      return;
    }

    const g = environment.gitlab;
    if (!g.clientId || g.clientId.startsWith('REPLACE_')) {
      throw new AuthError('GitLab application is not configured. Set gitlab.clientId (and baseUrl) in src/environments/environment.ts.');
    }

    const verifier = randomString(64); // PKCE secret, never leaves the browser until the token call
    const state = randomString(24); // CSRF protection, must come back unchanged
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
    sessionStorage.setItem(RETURN_KEY, safeReturnUrl(returnUrl));

    const params = new URLSearchParams({
      client_id: g.clientId,
      redirect_uri: g.redirectUri,
      response_type: 'code',
      scope: g.scope,
      state,
      code_challenge: await sha256Base64Url(verifier),
      code_challenge_method: 'S256',
    });
    window.location.assign(`${g.baseUrl}/oauth/authorize?${params}`);
  }

  /** Called by CallbackComponent with GitLab's ?code & ?state. Resolves to the URL to open next. */
  async completeLogin(code: string, state: string): Promise<string> {
    const expectedState = sessionStorage.getItem(STATE_KEY);
    const verifier = sessionStorage.getItem(VERIFIER_KEY);
    const returnUrl = sessionStorage.getItem(RETURN_KEY) ?? '/racks';
    [STATE_KEY, VERIFIER_KEY, RETURN_KEY].forEach((k) => sessionStorage.removeItem(k)); // one use only

    if (!expectedState || state !== expectedState || !verifier) {
      throw new AuthError('Sign-in could not be verified (state mismatch). Please try again.');
    }

    const g = environment.gitlab;
    const token = await this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: g.clientId,
      code,
      redirect_uri: g.redirectUri,
      code_verifier: verifier,
    });

    const info = await firstValueFrom(
      this.http.get<UserInfo>(`${g.baseUrl}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }),
    ).catch(() => {
      throw new AuthError('Could not read your GitLab profile.');
    });

    // AUTHORISATION: allowed groups only, or refuse the login.
    if (!authorize(info.groups ?? [])) {
      void this.revoke(token.access_token); // do not leave an unused token around
      throw new AuthError('Your GitLab account is not a member of a group allowed to use this application.');
    }

    this.setSession({
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + (token.expires_in ?? 7200) * 1000,
      user: {
        id: info.sub,
        username: info.nickname,
        name: info.name,
        avatarUrl: absoluteUrl(info.picture, g.baseUrl),
      },
    });
    return returnUrl;
  }

  /** Swap the refresh token for a new access token. Concurrent callers share one request. */
  refresh(): Promise<boolean> {
    if (environment.auth.mode === 'mock') return Promise.resolve(this.isAuthenticated);
    const current = this.session;
    if (!current?.refreshToken) {
      this.clearSession();
      return Promise.resolve(false);
    }
    this.refreshing ??= this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: environment.gitlab.clientId,
      refresh_token: current.refreshToken,
    })
      .then((t) => {
        // GitLab rotates refresh tokens: always store the new one.
        this.setSession({
          ...current,
          accessToken: t.access_token,
          refreshToken: t.refresh_token ?? current.refreshToken,
          expiresAt: Date.now() + (t.expires_in ?? 7200) * 1000,
        });
        return true;
      })
      .catch(() => {
        this.clearSession();
        return false;
      })
      .finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  logout(): void {
    const token = this.session?.accessToken;
    this.clearSession();
    if (token && environment.auth.mode === 'gitlab') void this.revoke(token);
    void this.router.navigate(['/login']);
  }

  // ---- internals -------------------------------------------------------------------------

  private tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    // GitLab's token endpoint expects a form-encoded body (HttpParams => application/x-www-form-urlencoded).
    return firstValueFrom(
      this.http.post<TokenResponse>(`${environment.gitlab.baseUrl}/oauth/token`, new HttpParams({ fromObject: body })),
    ).catch(() => {
      throw new AuthError('GitLab rejected the sign-in request.');
    });
  }

  /** Tell GitLab to invalidate the token (best effort - local sign-out already happened). */
  private revoke(token: string): Promise<unknown> {
    const body = new HttpParams({ fromObject: { client_id: environment.gitlab.clientId, token } });
    return firstValueFrom(this.http.post(`${environment.gitlab.baseUrl}/oauth/revoke`, body)).catch(() => undefined);
  }

  private signInAsDevUser(): void {
    this.setSession({
      accessToken: 'dev-token',
      expiresAt: Date.now() + 8 * 3600_000,
      user: environment.auth.devUser,
    });
  }

  private setSession(s: Session): void {
    this.session = s;
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage may be blocked */ }
    this.userSubject.next(s.user);
  }

  private clearSession(): void {
    this.session = null;
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
    this.userSubject.next(null);
  }

  private restoreSession(): void {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      this.session = JSON.parse(raw) as Session;
      this.userSubject.next(this.session.user);
      // An expired token is refreshed by ensureSession() the first time a protected route is opened.
    } catch {
      this.clearSession();
    }
  }
}

// ---- authorisation -------------------------------------------------------------------------

/**
 * Whether the user may use the app: they must be in one of `allowedGroups` (any GitLab user when empty).
 * That is the only access rule. There are no roles, and teams are display labels on environments only
 * (a user's team cannot be verified).
 */
export function authorize(groups: string[]): boolean {
  const { allowedGroups } = environment.authz;
  return allowedGroups.length === 0 || allowedGroups.some((w) => groups.includes(w));
}

/** GitLab normally sends a full avatar URL; if it sends a path (e.g. /uploads/...), it belongs to the GitLab host. */
function absoluteUrl(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, base).href;
  } catch {
    return undefined;
  }
}

/** Only same-app paths are allowed as a post-login target (prevents open redirects). */
function safeReturnUrl(url: string): string {
  return url.startsWith('/') && !url.startsWith('//') ? url : '/racks';
}

// ---- PKCE helpers --------------------------------------------------------------------------

function randomString(bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
