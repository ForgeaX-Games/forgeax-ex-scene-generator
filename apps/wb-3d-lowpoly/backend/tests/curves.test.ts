/**
 * Regression tests for backend/src/services/baker/curves.ts spline sampling.
 *
 * Run:
 *   cd backend && npx vitest run tests/curves.test.ts
 */
import { describe, expect, it } from 'vitest';
import { samplePath, type Vec3 } from '../src/services/baker/curves.js';

describe('samplePath: catmull_rom open-curve boundary', () => {
  it('starts exactly at the first control point (no origin-collapse glitch)', () => {
    // Snake-body-like path: flat "ground" run, then a lift into an S-bend.
    // The first control point sits far from the world origin, so any collapse
    // toward (0,0,0) at the boundary segment is immediately visible.
    const path: Vec3[] = [
      [-1.15, 0, 0.16],
      [-0.75, 0, 0.16],
      [-0.40, 0, 0.16],
      [-0.12, 0, 0.34],
      [0.08, 0, 0.68],
      [0.20, 0, 1.05],
      [0.16, 0, 1.45],
      [-0.05, 0, 1.78],
      [-0.12, 0, 2.05],
      [0.14, 0, 2.28],
    ];

    const sampled = samplePath(path, { spline: 'catmull_rom', samplesPerSegment: 12 });

    expect(sampled[0][0]).toBeCloseTo(path[0][0], 6);
    expect(sampled[0][1]).toBeCloseTo(path[0][1], 6);
    expect(sampled[0][2]).toBeCloseTo(path[0][2], 6);

    // No sample should ever jump back toward the origin — every point must stay
    // within (a small margin beyond) the path's own bounding box.
    const margin = 0.05;
    const lo = [0, 1, 2].map((axis) => Math.min(...path.map((p) => p[axis])) - margin);
    const hi = [0, 1, 2].map((axis) => Math.max(...path.map((p) => p[axis])) + margin);
    for (const p of sampled) {
      for (const axis of [0, 1, 2]) {
        expect(p[axis]).toBeGreaterThanOrEqual(lo[axis]);
        expect(p[axis]).toBeLessThanOrEqual(hi[axis]);
      }
    }
  });

  it('ends exactly at the last control point', () => {
    const path: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0.5],
      [2, 0, 1.5],
      [3, 0, 1.8],
    ];
    const sampled = samplePath(path, { spline: 'catmull_rom', samplesPerSegment: 8 });
    const last = sampled[sampled.length - 1];
    expect(last[0]).toBeCloseTo(path[path.length - 1][0], 6);
    expect(last[1]).toBeCloseTo(path[path.length - 1][1], 6);
    expect(last[2]).toBeCloseTo(path[path.length - 1][2], 6);
  });
});
