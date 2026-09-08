import {
  bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPipe(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const path = parseFlatNumbers(input.path);
  if (!path || path.length < 6 || path.length % 3 !== 0) {
    return { geometry: incoming, id: '', error: 'path must be a flat [x1,y1,z1,x2,y2,z2,...] list with at least 2 points' };
  }
  const radius = Number(input.radius ?? 0.05);
  if (!Number.isFinite(radius) || radius <= 0) {
    return { geometry: incoming, id: '', error: 'radius must be a positive finite number' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'pipe');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, ReturnType<typeof num> | ReturnType<typeof numList> | ReturnType<typeof str> | ReturnType<typeof bool>> = {
    path: numList(path),
    radius: num(radius),
  };
  const spline = String(input.spline ?? 'polyline').trim();
  if (spline && spline !== 'polyline') args.spline = str(spline);
  const samples = Number(input.samples_per_segment ?? input.samplesPerSegment);
  if (Number.isFinite(samples) && samples > 0) args.samples_per_segment = num(samples);
  const radialSegments = Number(input.radial_segments ?? input.radialSegments);
  if (Number.isFinite(radialSegments) && radialSegments > 0) args.radial_segments = num(radialSegments);
  if (input.closed !== undefined) args.closed = bool(Boolean(input.closed));
  if (input.cap !== undefined) args.cap = bool(Boolean(input.cap));
  const upHint = parseFlatNumbers(input.up_hint ?? input.upHint);
  if (upHint && upHint.length === 3) args.up_hint = numList(upHint);

  return { geometry: emit(incoming, id, 'pipe', args), id };
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

export default gPipe;
