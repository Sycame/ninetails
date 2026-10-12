# Ninetails Rack Dashboard

Angular 22 · standalone components · Angular Material · RxJS services. No other UI/state libraries.

```
npm start      # runs against mock JSON; you are signed in automatically as a dev user
npm run build  # production build into dist/
```

## What it does

A dashboard for a small data-centre estate. It shows:

- **Racks**: a front view of each rack (units, chassis, servers, switches) with live health LEDs, and a
  detail drawer/page per node (health checks, network interfaces and link state, hosted VMs).
- **Environments**: each logical environment (labelled with the team that owns it) with the hardware and VMs it runs on, a rolled-up
  status, and a **Deploy** button.
- **Teams, Deployments, Settings**: team list, deployment history (updated live as pipelines progress), and
  the configuration version with a manual "Check for updates".

Sign-in is GitLab OAuth (see below); the backend is the Go service in `../ninetails-api`. With `useMock: true`
the app runs on its own against the JSON in `public/mock/`.

## Setup

Development and production both run on **Red Hat Enterprise Linux** (RHEL 8/9, or Rocky/Alma). All commands in this
file are bash and need `sudo` where shown. They were written for RHEL but have not been run on a real host, so check each one.

You need **Node.js 22** and **npm 12** (the versions the project was built with; `package.json` pins `npm@12.2.0`).
Nothing else is required: fonts and icons are in the repo, and there is no external service in mock mode.

```
node -v && npm -v                          # already 22.x and 12.x? skip the install
sudo dnf module list nodejs                # which streams does your RHEL release offer?
sudo dnf module enable -y nodejs:22 && sudo dnf install -y nodejs
```

If your release does not offer a `nodejs:22` stream, install Node 22 from https://nodejs.org/en/download (Linux binaries)
or with a version manager such as `nvm`, and check the result with `node -v`. If `npm -v` is not 12.x, run
`sudo npm install -g npm@12.2.0`.

```
cd ninetails-app
npm install
```

### Developing on a remote RHEL server

If the code lives on a RHEL server and your browser is on another machine, forward the ports over SSH instead of
opening the firewall. From your own machine:

```
ssh -L 4200:localhost:4200 -L 8080:localhost:8080 you@dev-host
```

Then run `npm start` (and the API) on the server and browse to http://localhost:4200 locally. This also keeps the
dev URL on `localhost`, which is what the dev redirect URI `http://localhost:4200/auth/callback` expects when you test
GitLab sign-in. If you must reach the dev server directly instead, run `npm start -- --host 0.0.0.0` and open the
port with `sudo firewall-cmd --add-port=4200/tcp` (temporary; it is gone after a reload). The dev server may also refuse an
unfamiliar host name; the `--allowed-hosts` option of `ng serve` is the fix.

## Run

| Goal | Command | Notes |
|---|---|---|
| Develop with mock data | `npm start` | Serves http://localhost:4200 and reloads on save. Defaults: `useMock: true`, `auth.mode: 'mock'`, so no backend and no login. |
| Develop against the Go API | start `../ninetails-api` (`go run ./cmd/ninetails-api`), set `useMock: false` in `src/environments/environment.ts`, then `npm start` | `proxy.conf.json` forwards `/api` to `localhost:8080`, so there is no CORS setup. Keep `auth.mode: 'mock'` for the dev login, or `'gitlab'` for real sign-in. |
| Production build | `npm run build` | Output in `dist/ninetails-app/browser`, ready for any static web server. It must be served from the same origin as the API (or proxy `/api` to it). |
| Rebuild on change | `npm run watch` | Development build in watch mode. |

Before deploying anywhere real: set `auth.mode: 'gitlab'` (`'mock'` lets everyone in), `useMock: false`, and fill in the
`gitlab` and `authz` blocks of `environment.ts` (see "GitLab sign-in" below).

## Production on Red Hat Enterprise Linux

The build output is plain static files, so the RHEL server only needs a web server (nginx below); Node is needed
only where you build. These steps are for RHEL 8/9 with SELinux enforcing and have not been run on a real host yet,
so verify each one. The API's own install steps are in `../ninetails-api/README.md`.

### 1. Configure and build (on your RHEL development machine or a CI runner)

`src/environments/environment.ts` is compiled into the bundle, and the project has no per-environment file
replacement, so edit it for production **before** building:

