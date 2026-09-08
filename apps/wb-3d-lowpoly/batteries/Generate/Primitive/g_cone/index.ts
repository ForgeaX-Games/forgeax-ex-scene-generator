import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCone(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 0.5);
  const height = Number(input.height ?? 1);
  if (!Number.isFinite(radius) || !Number.isFinite(height) || radius <= 0 || height <= 0) {
    return { geometry: incoming, id: '', error: 'radius and height must be positive finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'cone');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'cone', {
    radius: num(radius),
    height: num(height),
  });
  return { geometry: next, id };
}

export default gCone;
