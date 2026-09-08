/**
 * Closed-loop gaussian smoothing of a cyclic 2D point sequence.
 * Ported verbatim from zone_nesting; point_zone_gen uses a single, fixed
 * spline pass (gaussian) since it only exposes `seed` to the user.
 * Coordinate convention: Point = [x, y] where x = column, y = row.
 */

export type Point = [number, number];

/**
 * Gaussian-weighted average with wrap-around indexing.
 * smoothness → sigma * 3 (larger = more blur).
 */
export function gaussianFilterClosed(points: Point[], smoothness: number): Point[] {
  if (points.length < 2) return points;
  const sigma = Math.max(0.5, smoothness / 3);
  const radius = Math.ceil(3 * sigma);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, k) => {
    const d = k - radius;
    return Math.exp(-(d * d) / (2 * sigma * sigma));
  });
  const n = points.length;

  return points.map((_, i) => {
    let sx = 0, sy = 0, sw = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = ((i + k) % n + n) % n;
      const wt = kernel[k + radius];
      sx += points[j][0] * wt;
      sy += points[j][1] * wt;
      sw += wt;
    }
    return [sx / sw, sy / sw] as Point;
  });
}
