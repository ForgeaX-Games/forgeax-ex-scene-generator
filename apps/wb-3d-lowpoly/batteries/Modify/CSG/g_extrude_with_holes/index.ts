import {
  bool,
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  num,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gExtrudeWithHoles(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const known = new Set(incoming.statements.map(s => s.id));
  const outerId = String(input.outer_id ?? '').trim();
  const holeIds = parseIds(input.hole_ids);

  const outerErr = validateId(known, 'outer_id', outerId);
  if (outerErr) return { geometry: incoming, id: '', error: outerErr };
  for (const holeId of holeIds) {
    const holeErr = validateId(known, 'hole_ids', holeId);
    if (holeErr) return { geometry: incoming, id: '', error: holeErr };
  }

  const height = Number(input.height ?? 0.2);
  if (!Number.isFinite(height) || height <= 0) {
    return { geometry: incoming, id: '', error: 'height must be a positive finite number' };
  }
  const center = input.center === undefined ? true : Boolean(input.center);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'extrude');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return {
    geometry: emit(incoming, id, 'extrude_with_holes', {
      outer: ref(outerId),
      holes: list(holeIds.map(ref)),
      height: num(height),
      center: bool(center),
    }),
    id,
  };
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function validateId(known: ReadonlySet<string>, name: string, id: string): string | null {
  if (id === '') return `${name} is required`;
  if (!isValidId(id)) return `invalid ${name} "${id}"`;
  if (!known.has(id)) return `${name} "${id}" not found in upstream Geometry`;
  return null;
}

export default gExtrudeWithHoles;
