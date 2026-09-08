import {
  bool,
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  ref,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gLoft(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const known = new Set(incoming.statements.map(s => s.id));
  const profileIds = parseIds(input.profile_ids);
  if (profileIds.length < 2) {
    return { geometry: incoming, id: '', error: 'profile_ids must contain at least two profile ids' };
  }
  for (const id of profileIds) {
    const err = validateId(known, 'profile_ids', id);
    if (err) return { geometry: incoming, id: '', error: err };
  }

  const height = Number(input.height ?? 1);
  if (!Number.isFinite(height) || height <= 0) {
    return { geometry: incoming, id: '', error: 'height must be a positive finite number' };
  }
  const zValues = parseFlatNumbers(input.z_values);
  if (zValues && zValues.length !== profileIds.length) {
    return { geometry: incoming, id: '', error: 'z_values length must match profile_ids length' };
  }
  const ruled = Boolean(input.ruled ?? false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'loft');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, Arg> = {
    profiles: list(profileIds.map(ref)),
    height: num(height),
    ruled: bool(ruled),
  };
  if (zValues) args.z_values = numList(zValues);
  return { geometry: emit(incoming, id, 'loft', args), id };
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean);
  return [];
}

function parseFlatNumbers(value: unknown): number[] | null {
  if (value === undefined || value === null || value === '') return null;
  const raw = Array.isArray(value)
    ? value.flat(Infinity)
    : typeof value === 'string'
      ? value.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean)
      : [];
  const nums = raw.map(Number);
  return nums.length > 0 && nums.every(Number.isFinite) ? nums : null;
}

function validateId(known: ReadonlySet<string>, name: string, id: string): string | null {
  if (id === '') return `${name} is required`;
  if (!isValidId(id)) return `invalid ${name} "${id}"`;
  if (!known.has(id)) return `${name} "${id}" not found in upstream Geometry`;
  return null;
}

export default gLoft;
