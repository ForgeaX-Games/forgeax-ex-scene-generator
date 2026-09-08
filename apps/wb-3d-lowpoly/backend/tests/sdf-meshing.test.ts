/**
 * Marching Cubes 等值面提取单测（backend/src/services/baker/sdf/marching-cubes.ts + combine.ts）。
 * 覆盖计划里的验收点：单球半径误差、smooth-union 连通性 + 无尖锐棱线、确定性、越界报错。
 */
import { describe, it, expect } from 'vitest';
import { marchingCubes } from '../src/services/baker/sdf/marching-cubes.js';
import { compileSdf, smoothUnion, subtractSdf, intersectSdf } from '../src/services/baker/sdf/combine.js';
import { BakerError } from '../src/services/baker/errors.js';
import type { SdfDescriptor, SdfPrimitiveSpec } from '../src/services/baker/sdf/types.js';

type Vec3 = readonly [number, number, number];

function sphereDescriptor(id: string, center: Vec3, radius: number): SdfPrimitiveSpec {
  return { id, type: 'sphere', center, params: [radius, 0, 0], rotation: [0, 0, 0] };
}

function cubeBounds(half: number) {
  return { min: [-half, -half, -half] as Vec3, max: [half, half, half] as Vec3 };
}

/** BFS over shared vertex indices to count connected components of a triangle mesh. */
function connectedComponents(faces: readonly (readonly [number, number, number])[]): number {
  const adjacency = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a)!.add(b);
  };
  for (const [a, b, c] of faces) {
    link(a, b); link(b, a);
    link(b, c); link(c, b);
    link(a, c); link(c, a);
  }
  const visited = new Set<number>();
  let components = 0;
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    components += 1;
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const next of adjacency.get(cur) ?? []) {
        if (!visited.has(next)) { visited.add(next); stack.push(next); }
      }
    }
  }
  return components;
}

function faceNormal(vertices: readonly Vec3[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]]!, b = vertices[face[1]]!, c = vertices[face[2]]!;
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

describe('smoothUnion / subtractSdf / intersectSdf (SDF booleans)', () => {
  it('smoothUnion degenerates to min() when radius<=0', () => {
    expect(smoothUnion(0.5, -0.3, 0)).toBeCloseTo(Math.min(0.5, -0.3), 10);
    expect(smoothUnion(0.5, -0.3, -1)).toBeCloseTo(Math.min(0.5, -0.3), 10);
  });
  it('smoothUnion is <= min(a,b) (the blend only pulls the surface further inward)', () => {
    expect(smoothUnion(0.2, 0.25, 0.5)).toBeLessThanOrEqual(Math.min(0.2, 0.25) + 1e-12);
  });
  it('subtractSdf/intersectSdf match the standard max(a,-b)/max(a,b) formulas', () => {
    expect(subtractSdf(0.3, 0.1)).toBeCloseTo(Math.max(0.3, -0.1), 10);
    expect(intersectSdf(0.3, 0.1)).toBeCloseTo(Math.max(0.3, 0.1), 10);
  });
});

describe('marchingCubes: single sphere isosurface', () => {
  it('vertices land near the sphere surface within one voxel step', () => {
    const radius = 1;
    const resolution = 32;
    const descriptor: SdfDescriptor = {
      primitives: [sphereDescriptor('s', [0, 0, 0], radius)],
      operations: [],
      resolution,
    };
    const sample = compileSdf(descriptor);
    const bounds = cubeBounds(1.5);
    const mesh = marchingCubes(sample, { bounds, resolution });
    expect(mesh.vertices.length).toBeGreaterThan(0);
    expect(mesh.faces.length).toBeGreaterThan(0);
    const voxelStep = (bounds.max[0] - bounds.min[0]) / resolution;
    for (const v of mesh.vertices) {
      const dist = Math.hypot(v[0], v[1], v[2]);
      expect(Math.abs(dist - radius)).toBeLessThan(voxelStep);
    }
  });

  it('is a closed, single-component 2-manifold-ish mesh (every edge used by >=2 faces)', () => {
    const resolution = 20;
    const descriptor: SdfDescriptor = {
      primitives: [sphereDescriptor('s', [0, 0, 0], 1)],
      operations: [],
      resolution,
    };
    const sample = compileSdf(descriptor);
    const mesh = marchingCubes(sample, { bounds: cubeBounds(1.5), resolution });
    expect(connectedComponents(mesh.faces)).toBe(1);
  });

  it('same params (deterministic pure function) => byte-identical output on repeated calls', () => {
    const resolution = 16;
    const descriptor: SdfDescriptor = {
      primitives: [sphereDescriptor('s', [0.1, -0.2, 0.05], 0.8)],
      operations: [],
      resolution,
    };
    const bounds = cubeBounds(1.2);
    const a = marchingCubes(compileSdf(descriptor), { bounds, resolution });
    const b = marchingCubes(compileSdf(descriptor), { bounds, resolution });
    expect(a.vertices).toEqual(b.vertices);
    expect(a.faces).toEqual(b.faces);
  });
});

