/**
 * Closed-loop spline algorithms for smoothing a cyclic sequence of 2D points.
 * All functions receive a closed polygon (point[n-1] connects back to point[0])
 * and return a new closed polygon (same convention).
 * Coordinate convention: Point = [x, y].
 */

export type Point = [number, number];

// ---------- Seeded RNG (LCG) ----------

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

// ---------- Moving Average (closed) ----------

/**
 * Sliding-window average with wrap-around indexing.
 * smoothness → half-window size (larger = smoother).
 */
export function movingAverageClosed(points: Point[], smoothness: number): Point[] {
  if (points.length < 2) return points;
  const w = Math.max(1, Math.round(smoothness));
  const n = points.length;
  return points.map((_, i) => {
    let sx = 0, sy = 0;
    for (let k = -w; k <= w; k++) {
      const j = ((i + k) % n + n) % n;
      sx += points[j][0];
      sy += points[j][1];
    }
    const count = 2 * w + 1;
    return [sx / count, sy / count] as Point;
  });
}

// ---------- Gaussian Filter (closed) ----------

/**
 * Gaussian-weighted average with wrap-around indexing.
 * smoothness → sigma (larger = more blur).
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

// ---------- Bezier (Chaikin subdivision, closed) ----------

/**
 * Chaikin's corner-cutting algorithm for a closed polygon.
 * This is an approximating subdivision scheme that produces smooth curves
 * WITHOUT overshoot - the curve always stays within the convex hull of
 * control points, eliminating the spike artifacts of interpolating splines.
 *
 * smoothness → number of subdivision iterations (1-5 recommended).
 * Each iteration doubles the point count and smooths corners.
 */
export function bezierSplineClosed(points: Point[], smoothness: number): Point[] {
  if (points.length < 3) return points;
  
  const iterations = Math.max(1, Math.min(5, Math.round(smoothness / 2)));
  let pts: Point[] = [...points];

  for (let iter = 0; iter < iterations; iter++) {
    const n = pts.length;
    const next: Point[] = [];
    
    for (let i = 0; i < n; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % n];
      
      // Chaikin cuts corners at 1/4 and 3/4 positions
      next.push([
        0.75 * p0[0] + 0.25 * p1[0],
        0.75 * p0[1] + 0.25 * p1[1],
      ]);
      next.push([
        0.25 * p0[0] + 0.75 * p1[0],
        0.25 * p0[1] + 0.75 * p1[1],
      ]);
    }
    
    pts = next;
  }

  return pts;
}

// ---------- Natural Cubic Spline (closed) ----------

/**
 * Solves the cyclic tridiagonal system for natural (closed) cubic spline.
 * All n segments form a closed loop.
 */
function solveClosedSplineM(y: number[]): number[] {
  const n = y.length;
  if (n <= 2) return new Array(n).fill(0);

  // 6 * (y[i-1] - 2*y[i] + y[i+1]) with wrap-around
  const rhs = y.map((_, i) => 6 * (y[(i - 1 + n) % n] - 2 * y[i] + y[(i + 1) % n]));

  // Thomas algorithm for cyclic tridiagonal (Sherman-Morrison)
  // All diagonal = 4, off-diagonal = 1 (unit-length equal spacing)
  const diag = new Array(n).fill(4);
  const lower = new Array(n).fill(1);
  const upper = new Array(n).fill(1);

  // Simple iterative relaxation (Gauss-Seidel) - sufficient for moderate n
  const m = new Array(n).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n;
      const next = (i + 1) % n;
      m[i] = (rhs[i] - lower[i] * m[prev] - upper[i] * m[next]) / diag[i];
    }
  }
  return m;
}

function evalCubicSegment(
  y0: number, y1: number, m0: number, m1: number, u: number
): number {
  return (
    m0 * Math.pow(1 - u, 3) / 6 +
    m1 * Math.pow(u, 3) / 6 +
    (y0 - m0 / 6) * (1 - u) +
    (y1 - m1 / 6) * u
  );
}

/**
 * Closed natural cubic spline (C2-continuous closed curve).
 * smoothness → samples per segment.
 */
export function cubicSplineClosed(points: Point[], smoothness: number): Point[] {
  if (points.length < 3) return bezierSplineClosed(points, smoothness);
  const sps = Math.max(2, Math.round(smoothness));
  const n = points.length;

  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  const Mx = solveClosedSplineM(xs);
  const My = solveClosedSplineM(ys);

  const result: Point[] = [];
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    for (let s = 0; s < sps; s++) {
      const u = s / sps;
      result.push([
        evalCubicSegment(xs[i], xs[i1], Mx[i], Mx[i1], u),
        evalCubicSegment(ys[i], ys[i1], My[i], My[i1], u),
      ]);
    }
  }
  return result;
}

// ---------- Polyline Perturbation (closed) ----------

/**
 * Recursive midpoint displacement on a closed polygon.
 * Each segment's midpoint is perturbed, then recursively subdivided.
 * smoothness → initial perturbation amplitude; iterations fixed at 3.
 * After perturbation, applies a light smoothing pass to remove small indentations.
 */
export function polylinePerturbClosed(
  points: Point[], smoothness: number, seed: number
): Point[] {
  if (points.length < 3) return points;
  const rng = makeRng(seed);
  const iterations = 3;
  let amp = Math.max(0.5, smoothness * 0.5);
  let pts: Point[] = [...points];

  for (let iter = 0; iter < iterations; iter++) {
    const n = pts.length;
    const next: Point[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      next.push(a, [
        (a[0] + b[0]) / 2 + (rng() - 0.5) * 2 * amp,
        (a[1] + b[1]) / 2 + (rng() - 0.5) * 2 * amp,
      ]);
    }
    pts = next;
    amp *= 0.55;
  }

  // Post-perturbation smoothing pass to remove small indentations
  // Uses a small moving average window (size 2) to smooth out sharp concavities
  const smoothed = movingAverageClosed(pts, 2);
  return smoothed;
}
