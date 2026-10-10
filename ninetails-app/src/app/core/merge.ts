import { NodeConfig, NodeState, Rack, RackConfig, RackNode, StatusSnapshot, Vm, VmConfig } from './models';

/**
 * Baseline + live state -> the merged view the UI renders.
 *
 *  - Before the first status snapshot has arrived (`snapshot === null`) everything shows as OK
 *    with no checks, so the UI is usable immediately instead of flashing warnings.
 *  - After it has arrived, a baseline item the status feed knows nothing about is shown as WARN
 *    ("No status reported"): a configured machine that nobody reports on is worth noticing.
 */

export function mergeNode(n: NodeConfig, snapshot: StatusSnapshot | null): RackNode {
  const state: NodeState = snapshot
    ? snapshot.nodes[n.id] ?? {
        status: 'WARN',
        checks: [{ name: 'Reporting', status: 'WARN', message: 'No status reported', checkedAt: snapshot.asOf }],
      }
    : { status: 'OK', checks: [] };

  return {
    ...n,
    status: state.status,
    checks: state.checks,
    // link state defaults to "up" when not reported
    network: n.network && {
      ...n.network,
      interfaces: n.network.interfaces.map((i) => ({ ...i, linkUp: state.links?.[i.name] ?? true })),
    },
  } as RackNode;
}

export function mergeRacks(racks: RackConfig[], snapshot: StatusSnapshot | null): Rack[] {
  return racks.map((r) => ({ ...r, nodes: r.nodes.map((n) => mergeNode(n, snapshot)) }));
}

export function mergeVms(vms: VmConfig[], snapshot: StatusSnapshot | null): Vm[] {
  return vms.map((v) => ({ ...v, status: snapshot ? snapshot.vms[v.id] ?? 'WARN' : 'OK' }));
}
