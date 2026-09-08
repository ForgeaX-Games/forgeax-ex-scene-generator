import {
  bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
  ref,
  num,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gSweep(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const known = new Set(incoming.statements.map(s => s.id));
  const profileId = String(input.profile_id ?? '').trim();
  const err = validateId(known, 'profile_id', profileId);
  if (err) return { geometry: incoming, id: '', error: err };

  const path = parseFlatNumbers(input.path);
  if (!path || path.length < 6 || path.length % 3 !== 0) {
    return { geometry: incoming, id: '', error: 'path must be a flat [x1,y1,z1,x2,y2,z2,...] list with at least 2 points' };
  }
  const ruled = Boolean(input.ruled ?? false);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'sweep');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, Arg> = { profile: ref(profileId), path: numList(path), ruled: bool(ruled) };
  const spline = String(input.spline ?? 'polyline').trim();
  if (spline && spline !== 'polyline') args.spline = str(spline);
  const samples = Number(input.samples_per_segment ?? input.samplesPerSegment);
  if (Number.isFinite(samples) && samples > 0) args.samples_per_segment = num(samples);
  if (input.align !== undefined) args.align = bool(Boolean(input.align));
  if (input.closed !== undefined) args.closed = bool(Boolean(input.closed));
  if (input.cap !== undefined) args.cap = bool(Boolean(input.cap));
  const upHint = parseFlatNumbers(input.up_hint ?? input.upHint);
  if (upHint && upHint.length === 3) args.up_hint = numList(upHint);

  return { geometry: emit(incoming, id, 'sweep', args), id };
}

function parseFlatNumbers(value: unknown): number[] | null {
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

export default gSweep;
