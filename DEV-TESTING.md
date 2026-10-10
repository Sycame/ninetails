# Ninetails: run it in dev mode and test it end to end

This guide starts the Go API and the Angular app together, then shows how to use the API's **Dev tools** to feed the
app data by hand (status, health, links, deployments, new configuration versions, raw events) and see it react.

Nothing here needs GitLab, a database or any real monitoring. Everything is mock data plus the dev tools.

```
 you (Swagger UI / curl) --> Go API (:8080) --SSE events + REST--> Angular app (:4200, browser)
                              dev tools play the part of the monitoring system, the GitLab pipeline
                              and change management
```

Two places to run it, same steps: your **Windows machine** (PowerShell) and the **RHEL VM** (bash). Commands are
given for both where they differ. Everything runs on one machine, so no CORS or network setup is needed.

---

## 1. Prerequisites

| Need | Version | Check |
|---|---|---|
| Go | 1.24 or newer | `go version` |
| Node.js | 22 | `node -v` |
| npm | 12 | `npm -v` |

Install hints (RHEL): see the "Setup" sections of `ninetails-api/README.md` and `ninetails-app/README.md`.
On Windows, install Go and Node from their websites.

## 2. One-time setup

```
cd ninetails-app
npm install
```

The API has no dependencies to download.

Point the app at the real API instead of its built-in mock JSON. Open `ninetails-app/src/environments/environment.ts`
and change one line:

```ts
useMock: false,        // was true
```

Leave `auth.mode: 'mock'`. You are signed in automatically as the dev user. Do not commit
this change as the permanent setting if other people run the app on mock data; flip it back to `true` when done.

## 3. Start everything (two terminals)

**Terminal 1: the API**

```
cd ninetails-api
go run ./cmd/ninetails-api
```

You should see the log lines `simulation on`, `dev tools on`, `auth: DEV MODE` and `listening addr=:8080`.
The warnings are expected in dev. Check it: open http://localhost:8080/healthz, it shows `{"ok":true,...}`.

**Terminal 2: the app**

```
cd ninetails-app
npm start
```

Wait for "Local: http://localhost:4200/", then open **http://localhost:4200**. `ng serve` forwards `/api` to
`localhost:8080` (`proxy.conf.json`), including the live event stream.

**Open Swagger UI in a second browser tab (or window beside the app): http://localhost:8080/docs**

Scroll to the **Dev tools** section. That is your control panel. Put the two tabs side by side so you can watch the
app while you click **Try it out > Execute**.

Stop everything with Ctrl+C in each terminal.

### Is the app really talking to the API?

- In the browser dev tools (F12 > Network) you should see requests to `/api/v1/config`, `/api/v1/status` and one
  long-running `/api/v1/events` request that never finishes. That is the live stream.
- `http://localhost:8080/healthz` shows `"eventClients": 1` (or more, one per open tab).
- No `/mock/...` requests: if you see those, `useMock` is still `true` (restart `npm start` after editing).

## 4. First look: the random simulation

Out of the box the API runs a simulator: every 8 seconds a random server, switch or VM changes status, and a started
deployment moves `queued > running > succeeded` by itself. Watch the **Racks** page for a minute and you will see LEDs
change colour without touching anything. That already proves the live path works (API > SSE > app).

For controlled testing the random changes get in the way. **Pause them first:**

Swagger: **POST /dev/simulation**, body `{ "paused": true }`, Execute.

Resume later with `{ "paused": false }`. Change the rhythm with `NINETAILS_SIMULATE_EVERY=2s` when starting the API.

## 5. Test scenarios

Run the scenarios in Swagger UI (click the endpoint, **Try it out**, paste the body, **Execute**). The ids below exist
in the shipped mock data. To see other ids, use **GET /config**.

Useful ids: nodes `srv-a1-01` (server, 3 NICs `eth0` `eth1` `eth2`), `srv-a1-02`, `sw-a1-top` (switch), `srv-b1-02`;
VMs `vm-1` ... `vm-15`; environments `env-prod`, `env-staging`, `env-legacy` (locked), `env-pay-sbx`, `env-ml`.

### 5.1 A server goes unhealthy (status and health checks)

**POST /dev/nodes/srv-a1-01/update**

```json
{ "status": "WARN",
  "checks": [ { "name": "Ping", "status": "OK" },
              { "name": "Disk", "status": "WARN", "message": "Disk /data 86% full" } ] }
```

Expect in the app (Racks, rack A1): `srv-a1-01` turns amber within a second, no reload. Click it: the drawer lists
the two checks with the message. The rack's header and the footer overall health roll up to WARN, and the
environment `prod` (which uses that server) shows WARN on the Environments page.

Make it worse:

```json
{ "status": "FAIL",
  "checks": [ { "name": "Ping", "status": "FAIL", "message": "No response for 12 min" } ] }
```

Expect red everywhere it rolls up. Then recover it:

```json
{ "status": "OK", "checks": [ { "name": "Ping", "status": "OK" } ] }
```

`checks` **replaces the whole list**, so always send every check you want to keep. `checkedAt` is filled in for you.
You can send just `status` (the old checks stay) or just `checks`.

