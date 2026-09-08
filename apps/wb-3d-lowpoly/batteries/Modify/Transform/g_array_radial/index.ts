import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gArrayRadial(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const err = validateShapeId(incoming.statements.map(s => s.id), shapeId);
  if (err) return { geometry: incoming, id: '', error: err };

  const count = Math.round(Number(input.count ?? 6));
  const angleDeg = Number(input.angle_deg ?? 360);
  const ax = Number(input.ax ?? 0);
  const ay = Number(input.ay ?? 0);
  const az = Number(input.az ?? 1);
  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (!Number.isFinite(count) || count < 1 || count > 128) {
    return { geometry: incoming, id: '', error: 'count must be an integer in [1, 128]' };
  }
  if (![angleDeg, ax, ay, az, ox, oy, oz].every(Number.isFinite) || Math.hypot(ax, ay, az) <= 1e-9) {
    return { geometry: incoming, id: '', error: 'angle/axis/origin must be finite and axis must be non-zero' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'radial');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  return {
    geometry: emit(incoming, id, 'array_radial', {
      shape: ref(shapeId),
      count: num(count),
      angle_deg: num(angleDeg),
      axis: numList([ax, ay, az]),
      origin: numList([ox, oy, oz]),
    }),
    id,
  };
}

function validateShapeId(knownIds: string[], id: string): string | null {
  if (id === '') return 'shape_id is required';
  if (!isValidId(id)) return `invalid shape_id "${id}"`;
  if (!new Set(knownIds).has(id)) return `shape_id "${id}" not found in upstream Geometry`;
  return null;
}

export default gArrayRadial;
