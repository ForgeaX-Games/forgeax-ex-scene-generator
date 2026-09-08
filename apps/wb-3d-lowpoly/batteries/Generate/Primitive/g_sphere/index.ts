/**
 * g_sphere —— 追加 `id = sphere(radius=...)`。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gSphere(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const radius = Number(input.radius ?? 1);
  if (!Number.isFinite(radius) || radius <= 0) {
    return { geometry: incoming, id: '', error: 'radius must be a positive finite number' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'sph');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'sphere', { radius: num(radius) });
  return { geometry: next, id };
}

export default gSphere;
