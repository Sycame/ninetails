# ninetails-api

The Go REST backend for the Ninetails dashboard (`../ninetails-app`). It implements the contract in
`../ninetails-app/docs/api.md`. Standard library only: no third-party modules to download.
Business data is mocked for now (embedded JSON in `data/`); everything else is real.

Development and production both run on **Red Hat Enterprise Linux** (RHEL 8/9, or Rocky/Alma). All commands in this
file are bash. The steps were written for RHEL but have not yet been run on a real host, so check each one.

## Setup (development)

Install **Go 1.24 or newer**. That is all: the service uses only the standard library, so there are no modules to
download and no database or other service to start.

```
go version                      # already 1.24+? then skip the install
sudo dnf install -y golang      # RHEL's own package; check the version it gives you
```

RHEL's `golang` package can lag behind. If `go version` reports less than 1.24, install the official tarball from
https://go.dev/dl/ instead (verify the checksum shown on that page):

```
sudo rm -rf /usr/local/go && sudo tar -C /usr/local -xzf go1.24.x.linux-amd64.tar.gz     # use the real file name
echo 'export PATH=$PATH:/usr/local/go/bin' | sudo tee /etc/profile.d/go.sh
# open a new shell, then:
go version
```

Then change into this folder:

```
cd ninetails-api
```

If you develop on a remote RHEL server over SSH, see "Developing on a remote server" in the app README for reaching the
service from your browser.

## Run

```
go run ./cmd/ninetails-api            # listens on :8080
```

To build and run a single executable instead:

```
go build -o ninetails-api ./cmd/ninetails-api
./ninetails-api
```

Configure it with environment variables (full list below):

```
NINETAILS_ADDR=:9090 NINETAILS_SIMULATE_EVERY=2s go run ./cmd/ninetails-api
```

Stop it with Ctrl+C; open event streams are
closed and the server shuts down cleanly. Check that it is up with http://localhost:8080/healthz, which returns
`{"ok":true,"configVersion":...}`.

Defaults are for local development: **no login is required and every request is treated as the dev user**
(`NINETAILS_AUTH=dev`), the data is mock data, and fake status changes and pipeline progress are generated
(`NINETAILS_SIMULATE=true`). The service logs a warning saying so. Set `NINETAILS_AUTH=gitlab` and
`NINETAILS_GITLAB_URL` for anything shared, and `NINETAILS_SIMULATE=false` once real status and pipelines are plugged in.

Run `go vet ./...` and `gofmt -l .` before committing; both should print nothing.

## Use it

### From the Angular app

1. Start this service (`go run ./cmd/ninetails-api`).
2. In `../ninetails-app/src/environments/environment.ts` set `useMock: false` (keep `auth.mode: 'mock'` for the dev login, or `'gitlab'` for real sign-in).
3. `npm start` in the app. `ng serve` proxies `/api` to `localhost:8080` (`proxy.conf.json`), so there is no CORS to configure.

In production, serve the built app and this API from the same origin (reverse proxy `/api` to this service, and turn
response buffering off for `/api/v1/events`), or set `NINETAILS_CORS_ORIGIN` to the app's origin.

### By hand (curl)

`curl` is installed on RHEL by default. In `dev` auth mode no token is needed; with `NINETAILS_AUTH=gitlab` add
`-H "Authorization: Bearer <GitLab access token>"` to every `/api/v1` call.

```
curl http://localhost:8080/api/v1/config/version          # {version, publishedAt, description}
curl http://localhost:8080/api/v1/config                  # the whole baseline
curl http://localhost:8080/api/v1/status                  # live state snapshot
curl "http://localhost:8080/api/v1/deployments?limit=5"   # newest first

curl -N http://localhost:8080/api/v1/events               # watch live events; Ctrl+C to stop
```

Start a deployment (pick an environment id from `/config`), then watch the `deployment.updated` events in the
stream above go from `queued` to `running` to `succeeded`/`failed`:

```
curl -X POST http://localhost:8080/api/v1/environments/<envId>/deployments
```

Typical answers: `202` + the deployment; `404 env_not_found`;
`409 env_locked` (names in `NINETAILS_LOCKED_ENVS`, `legacy` by default); `409 deploy_in_progress`.

### Explore in the browser

Open http://localhost:8080/docs for Swagger UI (details below).

### Trigger data by hand (dev tools)

With no monitoring, GitLab or change-management system connected, the **Dev tools** section of Swagger UI plays
their part so you can test the app end to end. Every call goes through the same stores as the real integrations,
so the app sees what it would see in production: the change is stored (visible in `GET /status`, `/deployments`,
`/config`) and pushed to every connected app as an event.

