/**
 * Analytic surface placement helpers inspired by articraft.sdk.placement.
 *
 * For primitive parent shapes (box / cylinder / sphere) this queries the actual
 * local surface and normal. Complex shapes fall back to their derived AABB so
 * placement remains usable without forcing a mesh bake in the battery layer.
 */

import type { Arg, Statement } from './types.js';
import { localAabbFromPart, type LocalAABB } from './aabb.js';

export type Vec3 = readonly [number, number, number];

export interface SurfaceFrame3 {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly tangentU: Vec3;
  readonly tangentV: Vec3;
  readonly source: 'analytic' | 'aabb';
}

export interface SurfacePlacement3 {
  readonly origin: Vec3;
  readonly rpy: Vec3;
  readonly frame: SurfaceFrame3;
  readonly support: number;
  readonly clearance: number;
}

const EPS = 1e-9;

export function surfaceFrameFromPart(
  part: Statement,
  byId: ReadonlyMap<string, Statement>,
  opts: {
    readonly pointHint?: Vec3;
    readonly direction?: Vec3;
    readonly upHint?: Vec3;
  },
): SurfaceFrame3 | null {
  if ((opts.pointHint === undefined) === (opts.direction === undefined)) return null;

  const aabb = localAabbFromPart(part, byId);
  if (!aabb) return null;

  const query = opts.pointHint ?? queryPointFromDirection(aabb, normalize(opts.direction!, 'direction'));
  const hit = querySurface(part, byId, query, aabb);
  if (!hit) return null;

  const normal = normalize(hit.normal, 'surface normal');
  const [tangentU, tangentV] = buildSurfaceTangents(normal, opts.upHint ?? [0, 0, 1]);
  return {
    point: hit.point,
    normal,
    tangentU,
    tangentV,
    source: hit.source,
  };
}

export function placePartOnSurface(
  child: Statement,
  parent: Statement,
  byId: ReadonlyMap<string, Statement>,
  opts: {
    readonly pointHint?: Vec3;
    readonly direction?: Vec3;
    readonly childAxis?: string;
    readonly clearance?: number;
    readonly spin?: number;
    readonly upHint?: Vec3;
  },
): SurfacePlacement3 | null {
  const frame = surfaceFrameFromPart(parent, byId, opts);
  if (!frame) return null;

  const childAxis = opts.childAxis ?? '+z';
  const axis = axisVector(childAxis);
  const support = minProjectionAlongAxis(child, byId, axis);
  if (support === null) return null;

  const clearance = opts.clearance ?? 0;
  const offset = clearance - support;
  const origin: Vec3 = [
    frame.point[0] + frame.normal[0] * offset,
    frame.point[1] + frame.normal[1] * offset,
    frame.point[2] + frame.normal[2] * offset,
  ];
  const rot = rotationForSurfaceFrame(frame, childAxis, opts.spin ?? 0);
  return {
    origin,
    rpy: mat3ToRpy(rot),
    frame,
    support,
    clearance,
  };
}

function queryPointFromDirection(aabb: LocalAABB, dir: Vec3): Vec3 {
  const radius = Math.max(norm(aabb.halfExtent) * 4, 1e-3);
  return [
    aabb.center[0] + dir[0] * radius,
    aabb.center[1] + dir[1] * radius,
    aabb.center[2] + dir[2] * radius,
  ];
}

function querySurface(
  part: Statement,
  byId: ReadonlyMap<string, Statement>,
  query: Vec3,
  fallbackAabb: LocalAABB,
): { point: Vec3; normal: Vec3; source: 'analytic' | 'aabb' } | null {
  const shape = shapeFromPart(part, byId);
  if (!shape) return null;

  switch (shape.op) {
    case 'sphere': {
      const radius = readNumber(shape.args.radius);
      if (radius === undefined || radius <= 0) break;
      const normal = normalize(query, 'sphere query direction');
      return {
        point: [normal[0] * radius, normal[1] * radius, normal[2] * radius],
        normal,
        source: 'analytic',
      };
    }
    case 'box': {
      const size = readNumList(shape.args.size, 3);
      if (!size) break;
      const hit = closestPointOnBox(query, [0, 0, 0], [size[0] / 2, size[1] / 2, size[2] / 2]);
      return { ...hit, source: 'analytic' };
    }
    case 'cylinder': {
      const radius = readNumber(shape.args.radius);
      const length = readNumber(shape.args.length);
      if (radius === undefined || length === undefined || radius <= 0 || length <= 0) break;
      const hit = closestPointOnCylinder(query, radius, length);
      return { ...hit, source: 'analytic' };
    }
  }

  const hit = closestPointOnBox(query, fallbackAabb.center, fallbackAabb.halfExtent);
  return { ...hit, source: 'aabb' };
}

function shapeFromPart(part: Statement, byId: ReadonlyMap<string, Statement>): Statement | null {
  if (part.op !== 'part') return null;
  const shapeRef = part.args.shape;
  if (!shapeRef || shapeRef.kind !== 'ref') return null;
  return byId.get(shapeRef.name) ?? null;
}

