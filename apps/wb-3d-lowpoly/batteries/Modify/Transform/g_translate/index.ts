import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gTranslate(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const err = validateShapeId(incoming.statements.map(s => s.id), shapeId);
  if (err) return { geometry: incoming, id: '', error: err };

  const x = Number(input.x ?? 0);
  const y = Number(input.y ?? 0);
  const z = Number(input.z ?? 0);
  if (![x, y, z].every(Number.isFinite)) {
    return { geometry: incoming, id: '', error: 'x/y/z must be finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'move');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  return { geometry: emit(incoming, id, 'translate', { shape: ref(shapeId), offset: numList([x, y, z]) }), id };
}

function validateShapeId(knownIds: string[], id: string): string | null {
  if (id === '') return 'shape_id is required';
  if (!isValidId(id)) return `invalid shape_id "${id}"`;
  if (!new Set(knownIds).has(id)) return `shape_id "${id}" not found in upstream Geometry`;
  return null;
}

export default gTranslate;
