/**
 * Analytic surface placement helpers.
 *
 * For analytic parent shapes (box / cylinder / sphere / cone / capsule / torus
 * / dome) this queries the actual local surface and normal. Complex shapes fall
 * back to their derived AABB so placement remains usable without forcing a mesh
 * bake in the battery layer.
 */

import type { Arg, Statement } from './types.js';
import { localAabbFromPart, visualAabbFromPart, type LocalAABB } from './aabb.js';

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

  const aabb = visualAabbFromPart(part, byId);
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
  const origin = readVec3(part.args.origin) ?? [0, 0, 0];
  const rpy = readVec3(part.args.rpy) ?? [0, 0, 0];
  const localQuery = inverseTransformByOriginRpy(query, origin, rpy);

  switch (shape.op) {
    case 'sphere': {
      const radius = readNumber(shape.args.radius);
      if (radius === undefined || radius <= 0) break;
      const normal = normalize(localQuery, 'sphere query direction');
      return transformHit({
        point: [normal[0] * radius, normal[1] * radius, normal[2] * radius],
        normal,
        source: 'analytic',
      }, origin, rpy);
    }
    case 'box': {
      const size = readNumList(shape.args.size, 3);
      if (!size) break;
      const hit = closestPointOnBox(localQuery, [0, 0, 0], [size[0] / 2, size[1] / 2, size[2] / 2]);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
    }
    case 'cylinder': {
      const radius = readNumber(shape.args.radius);
      const length = readNumber(shape.args.length);
      if (radius === undefined || length === undefined || radius <= 0 || length <= 0) break;
      const hit = closestPointOnCylinder(localQuery, radius, length);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
    }
    case 'cone': {
      const radius = readNumber(shape.args.radius);
      const height = readNumber(shape.args.height);
      if (radius === undefined || height === undefined || radius <= 0 || height <= 0) break;
      const hit = closestPointOnCone(localQuery, radius, height);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
    }
    case 'capsule': {
      const radius = readNumber(shape.args.radius);
      const length = readNumber(shape.args.length);
      if (radius === undefined || length === undefined || radius <= 0 || length < 2 * radius) break;
      const hit = closestPointOnCapsule(localQuery, radius, length);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
    }
    case 'torus': {
      const majorRadius = readNumber(shape.args.major_radius);
      const minorRadius = readNumber(shape.args.minor_radius);
      if (majorRadius === undefined || minorRadius === undefined || majorRadius <= 0 || minorRadius <= 0 || minorRadius >= majorRadius) break;
      const hit = closestPointOnTorus(localQuery, majorRadius, minorRadius);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
    }
    case 'dome': {
      const radius = readNumber(shape.args.radius);
      const height = readNumber(shape.args.height);
      if (radius === undefined || height === undefined || radius <= 0 || height <= 0 || height > radius) break;
      const hit = closestPointOnDome(localQuery, radius, height);
      return transformHit({ ...hit, source: 'analytic' }, origin, rpy);
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

function closestPointOnCone(point: Vec3, radius: number, height: number): { point: Vec3; normal: Vec3 } {
  const [x, y, z] = point;
  const half = height / 2;
  const radial = Math.hypot(x, y);
  const rx = radial <= EPS ? 1 : x / radial;
  const ry = radial <= EPS ? 0 : y / radial;
  const t = clamp((half - z) / height, 0, 1);
  const sideR = radius * t;
  const side: Vec3 = [rx * sideR, ry * sideR, z];
  const sideNormal = normalize([rx * height, ry * height, radius], 'cone side normal');
  const sideD2 = squaredDistance(point, side);
  const baseXY: Vec3 = radial <= radius ? [x, y, -half] : [rx * radius, ry * radius, -half];
  const baseD2 = squaredDistance(point, baseXY);
  const tip: Vec3 = [0, 0, half];
  const tipD2 = squaredDistance(point, tip);
  if (baseD2 <= sideD2 && baseD2 <= tipD2) return { point: baseXY, normal: [0, 0, -1] };
  if (tipD2 <= sideD2) return { point: tip, normal: [0, 0, 1] };
  return { point: side, normal: sideNormal };
}

function closestPointOnCapsule(point: Vec3, radius: number, length: number): { point: Vec3; normal: Vec3 } {
  const bodyLength = Math.max(0, length - 2 * radius);
  const zCenter = clamp(point[2], -bodyLength / 2, bodyLength / 2);
  const center: Vec3 = [0, 0, zCenter];
  const delta: Vec3 = [point[0], point[1], point[2] - zCenter];
  const normal = normalize(delta, 'capsule query direction');
  return {
    point: [center[0] + normal[0] * radius, center[1] + normal[1] * radius, center[2] + normal[2] * radius],
    normal,
  };
}

function closestPointOnTorus(point: Vec3, majorRadius: number, minorRadius: number): { point: Vec3; normal: Vec3 } {
  const radial = Math.hypot(point[0], point[1]);
  const rx = radial <= EPS ? 1 : point[0] / radial;
  const ry = radial <= EPS ? 0 : point[1] / radial;
  const tubeCenter: Vec3 = [rx * majorRadius, ry * majorRadius, 0];
  const delta: Vec3 = [point[0] - tubeCenter[0], point[1] - tubeCenter[1], point[2]];
  const normal = normalize(delta, 'torus query direction');
  return {
    point: [
      tubeCenter[0] + normal[0] * minorRadius,
      tubeCenter[1] + normal[1] * minorRadius,
      normal[2] * minorRadius,
    ],
    normal,
  };
}

function closestPointOnDome(point: Vec3, radius: number, height: number): { point: Vec3; normal: Vec3 } {
  const sphereCenterZ = height / 2 - radius;
  const zBase = -height / 2;
  const zTop = height / 2;
  const sphereDelta: Vec3 = [point[0], point[1], point[2] - sphereCenterZ];
  const sphereNormal = normalize(sphereDelta, 'dome query direction');
  const spherePoint: Vec3 = [
    sphereNormal[0] * radius,
    sphereNormal[1] * radius,
    sphereCenterZ + sphereNormal[2] * radius,
  ];
  if (spherePoint[2] >= zBase - EPS && spherePoint[2] <= zTop + EPS) {
    return { point: spherePoint, normal: sphereNormal };
  }
  const baseR = Math.sqrt(Math.max(0, radius * radius - (zBase - sphereCenterZ) ** 2));
  const radial = Math.hypot(point[0], point[1]);
  const rx = radial <= EPS ? 1 : point[0] / radial;
  const ry = radial <= EPS ? 0 : point[1] / radial;
  const basePoint: Vec3 = radial <= baseR ? [point[0], point[1], zBase] : [rx * baseR, ry * baseR, zBase];
  return { point: basePoint, normal: [0, 0, -1] };
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
  if (shape.op === 'capsule') {
    const radius = readNumber(shape.args.radius);
    const length = readNumber(shape.args.length);
    if (radius === undefined || length === undefined) return null;
    return -(Math.max(0, length - 2 * radius) / 2 * Math.abs(axis[2]) + radius);
  }
  if (shape.op === 'cone') {
    const radius = readNumber(shape.args.radius);
    const height = readNumber(shape.args.height);
    if (radius === undefined || height === undefined) return null;
    const radial = Math.hypot(axis[0], axis[1]);
    return Math.min(-(height / 2) * axis[2] - radius * radial, (height / 2) * axis[2]);
  }
  if (shape.op === 'torus') {
    const majorRadius = readNumber(shape.args.major_radius);
    const minorRadius = readNumber(shape.args.minor_radius);
    if (majorRadius === undefined || minorRadius === undefined) return null;
    const radial = Math.hypot(axis[0], axis[1]);
    return -(majorRadius * radial + minorRadius);
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

function transformHit(
  hit: { point: Vec3; normal: Vec3; source: 'analytic' | 'aabb' },
  origin: Vec3,
  rpy: Vec3,
): { point: Vec3; normal: Vec3; source: 'analytic' | 'aabb' } {
  return {
    point: transformByOriginRpy(hit.point, origin, rpy),
    normal: normalize(transformDirectionByRpy(hit.normal, rpy), 'surface normal'),
    source: hit.source,
  };
}

function inverseTransformByOriginRpy(point: Vec3, origin: Vec3, rpy: Vec3): Vec3 {
  const rotT = mat3Transpose(rpyMatrix(rpy));
  return mat3Vec(rotT, [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]]);
}

function transformByOriginRpy(point: Vec3, origin: Vec3, rpy: Vec3): Vec3 {
  const rotated = transformDirectionByRpy(point, rpy);
  return [origin[0] + rotated[0], origin[1] + rotated[1], origin[2] + rotated[2]];
}

function transformDirectionByRpy(vec: Vec3, rpy: Vec3): Vec3 {
  return mat3Vec(rpyMatrix(rpy), vec);
}

function rpyMatrix(rpy: Vec3): readonly [Vec3, Vec3, Vec3] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r); const sr = Math.sin(r);
  const cp = Math.cos(p); const sp = Math.sin(p);
  const cy = Math.cos(y); const sy = Math.sin(y);
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

function mat3Vec(m: readonly [Vec3, Vec3, Vec3], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

function readVec3(a: Arg | undefined): Vec3 | undefined {
  const list = readNumList(a, 3);
  return list ? [list[0], list[1], list[2]] : undefined;
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
