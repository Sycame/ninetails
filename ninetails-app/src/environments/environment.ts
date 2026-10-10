/**
 * Runtime configuration.
 * (Angular 22 projects have no fileReplacements by default; add a
 * environment.prod.ts + fileReplacements in angular.json when you need one.)
 */
export const environment = {
  /** true  -> ApiService reads /mock/*.json and DeployService simulates the call */
  useMock: false,
  appVersion: '0.1.0',
  /** Base URL of the Go backend REST API (versioned). Contract: docs/api.md. */
  apiBaseUrl: '/api/v1',

  /**
   * Baseline configuration (racks, servers, VMs, environments, teams). It is versioned and rarely changes;
   * the app also gets a push (`config.changed`) but checks the tiny version document this often as a safety net.
   * In mock mode: edit public/mock/config.json AND bump "version" in public/mock/config/version.json
   * and the running app picks the change up on the next check (or use Settings > Check for updates).
   */
  config: {
    pollMs: 60000,
  },

  /** Live status updates (Server-Sent Events from GET {apiBaseUrl}/events). */
  live: {
    enabled: true,
    /** In mock mode: generate fake status changes so the live UI can be developed without a backend. */
    simulateInMock: true,
    simulateEveryMs: 8000,
    /** While the stream is down, refetch the inventory this often as a fallback. */
    pollFallbackMs: 30000,
  },

  auth: {
    /**
     * 'gitlab' -> real OAuth 2.0 / OpenID Connect login against your GitLab application.
     * 'mock'   -> DEV BYPASS: no GitLab; you are signed in automatically as `devUser` at startup.
     * Independent from `useMock` above, so you can use real login with mock data.
     * !! Must be 'gitlab' for anything deployed - 'mock' grants access to everyone. !!
     */
    mode: 'mock' as 'gitlab' | 'mock',
    /** The user you are signed in as while mode is 'mock'. */
    devUser: { id: 'dev', username: 'dev', name: 'Dev User', avatarUrl: '/mock/avatar.svg' },
  },

  /**
   * The GitLab *Application* this app authenticates with. Create it in GitLab under
   * Admin area (or Group / User settings) > Applications:
   *   - Redirect URI : the `redirectUri` below (must match exactly)
   *   - Confidential : OFF  (browser apps cannot keep a secret; PKCE replaces it)
   *   - Scopes       : openid, profile, email, read_user
   * Then paste the generated "Application ID" into `clientId`. No secret is ever put in this app.
   */
  gitlab: {
    baseUrl: 'https://gitlab.example.com',
    clientId: 'REPLACE_WITH_GITLAB_APPLICATION_ID',
    redirectUri: `${window.location.origin}/auth/callback`,
    scope: 'openid profile email read_user',
  },

  /**
   * AUTHORISATION: decided from the GitLab *group* memberships returned in the OpenID `groups` claim
   * (full group paths, e.g. 'acme/infra/admins'). The backend must enforce the same rules.
   */
  authz: {
    /** Users must be in at least one of these groups to use the app. Empty = any GitLab user. */
    allowedGroups: [] as string[],
  },
};
