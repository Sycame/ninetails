# Ninetails: deploying to production (RHEL 8 / RHEL 9)

Manual, step-by-step deployment of the Go API and the Angular app onto **one** RHEL 8 or RHEL 9 virtual machine.
The steps are grouped so they can be moved into a GitLab pipeline later with little rewriting: see
[Section 12](#12-turning-this-into-a-cicd-pipeline-later). Where something would change in a pipeline, it says so.

> **Read this first: what "production" means today**
>
> The backend still uses **mock data and simulators** for the parts that do not exist yet. Deploying it
> as described here gives you a real, secured, correctly hosted system, but:
>
> - The **baseline** (racks, servers, VMs, environments, teams) is the sample data compiled into the binary, unless you
>   supply your own file with `NINETAILS_CONFIG_FILE` (Section 6). **You will almost certainly want to do that.**
> - **Live status** starts from the sample status file and, with `NINETAILS_SIMULATE=false`, **never changes**: there is
>   no monitoring collector yet.
> - **Deployments** are recorded, but nothing runs a pipeline, so a new deployment **stays `queued` forever** with
>   `NINETAILS_SIMULATE=false`. With `NINETAILS_SIMULATE=true` it would instead show fake status flips to real users.
> - Everything is **in memory**: restarting the service resets status and deployment history.
>
> Real integrations replace `internal/sim` (see "Replacing the mocks" in `ninetails-api/README.md`). The deployment
> procedure below does not change when they do.
>
> The dev tools (`/api/v1/dev/*`) are switched off in this setup, because `NINETAILS_AUTH=gitlab` disables them and the
> service refuses to start with both.

---

## 1. What you are deploying

```
 browser --HTTPS--> nginx :443 --+-- /            static Angular files   /var/www/ninetails/current
                                 +-- /api/...     proxy --> 127.0.0.1:8080  ninetails-api (systemd service)
                                 +-- /api/v1/events  same, with buffering OFF (live updates)
```

| Piece | What it is | Where it lives on the VM |
|---|---|---|
| API | One static Linux executable, no runtime needed | `/opt/ninetails-api/ninetails-api` |
| API settings | Environment file | `/etc/ninetails-api.env` |
| API baseline (optional) | `config.json` the service loads and watches | `/var/lib/ninetails/config.json` |
| App | Static files (HTML/JS/CSS) from `ng build` | `/var/www/ninetails/releases/<version>/`, symlink `current` |
| Web server | nginx, TLS, reverse proxy | `/etc/nginx/conf.d/ninetails.conf` |

The VM needs **no** Go, **no** Node and no database. Building happens elsewhere (your Windows machine, a build host or
later the GitLab runner); the VM only receives two build outputs.

## 2. Before you start: information and decisions

Collect these first. Every `<...>` placeholder in the rest of this document comes from here.

| Item | Example | Notes |
|---|---|---|
| Public host name | `ninetails.yourcompany.com` | DNS must point at the VM. |
| TLS certificate + key | from your internal CA / Let's Encrypt | HTTPS is required: GitLab sign-in and bearer tokens must not travel over HTTP. |
| GitLab URL | `https://gitlab.yourcompany.com` | |
| GitLab Application ID | from Section 3 | Safe to put in the app (no secret is used). |
| GitLab group | `acme/infra` (allowed) | Group **path**. The only access rule; there are no roles. Teams are not mapped from GitLab: they are only labels on environments in the baseline. |
| Pipelines base URL | `https://gitlab.yourcompany.com/acme/app/-/pipelines` | Used for links in the deployment list. |
| Release version | `0.1.0` or a date/commit | Names the release folder and lets you roll back. |
| SSH user with sudo on the VM | `deploy` | |
| VM CPU | x86-64 (`amd64`) or ARM (`arm64`) | `uname -m` on the VM. |

## 3. Create the GitLab Application (once)

The app signs users in with GitLab (OAuth 2.0 / OpenID Connect with PKCE). It never sees passwords or a secret.

1. GitLab: **Admin area > Applications** (instance-wide) or a group's **Settings > Applications** > **New application**.
2. **Redirect URI:** `https://<host>/auth/callback` exactly (no trailing slash difference, https, correct host).
3. **Confidential:** **off** (a browser app cannot keep a secret; PKCE protects the exchange).
4. **Scopes:** `openid`, `profile`, `email`, `read_user`.
5. Save, and copy the **Application ID**.

The browser calls GitLab's `/oauth/token`, `/oauth/userinfo` and `/oauth/revoke` directly, so GitLab must allow
cross-origin calls for those endpoints (it does by default; a reverse proxy in front of GitLab that strips the headers
would break sign-in).

## 4. Configure the app for production (build machine)

The app's settings are **compiled into the bundle** and there is no per-environment file yet, so edit
`ninetails-app/src/environments/environment.ts` **before building**:

```ts
useMock: false,                                   // use the real API
apiBaseUrl: '/api/v1',                            // same origin through nginx, leave as is
auth: {
  mode: 'gitlab',                                 // NEVER leave 'mock': it signs in everybody
  devUser: { ... },                               // ignored with mode 'gitlab', leave
},
gitlab: {
  baseUrl: 'https://gitlab.yourcompany.com',
  clientId: '<Application ID from Section 3>',
  // redirectUri is derived from the page origin, nothing to change
},
authz: {
  allowedGroups: ['acme/infra'],                  // who may sign in (empty = any GitLab user!)
},
```

Also set `live.simulateInMock` is irrelevant with `useMock: false`. Do not edit anything else.

**These must agree with the API settings in Section 7:** `authz.allowedGroups` here
corresponds to `NINETAILS_ALLOWED_GROUPS`. The app uses its copy to refuse sign-in; the API enforces its own
on every request. If they differ, a user the app lets in gets 403 on every call.

> **Pipeline note:** this hand-edit is the part most worth automating. When CI arrives, add an
> `environment.prod.ts` plus `fileReplacements` in `angular.json` (or generate the file from CI variables) so the
> checked-in file stays on dev values and nobody has to remember to edit and revert it.

## 5. Build (build machine)

The two builds do not depend on the OS they run on, so a Windows machine can produce what a RHEL server runs.

**App** (needs Node 22 and npm 12):

```
cd ninetails-app
npm ci
npm run build
```

Output: `ninetails-app/dist/ninetails-app/browser/` (contains `index.html` and hashed `.js`/`.css`). `npm ci` installs
exactly what `package-lock.json` says, so use it instead of `npm install` for release builds.

**API** (needs Go 1.24+). Static binary for Linux, no dependency on the VM's libraries, so it runs on RHEL 8 and 9:

PowerShell (Windows):

```powershell
cd ninetails-api
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'    # arm64 if the VM is ARM
go vet ./...
go build -trimpath -ldflags "-s -w" -o ninetails-api ./cmd/ninetails-api
Remove-Item Env:GOOS,Env:GOARCH,Env:CGO_ENABLED
```

bash (RHEL / Linux):

```
cd ninetails-api
go vet ./...
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ninetails-api ./cmd/ninetails-api
```

Check: the file `ninetails-api` exists, is a few MB, and `file ninetails-api` (Linux) says "statically linked".

**Package the release** (one folder to hand over, names matter for Section 9):

```
release-0.1.0/
  ninetails-api              the executable
  config.json                optional baseline (Section 6); omit to use the built-in sample
  web/                       the contents of dist/ninetails-app/browser
```

## 6. Prepare your real baseline (recommended, once and then per change)

The baseline is the inventory: racks, chassis, servers, switches, VMs, environments, teams. Start from the sample
and replace it with your own.

1. Copy `ninetails-api/data/config.json` and edit it. Rules checked on every load: unique ids, every reference resolves
   (rack, chassis, host, environment, team), everything fits its rack without overlap, no unknown fields.
2. Set `version` (text, e.g. `2026.10.1`) and `description` (e.g. the change ticket).
3. Test it before it goes anywhere: on your dev machine,
   `NINETAILS_CONFIG_FILE=<path> go run ./cmd/ninetails-api` and check the log says `baseline published` (a bad file
   stops the service at startup with the list of problems).

Later changes to the inventory are edits to this one file on the server (Section 11), with a bumped `version`.
Teams are display labels only (each environment names the team that owns it). Who may deploy where is not enforced by the system: every signed-in user can deploy to any environment, so manage that by trust and by who is allowed into the GitLab group.

## 7. Prepare the VM (once)

All commands on the VM, as a user with `sudo`. Works on RHEL 8 and RHEL 9 unless noted.

### 7.1 Packages and services

```
sudo dnf install -y nginx rsync policycoreutils-python-utils
sudo systemctl enable nginx            # started later, after it has a config and certificate
```

RHEL 8's default nginx may be old (1.14); it is fine for this configuration. If you prefer a newer one:
`sudo dnf module enable nginx:1.22` (check `sudo dnf module list nginx` for what your release offers).

### 7.2 Service account and folders

```
sudo useradd --system --home-dir /var/lib/ninetails --shell /sbin/nologin ninetails
sudo install -d -o root -g root -m 755 /opt/ninetails-api
sudo install -d -o ninetails -g ninetails -m 750 /var/lib/ninetails
sudo install -d -o root -g root -m 755 /var/www/ninetails/releases
sudo install -d -o root -g root -m 750 /var/ninetails-staging
sudo chown deploy /var/ninetails-staging        # the SSH user that uploads releases; replace "deploy"
```

The binary stays under `/opt` (never a home directory: SELinux blocks services from running files labelled as home
content).

### 7.3 API settings

Create `/etc/ninetails-api.env` (plain `NAME=value`, one per line, **no quotes**):

```
NINETAILS_ADDR=127.0.0.1:8080
NINETAILS_AUTH=gitlab
NINETAILS_GITLAB_URL=https://gitlab.yourcompany.com
NINETAILS_ALLOWED_GROUPS=acme/infra
NINETAILS_PIPELINE_URL=https://gitlab.yourcompany.com/acme/app/-/pipelines
NINETAILS_CONFIG_FILE=/var/lib/ninetails/config.json
NINETAILS_SIMULATE=false
NINETAILS_LOG_LEVEL=info
```

```
sudo chown root:ninetails /etc/ninetails-api.env
sudo chmod 640 /etc/ninetails-api.env
```

What matters:

| Setting | Why |
|---|---|
| `NINETAILS_ADDR=127.0.0.1:8080` | Only nginx on the same VM talks to the API; it is never exposed directly. |
| `NINETAILS_AUTH=gitlab` | Anything else (`dev`) accepts everyone without login and enables the dev tools. |
| `NINETAILS_GITLAB_URL` | Must be the **same GitLab** as `gitlab.baseUrl` in the app, or every API call is 401. |
| `NINETAILS_ALLOWED_GROUPS` | Empty means any GitLab user may use the service. Set it. |
| `NINETAILS_CONFIG_FILE` | Your baseline (Section 6). Without it the sample inventory is served. |
| `NINETAILS_SIMULATE=false` | No fake changes. See the warning at the top. |
| `NINETAILS_CORS_ORIGIN` | Leave unset: app and API share one origin through nginx. |

The full list is in `ninetails-api/README.md` ("Configuration").

### 7.4 systemd unit

`/etc/systemd/system/ninetails-api.service`:

```
[Unit]
Description=Ninetails API
After=network-online.target
Wants=network-online.target

[Service]
User=ninetails
Group=ninetails
EnvironmentFile=/etc/ninetails-api.env
ExecStart=/opt/ninetails-api/ninetails-api
Restart=on-failure
RestartSec=2
# Shuts down cleanly on SIGTERM; give open event streams time to close.
TimeoutStopSec=15
# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/ninetails

[Install]
WantedBy=multi-user.target
```

```
sudo systemctl daemon-reload
sudo systemctl enable ninetails-api       # starts at boot; first start happens in Section 9
```

### 7.5 TLS certificate

Put the certificate chain and key where nginx can read them, with the key private:

```
sudo install -o root -g root -m 644 ninetails.crt /etc/pki/tls/certs/ninetails.crt          # full chain
sudo install -o root -g root -m 600 ninetails.key /etc/pki/tls/private/ninetails.key
sudo restorecon -v /etc/pki/tls/certs/ninetails.crt /etc/pki/tls/private/ninetails.key
```

Use whatever your organisation uses (internal CA, ACME client such as `certbot` or `lego`). Note the renewal procedure
for later: the certificate files are replaced and `sudo systemctl reload nginx` is run.

### 7.6 nginx

`/etc/nginx/conf.d/ninetails.conf` (replace the host name):

```
server {
    listen 80;
    server_name ninetails.yourcompany.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ninetails.yourcompany.com;

    ssl_certificate     /etc/pki/tls/certs/ninetails.crt;
    ssl_certificate_key /etc/pki/tls/private/ninetails.key;
    ssl_protocols       TLSv1.2 TLSv1.3;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy same-origin always;
    # add_header Strict-Transport-Security "max-age=31536000" always;   # enable once HTTPS is confirmed stable

    root /var/www/ninetails/current;
    index index.html;

    # Single-page app: /racks, /envs/42, /auth/callback ... are routes, not files.
    location / {
        try_files $uri /index.html;
    }

    # Live updates (Server-Sent Events): no buffering, long timeout, no gzip. Without this the dots update late.
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

    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check for monitoring. Swagger UI (/docs, /openapi.json) is deliberately not exposed in production;
    # to expose it to your own network only, add: location ~ ^/(docs|openapi\.json) { allow 10.0.0.0/8; deny all; proxy_pass http://127.0.0.1:8080; }
    location = /healthz {
        proxy_pass http://127.0.0.1:8080;
    }

    # Fingerprinted bundles can be cached for a year; index.html must always be re-checked.
    location ~* \.(js|css|woff2?|ico)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }
    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

`listen 443 ssl http2;` works on every nginx shipped with RHEL 8 and 9 (newer nginx prints a harmless deprecation
notice for it).

### 7.7 SELinux and firewall

```
sudo setsebool -P httpd_can_network_connect 1          # lets nginx connect to the API on 127.0.0.1:8080
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

Do **not** open port 8080. Only nginx reaches the API.

`sudo nginx -t` should say "syntax is ok" and "test is successful". Do not start nginx yet; the web root is still empty.

## 8. Upload a release (from the build machine)

```
# from the folder holding release-0.1.0/
scp -r release-0.1.0 deploy@<vm>:/var/ninetails-staging/
```

(`rsync -a release-0.1.0/ deploy@<vm>:/var/ninetails-staging/release-0.1.0/` also works and is quicker for repeats.)

Optionally verify the binary arrived intact: compare `sha256sum` (Linux) / `Get-FileHash` (Windows) of
`ninetails-api` on both sides.

## 9. Install and start the release (on the VM)

Set the version once for the session: `REL=0.1.0` (the folder name is `/var/ninetails-staging/release-$REL`).

**First deployment**

```
# 1. API: binary and (optional) baseline
sudo install -o root -g root -m 755 /var/ninetails-staging/release-$REL/ninetails-api /opt/ninetails-api/ninetails-api
sudo install -o ninetails -g ninetails -m 640 /var/ninetails-staging/release-$REL/config.json /var/lib/ninetails/config.json   # skip if no baseline file
sudo restorecon -v /opt/ninetails-api/ninetails-api

# 2. App: a new release folder, then switch the "current" link to it
sudo mkdir -p /var/www/ninetails/releases/$REL
sudo rsync -a --delete /var/ninetails-staging/release-$REL/web/ /var/www/ninetails/releases/$REL/
sudo restorecon -R /var/www/ninetails
sudo ln -sfn /var/www/ninetails/releases/$REL /var/www/ninetails/current

# 3. Start
sudo systemctl start ninetails-api
sudo nginx -t && sudo systemctl start nginx
```

**Every later deployment** (no config change needed): repeat 1 and 2 (do not overwrite `config.json` unless the baseline
changed, see Section 11), then:

```
sudo systemctl restart ninetails-api       # brief blip; open apps reconnect and resync by themselves
```

Do not restart nginx for an app-only change: switching the `current` link is enough and instant. Users get the new
version on their next page load.

> **Pipeline note:** Sections 8 and 9 are the "deploy" job: copy the release to the VM, run these commands over SSH,
> then run the checks in Section 10. See Section 12.

## 10. Verify (every deployment)

On the VM:

```
systemctl status ninetails-api                       # active (running)
journalctl -u ninetails-api -n 30 --no-pager         # shows "listening", "auth: validating GitLab tokens", "baseline published"
curl -s http://127.0.0.1:8080/healthz                # {"ok":true,"configVersion":"...","eventClients":N}
curl -sI https://<host>/ | head -1                   # HTTP/2 200
curl -s https://<host>/healthz                       # same JSON through nginx
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/status      # 401 (no token): auth is on
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/api/v1/dev          # 401 or 404, never 200: dev tools are off
```

Expected log lines must **not** include `DEV MODE` or `simulation on` or `dev tools on`. If they do, `/etc/ninetails-api.env`
is not being read or has the wrong values.

In a browser (a user who is in `NINETAILS_ALLOWED_GROUPS`):

1. Open `https://<host>/`. You are redirected to GitLab, sign in, and come back to the Racks page.
2. The header shows your name. Deploy is available on every environment (except locked ones).
3. F12 > Network: requests to `/api/v1/config` and `/api/v1/status` return 200, and `/api/v1/events` stays open.
4. **Settings** shows the expected configuration version and the data source.
5. A user outside the allowed groups is refused (a 403 message), not shown data.
6. Reload on a deep link, for example `https://<host>/envs`: the page loads (proves the `try_files` fallback).

## 11. Day-two operations

### Publish a new baseline (inventory change)

No restart needed:

```
sudoedit /var/lib/ninetails/config.json       # edit, and BUMP "version" (and "description")
journalctl -u ninetails-api -f                # within ~2 s: "baseline published" or "baseline change rejected"
```

A rejected edit (typo, invalid reference, rack overlap, reused version) is logged and ignored; the previous baseline
keeps being served. Every open app updates itself and shows "Configuration updated". Keep the file in version control
somewhere, as the server copy is the only place it lives.

### Deploy a new version

Repeat Sections 5, 8, 9 and 10 with a new release number.

### Roll back

```
# app: point "current" at the previous release folder
sudo ln -sfn /var/www/ninetails/releases/<previous> /var/www/ninetails/current

# API: keep the previous binary before replacing it (add this to Section 9 step 1):
#   sudo cp -p /opt/ninetails-api/ninetails-api /opt/ninetails-api/ninetails-api.prev
sudo install -o root -g root -m 755 /opt/ninetails-api/ninetails-api.prev /opt/ninetails-api/ninetails-api
sudo restorecon -v /opt/ninetails-api/ninetails-api
sudo systemctl restart ninetails-api
```

Prune old app releases occasionally: keep the last three or so in `/var/www/ninetails/releases/`.

### Logs and monitoring

- API logs go to stderr, which journald collects: `journalctl -u ninetails-api -f`. Set `NINETAILS_LOG_LEVEL=debug`
  temporarily for more detail (edit the env file, `sudo systemctl restart ninetails-api`).
- nginx: `/var/log/nginx/access.log`, `/var/log/nginx/error.log`.
- Point a monitor at `https://<host>/healthz` (returns 200 and JSON when the API is up).
- Everything is in memory: after a restart, status and deployment history return to their starting state.

### Certificate renewal

Replace the files from Section 7.5, run `sudo restorecon -v` on them, then `sudo nginx -t && sudo systemctl reload nginx`.

## 12. Turning this into a CI/CD pipeline later

Nothing above depends on a person typing it; it was written as a sequence of stages. When you choose the CI/CD
system (the plan is GitLab), map it like this:

| Pipeline stage | Manual equivalent | Becomes |
|---|---|---|
| **test** | `go vet ./...`, `gofmt -l .` (must print nothing), `ng build` | Job in an image with Go 1.24 and another with Node 22. Add unit/e2e tests here when they exist. |
| **build-api** | Section 5, API | Job producing `ninetails-api` as an artifact (`CGO_ENABLED=0 GOOS=linux GOARCH=amd64`). |
| **build-app** | Section 4 + 5, app | Job producing `dist/ninetails-app/browser` as an artifact, with settings supplied from CI variables (see below). |
| **package** | Section 5, "Package the release" | Combine both artifacts (and the baseline file if kept in the repo) into one `release-<version>` archive. |
| **deploy** | Sections 8 and 9 | `scp`/`rsync` the package and run the Section 9 commands over SSH, as a dedicated deploy user. |
| **verify** | Section 10 | A script of the `curl` checks; fail the job (and roll back) if they fail. |

Things to decide or prepare when that time comes:

- **Runner and access.** A GitLab Runner (shell executor on the VM, or a runner elsewhere with SSH to the VM). The
  `deploy` user needs `sudo` only for the exact commands in Section 9: list them in `/etc/sudoers.d/ninetails-deploy`
  instead of granting full sudo.
- **Secrets.** There are very few: the SSH key for the deploy user (a masked/protected CI file variable) and the TLS
  key (leave it on the VM, not in CI). The GitLab Application ID is public and not a secret; there is no OAuth client
  secret anywhere in this system.
- **Per-environment settings** (Section 4). Replace the hand edit by `environment.prod.ts` with `fileReplacements`, or
  a CI step that writes the file from variables such as `GITLAB_BASE_URL`, `GITLAB_CLIENT_ID`, `ALLOWED_GROUPS`,
  Keep these values identical to the API env file (Section 7.3), ideally from the same variables.
- **API settings** live on the VM in `/etc/ninetails-api.env`, outside the release, so a deployment never overwrites them.
  If the pipeline should manage them, have it template the file from variables and set `chown root:ninetails` / `chmod 640`.
- **Version.** Use `$CI_COMMIT_TAG` or `$CI_COMMIT_SHORT_SHA` as the release folder name (Section 9 already uses a
  per-release folder and a `current` link, so a failed deploy never leaves a half-written site).
- **Baseline changes.** Decide whether `config.json` lives in the repo and is deployed by the pipeline (changes reviewed
  as merge requests: recommended), or stays a server-side file edited by hand. If it is deployed, the pipeline just
  copies it to `/var/lib/ninetails/config.json` and the running service picks it up; no restart.
- **Environments and approvals.** Add a `staging` VM or a protected manual-approval job before production. The same
  steps apply with different host name, GitLab Application and env file.
- **Rollback.** Section 11 as a manual "rollback" job that re-points `current` and restores `ninetails-api.prev`.

The only commands that run on the VM are those in Sections 9 to 11, so a pipeline other than GitLab (or a plain script)
needs just: copy the package, run Section 9, run Section 10.

## 13. Checklist

Before the first deployment:

- [ ] DNS name points at the VM; TLS certificate and key installed (7.5)
- [ ] GitLab Application created with the exact redirect URI (3)
- [ ] `environment.ts`: `useMock: false`, `auth.mode: 'gitlab'`, client id, base URL, groups (4)
- [ ] API env file written, group settings match the app, mode is `gitlab`, `NINETAILS_SIMULATE=false` (7.3)
- [ ] Baseline file prepared and tested, or you accept the sample inventory (6)
- [ ] `nginx -t` passes; SELinux boolean and firewall set; port 8080 closed (7.6, 7.7)

After each deployment:

- [ ] Service active, log shows `auth: validating GitLab tokens`, no `DEV MODE` (10)
- [ ] `/healthz` OK through nginx; `/api/v1/status` without a token gives 401 (10)
- [ ] Sign in works, Racks load, live stream connected, deep-link reload works (10)

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Service fails to start, journal says `NINETAILS_DEV_TOOLS=true needs NINETAILS_AUTH=dev` | The env file has `NINETAILS_AUTH=gitlab` with dev tools forced on. Remove `NINETAILS_DEV_TOOLS` or set it to `false`. |
| Service fails to start, "baseline is invalid" | `/var/lib/ninetails/config.json` has problems; the message lists each. Fix and restart. |
| Fails to start, "permission denied", nothing in the log | SELinux. `sudo ausearch -m avc -ts recent`; `ls -Z /opt/ninetails-api/ninetails-api`; `sudo restorecon -v` it. The binary must not be in a home directory. |
| nginx 502 | API not running (`systemctl status ninetails-api`) or `httpd_can_network_connect` is off. |
| nginx 403 on every file | SELinux label or file permissions: `sudo restorecon -R /var/www/ninetails`; check that `current` points at an existing release folder. |
| Blank page or 404 on `/racks` or `/auth/callback` | The `try_files $uri /index.html` fallback is missing or the wrong server block is serving. |
| GitLab says "redirect URI is not valid" | The Application's Redirect URI must equal `https://<host>/auth/callback` exactly. |
| Sign-in works but every API call is 401 | `NINETAILS_GITLAB_URL` differs from the app's `gitlab.baseUrl` (the API asks the wrong GitLab who the token belongs to). |
| Sign-in works but 403 | The user is outside `NINETAILS_ALLOWED_GROUPS` (and the app's `allowedGroups`). |
| Everything answers 403 after sign-in | The user is outside `NINETAILS_ALLOWED_GROUPS`, or the app and API group settings disagree. Align them (4 and 7.3). |
| Status dots never change, or change in bursts | Expected with `NINETAILS_SIMULATE=false` and no collector. If it used to work, nginx is buffering `/api/v1/events`: check that location block. |
| A deployment stays `queued` | Expected until a real pipeline integration exists (see the warning at the top). |
| App shows old version after deploy | Browser cache of `index.html`; confirm the `no-cache` rule and that `current` points at the new release. |
| "Configuration updated" never appears after editing `config.json` | The edit was rejected (check the journal), the `version` was not changed, or the file is not the one in `NINETAILS_CONFIG_FILE`. |
| `nginx: unknown directive "http2"` | You used `http2 on;` (needs nginx 1.25.1+). Use `listen 443 ssl http2;` as in 7.6. |
