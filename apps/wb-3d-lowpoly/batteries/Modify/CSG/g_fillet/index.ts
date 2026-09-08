import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  ref,
  str,
} from '../../../../vendor/dist/shared/types/index.js';

const EDGE_MODES = new Set(['all', 'vertical']);

export function gFillet(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const shapeId = String(input.shape_id ?? '').trim();
  const known = new Set(incoming.statements.map(s => s.id));
  if (shapeId === '') return { geometry: incoming, id: '', error: 'shape_id is required' };
  if (!isValidId(shapeId)) return { geometry: incoming, id: '', error: `invalid shape_id "${shapeId}"` };
  if (!known.has(shapeId)) {
    return { geometry: incoming, id: '', error: `shape_id "${shapeId}" not found in upstream Geometry` };
  }

  const radius = Number(input.radius ?? 0);
  if (!Number.isFinite(radius) || radius <= 0) {
    return { geometry: incoming, id: '', error: 'radius must be a positive finite number' };
  }

  const type = String(input.type ?? 'round').trim().toLowerCase();
  if (type !== 'round' && type !== 'chamfer') {
    return { geometry: incoming, id: '', error: `type must be "round" or "chamfer" (got "${type}")` };
  }

  const edges = String(input.edges ?? 'all').trim().toLowerCase();
  if (!EDGE_MODES.has(edges)) {
    return { geometry: incoming, id: '', error: `edges must be "all" or "vertical" (got "${edges}")` };
  }

  const op = type === 'chamfer' ? 'chamfer' : 'fillet';
  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, op);
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return {
    geometry: emit(incoming, id, op, { shape: ref(shapeId), radius: num(radius), edges: str(edges) }),
    id,
  };
}

export default gFillet;
