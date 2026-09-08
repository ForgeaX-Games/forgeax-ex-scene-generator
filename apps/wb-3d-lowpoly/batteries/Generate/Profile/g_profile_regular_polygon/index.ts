import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gProfileRegularPolygon(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 0.5);
  const sides = Math.round(Number(input.sides ?? 6));
  if (!Number.isFinite(radius) || radius <= 0) {
    return { geometry: incoming, id: '', error: 'radius must be a positive finite number' };
  }
  if (!Number.isFinite(sides) || sides < 3 || sides > 128) {
    return { geometry: incoming, id: '', error: 'sides must be an integer in [3, 128]' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'profile');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return {
    geometry: emit(incoming, id, 'profile_regular_polygon', { radius: num(radius), sides: num(sides) }),
    id,
  };
}

export default gProfileRegularPolygon;