| Call | Does |
|---|---|
| `POST /dev/simulation` `{"paused":true}` | Stops the random status flips and the automatic pipeline progress. **Do this first**, otherwise the simulator overwrites your changes. |
| `POST /dev/nodes/{nodeId}/update` | Set a server/switch's `status`, `checks` or interface `linkUp` (`node.updated`). Node ids: `GET /config`. |
| `POST /dev/vms/{vmId}/update` | Set a VM's status (`vm.updated`). |
| `POST /environments/{envId}/deployments` | The normal Deploy call; with the simulation paused the deployment stays `queued`. |
| `POST /dev/deployments/{id}/update` | Move it to `running`, `succeeded` or `failed` (`deployment.updated`). |
| `POST /dev/config/bump` | Republish the same baseline under a new version (`config.changed`, app shows "Configuration updated"). |
| `POST /dev/config` | Publish an edited baseline: copy `GET /config`, change it, **change `version`**, paste. Fully validated. |
| `POST /dev/events` | Broadcast any raw event, e.g. `{"type":"resync"}`, or an unknown one to check the app ignores it. Does not change state. |
| `GET /dev` | Simulation state, baseline version, number of connected apps. |

Run the app against the API (see "From the Angular app"), change something in Swagger, and watch the app react.
These endpoints exist only when `NINETAILS_DEV_TOOLS=true`, which is the default with `NINETAILS_AUTH=dev`; the
service refuses to start with dev tools and `gitlab` auth, and logs a warning when they are on. In production set
`NINETAILS_AUTH=gitlab` and they are gone.

### Change the data

Embedded mock data in `data/` is compiled into the binary, so editing it needs a restart. To change the baseline
while the service is running, use `NINETAILS_CONFIG_FILE` (see "Baseline configuration and how it changes" below):
edit the file, bump `version`, and every open app updates within a couple of seconds.

## Production on Red Hat Enterprise Linux

The service is a single static executable with no runtime dependencies, so the production host needs no Go, no packages
and no database: build on a development or CI machine and copy the one file. The steps assume RHEL 8/9 (and compatible:
Rocky, Alma) with systemd and SELinux enforcing, and use `sudo`.

### 1. Build

On your RHEL development machine or CI runner, build natively. `CGO_ENABLED=0` makes a fully static binary that does not
depend on the host's glibc version, so it also runs on a different RHEL release than the one that built it:

```
CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o ninetails-api ./cmd/ninetails-api
scp ninetails-api data/config.json you@prod-host:/tmp/        # or your usual artifact/deploy tooling
```

If the build machine and the server differ in CPU type (for example x86-64 build, ARM server), add
`GOOS=linux GOARCH=arm64` (or `amd64`) to the build command. The mock data is embedded, so this one file is all the
service needs (the `config.json` copy is only the starting baseline file used in step 3).

### 2. Install

```
sudo useradd --system --home-dir /var/lib/ninetails --shell /sbin/nologin ninetails
sudo install -d -o root -g root -m 755 /opt/ninetails-api
sudo install -o root -g root -m 755 /tmp/ninetails-api /opt/ninetails-api/ninetails-api
sudo install -d -o ninetails -g ninetails -m 750 /var/lib/ninetails      # baseline file lives here
```

Keep the binary under `/opt` (or `/usr/local/bin`), not in a home directory: SELinux blocks services from running
files labelled as home content.

### 3. Configure

Put the settings in `/etc/ninetails-api.env` (root-owned, readable by the service only). No quotes, one `NAME=value` per line:

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
sudo chown root:ninetails /etc/ninetails-api.env && sudo chmod 640 /etc/ninetails-api.env
sudo install -o ninetails -g ninetails -m 640 /tmp/config.json /var/lib/ninetails/config.json
```

Notes: bind to `127.0.0.1` because the reverse proxy (below) is the public entry point. `NINETAILS_AUTH` must be `gitlab`;
the default `dev` accepts everybody without login. `NINETAILS_SIMULATE=false` stops the fake status and pipeline
data (until the real integrations replace `internal/sim`, status changes and deployments will then not progress).
Leave `NINETAILS_CORS_ORIGIN` unset when the app and API are served from the same origin.

### 4. Run it as a service

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
# The service shuts down cleanly on SIGTERM; give open event streams time to close.
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
sudo systemctl enable --now ninetails-api
systemctl status ninetails-api
journalctl -u ninetails-api -f                 # logs go to stderr, so journald collects them
curl http://127.0.0.1:8080/healthz
```

### 5. Reverse proxy, TLS and firewall

Put nginx (or Apache/HAProxy) in front for TLS and to serve the Angular build. The event stream
(`/api/v1/events`) needs **buffering off** and a long read timeout, otherwise live updates arrive late or not at all.
See the app README for a ready-to-use nginx configuration.

