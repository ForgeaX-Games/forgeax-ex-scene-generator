import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gTorus(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const majorRadius = Number(input.major_radius ?? 0.5);
  const minorRadius = Number(input.minor_radius ?? 0.1);
  if (
    !Number.isFinite(majorRadius) ||
    !Number.isFinite(minorRadius) ||
    majorRadius <= 0 ||
    minorRadius <= 0
  ) {
    return { geometry: incoming, id: '', error: 'major_radius and minor_radius must be positive finite numbers' };
  }
  if (minorRadius >= majorRadius) {
    return { geometry: incoming, id: '', error: 'minor_radius must be < major_radius' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'torus');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'torus', {
    major_radius: num(majorRadius),
    minor_radius: num(minorRadius),
  });
  return { geometry: next, id };
}

export default gTorus;
