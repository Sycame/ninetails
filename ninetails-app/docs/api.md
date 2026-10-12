# Ninetails backend API (v1)

> Implemented by the Go service in **`../../ninetails-api`** (see its README). Run it, set `useMock: false`
> in `src/environments/environment.ts`, and `npm start`: `ng serve` proxies `/api` to it (`proxy.conf.json`).

The contract between this Angular app and the Go backend. Every path is relative to `/api/v1`
(`environment.apiBaseUrl`). The paths live in one file on the frontend: `src/app/core/api-endpoints.ts`;
the TypeScript types for every payload are in `src/app/core/models.ts` (that is the source of truth for field names).

## Conventions

| | |
|---|---|
| Format | JSON, `camelCase` field names, UTF-8 |
| Dates | ISO 8601 in UTC, e.g. `2026-10-09T08:00:00Z` |
| Auth | `Authorization: Bearer <GitLab access token>` on every request, including `/events`. Validate it against GitLab (`/oauth/token/info` or `/oauth/userinfo`) and cache by token. `401` = missing/expired token (the app refreshes the token and retries once). `403` = valid user, not allowed. |
| IDs | Opaque strings. Environments are addressed **by id**, never by name (names are free-form: spaces, brackets, unicode). |
| Errors | Non-2xx responses carry `{ "error": { "code": "env_locked", "message": "Environment is locked." } }`. `message` is shown to the user as-is; `code` is for programs. |
| Caching | Reads may send `ETag`/`Cache-Control: no-cache`; the browser revalidates automatically. |
| CORS | Not needed when the app and API share an origin (recommended: reverse-proxy `/api` to Go). |

## Two kinds of data: baseline configuration and live state

| | Baseline configuration | Live state |
|---|---|---|
| What | What exists and how it is set up: racks, chassis, servers, switches, network settings (hostname, IPs, MACs, VLANs), VMs, environments, teams (a display label on each environment), who owns what | Whether it is healthy: status `OK/WARN/FAIL`, health checks, interface link up/down |
| Changes | Rarely, through the change process. Each approved change is published as a **new version** | Constantly |
| Delivered as | One versioned snapshot, `GET /config`; the app **pulls** it, and is **told** when a new one exists | Snapshot `GET /status`, then pushed events |
| Contains health? | **No** | Yes |

The app merges the two on the client (`core/merge.ts`): the baseline decides *what is shown and where*,
the live state decides *how it is coloured*. Changing a status never touches the baseline, and publishing
a new baseline never needs the status service to change.

## Reads (GET)

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /config` | `ConfigBaseline` | The whole current baseline: `{ version, publishedAt, description?, racks[], vms[], environments[], teams[] }`. Racks contain their `chassis[]` and **all** `nodes[]` inline. **No** `status`, `checks` or interface `linkUp` in here. |
| `GET /config/version` | `ConfigVersion` | `{ version, publishedAt, description? }`. Tiny; the app calls this to see whether anything changed and only then fetches `/config`. |
| `GET /status` | `StatusSnapshot` | `{ asOf, nodes: { <nodeId>: { status, checks[], links?: { <ifName>: bool } } }, vms: { <vmId>: status } }`, keyed by the ids used in the baseline. |
| `GET /deployments?limit=50` | `Deployment[]` | Newest first. |

Rules for the baseline:
- `version` is any opaque string that changes with every published baseline (a release number, a change
  ticket, a hash). Never reuse a version for different content. The app treats "different string" as "changed".
- A baseline is **immutable once published**; to change anything, publish a new version.
- Publishing is atomic: the app never sees half a change. Use ETag/`Cache-Control: no-cache` on `/config` if you like.
- `description` is shown to users when the app picks up a new version ("Configuration updated: 2026.10.1 → 2026.10.2 (CHG-1042: add rack C2)").
- Ids (racks, nodes, VMs, environments, teams) must be **stable across versions**; the live state is keyed by them.
- A node/VM in the baseline that the status feed does not mention is shown as `WARN` ("No status reported").
- Environment membership lives on the machines: a node/VM belongs to an environment through its own `envId`.
  A VM's `envId` may differ from its host server's `envId`.
- A server or switch with no `envId` is shared hardware that belongs to no environment (the app lists it under
  "Shared hardware" on the Environments page). Its VMs keep their own `envId`, so one such server can host VMs of
  several environments. A VM with no `envId` must run on a server that has one (the baseline is rejected otherwise).

Layout rules the baseline must follow (the app checks them on every new version, logs problems to the console and the Racks tab shows a warning banner):
- a rack unit holds one server vertically: nodes/chassis may not overlap on the same RUs;
- inside a chassis, nodes sit in grid cells (`placement`) and may not share a cell; rows are whole RUs.

### How the app syncs the baseline

1. **Start:** shows the cached baseline from the previous visit immediately (localStorage), then checks for a newer one.
2. **Check:** `GET /config/version`; if `version` differs from what it holds, `GET /config` and swap atomically.
3. **When it checks:** on startup, on the `config.changed` push event, after any stream reconnect (`resync`),
   every 60 s as a safety net (`environment.config.pollMs`), and on demand (Settings -> Check for updates).
4. **On change:** the new structure replaces the old one everywhere at once, and the user sees a notice.
   No restart or reload is needed.

(Push only is possible too: send `config.changed` and the app pulls. Pull only works as well; the periodic check covers it.)

## Writes

### Start a deployment

```
POST /environments/{envId}/deployments
```
No body (a future body could carry `{ "ref": "main" }`). The backend triggers the GitLab pipeline and answers
immediately; it does **not** wait for the pipeline to finish.

`202 Accepted`
```json
{ "id": "d-1004", "envId": "env-staging", "envName": "staging", "status": "queued",
  "startedBy": "jdoe", "startedAt": "2026-10-09T10:00:00Z",
  "pipelineUrl": "https://gitlab.example.com/acme/app/-/pipelines/1004", "message": "Pipeline #1004 queued." }