### 5.2 A network link drops

**POST /dev/nodes/srv-a1-01/update**

```json
{ "interfaces": [ { "name": "eth1", "linkUp": false } ] }
```

Expect: in the node's detail drawer, the `eth1` interface shows link down. Bring it back with `"linkUp": true`.
Interface names must match the node's network config in the baseline.

### 5.3 A VM fails

**POST /dev/vms/vm-1/update** body `{ "status": "FAIL" }`

Expect: the VM is red in the host server's drawer, and the environment that VM belongs to rolls up to FAIL, even when
the VM runs on hardware of another environment.

### 5.4 A deployment, step by step (with the simulation paused)

1. In the app: **Environments > prod > Deploy**. (Or Swagger **POST /environments/{envId}/deployments** with
   `env-prod`.) The app shows success: the request was accepted.
2. Open **Deployments** in the app: a new row, status **queued**. It stays queued because the simulation is paused.
   Note its id (for example `d-1004`), also visible in **GET /deployments**.
3. **POST /dev/deployments/d-1004/update** body `{ "status": "running", "message": "Pipeline running." }`
   Expect the row to change to running, no reload.
4. Same call with `{ "status": "succeeded", "message": "Pipeline passed." }` or
   `{ "status": "failed", "message": "Job deploy: exit code 1" }`. Expect the final state and a finished time.

Also try the refusals (these come from the API, the app must show the reason on the Deploy button/toast):

| Try | Expect |
|---|---|
| Deploy to `prod` again while one is `queued` or `running` | `409 deploy_in_progress` |
| Deploy to `legacy` (`env-legacy`) | `409 env_locked` |
| Deploy to an unknown env id in Swagger | `404 env_not_found` |

With the simulation **resumed** (`paused: false`) a deployment goes queued > running > succeeded by itself in about
7 seconds, which is a quick check that the automatic flow still works.

### 5.5 A new configuration version is published

Quick version (same content, new version number):

**POST /dev/config/bump** body `{ "version": "2026.10.2", "description": "CHG-1042: test update" }`
(an empty body is fine too: the version becomes `dev-<timestamp>`).

Expect: a "Configuration updated" message appears in the app within a second or two. **Settings** shows the new
version, publish time and description.

Real change (the baseline itself differs):

1. **GET /config**, copy the response.
2. Edit it: for example rename an environment, set a server's `envId` to a different environment, or add a VM.
3. **Change `version`** (a reused version with different content is refused with `409 version_reused`).
4. **POST /dev/config**, paste the body.

Expect: the Racks and Environments pages redraw with your change. If the baseline is invalid (duplicate id, a server
that does not fit its rack, a reference to something that does not exist), you get `422 baseline_invalid` listing
every problem and the app keeps the previous baseline. That is a good test too: break it on purpose.

A newly added server or VM shows **WARN "No status reported"** until you send it a status with
`/dev/nodes/{id}/update`. That is by design: the app marks anything the status feed does not know about.

### 5.6 The connection drops

1. Stop the API (Ctrl+C in terminal 1). The app keeps showing the last known state and reconnects with backoff.
2. Before restarting, set a status first (for example 5.1) so you can tell old from new. Then restart the API
   (`go run ...`). The data resets to the mock start state (everything is in memory).
3. Expect: the app reconnects by itself and **refetches everything** (the `resync` after a reconnect), so any status
   you had set before is replaced by the fresh state. No manual reload needed.

A slow drop test without stopping the API: **POST /dev/events** body `{ "type": "resync" }` makes every open app
refetch config and status at once.

### 5.7 Awkward events (robustness)

**POST /dev/events**

| Body | Expect |
|---|---|
| `{ "type": "something.new", "data": { "x": 1 } }` | Nothing visible; the app ignores unknown events and does not error. |
| `{ "type": "config.changed", "data": { "version": "9.9.9", "publishedAt": "2026-10-10T12:00:00Z" } }` | The app checks the real version, sees nothing new and keeps its data. |

`/dev/events` sends exactly what you write and does **not** change the server's stored state, so it is only for
protocol tests. To change what the app shows, use the typed endpoints above (they update the state *and* send the event).

### 5.8 Two browser tabs / many users

Open the app in two tabs. Every change should appear in both. `"eventClients"` in `/healthz` (or **GET /dev**) shows
how many are connected.

## 6. Watching the events themselves

Swagger UI cannot show a stream. To see the raw events the API sends, run in another terminal:

PowerShell or bash on a machine with curl:

```
curl.exe -N http://localhost:8080/api/v1/events          # Windows: use curl.exe, plain "curl" is a different PowerShell command
curl -N http://localhost:8080/api/v1/events              # RHEL
```

You will see lines like:

```
event: node.updated
data: {"id":"srv-a1-01","status":"WARN","checks":[...]}
```

and a `: ping` comment every 15 seconds. Ctrl+C stops it. If a status change shows here but the app does not move, the
problem is in the app; if nothing shows here, it is the API.

Other useful reads:

