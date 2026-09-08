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

export function gArrayLinear(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const err = validateShapeId(incoming.statements.map(s => s.id), shapeId);
  if (err) return { geometry: incoming, id: '', error: err };

  const count = Math.round(Number(input.count ?? 3));
  const dx = Number(input.dx ?? 1);
  const dy = Number(input.dy ?? 0);
  const dz = Number(input.dz ?? 0);
  if (!Number.isFinite(count) || count < 1 || count > 128) {
    return { geometry: incoming, id: '', error: 'count must be an integer in [1, 128]' };
  }
  if (![dx, dy, dz].every(Number.isFinite)) return { geometry: incoming, id: '', error: 'step must be finite' };

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'array');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  return {
    geometry: emit(incoming, id, 'array_linear', { shape: ref(shapeId), count: num(count), step: numList([dx, dy, dz]) }),
    id,
  };
}

function validateShapeId(knownIds: string[], id: string): string | null {
  if (id === '') return 'shape_id is required';
  if (!isValidId(id)) return `invalid shape_id "${id}"`;
  if (!new Set(knownIds).has(id)) return `shape_id "${id}" not found in upstream Geometry`;
  return null;
}

export default gArrayLinear;
