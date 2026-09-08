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

export function gScale(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const err = validateShapeId(incoming.statements.map(s => s.id), shapeId);
  if (err) return { geometry: incoming, id: '', error: err };

  const factor = Number(input.factor ?? 1);
  const cx = Number(input.cx ?? 0);
  const cy = Number(input.cy ?? 0);
  const cz = Number(input.cz ?? 0);
  if (![factor, cx, cy, cz].every(Number.isFinite) || factor <= 0) {
    return { geometry: incoming, id: '', error: 'factor must be positive; center must be finite' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'scale');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  return {
    geometry: emit(incoming, id, 'scale', { shape: ref(shapeId), factor: num(factor), center: numList([cx, cy, cz]) }),
    id,
  };
}

function validateShapeId(knownIds: string[], id: string): string | null {
  if (id === '') return 'shape_id is required';
  if (!isValidId(id)) return `invalid shape_id "${id}"`;
  if (!new Set(knownIds).has(id)) return `shape_id "${id}" not found in upstream Geometry`;
  return null;
}

export default gScale;
