import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gIntersection(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const aId = String(input.a_id ?? '').trim();
  const bId = String(input.b_id ?? '').trim();
  const err = validateRefs(incoming.statements.map(s => s.id), { a_id: aId, b_id: bId });
  if (err) return { geometry: incoming, id: '', error: err };

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'intersect');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'intersection', { a: ref(aId), b: ref(bId) }), id };
}

function validateRefs(knownIds: string[], refs: Record<string, string>): string | null {
  const known = new Set(knownIds);
  for (const [name, id] of Object.entries(refs)) {
    if (id === '') return `${name} is required`;
    if (!isValidId(id)) return `invalid ${name} "${id}"`;
    if (!known.has(id)) return `${name} "${id}" not found in upstream Geometry`;
  }
  return null;
}

export default gIntersection;