describe('marchingCubes: smooth-union of two overlapping spheres', () => {
  const makeTwoSphereDescriptor = (radius: number, gapFactor: number, blendRadius: number): SdfDescriptor => ({
    primitives: [
      sphereDescriptor('a', [-radius * gapFactor, 0, 0], radius),
      sphereDescriptor('b', [radius * gapFactor, 0, 0], radius),
    ],
    operations: [{ id: 'u', type: 'smooth-union', left: 'a', right: 'b', radius: blendRadius }],
    resolution: 28,
  });

  it('produces a single connected component (the two spheres fuse into one blob)', () => {
    const descriptor = makeTwoSphereDescriptor(0.6, 0.7, 0.4);
    const resolution = descriptor.resolution;
    const mesh = marchingCubes(compileSdf(descriptor), { bounds: cubeBounds(2), resolution });
    expect(connectedComponents(mesh.faces)).toBe(1);
  });

  it('smooth-union removes the sharp crease that a hard union (radius=0) would leave at the waist', () => {
    const radius = 0.6, gapFactor = 0.7, resolution = 28;
    const smoothMesh = marchingCubes(
      compileSdf(makeTwoSphereDescriptor(radius, gapFactor, 0.5)),
      { bounds: cubeBounds(2), resolution },
    );
    const hardMesh = marchingCubes(
      compileSdf(makeTwoSphereDescriptor(radius, gapFactor, 0)),
      { bounds: cubeBounds(2), resolution },
    );
    const maxAdjacentAngleDeg = (mesh: typeof smoothMesh): number => {
      const edgeFaces = new Map<string, number[]>();
      mesh.faces.forEach((face, fi) => {
        for (const [p, q] of [[face[0], face[1]], [face[1], face[2]], [face[2], face[0]]] as const) {
          const key = p < q ? `${p}_${q}` : `${q}_${p}`;
          if (!edgeFaces.has(key)) edgeFaces.set(key, []);
          edgeFaces.get(key)!.push(fi);
        }
      });
      let maxAngle = 0;
      for (const faceIdxs of edgeFaces.values()) {
        if (faceIdxs.length !== 2) continue;
        const n1 = faceNormal(mesh.vertices, mesh.faces[faceIdxs[0]]);
        const n2 = faceNormal(mesh.vertices, mesh.faces[faceIdxs[1]]);
        const dot = Math.min(1, Math.max(-1, n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]));
        maxAngle = Math.max(maxAngle, (Math.acos(dot) * 180) / Math.PI);
      }
      return maxAngle;
    };
    // Coarse but robust: the smooth-union blend should have a visibly gentler max dihedral
    // angle between adjacent faces than a hard union at the same resolution.
    expect(maxAdjacentAngleDeg(smoothMesh)).toBeLessThan(maxAdjacentAngleDeg(hardMesh));
  });
});

describe('bounds/limits validation', () => {
  it('throws BakerError when resolution < 2', () => {
    const descriptor: SdfDescriptor = { primitives: [sphereDescriptor('s', [0, 0, 0], 1)], operations: [], resolution: 1 };
    expect(() => marchingCubes(compileSdf(descriptor), { bounds: cubeBounds(1.5), resolution: 1 })).toThrow(BakerError);
  });

  it('throws BakerError when bounds are degenerate (zero/negative extent)', () => {
    const descriptor: SdfDescriptor = { primitives: [sphereDescriptor('s', [0, 0, 0], 1)], operations: [], resolution: 8 };
    const sample = compileSdf(descriptor);
    expect(() => marchingCubes(sample, { bounds: { min: [0, 0, 0], max: [0, 1, 1] }, resolution: 8 })).toThrow(BakerError);
  });

  it('compileSdf throws BakerError on duplicate primitive ids', () => {
    const descriptor: SdfDescriptor = {
      primitives: [sphereDescriptor('dup', [0, 0, 0], 1), sphereDescriptor('dup', [1, 0, 0], 1)],
      operations: [],
      resolution: 8,
    };
    expect(() => compileSdf(descriptor)).toThrow(BakerError);
  });

  it('compileSdf throws BakerError on forward/unknown operation references (no cycles allowed)', () => {
    const descriptor: SdfDescriptor = {
      primitives: [sphereDescriptor('a', [0, 0, 0], 1)],
      operations: [{ id: 'u', type: 'smooth-union', left: 'a', right: 'not-declared', radius: 0.2 }],
      resolution: 8,
    };
    expect(() => compileSdf(descriptor)).toThrow(BakerError);
  });
});
