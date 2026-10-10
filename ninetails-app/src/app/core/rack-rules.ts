import { RackConfig, Slot } from './models';

/**
 * Pure layout rules for a rack. They only look at geometry, so they accept both the baseline
 * (RackConfig) and the merged view (Rack).
 */

/**
 * One Slot per RU, 1..heightU. Standalone nodes and chassis each claim `sizeU` contiguous RUs
 * starting at `positionU`; nodes inside a chassis are skipped because their chassis owns those RUs.
 * Overlaps are flagged with `conflict` (first claimant keeps the slot); anything above heightU is
 * ignored so bad data cannot crash the view.
 */
export function computeSlotOccupancy(rack: RackConfig): Slot[] {
  const slots: Slot[] = Array.from({ length: rack.heightU }, (_, i) => ({ ru: i + 1 }));

  const claim = (itemId: string, positionU: number, sizeU: number) => {
    for (let ru = positionU; ru < positionU + sizeU; ru++) {
      const slot = slots[ru - 1];
      if (!slot) continue; // outside the rack
      if (slot.itemId) slot.conflict = true;
      else slot.itemId = itemId;
    }
  };

  for (const c of rack.chassis) claim(c.id, c.positionU, c.sizeU);
  for (const n of rack.nodes) {
    if (!n.chassisId && n.positionU !== undefined) claim(n.id, n.positionU, n.sizeU ?? 1);
  }
  return slots;
}

/**
 * Checks the layout rules and returns human-readable problems (empty = valid):
 *  - nothing sticks out of the rack, and no two standalone items/chassis share an RU;
 *  - inside a chassis, placements stay within its grid and use whole RUs;
 *  - HEIGHT RULE: two servers can never be stacked vertically in one RU - i.e. no two nodes
 *    of a chassis may cover the same grid cell (side by side in different columns is fine).
 */
export function validateRack(rack: RackConfig): string[] {
  const issues: string[] = [];

  for (const s of computeSlotOccupancy(rack)) {
    if (s.conflict) issues.push(`RU ${s.ru} holds more than one item (servers cannot be stacked in one RU).`);
  }
  const top = (positionU: number, sizeU: number) => positionU + sizeU - 1;
  for (const c of rack.chassis) {
    if (c.positionU < 1 || top(c.positionU, c.sizeU) > rack.heightU) issues.push(`Chassis ${c.name} does not fit in the rack.`);
  }
  for (const n of rack.nodes) {
    if (!n.chassisId && n.positionU !== undefined) {
      const size = n.sizeU ?? 1;
      if (!Number.isInteger(size) || size < 1) issues.push(`${n.name} must be a whole number of RU tall.`);
      if (n.positionU < 1 || top(n.positionU, size) > rack.heightU) issues.push(`${n.name} does not fit in the rack.`);
    }
  }

  for (const c of rack.chassis) {
    const taken = new Map<string, string>(); // "col,row" -> node name
    for (const n of rack.nodes.filter((x) => x.chassisId === c.id)) {
      const p = n.placement;
      if (!p) { issues.push(`${n.name} is in ${c.name} but has no placement.`); continue; }
      const whole = [p.col, p.row, p.colSpan, p.rowSpan].every(Number.isInteger);
      if (!whole || p.col < 1 || p.row < 1 || p.colSpan < 1 || p.rowSpan < 1
          || p.col + p.colSpan - 1 > c.columns || p.row + p.rowSpan - 1 > c.sizeU) {
        issues.push(`${n.name} placement is outside ${c.name} or not whole-RU.`);
        continue;
      }
      for (let col = p.col; col < p.col + p.colSpan; col++) {
        for (let row = p.row; row < p.row + p.rowSpan; row++) {
          const other = taken.get(`${col},${row}`);
          if (other) issues.push(`${n.name} and ${other} are stacked in the same RU of ${c.name}.`);
          else taken.set(`${col},${row}`, n.name);
        }
      }
    }
  }
  return issues;
}