- `useMock: false`
- `auth.mode: 'gitlab'` (`'mock'` lets everyone in)
- `gitlab.baseUrl`, `gitlab.clientId`, and the `authz` groups. `redirectUri` is derived from the page's own origin, so
  register `https://<your-host>/auth/callback` as the Redirect URI in the GitLab Application.

```
npm ci
npm run build          # output: dist/ninetails-app/browser
```

Use `npm ci` rather than `npm install` in CI: it installs exactly what `package-lock.json` says.

### 2. Install the web server and the files

On the production host (once):

```
sudo dnf install -y nginx rsync
sudo mkdir -p /var/www/ninetails
```

From the build machine, copy the build over (the target folder must be writable by that SSH user, or copy to a staging
folder and `sudo rsync` into place):

```
rsync -a --delete dist/ninetails-app/browser/ you@prod-host:/tmp/ninetails-browser/
```

On the production host:

```
sudo rsync -a --delete /tmp/ninetails-browser/ /var/www/ninetails/
sudo restorecon -R /var/www/ninetails           # correct SELinux label for web content
```

### 3. nginx configuration

`/etc/nginx/conf.d/ninetails.conf` (adjust the host name and certificate paths):

```
server {
    listen 443 ssl http2;       # "http2 on;" needs nginx 1.25.1+, newer than RHEL 8/9 ship
    server_name ninetails.yourcompany.com;
    ssl_certificate     /etc/pki/tls/certs/ninetails.crt;
    ssl_certificate_key /etc/pki/tls/private/ninetails.key;

    root /var/www/ninetails;
    index index.html;

    # The app is a single-page app: /racks, /envs/42, /auth/callback ... are routes, not files.
    location / {
        try_files $uri /index.html;
    }

    # Live updates (Server-Sent Events): no buffering, long timeout, no gzip.
    location = /api/v1/events {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        gzip off;
        proxy_read_timeout 1h;
    }

    # The rest of the API (and the Swagger docs, if you want them reachable).
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ~ ^/(docs|openapi\.json|healthz)$ {
        proxy_pass http://127.0.0.1:8080;
    }

    # Fingerprinted bundles can be cached forever; index.html must always be re-checked.
    location ~* \.(js|css|woff2?|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}

server {
    listen 80;
    server_name ninetails.yourcompany.com;
    return 301 https://$host$request_uri;
}
```

```
sudo nginx -t
sudo setsebool -P httpd_can_network_connect 1      # allow nginx -> the API on 127.0.0.1:8080
sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload
sudo systemctl enable --now nginx
```

### 4. Updating

Rebuild, then `rsync` the new `browser/` folder over `/var/www/ninetails/` (with `--delete`, so removed bundles
disappear) and run `restorecon -R /var/www/ninetails`. No restart is needed. Users get the new version on their next page load.

### Troubleshooting

- **`npm start` fails with `ENOSPC: System limit for number of file watchers reached` (development):** raise the
  Linux limit: `echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/90-inotify.conf && sudo sysctl --system`.
- **Blank page or 404 on a deep link / on the GitLab callback:** the `try_files $uri /index.html` fallback is missing.
- **403 on every file:** wrong SELinux label (run `restorecon -R`) or the files are not readable by nginx.
- **502 on `/api`:** the API is not running, or `httpd_can_network_connect` is off. Check `systemctl status ninetails-api`.
- **Data loads but the status dots never change:** the proxy is buffering `/api/v1/events`; check the `location =` block above.
- **GitLab says "redirect URI is not valid":** the Redirect URI in the GitLab Application must match
  `https://<your-host>/auth/callback` exactly.
- **Sign-in works but every API call is 401:** the API's `NINETAILS_GITLAB_URL` does not match the GitLab in `environment.ts`
  (it asks the wrong server who the token belongs to), or the user is outside `NINETAILS_ALLOWED_GROUPS` (that is a 403).

## Using the app

Once signed in, the left navigation has five views. The header has a light/dark toggle, your name,
and **Logout**. The footer shows the overall health and the time of the last sync.

- **Racks**: shows one rack at a time. Use the arrows (or Page Up / Page Down) to move between racks. Each server and
  switch is coloured by its status (`OK`, `WARN`, `FAIL`). Click one to open its detail drawer, with health checks,
  network interfaces and link state, and the VMs it hosts; a link like `/racks/<rack>?node=<id>` opens a rack with that node's drawer already open.
