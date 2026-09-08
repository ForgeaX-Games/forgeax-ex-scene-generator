import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gProfileCircle(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 0.5);
  const segments = Math.round(Number(input.segments ?? 48));
  if (!Number.isFinite(radius) || radius <= 0) {
    return { geometry: incoming, id: '', error: 'radius must be a positive finite number' };
  }
  if (!Number.isFinite(segments) || segments < 3 || segments > 256) {
    return { geometry: incoming, id: '', error: 'segments must be an integer in [3, 256]' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'profile');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'profile_circle', { radius: num(radius), segments: num(segments) }), id };
}

export default gProfileCircle;
