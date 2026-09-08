/**
 * pt_explode — Point3D → (x, y, z)
 */

import { isPoint3D } from '../../../../vendor/dist/shared/types/index.js';

export function ptExplode(input: Record<string, unknown>): Record<string, unknown> {
  const p = input.point;
  if (!isPoint3D(p)) {
    return { x: 0, y: 0, z: 0, error: 'point input must be a Point3D { x, y, z }' };
  }
  return { x: p.x, y: p.y, z: p.z };
}