- **Environments**: lists every environment with its status. Filter by team, switch between "By team" and "All", and
  expand an environment to see the servers, switches and VMs it uses. **Open page** shows one environment alone.
  Press **Deploy** on an environment to start a deployment. Any signed-in user can deploy to any environment (a user's team cannot be verified, so teams are
  labels, not permissions). Locked environments and ones already deploying refuse the request, and the button shows
  the reason.
- **Teams**: the teams and the environments they own.
- **Deployments**: the 50 most recent deployments, newest first. Rows move from queued to running to succeeded or failed
  by themselves, with no page reload.
- **Settings**: the app version, the data source, and the loaded configuration baseline (version, publish time, change
  description, counts). **Check for updates** fetches a newer baseline right away. Normally you never need it, because
  a published change appears on its own and a "Configuration updated" message pops up.

Status colours change live while the page is open. If the connection to the backend drops, the app keeps showing the
last known state, reconnects by itself, and refreshes everything when it is back.

## Folder structure

```
public/mock/               config.json status.json deployments.json config/version.json   (mock API)
docs/api.md                the REST + SSE contract shared with the backend
proxy.conf.json            ng serve proxies /api to the Go service on localhost:8080
src/environments/          environment.ts   (mock switches, polling, GitLab client id, authz groups)
src/fonts.scss, neon.scss, styles.scss   self-hosted fonts, theme, global Material overrides
src/app/
  app.ts / app.config.ts / app.routes.ts   bootstrap, providers (router, HttpClient + interceptor), lazy routes
  core/                    all data and logic, no UI:
    models.ts                types: Status, Rack, Server, Switch, Vm, Environment, ConfigBaseline, StatusSnapshot, LiveEvent, ...
    api.service.ts           the only HTTP client wrapper (retries GETs, normalises errors); api-endpoints.ts lists the paths
    config.service.ts        the baselined configuration: versioned, cached, swapped atomically
    status.service.ts        live state snapshot, patched by events
    live-status.service.ts   Server-Sent Events connection (reconnect, resync, mock simulator); sse-parser.ts
    merge.ts                 baseline + live state -> what the UI renders
    rack.service.ts          merged racks/VMs/nodes, current rack selection, overall health
    rack-rules.ts            pure layout rules (slot occupancy, overlap checks)
    env.service.ts           environments joined with teams, nodes, VMs and rolled-up status
    deploy.service.ts        start a deployment, keep history
    auth.service.ts, auth.guard.ts, auth.interceptor.ts   GitLab sign-in, route guard, bearer token
    theme.service.ts         light/dark theme
  shared/                  material.module.ts, status-badge.component, logo.component (the trident logo)
  layout/                  shell (header, navbar, footer; starts data loading and the live stream)
  features/
    login/                 login, callback (OAuth redirect target)
    racks/                 rack-view, rack-layout, node-details (drawer)
    envs/                  env-list (team filter), env-tree, env-detail, deploy-button
    misc/                  teams, deployments, settings
```

## How it works

### Two feeds of data

The data is split by how often it changes, and the two halves are only joined in the UI layer:

| Feed | Service | Contents | Changes |
|---|---|---|---|
| **Baseline configuration** | `ConfigService` | racks, chassis, servers, switches, network settings, VMs, environments, teams | rarely; published as a new `version` |
| **Live status** | `StatusService` | status (`OK`/`WARN`/`FAIL`), health checks, link up/down per node and VM | constantly |

```
 backend                         services (core/)                          UI
 GET /config, /config/version -> ConfigService  -- racks$/vms$/envs$ --+
 GET /status                  -> StatusService  -- snapshot$ ----------+--> RackService (merge.ts) --> racks$, vms$, nodes$, health$
 GET /events (SSE)            -> LiveStatusService -- events$ --> Config/Status/Deploy services      \-> EnvService --> summaries$
 POST /environments/{id}/deployments <- DeployService                                                  components (async pipe)
```

### Startup

1. `authGuard` runs on the shell route. It calls `ensureSession()`, which silently refreshes an expired token, and
   otherwise redirects to `/login?returnUrl=...`.
