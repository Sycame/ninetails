/** Single status model used everywhere (racks, nodes, VMs, environments). */
export type Status = 'OK' | 'WARN' | 'FAIL';

const SEVERITY: Record<Status, number> = { OK: 0, WARN: 1, FAIL: 2 };

/** Roll a list of statuses up into the worst one. Empty list => OK. */
export function worstStatus(statuses: Status[]): Status {
  return statuses.reduce<Status>((w, s) => (SEVERITY[s] > SEVERITY[w] ? s : w), 'OK');
}

export interface HealthCheck {
  name: string;
  status: Status;
  message?: string;
  checkedAt: string; // ISO date
}

export interface Team {
  id: string;
  name: string;
}

export interface User {
  id: string;
  username: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Position of a node inside a chassis, in cells of the chassis' own grid (1-based).
 * The grid has `columns` columns and one row per RU (`sizeU` rows, row 1 = top).
 *
 * HEIGHT RULE: in any RU, a column holds at most ONE server - servers cannot be stacked
 * vertically inside a single RU. A server is 1 RU tall (rowSpan 1) or spans several whole RUs.
 * Servers may sit side by side in the same RU (different columns), which is how asymmetric
 * layouts are expressed: left column = one 2U server (col 1, rowSpan 2), right column = two 1U servers
 * (col 2, row 1) and (col 2, row 2). Wide nodes use colSpan > 1.
 * RackService.validateRack() enforces this.
 */
export interface Placement {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/** A multi-slot enclosure mounted in the rack that hosts several nodes. */
export interface Chassis {
  id: string;
  name: string;
  model: string;
  /** Lowest rack unit occupied (1 = bottom of the rack). */
  positionU: number;
  /** Height in rack units (the chassis spans this many contiguous RUs). */
  sizeU: number;
  /** Number of side-by-side columns. Rows are implied: one per RU (`sizeU`). */
  columns: number;
  envId?: string;
  teamId?: string;
}

/** One rack unit in the computed occupancy map (see RackService.computeSlotOccupancy). */
export interface Slot {
  ru: number;
  /** Id of the node or chassis occupying this RU; undefined = free. */
  itemId?: string;
  /** true when two items overlap this RU (bad data, flagged so the UI/tests can notice). */
  conflict?: boolean;
}

export interface NetworkInterface {
  name: string; // e.g. eth0, bond0
  purpose?: string; // e.g. 'data', 'storage'
  ipAddress: string;
  mac: string;
  vlan?: number;
  speedGbps: number;
  linkUp: boolean;
}

/** Network details shown in the node details panel. */
export interface NodeNetwork {
  hostname: string;
  /** Out-of-band management (iDRAC / iLO / BMC) address. */
  mgmtIp?: string;
  gateway?: string;
  interfaces: NetworkInterface[];
}

/** Fields shared by everything that sits in a rack. */
interface NodeBase {
  id: string;
  name: string;
  model: string;
  status: Status;
  rackId: string;
  /** Standalone nodes only: lowest rack unit occupied (1 = bottom of the rack). */
  positionU?: number;
  /** Standalone nodes only: height in rack units. */
  sizeU?: number;
  /** Set when the node lives inside a chassis; then `placement` says where. */
  chassisId?: string;
  placement?: Placement;
  envId?: string;
  teamId?: string;
  /** Optional; the details panel shows a Network section when present. */
  network?: NodeNetwork;
  checks: HealthCheck[];
}

export interface Server extends NodeBase {
  type: 'server';
}

export interface Switch extends NodeBase {
  type: 'switch';
  ports: number;
}

/** Discriminated union: switch on `node.type` to narrow. */
export type RackNode = Server | Switch;

export interface Rack {
  id: string;
  name: string;
  location: string;
  /** Custom rack size in RU (e.g. 24, 42, 48). */
  heightU: number;
  chassis: Chassis[];
  /** All nodes, both standalone and chassis-hosted (so lookups by id stay simple). */
  nodes: RackNode[];
}

export interface Vm {
  id: string;
  name: string;
  hostId: string; // Server.id
  envId?: string;
  status: Status;
  os: string;
}

export interface Environment {
  id: string;
  name: string; // used in POST /deploy/:envName
  description?: string;
  teamId: string;
}

/** A server that belongs to an environment, with the environment's VMs running on it. */
export interface EnvHost {
  server: Server;
  vms: Vm[];
}

/** An environment VM whose host server is NOT a member of the environment (possible, e.g. shared hardware). */
export interface ForeignVm {
  vm: Vm;
  hostName: string;
}

/**
 * View model: an environment with everything attached and a rolled-up status.
 * An Environment is just a free-form name for a set of machines (servers, switches) and VMs.
 * Membership comes from `envId` on nodes and VMs, so environment names have no required pattern.
 */
export interface EnvSummary {
  env: Environment;
  team?: Team;
  status: Status;
  servers: Server[];
  switches: Switch[];
  /** All VMs that belong to this environment. */
  vms: Vm[];
  /** Member servers, each with this environment's VMs hosted on it (the tree shown in the UI). */
  hosts: EnvHost[];
  foreignVms: ForeignVm[];
}

// ---- baseline configuration vs live state ----------------------------------------------------
//
// The CONFIGURATION (what exists: racks, chassis, servers, switches, network settings, VMs,
// environments, teams) is baselined: it changes rarely, through a change process, and is published by
// the backend as one versioned snapshot (GET /config). It contains no health information.
// The live STATE (status, health checks, link up/down) is a separate fast-moving feed (GET /status + events).
// The app merges the two: the `Rack`/`RackNode`/`Vm` types above are that merged view.

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type NetworkInterfaceConfig = Omit<NetworkInterface, 'linkUp'>;
export type NodeNetworkConfig = Omit<NodeNetwork, 'interfaces'> & { interfaces: NetworkInterfaceConfig[] };

/** A node as stored in the baseline: no status, no health checks, no link state. */
export type NodeConfig = DistributiveOmit<RackNode, 'status' | 'checks' | 'network'> & { network?: NodeNetworkConfig };
export type RackConfig = Omit<Rack, 'nodes'> & { nodes: NodeConfig[] };
export type VmConfig = Omit<Vm, 'status'>;

/** Tiny document the app polls to find out whether a newer baseline exists. */
export interface ConfigVersion {
  /** Opaque, changes with every published baseline (e.g. '2026.10.2' or a change number). */
  version: string;
  publishedAt: string; // ISO 8601 UTC
  /** Human-readable reason, e.g. 'CHG-1042: add rack C2'. */
  description?: string;
}

export interface ConfigBaseline extends ConfigVersion {
  racks: RackConfig[];
  vms: VmConfig[];
  environments: Environment[];
  teams: Team[];
}

/** Live state of one node. `links` is keyed by interface name (true = link up). */
export interface NodeState {
  status: Status;
  checks: HealthCheck[];
  links?: Record<string, boolean>;
}

/** GET /status: current state of everything, keyed by the ids used in the baseline. */
export interface StatusSnapshot {
  asOf: string; // ISO 8601 UTC
  nodes: Record<string, NodeState>;
  vms: Record<string, Status>;
}

/** UI state of the Deploy button (not an API type). */
export type DeployPhase = 'idle' | 'loading' | 'success' | 'error';

export interface DeployState {
  phase: DeployPhase;
  message?: string;
}

export type DeploymentStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/** A deployment (one GitLab pipeline run) as returned by the backend. */
export interface Deployment {
  id: string;
  envId: string;
  envName: string;
  status: DeploymentStatus;
  startedBy: string; // GitLab username
  startedAt: string; // ISO 8601 UTC
  finishedAt?: string;
  /** Link to the GitLab pipeline. */
  pipelineUrl?: string;
  message?: string;
}

// ---- live updates (Server-Sent Events from GET /events) ------------------------------------

/** Partial update of a node: only the fields present are changed. */
export interface NodeUpdate {
  id: string;
  status?: Status;
  checks?: HealthCheck[];
  /** Link state changes by interface name. */
  interfaces?: { name: string; linkUp: boolean }[];
}

export interface VmUpdate {
  id: string;
  status?: Status;
}

export interface DeploymentUpdate {
  id: string;
  status: DeploymentStatus;
  finishedAt?: string;
  message?: string;
}

/**
 * Everything the server can push.
 *  - `config.changed`: a new baseline was published -> pull it (GET /config).
 *  - `resync`: "refetch everything" (also emitted locally after a reconnect / by the polling fallback).
 */
export type LiveEvent =
  | { type: 'config.changed'; data: ConfigVersion }
  | { type: 'node.updated'; data: NodeUpdate }
  | { type: 'vm.updated'; data: VmUpdate }
  | { type: 'deployment.updated'; data: DeploymentUpdate }
  | { type: 'resync' };

export type ConnectionState = 'connecting' | 'live' | 'offline';
