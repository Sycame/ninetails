import { Chassis, Placement, Rack, RackNode, Status, worstStatus } from '../../core/models';

/**
 * Pure functions that turn a Rack into plain "what goes in which grid cell" data,
 * so the template stays dumb and the logic is easy to unit test.
 *
 * Rack grid: one row per RU. positionU counts from the BOTTOM, CSS grid rows from the TOP,
 * so rows are flipped (see ruRow).
 */

/** A node plus the CSS grid placement inside its parent (chassis grid or rack grid). */
export interface LayoutMember {
  node: RackNode;
  gridRow: string;
  gridColumn: string;
}

/** Something drawn directly on the rack: a standalone node or a chassis with members. */
export interface LayoutItem {
  id: string;
  /** grid-row inside the rack grid. */
  row: string;
  chassis?: Chassis;
  members: LayoutMember[];
  status: Status;
}

export interface RackLayout {
  /** RU numbers, top of the rack first, with their grid row (for the index column). */
  labels: { ru: number; row: number }[];
  items: LayoutItem[];
}

/** grid-row value for something `sizeU` tall whose lowest RU is `positionU`. */
export function ruRow(heightU: number, positionU: number, sizeU: number): string {
  const top = heightU - (positionU + sizeU - 1) + 1;
  return `${top} / span ${sizeU}`;
}

/** CSS grid values for a placement inside a chassis grid. */
export function placementStyle(p: Placement): { gridRow: string; gridColumn: string } {
  return { gridRow: `${p.row} / span ${p.rowSpan}`, gridColumn: `${p.col} / span ${p.colSpan}` };
}

export function buildLayout(rack: Rack): RackLayout {
  const labels = Array.from({ length: rack.heightU }, (_, i) => ({ ru: rack.heightU - i, row: i + 1 }));
  const items: LayoutItem[] = [];

  for (const c of rack.chassis) {
    const members = rack.nodes
      .filter((n) => n.chassisId === c.id && n.placement)
      .map((node) => ({ node, ...placementStyle(node.placement!) }));
    items.push({
      id: c.id,
      row: ruRow(rack.heightU, c.positionU, c.sizeU),
      chassis: c,
      members,
      status: worstStatus(members.map((m) => m.node.status)),
    });
  }

  for (const node of rack.nodes) {
    if (node.chassisId || node.positionU === undefined) continue; // chassis members are drawn inside their chassis
    items.push({
      id: node.id,
      row: ruRow(rack.heightU, node.positionU, node.sizeU ?? 1),
      members: [{ node, gridRow: '', gridColumn: '' }],
      status: node.status,
    });
  }
  return { labels, items };
}