2. `ShellComponent` starts everything: `EnvService.load()` (which calls `ConfigService.sync()` and
   `StatusService.load()`) and `LiveStatusService.start()`. It stops the stream when the shell is destroyed.
3. The cached baseline (`localStorage`) is shown immediately, then the app asks `GET /config/version` and only
   downloads `GET /config` when the version differs.

### Keeping it current

- **Live status:** `LiveStatusService` reads `GET /events` (Server-Sent Events) with `fetch`, so it can send the
  bearer token. Events: `node.updated`, `vm.updated`, `deployment.updated`, `config.changed`. `StatusService` patches
  its snapshot in place; only colours/LEDs change.
- **Baseline changes:** a `config.changed` event, a 60 s poll (`environment.config.pollMs`), a reconnect, or the
  Settings button all trigger `ConfigService.sync()`. A new version replaces the old one in one step and the shell
  shows a "Configuration updated" toast. Layout mistakes in a new baseline are logged by `rack-rules.ts`.
- **Resilience:** the stream reconnects with exponential backoff and jitter, treats 45 s of silence (the server pings
  every ~15 s) as a dead connection, emits `resync` after every reconnect so services refetch what they may have
  missed, and while it is down emits `resync` every 30 s as a polling fallback. A 401 triggers one token refresh.

### Merging and roll-ups

`merge.ts` combines baseline and status: before the first snapshot arrives everything shows `OK` (no warning flash);
afterwards anything the status feed does not report shows `WARN: No status reported`. `worstStatus()` rolls child
statuses up to racks and environments. `EnvService.summaries$` joins environments, teams, nodes and VMs, including
VMs that run on hardware belonging to another environment.

### Routes

All routes except `/login` and `/auth/callback` are children of the shell and lazy-loaded.

| Path | Page |
|---|---|
| `/racks`, `/racks/:id` | rack front view (previous/next rack navigation) |
| `/envs`, `/envs/:id` | environment list (team filter) and detail with Deploy |
| `/teams`, `/deployments`, `/settings` | team list, deployment history, config version and update check |

### Deploying

The Deploy button calls `DeployService.deploy(envId)` (`POST /environments/{envId}/deployments`). The backend answers
`202` with a `queued` deployment, which the button shows as success. The pipeline's progress then arrives as
`deployment.updated` events and appears on the Deployments page. Writes are never retried automatically, and the
backend can refuse (`403 forbidden`, `409 env_locked`, `409 deploy_in_progress`).

### Mock mode

With `useMock: true`, `ApiService` reads `/mock/<path>.json` instead of calling the backend, `DeployService`
fakes the call, and `LiveStatusService` generates random status changes every `simulateEveryMs`. To simulate a
published baseline, edit `public/mock/config.json` **and** bump `version` in `public/mock/config/version.json`.
`auth.mode: 'mock'` (independent of `useMock`) skips GitLab and signs you in as `devUser`.

## Offline / self-hosted assets

The app needs no internet. All fonts and icons live in the repo under `src/fonts/` and are declared in
`src/fonts.scss`: **Material Symbols Outlined** (every `<mat-icon>`; set as the default icon font in
`app.config.ts`) and **Roboto** 300/400/500. Do not add CDN links or `<link>` tags to `index.html`.
The logo is the head of a trident (Material Symbols style, with a gradient and a small spark): `src/app/shared/logo.component.ts` draws it inline for the header and the login page and follows the light/dark theme; `public/favicon.svg` is the browser-tab icon (it cannot read theme colours, so it has fixed colours) and `public/favicon.ico` is the same drawing as a fallback. The GitLab icon on the sign-in button is registered inline in `app.config.ts`. To change the logo, edit the paths in those three places. Any future images/video go in `public/` (or `src/assets`) and are referenced by relative path.
Licenses are next to the font files (Material Symbols: Apache 2.0, Roboto: SIL OFL 1.1). Only the signed-in user's profile picture (the `picture` from GitLab's userinfo, shown in the header; the generic icon appears if there is none or it fails to load; in mock mode `/mock/avatar.svg`) is fetched at runtime, which is normally
from your own GitLab host.

## Architecture

- **State = RxJS services.** Each service owns a private `BehaviorSubject` and exposes read-only
  `Observable`s. Data comes in two independent feeds: the **baselined configuration** (`ConfigService`,
  versioned, pulled/pushed, cached) and the **live status** (`StatusService`, snapshot + events). `RackService`
  merges them (`core/merge.ts`) and `EnvService.summaries$` joins environments, teams, nodes and VMs with
  `combineLatest`, so status roll-ups are always consistent. See [docs/api.md](docs/api.md).
