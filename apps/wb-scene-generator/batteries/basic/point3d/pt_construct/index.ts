/**
 * pt_construct — (x, y, z) → Point3D
 */

import { makePoint3D } from '../../../../vendor/dist/shared/types/index.js';

export function ptConstruct(input: Record<string, unknown>): Record<string, unknown> {
  const x = Number(input.x ?? 0);
  const y = Number(input.y ?? 0);
  const z = Number(input.z ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return { point: null, error: 'x/y/z must be finite numbers' };
  }
  return { point: makePoint3D(x, y, z) };
}
