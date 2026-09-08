import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
  ref,
  str,
} from '../../../../vendor/dist/shared/types/index.js';

export function gMirror(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const err = validateShapeId(incoming.statements.map(s => s.id), shapeId);
  if (err) return { geometry: incoming, id: '', error: err };

  const plane = String(input.plane ?? 'YZ').trim().toUpperCase();
  if (!['XY', 'YZ', 'XZ'].includes(plane)) {
    return { geometry: incoming, id: '', error: 'plane must be one of XY/YZ/XZ' };
  }
  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (![ox, oy, oz].every(Number.isFinite)) return { geometry: incoming, id: '', error: 'origin must be finite' };

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'mirror');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  return {
    geometry: emit(incoming, id, 'mirror', { shape: ref(shapeId), plane: str(plane), origin: numList([ox, oy, oz]) }),
    id,
  };
}

function validateShapeId(knownIds: string[], id: string): string | null {
  if (id === '') return 'shape_id is required';
  if (!isValidId(id)) return `invalid shape_id "${id}"`;
  if (!new Set(knownIds).has(id)) return `shape_id "${id}" not found in upstream Geometry`;
  return null;
}

export default gMirror;
