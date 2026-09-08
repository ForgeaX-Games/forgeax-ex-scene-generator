import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gProfileRect(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const w = Number(input.w ?? 1);
  const d = Number(input.d ?? 1);
  if (!Number.isFinite(w) || !Number.isFinite(d) || w <= 0 || d <= 0) {
    return { geometry: incoming, id: '', error: 'w and d must be positive finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'profile');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'profile_rect', { w: num(w), d: num(d) }), id };
}

export default gProfileRect;