```
Errors: `404 env_not_found`, `409 env_locked` / `deploy_in_progress`,
`502 gitlab_unavailable`. The Deploy button shows `error.message`.
Do **not** auto-retry this call; the app never does.

`status` moves `queued -> running -> succeeded | failed` and every change is pushed as a `deployment.updated` event.

## Live updates: Server-Sent Events

```
GET /events
Accept: text/event-stream
Authorization: Bearer ...
```

**Why SSE:** updates only flow server -> browser, it is plain HTTP (proxies, auth and logging work as usual),
and it is a few lines in Go. A WebSocket would add a protocol, heartbeats and sticky routing for no benefit here.
(The app reads the stream with `fetch`, not `EventSource`, because `EventSource` cannot send the Authorization header.)

Stream format (`text/event-stream`):

```
event: config.changed
data: {"version":"2026.10.2","publishedAt":"2026-10-12T06:00:00Z","description":"CHG-1042: add rack C2"}

event: node.updated
data: {"id":"srv-a1-02","status":"WARN","checks":[{"name":"Disk","status":"WARN","message":"Disk /data 86% full","checkedAt":"2026-10-09T08:00:00Z"}]}

event: vm.updated
data: {"id":"vm-2","status":"FAIL"}

event: deployment.updated
data: {"id":"d-1004","status":"succeeded","finishedAt":"2026-10-09T10:04:12Z","message":"Pipeline #1004 passed."}

event: resync
data: {}

: ping
```

| Event | `data` | Client behaviour |
|---|---|---|
| `config.changed` | `{ version, publishedAt, description? }` | A new baseline was published: the app compares `version` and pulls `GET /config`. |
| `node.updated` | `{ id, status?, checks?, interfaces?: [{ name, linkUp }] }` | Partial merge into the live state: only the fields present change. `checks` replaces the whole list. |
| `vm.updated` | `{ id, status? }` | Partial merge. |
| `deployment.updated` | `{ id, status, finishedAt?, message? }` | Updates the Deployments tab. |
| `resync` | `{}` | Refetch `/status`, `/deployments` and check the config version. Optional: structural changes belong in a new baseline + `config.changed`, not here. |
| `: ping` (comment) | | Send one every ~15 s. The app reconnects if it hears nothing for 45 s. |

Rules for the server:
- Unknown event names are ignored by the client, so new ones can be added without breaking old builds.
- No replay is required. After every reconnect the client refetches everything (it emits `resync` itself), so
  missed events are harmless. While the stream is down it also polls every 30 s.
- Disable proxy buffering for this route (`X-Accel-Buffering: no` for nginx) and any response timeout shorter than the ping interval.
- Environment health is **not** sent: the client derives it from its nodes and VMs.

### Go sketch (standard library)

```go
func events(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fl, ok := w.(http.Flusher)
		if !ok { http.Error(w, "streaming unsupported", 500); return }
		h := w.Header()
		h.Set("Content-Type", "text/event-stream")
		h.Set("Cache-Control", "no-cache")
		h.Set("X-Accel-Buffering", "no")

		ch := hub.Subscribe() // chan Event; fan out from your status collector
		defer hub.Unsubscribe(ch)
		ping := time.NewTicker(15 * time.Second)
		defer ping.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ping.C:
				fmt.Fprint(w, ": ping\n\n")
			case e := <-ch:
				b, _ := json.Marshal(e.Data)
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", e.Type, b)
			}
			fl.Flush()
		}
	}
}
```

## Frontend map

| Concern | Where |
|---|---|
| HTTP, retries (GET only), error mapping | `core/api.service.ts` |
| Paths | `core/api-endpoints.ts` |
| Baseline config: pull, cache, version check | `core/config.service.ts` |
| Live state snapshot + event patches | `core/status.service.ts` |
| Baseline + live state -> merged view | `core/merge.ts`, `core/rack.service.ts`, `core/env.service.ts` |
| Layout rules (RU occupancy, validation) | `core/rack-rules.ts` |
| Deployments | `core/deploy.service.ts` |
| Event stream, reconnect, polling fallback | `core/live-status.service.ts` (+ `sse-parser.ts`) |
| Auth header / 401 handling | `core/auth.interceptor.ts` |
| Mock backend for UI work | `public/mock/config.json`, `config/version.json`, `status.json`, `deployments.json`; simulated deploys and status changes (`environment.useMock`, `environment.live.simulateInMock`) |

### Mocking a baseline change (until the backend exists)

The mock baseline is plain JSON, so a "configuration change" is just an edit:
1. edit `public/mock/config.json` (add a rack, move a server, rename an environment...);
2. change `version` (and optionally `description`) in **both** `public/mock/config.json` and `public/mock/config/version.json`;
3. in the running app wait up to a minute, or open Settings -> **Check for updates**.
The app swaps the new baseline in without a reload and shows an "updated" notice. Add status entries for any new
node/VM ids to `public/mock/status.json`, otherwise they show as WARN ("No status reported").

To switch to the real backend: `useMock: false` in `src/environments/environment.ts`, proxy `/api` to the Go server
(`ng serve --proxy-config` during development), and set `auth.mode: 'gitlab'`.