function closestPointOnBox(
  point: Vec3,
  center: Vec3,
  half: Vec3,
): { point: Vec3; normal: Vec3 } {
  const local: Vec3 = [point[0] - center[0], point[1] - center[1], point[2] - center[2]];
  const clamped: [number, number, number] = [
    clamp(local[0], -half[0], half[0]),
    clamp(local[1], -half[1], half[1]),
    clamp(local[2], -half[2], half[2]),
  ];
  const inside = Math.abs(local[0]) <= half[0] && Math.abs(local[1]) <= half[1] && Math.abs(local[2]) <= half[2];
  if (inside) {
    const faceDist = [half[0] - Math.abs(local[0]), half[1] - Math.abs(local[1]), half[2] - Math.abs(local[2])];
    const axis = faceDist[0] <= faceDist[1] && faceDist[0] <= faceDist[2] ? 0 : faceDist[1] <= faceDist[2] ? 1 : 2;
    const sign = local[axis] >= 0 ? 1 : -1;
    clamped[axis] = half[axis] * sign;
    const normal: [number, number, number] = [0, 0, 0];
    normal[axis] = sign;
    return { point: [center[0] + clamped[0], center[1] + clamped[1], center[2] + clamped[2]], normal };
  }

  const delta: Vec3 = [local[0] - clamped[0], local[1] - clamped[1], local[2] - clamped[2]];
  const axis = Math.abs(delta[0]) >= Math.abs(delta[1]) && Math.abs(delta[0]) >= Math.abs(delta[2]) ? 0 : Math.abs(delta[1]) >= Math.abs(delta[2]) ? 1 : 2;
  const normal: [number, number, number] = [0, 0, 0];
  normal[axis] = delta[axis] >= 0 ? 1 : -1;
  return { point: [center[0] + clamped[0], center[1] + clamped[1], center[2] + clamped[2]], normal };
}

function closestPointOnCylinder(point: Vec3, radius: number, length: number): { point: Vec3; normal: Vec3 } {
  const [x, y, z] = point;
  const half = length / 2;
  const radial = Math.hypot(x, y);
  const rx = radial <= EPS ? 1 : x / radial;
  const ry = radial <= EPS ? 0 : y / radial;
  const side: Vec3 = [rx * radius, ry * radius, clamp(z, -half, half)];
  const sideD2 = squaredDistance(point, side);

  const capCandidate = (sign: number): [Vec3, number] => {
    const capZ = sign * half;
    const capXY: Vec3 = radial <= radius ? [x, y, capZ] : [rx * radius, ry * radius, capZ];
    return [capXY, squaredDistance(point, capXY)];
  };
  const [top, topD2] = capCandidate(1);
  const [bottom, bottomD2] = capCandidate(-1);
  if (sideD2 <= topD2 && sideD2 <= bottomD2) return { point: side, normal: [rx, ry, 0] };
  if (topD2 <= bottomD2) return { point: top, normal: [0, 0, 1] };
  return { point: bottom, normal: [0, 0, -1] };
}

function minProjectionAlongAxis(part: Statement, byId: ReadonlyMap<string, Statement>, axis: Vec3): number | null {
  const shape = shapeFromPart(part, byId);
  if (!shape) return null;
  const aabb = localAabbFromPart(part, byId);
  if (!aabb) return null;

  if (shape.op === 'sphere') {
    const radius = readNumber(shape.args.radius);
    return radius === undefined ? null : -radius;
  }
  if (shape.op === 'cylinder') {
    const radius = readNumber(shape.args.radius);
    const length = readNumber(shape.args.length);
    if (radius === undefined || length === undefined) return null;
    const radial = Math.hypot(axis[0], axis[1]);
    return -(radius * radial + (length / 2) * Math.abs(axis[2]));
  }

  const half = aabb.halfExtent;
  const center = aabb.center;
  return dot(center, axis) - (half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]));
}

function rotationForSurfaceFrame(frame: SurfaceFrame3, childAxis: string, spin: number): readonly [Vec3, Vec3, Vec3] {
  const localBasis = childLocalBasisForAxis(childAxis);
  const worldBasis = mat3FromColumns(frame.tangentU, frame.tangentV, frame.normal);
  const base = mat3Mul(worldBasis, mat3Transpose(mat3FromColumns(localBasis[0], localBasis[1], localBasis[2])));
  if (Math.abs(spin) <= EPS) return base;
  return mat3Mul(axisAngle(frame.normal, spin), base);
}