```
http://localhost:8080/api/v1/status               what the API believes right now (all node/VM states)
http://localhost:8080/api/v1/deployments?limit=5  newest first
http://localhost:8080/api/v1/config/version       current baseline version
http://localhost:8080/api/v1/dev                  simulation paused? version? connected apps?
```

## 7. Using curl instead of Swagger (scriptable)

RHEL / bash:

```
curl -X POST localhost:8080/api/v1/dev/simulation -H 'Content-Type: application/json' -d '{"paused":true}'

curl -X POST localhost:8080/api/v1/dev/nodes/srv-a1-01/update -H 'Content-Type: application/json' \
  -d '{"status":"FAIL","checks":[{"name":"Ping","status":"FAIL","message":"No response"}]}'

curl -X POST localhost:8080/api/v1/dev/vms/vm-1/update -H 'Content-Type: application/json' -d '{"status":"WARN"}'
```

Windows PowerShell (quoting JSON for curl.exe is painful; use Invoke-RestMethod):

```powershell
$api = 'http://localhost:8080/api/v1'
function Dev($path, $body) {
  Invoke-RestMethod -Method Post "$api$path" -ContentType 'application/json' -Body ($body | ConvertTo-Json -Depth 6)
}

Dev '/dev/simulation' @{ paused = $true }
Dev '/dev/nodes/srv-a1-01/update' @{ status = 'FAIL'; checks = @(@{ name = 'Ping'; status = 'FAIL'; message = 'No response' }) }
Dev '/dev/vms/vm-1/update' @{ status = 'WARN' }
Dev '/dev/config/bump' @{ version = '2026.10.3'; description = 'scripted' }
```

With these, a whole scenario (degrade, wait, recover) fits in a small script you can rerun.

## 8. Reset to a clean start

All state is in memory. Stop the API (Ctrl+C) and start it again: status, deployments and the baseline return to the
shipped mock data and the version goes back to `2026.10.1`. The app picks this up by itself when it reconnects (or
reload the page). The app also caches the baseline in the browser (`localStorage`); if something looks stale, clear the
site data for `localhost:4200`.

To keep a modified baseline across restarts, copy `ninetails-api/data/config.json` to `ninetails-api/local/config.json`
and start the API with `NINETAILS_CONFIG_FILE=local/config.json`. Then editing that file and bumping `version` publishes
it live without any endpoint. (Windows: `$env:NINETAILS_CONFIG_FILE='local/config.json'; go run ./cmd/ninetails-api`;
bash: `NINETAILS_CONFIG_FILE=local/config.json go run ./cmd/ninetails-api`.)

## 9. Settings you may want in dev

Set them before `go run` (PowerShell: `$env:NAME='value'`; bash: `NAME=value go run ...`).

| Variable | Use |
|---|---|
| `NINETAILS_SIMULATE=false` | No simulator at all: nothing moves unless you move it. `/dev/simulation` then answers `409 simulation_off`. A new deployment would stay `queued` forever, so you drive it with `/dev/deployments/{id}/update`. |
| `NINETAILS_SIMULATE_EVERY=2s` | Faster random changes. |
| `NINETAILS_LOCKED_ENVS=legacy,prod` | Which environments refuse deployments. |
| `NINETAILS_ADDR=:9090` | Different API port (then change the target in `ninetails-app/proxy.conf.json` too). |
| `NINETAILS_LOG_LEVEL=debug` | More logging. |

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser shows data but nothing ever changes | The app is on mock data (`useMock` still `true`; restart `npm start`), or the event stream is blocked. Check F12 > Network for `/api/v1/events`. |
| App shows errors / empty pages, the proxy logs `ECONNREFUSED` | The API is not running or not on :8080. Start terminal 1 first. |
| Swagger calls return 404 for `/dev/...` | Dev tools are off. They are on by default with `NINETAILS_AUTH=dev`; check `NINETAILS_DEV_TOOLS` is not `false`. |
| Status goes back to what it was a few seconds later | The random simulator overwrote it. Pause it first (section 4). |
| `404 node_not_found` | The id is not in the baseline. Use ids from **GET /config** (racks > nodes). |
| `409 version_reused` | You published an existing version with different content. Use a new version string. |
| `curl` in PowerShell prints odd errors | PowerShell's `curl` is a different command. Use `curl.exe`, or the `Invoke-RestMethod` helper in section 7. |
| Port 8080 or 4200 already in use | Stop the other process, or set `NINETAILS_ADDR` / run `npm start -- --port 4300`. |
| `go: command not found` / `npm: command not found` | Open a new terminal after installing, or fix PATH. |
| Windows Defender Firewall prompt on first run | Allow access for private networks (or cancel; localhost works regardless). |

## 11. Before this goes anywhere real

Dev tools forge status, deployments and baselines, so they are **off** whenever `NINETAILS_AUTH=gitlab` (the service even
refuses to start with both). Before deploying: revert `useMock` to what production needs (`false`), set
`auth.mode: 'gitlab'` in `environment.ts`, run the API with `NINETAILS_AUTH=gitlab`, and `NINETAILS_SIMULATE=false`. The
RHEL steps are in `ninetails-api/README.md` and `ninetails-app/README.md`.
