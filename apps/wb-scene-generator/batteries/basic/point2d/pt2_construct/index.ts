/**
 * pt2_construct — (x, y) → Point2D
 */

import { makePoint2D } from '../../../../vendor/dist/shared/types/index.js';

export function pt2Construct(input: Record<string, unknown>): Record<string, unknown> {
  const x = Number(input.x ?? 0);
  const y = Number(input.y ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { point: null, error: 'x/y must be finite numbers' };
  }
  return { point: makePoint2D(x, y) };
}