```
sudo setsebool -P httpd_can_network_connect 1          # lets nginx connect to 127.0.0.1:8080 under SELinux
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

Do not open port 8080 in the firewall; only the proxy needs to reach it. Use HTTPS: GitLab OAuth redirect URIs and
bearer tokens should never travel over plain HTTP.

### 6. Update and troubleshooting

- **Deploy a new version:** copy the new binary over `/opt/ninetails-api/ninetails-api`, then
  `sudo systemctl restart ninetails-api`. Open apps reconnect and resync by themselves.
- **Publish a new baseline:** edit `/var/lib/ninetails/config.json` and bump `version`; no restart is needed
  (see "Baseline configuration" below). A rejected edit is logged and ignored.
- **Fails to start with "permission denied" and nothing in the logs:** SELinux. Check `sudo ausearch -m avc -ts recent`
  and the file label with `ls -Z /opt/ninetails-api/ninetails-api`; `sudo restorecon -v` fixes a wrong label.
- **Proxy returns 502:** the service is not running or `httpd_can_network_connect` is off.
- **Live updates stutter or arrive in bursts:** the proxy is buffering `/api/v1/events`.

## What it serves (all under `/api/v1`, plus `/healthz`)

| Endpoint | Purpose |
|---|---|
| `GET /config` | The baselined configuration: racks, chassis, servers, switches, network settings, VMs, environments, teams. Versioned; `ETag` = version (`304` when unchanged). No health data. |
| `GET /config/version` | Tiny `{version, publishedAt, description}` the app polls. |
| `GET /status` | Live state snapshot: status, checks and link state per node/VM. |
| `GET /deployments?limit=50` | Deployment history, newest first. |
| `POST /environments/{envId}/deployments` | Start a deployment. `202` + the deployment; `404 env_not_found`, `409 env_locked` / `deploy_in_progress`. |
| `GET /events` | Server-Sent Events: `config.changed`, `node.updated`, `vm.updated`, `deployment.updated`, heartbeat comments. |
| `GET /healthz` | Liveness, no auth. |

### API docs (Swagger)

With the service running, open **http://localhost:8080/docs** for Swagger UI; the raw OpenAPI 3 spec is at
`/openapi.json`. Both need no login. Use **Authorize** to paste a GitLab token (not needed in dev auth mode),
then **Try it out**. The spec is hand-written in `internal/docs/openapi.json` and embedded, and Swagger UI is
vendored in `internal/docs/swaggerui/` (swagger-ui-dist 5.17.14), so nothing is fetched from a CDN. When you
change an endpoint or a type in `internal/model`, update the spec too.

Errors always look like `{ "error": { "code": "env_locked", "message": "Environment is locked." } }`.

## Configuration (environment variables)

| Variable | Default | |
|---|---|---|
| `NINETAILS_ADDR` | `:8080` | Listen address |
| `NINETAILS_AUTH` | `dev` | `dev` (no login) or `gitlab` (validate bearer tokens against GitLab) |
| `NINETAILS_GITLAB_URL` | `https://gitlab.example.com` | Your GitLab; used when `NINETAILS_AUTH=gitlab` |
| `NINETAILS_ALLOWED_GROUPS` | *(any user)* | Comma-separated GitLab group paths allowed in |
| `NINETAILS_PIPELINE_URL` | `https://gitlab.example.com/acme/app/-/pipelines` | Base for pipeline links |
| `NINETAILS_CONFIG_FILE` | *(embedded)* | Baseline file to load **and watch** |
| `NINETAILS_SIMULATE` | `true` | Fake status changes and pipeline progress |
| `NINETAILS_SIMULATE_EVERY` | `8s` | Pause between fake status changes |
| `NINETAILS_LOCKED_ENVS` | `legacy` | Environment names that refuse deployments |
| `NINETAILS_DEV_TOOLS` | `true` with `dev` auth, else `false` | Serve `/api/v1/dev/*` (see "Trigger data by hand"). `true` with `gitlab` auth is refused at startup |
| `NINETAILS_CORS_ORIGIN` | *(off)* | Only if the app is served from another origin than the API |
| `NINETAILS_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

The same GitLab Application the Angular app uses is what identifies users here: the app sends its access
token and this service asks GitLab (`/oauth/userinfo`) who it belongs to, then applies the group rules above.
The `NINETAILS_ALLOWED_GROUPS` setting should match `authz` in the app's `environment.ts`.

## Baseline configuration and how it changes

The baseline is data, not code. To change it the way the real process would:

```
mkdir -p local && cp data/config.json local/config.json      # somewhere editable (local/ is not committed)
NINETAILS_CONFIG_FILE=local/config.json go run ./cmd/ninetails-api
```

Edit the file and **bump `version`** (and `description`, e.g. the change ticket). Within about 2 seconds the service
validates it and, if good, publishes it and pushes `config.changed` to every connected app, which pulls the new baseline.
Rules enforced on every publish:

- ids are unique and every reference resolves (rack, chassis, host server, environment, team);
- everything fits its rack and nothing overlaps (a rack unit holds one server vertically); chassis members stay in their grid and never share a cell;
- unknown JSON fields are rejected (they are nearly always typos);
- a published version is immutable: same `version` with different content is refused.

A rejected edit is logged and ignored; the service keeps serving the last good baseline.

## Layout

```
cmd/ninetails-api/   main: wiring, graceful shutdown
data/                embedded mock datasets (config, status, deployments)
internal/model/      wire types (mirror the app's models.ts)
internal/store/      baseline (+ validation, file watch), live status, deployments
internal/events/     SSE fan-out hub
internal/auth/       dev + GitLab authentication, group policy
internal/api/        routes, handlers, middleware, SSE stream
internal/sim/        stand-ins for the monitoring collector and the GitLab pipeline
internal/settings/   environment-variable configuration
```

## How it works

Everything lives in memory in one process. `cmd/ninetails-api/main.go` wires the pieces together:

```
settings (env vars) --> main --> ConfigStore  -+
                                 StatusStore  -+--> events.Hub --> GET /events (SSE) --> every connected app
                                 DeployStore  -+        ^
                                                        | publishes
 sim.Status   --> StatusStore.ApplyNode / ApplyVM -------+      (mock monitoring collector)
 sim.Pipeline --> DeployStore.Update --------------------+      (mock GitLab pipeline)
 file watcher --> ConfigStore.Publish -------------------+      (when NINETAILS_CONFIG_FILE is set)

 request --> recover > log > cors > [auth.Authenticator] > api.Server handlers --> stores
```

- **Startup:** load the baseline (embedded `data/config.json`, or the file in `NINETAILS_CONFIG_FILE`), validate it, and
  publish it as version 1. Load the status snapshot and deployment history from `data/`. Start the optional
  simulators and the HTTP server. Ctrl+C / SIGTERM cancels the base context, which ends the event streams and
  background work, then shuts the server down gracefully (10 s).
- **Three stores, three jobs.** `ConfigStore` holds the immutable, versioned baseline and swaps it atomically.
  `StatusStore` holds the live state and applies partial node/VM updates. `DeployStore` holds deployment history
  and knows whether an environment already has a deployment running. Each store publishes to the `Hub` when it
  changes, so the HTTP layer never has to announce anything itself.
- **Events:** `events.Hub` fans each event out to every subscriber. Publishing never blocks: a client that cannot keep
  up is dropped, reconnects, and the app refetches everything, so nothing is lost. `GET /events` writes
  `event: <type>` / `data: <json>` frames and a `: ping` comment every 15 s (the app treats 45 s of silence as a dead
  connection). The app does not need an event replay: it resyncs after every reconnect.
- **Auth:** `auth.Authenticator` turns a request into a user. `dev` accepts everybody; `gitlab` sends the
  bearer token to GitLab's `/oauth/userinfo`, caches the answer briefly, and applies the group policy
  (allowed groups). Only `/api/v1/*` is authenticated; `/healthz`, `/docs` and `/openapi.json` are open.
- **Deploying:** `POST /environments/{envId}/deployments` checks, in order, that the environment exists (`404`),
  that the environment is not locked (`409 env_locked`),
  and that no deployment is already running (`409 deploy_in_progress`). It then records a `queued` deployment, hands it
  to the `PipelineStarter`, and answers `202`. The pipeline later moves it to `running` and `succeeded`/`failed`;
  each change is pushed as `deployment.updated`.
- **Baseline changes:** `ConfigStore.Publish` validates (see the rules above), refuses a reused version with different
  content, swaps the baseline, and the hub sends `config.changed`. The app then asks `GET /config/version` and pulls
  `GET /config` only if the version differs. `GET /config` uses the version as its `ETag`, so unchanged polls get a `304`.

## Replacing the mocks

| Mock | Real thing | Where |
|---|---|---|
| Embedded / file baseline | The change-management system's published baseline (or a database) | `store.ConfigStore.Publish` is the single entry point |
| `sim.Status` | Monitoring / agents calling `StatusStore.ApplyNode` / `ApplyVM` | `internal/sim`, `internal/store/status.go` |
| `sim.Pipeline` | GitLab pipeline trigger + webhook updating `DeployStore.Update` | implement `api.PipelineStarter` |
| In-memory deployment history | A database table | `internal/store/deployments.go` |
