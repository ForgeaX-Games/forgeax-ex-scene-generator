/**
 * g_cylinder —— 追加 `id = cylinder(radius=..., length=...)`。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCylinder(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 1);
  const length = Number(input.length ?? 1);
  if (!Number.isFinite(radius) || !Number.isFinite(length) || radius <= 0 || length <= 0) {
    return { geometry: incoming, id: '', error: 'radius and length must be positive finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'cyl');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'cylinder', {
    radius: num(radius),
    length: num(length),
  });
  return { geometry: next, id };
}

export default gCylinder;
