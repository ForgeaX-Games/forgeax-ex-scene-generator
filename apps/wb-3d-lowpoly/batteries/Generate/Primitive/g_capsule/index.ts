import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCapsule(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 0.25);
  const length = Number(input.length ?? 1);
  if (!Number.isFinite(radius) || !Number.isFinite(length) || radius <= 0 || length <= 0) {
    return { geometry: incoming, id: '', error: 'radius and length must be positive finite numbers' };
  }
  if (length < 2 * radius) {
    return { geometry: incoming, id: '', error: 'length must be >= 2 * radius' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'capsule');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'capsule', {
    radius: num(radius),
    length: num(length),
  });
  return { geometry: next, id };
}

export default gCapsule;