function childLocalBasisForAxis(axis: string): readonly [Vec3, Vec3, Vec3] {
  switch (axis.trim().toLowerCase()) {
    case '+z': return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    case '-z': return [[1, 0, 0], [0, -1, 0], [0, 0, -1]];
    case '+x': return [[0, 1, 0], [0, 0, 1], [1, 0, 0]];
    case '-x': return [[0, 1, 0], [0, 0, -1], [-1, 0, 0]];
    case '+y': return [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
    case '-y': return [[0, 0, -1], [1, 0, 0], [0, -1, 0]];
    default: throw new Error(`invalid child_axis "${axis}"`);
  }
}

function axisVector(axis: string): Vec3 {
  switch (axis.trim().toLowerCase()) {
    case '+x': return [1, 0, 0];
    case '-x': return [-1, 0, 0];
    case '+y': return [0, 1, 0];
    case '-y': return [0, -1, 0];
    case '+z':
    case 'z': return [0, 0, 1];
    case '-z': return [0, 0, -1];
    default: throw new Error(`invalid axis "${axis}"`);
  }
}

function buildSurfaceTangents(normal: Vec3, upHint: Vec3): readonly [Vec3, Vec3] {
  const up = normalize(upHint, 'up_hint');
  let projected: Vec3 = [
    up[0] - normal[0] * dot(up, normal),
    up[1] - normal[1] * dot(up, normal),
    up[2] - normal[2] * dot(up, normal),
  ];
  if (norm(projected) <= EPS) {
    const fallback: Vec3 = Math.abs(dot([1, 0, 0], normal)) >= 0.95 ? [0, 1, 0] : [1, 0, 0];
    projected = cross(fallback, normal);
  }
  const tangentU = normalize(projected, 'surface tangent');
  const tangentV = normalize(cross(normal, tangentU), 'surface bitangent');
  return [tangentU, tangentV];
}

function mat3ToRpy(mat: readonly [Vec3, Vec3, Vec3]): Vec3 {
  const pitch = Math.asin(clamp(-mat[2][0], -1, 1));
  const cp = Math.cos(pitch);
  if (Math.abs(cp) > 1e-8) {
    return [Math.atan2(mat[2][1], mat[2][2]), pitch, Math.atan2(mat[1][0], mat[0][0])];
  }
  return [0, pitch, pitch >= 0 ? Math.atan2(-mat[0][1], mat[1][1]) : Math.atan2(mat[0][1], mat[1][1])];
}

function mat3FromColumns(a: Vec3, b: Vec3, c: Vec3): readonly [Vec3, Vec3, Vec3] {
  return [[a[0], b[0], c[0]], [a[1], b[1], c[1]], [a[2], b[2], c[2]]];
}

function mat3Transpose(m: readonly [Vec3, Vec3, Vec3]): readonly [Vec3, Vec3, Vec3] {
  return [[m[0][0], m[1][0], m[2][0]], [m[0][1], m[1][1], m[2][1]], [m[0][2], m[1][2], m[2][2]]];
}

function mat3Mul(a: readonly [Vec3, Vec3, Vec3], b: readonly [Vec3, Vec3, Vec3]): readonly [Vec3, Vec3, Vec3] {
  return [
    [
      a[0][0] * b[0][0] + a[0][1] * b[1][0] + a[0][2] * b[2][0],
      a[0][0] * b[0][1] + a[0][1] * b[1][1] + a[0][2] * b[2][1],
      a[0][0] * b[0][2] + a[0][1] * b[1][2] + a[0][2] * b[2][2],
    ],
    [
      a[1][0] * b[0][0] + a[1][1] * b[1][0] + a[1][2] * b[2][0],
      a[1][0] * b[0][1] + a[1][1] * b[1][1] + a[1][2] * b[2][1],
      a[1][0] * b[0][2] + a[1][1] * b[1][2] + a[1][2] * b[2][2],
    ],
    [
      a[2][0] * b[0][0] + a[2][1] * b[1][0] + a[2][2] * b[2][0],
      a[2][0] * b[0][1] + a[2][1] * b[1][1] + a[2][2] * b[2][1],
      a[2][0] * b[0][2] + a[2][1] * b[1][2] + a[2][2] * b[2][2],
    ],
  ];
}

function axisAngle(axisRaw: Vec3, angle: number): readonly [Vec3, Vec3, Vec3] {
  const axis = normalize(axisRaw, 'axis');
  const [x, y, z] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;
  return [
    [t * x * x + c, t * x * y - s * z, t * x * z + s * y],
    [t * x * y + s * z, t * y * y + c, t * y * z - s * x],
    [t * x * z - s * y, t * y * z + s * x, t * z * z + c],
  ];
}

function readNumber(a: Arg | undefined): number | undefined {
  return a?.kind === 'number' ? a.value : undefined;
}

function readNumList(a: Arg | undefined, n: number): number[] | undefined {
  if (!a || a.kind !== 'list' || a.items.length !== n) return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(v: Vec3): number {
  return Math.sqrt(dot(v, v));
}

function normalize(v: Vec3, name: string): Vec3 {
  const n = norm(v);
  if (n <= EPS) throw new Error(`${name} must be non-zero`);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function squaredDistance(a: Vec3, b: Vec3): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