- **Components are dumb readers**: `async` pipe for streams, `signal`/`input()` for local state and
  route params (`withComponentInputBinding`), `toObservable` to bridge a signal input back into a stream.
- **Why not NgRx?** The data is small, read-mostly, and has one writer per slice. NgRx would add
  actions/reducers/effects/selectors (4+ files per feature) for no benefit here. If you later need
  time-travel debugging, optimistic updates across many features, or large entity caches, the
  service API (`xxx$` + `load()`) is easy to swap for a store behind the same methods.
- **Status model**: `Status = 'OK' | 'WARN' | 'FAIL'`; `worstStatus()` rolls child statuses up to racks/envs.

## Going live

1. Set `useMock: false` in `environment.ts` once the Go backend exists and proxy `/api` to it.
2. The REST contract, live-update (SSE) protocol and a Go sketch are in **[docs/api.md](docs/api.md)**.

## GitLab sign-in (OAuth 2.0 + OpenID Connect)

Login and authorisation go through a **GitLab Application**; the app never sees a password or a client secret.

1. **Create the application** in GitLab: Admin area > Applications (instance-wide), or a group's
   Settings > Applications. Set:
   - Redirect URI: `https://<your-app-host>/auth/callback` (and `http://localhost:4200/auth/callback` for dev). Must match `gitlab.redirectUri` exactly.
   - **Confidential: off** (a browser app cannot keep a secret; PKCE protects the code exchange instead).
   - Scopes: `openid`, `profile`, `email`, `read_user`.
2. **Configure the app** in `src/environments/environment.ts`: `gitlab.baseUrl` (your GitLab URL),
   `gitlab.clientId` (the Application ID), and `auth.mode: 'gitlab'`. Use `'mock'` only for UI work without GitLab.
3. **Authorisation** is decided from the user's GitLab group memberships (the OpenID `groups` claim):
   - `authz.allowedGroups` - only members may sign in (empty = any GitLab user);
   - That is the only access rule. There are no roles, and teams are **not** part of access: a user's team cannot be verified, so teams are only labels on environments (and the Teams page / filters). Everyone let in can deploy to any environment.
4. **How the flow works**: Sign in > redirect to GitLab (`/oauth/authorize`, PKCE challenge + random `state`) >
   GitLab redirects to `/auth/callback?code&state` > app verifies `state`, exchanges the code at `/oauth/token`
   with the PKCE verifier, reads `/oauth/userinfo`, applies the group rules, stores the session. Expired
   access tokens are refreshed silently with the refresh token (route guard and on a 401); Logout revokes
   the token at GitLab (`/oauth/revoke`).
5. GitLab must allow the app's origin to call `/oauth/token`, `/oauth/userinfo` and `/oauth/revoke`
   from the browser (CORS). GitLab permits this for these endpoints; if a reverse proxy strips the headers, fix it there.
   The backend must still validate the bearer token and enforce the same group rules.

## Token storage and production next steps

- **Demo behaviour**: PKCE code flow; token in memory + `sessionStorage`. Any XSS can read it.
- **Better**: a small backend (BFF) performs the code exchange, keeps GitLab tokens server side and
  gives the browser an `HttpOnly; Secure; SameSite=Lax` session cookie. Then delete the token logic
  from `AuthService` and the interceptor.
- **Short-lived access tokens + refresh**: GitLab tokens expire (~2h). Refresh server side in the BFF;
  if you must refresh in the SPA, do it in the interceptor on 401 and queue concurrent requests.
- **Never** log tokens, put them in URLs, or send them to non-API hosts (the interceptor already
  restricts to `apiBaseUrl`). Add a strict CSP.
- **Validate the ID token / userinfo on the backend** and make the backend, not the UI, enforce
  authorization. Hiding buttons is not security.
- **Live health**: replace polling with a WebSocket/SSE stream that pushes `{nodeId, status, checks}`;
  merge into `RackService.racksSubject` so every view updates with no component changes.
- Also: deploy history from the backend, pipeline status polling after POST /deploy, and an
  `environment.prod.ts` via `fileReplacements`.
