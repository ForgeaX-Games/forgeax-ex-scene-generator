import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gProfileRoundedRect(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const w = Number(input.w ?? 1);
  const d = Number(input.d ?? 1);
  const radius = Number(input.radius ?? 0.1);
  const segments = Math.round(Number(input.segments ?? 8));
  if (![w, d, radius].every(Number.isFinite) || w <= 0 || d <= 0 || radius < 0) {
    return { geometry: incoming, id: '', error: 'w/d must be positive and radius must be >= 0' };
  }
  if (radius > Math.min(w, d) / 2) return { geometry: incoming, id: '', error: 'radius must be <= min(w,d)/2' };
  if (!Number.isFinite(segments) || segments < 1 || segments > 64) {
    return { geometry: incoming, id: '', error: 'segments must be an integer in [1, 64]' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'profile');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return {
    geometry: emit(incoming, id, 'profile_rounded_rect', {
      w: num(w),
      d: num(d),
      radius: num(radius),
      segments: num(segments),
    }),
    id,
  };
}

export default gProfileRoundedRect;
