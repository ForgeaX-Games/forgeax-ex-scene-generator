/**
 * g_door_leaf —— append exactly one door_leaf(...) shape.
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const HINGES = new Set(['left', 'right', 'center']);
const STYLES = new Set(['flush', 'panel', 'glazed']);

export function gDoorLeaf(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const width = Number(input.width);
  const height = Number(input.height);
  const thickness = Number(input.thickness);
  if (![width, height, thickness].every(Number.isFinite) || width <= 0 || height <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'door_leaf: width, height and thickness must be positive finite numbers' };
  }

  const hinge = String(input.hinge ?? 'center').trim().toLowerCase();
  const style = String(input.style ?? 'flush').trim().toLowerCase();
  if (!HINGES.has(hinge)) {
    return { geometry: incoming, id: '', error: 'door_leaf: hinge must be left, right, or center' };
  }
  if (!STYLES.has(style)) {
    return { geometry: incoming, id: '', error: 'door_leaf: style must be flush, panel, or glazed' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId || freshId(incoming, 'door_leaf');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, Arg> = {
    size: numList([width, height]),
    thickness: num(thickness),
  };
  if (hinge !== 'center') args.hinge = str(hinge);
  if (style !== 'flush') args.style = str(style);

  if (style === 'panel') {
    const rows = Math.round(Number(input.panel_rows ?? 2));
    const cols = Math.round(Number(input.panel_cols ?? 1));
    if (!Number.isFinite(rows) || rows < 1 || !Number.isFinite(cols) || cols < 1) {
      return { geometry: incoming, id: '', error: 'door_leaf: panel_rows and panel_cols must be positive integers' };
    }
    args.panel_rows = num(rows);
    args.panel_cols = num(cols);
  }
  return { geometry: emit(incoming, id, 'door_leaf', args), id };
}

export default gDoorLeaf;
