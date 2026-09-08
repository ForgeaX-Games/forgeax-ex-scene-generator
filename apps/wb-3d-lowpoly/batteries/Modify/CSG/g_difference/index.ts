import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gDifference(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const baseId = String(input.base_id ?? '').trim();
  const toolId = String(input.tool_id ?? '').trim();
  const err = validateRefs(incoming.statements.map(s => s.id), { base_id: baseId, tool_id: toolId });
  if (err) return { geometry: incoming, id: '', error: err };

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'diff');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'difference', { base: ref(baseId), tool: ref(toolId) }), id };
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

export default gDifference;
