/**
 * Every backend path in one place (relative to `environment.apiBaseUrl`, e.g. /api/v1).
 * The full contract (request/response shapes, errors, events) is documented in docs/api.md.
 * In mock mode a GET of `status` is served from /public/mock/status.json (and `config/version`
 * from /public/mock/config/version.json), so each GET path below needs a file of that name there.
 */
export const ENDPOINTS = {
  // BASELINE CONFIGURATION: racks, chassis, servers, switches, network settings, VMs, environments, teams.
  // Versioned, changes rarely (through the change process). Pulled, cached and re-pulled when the version changes.
  config: 'config', //                        GET -> ConfigBaseline
  configVersion: 'config/version', //         GET -> ConfigVersion (tiny; poll this)

  // LIVE STATE: status, health checks, link state. Snapshot here, changes arrive on `events`.
  status: 'status', //                        GET -> StatusSnapshot

  // deployments
  deployments: 'deployments', //              GET  ?limit=50 -> Deployment[] (newest first)
  deployEnvironment: (envId: string) => `environments/${encodeURIComponent(envId)}/deployments`, // POST -> 202 Deployment

  // Server-Sent Events stream: status changes, config.changed, deployment progress (see LiveStatusService)
  events: 'events',
} as const;
