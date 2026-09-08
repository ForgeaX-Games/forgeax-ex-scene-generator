/**
 * pt2_explode — Point2D → (x, y)
 */

import { isPoint2D } from '../../../../vendor/dist/shared/types/index.js';

export function pt2Explode(input: Record<string, unknown>): Record<string, unknown> {
  const p = input.point;
  if (!isPoint2D(p)) {
    return { x: 0, y: 0, error: 'point input must be a Point2D { x, y }' };
  }
  return { x: p.x, y: p.y };
}
