import { BakerError } from './errors.js';
import type { MeshGeometry } from './types.js';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

export interface SplineOptions {
  readonly spline?: string;
  readonly samplesPerSegment?: number;
  readonly closed?: boolean;
  readonly alpha?: number;
}

export interface SweepOptions extends SplineOptions {
  readonly upHint?: Vec3;
  readonly cap?: boolean;
}

const EPS = 1e-9;

export function samplePath(points: readonly Vec3[], opts: SplineOptions = {}): Vec3[] {
  const spline = (opts.spline ?? 'polyline').toLowerCase();
  const closed = Boolean(opts.closed);
  const samples = clampInt(opts.samplesPerSegment ?? 12, 1, 128);
  const path = removeShortSegments(points, closed);
  if (path.length < 2) throw new BakerError('path must contain at least two distinct points');

  if (spline === 'polyline' || samples <= 1) return path;
  if (spline === 'catmull_rom' || spline === 'catmull-rom' || spline === 'catmullrom') {
    return sampleCatmullRom(path, samples, closed, opts.alpha ?? 0.5);
  }
  if (spline === 'bezier') return sampleBezierChain(path, samples, closed);
  throw new BakerError('spline must be one of: polyline, catmull_rom, bezier');
}

export function tubeMeshFromPath(
  points: readonly Vec3[],
  radius: number,
  radialSegments: number,
  opts: SweepOptions = {},
): MeshGeometry {
  if (radius <= 0) throw new BakerError('pipe: radius must be positive');
  const segments = clampInt(radialSegments, 3, 256);
  const profile: Vec2[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    profile.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return sweepProfileMesh(points, profile, opts);
}

export function sweepProfileMesh(
  points: readonly Vec3[],
  profile: readonly Vec2[],
  opts: SweepOptions = {},
): MeshGeometry {
  if (profile.length < 3) throw new BakerError('sweep: profile must contain at least 3 points');
  const path = samplePath(points, opts);
  const closedPath = Boolean(opts.closed);
  const cap = opts.cap ?? !closedPath;
  const upHint = normalize(opts.upHint ?? [0, 0, 1]);
  const frames = makePathFrames(path, upHint, closedPath);
  const vertices: Vec3[] = [];
  const ringSize = profile.length;

  for (let i = 0; i < path.length; i++) {
    const frame = frames[i];
    for (const [px, py] of profile) {
      vertices.push(add(path[i], add(scale(frame.xAxis, px), scale(frame.yAxis, py))));
    }
  }

  const faces: Array<readonly [number, number, number]> = [];
  const ringCount = path.length;
  const pathSpan = closedPath ? ringCount : ringCount - 1;
  for (let i = 0; i < pathSpan; i++) {
    const ni = (i + 1) % ringCount;
    const segmentCenter = scale(add(path[i], path[ni]), 0.5);
    for (let j = 0; j < ringSize; j++) {
      const nj = (j + 1) % ringSize;
      const a = i * ringSize + j;
      const b = ni * ringSize + j;
      const c = ni * ringSize + nj;
      const d = i * ringSize + nj;
      pushOutwardFace(vertices, faces, [a, b, c], sub(faceCenter(vertices, [a, b, c]), segmentCenter));
      pushOutwardFace(vertices, faces, [a, c, d], sub(faceCenter(vertices, [a, c, d]), segmentCenter));
    }
  }

  if (cap && !closedPath) {
    addCap(vertices, faces, 0, ringSize, sub(path[0], path[1]));
    addCap(vertices, faces, (ringCount - 1) * ringSize, ringSize, sub(path[ringCount - 1], path[ringCount - 2]));
  }

  return { kind: 'mesh_geometry', vertices, faces };
}

export function sectionLoftMesh(
  sections: readonly (readonly Vec3[])[],
  opts: { readonly cap?: boolean; readonly closed?: boolean } = {},
): MeshGeometry {
  if (sections.length < 2) throw new BakerError('section_loft: sections must contain at least two sections');
  const ringSize = sections[0].length;
  if (ringSize < 3) throw new BakerError('section_loft: each section must contain at least 3 points');
  for (const section of sections) {
    if (section.length !== ringSize) throw new BakerError('section_loft: all sections must have the same point count');
  }

  const vertices: Vec3[] = sections.flatMap(section => section.map(p => [p[0], p[1], p[2]] as Vec3));
  const sectionCenters = sections.map(section => average(section));
  const faces: Array<readonly [number, number, number]> = [];
  const closed = Boolean(opts.closed);
  const span = closed ? sections.length : sections.length - 1;
  for (let i = 0; i < span; i++) {
    const ni = (i + 1) % sections.length;
    const segmentCenter = scale(add(sectionCenters[i], sectionCenters[ni]), 0.5);
    for (let j = 0; j < ringSize; j++) {
      const nj = (j + 1) % ringSize;
      const a = i * ringSize + j;
      const b = ni * ringSize + j;
      const c = ni * ringSize + nj;
      const d = i * ringSize + nj;
      pushOutwardFace(vertices, faces, [a, b, c], sub(faceCenter(vertices, [a, b, c]), segmentCenter));
      pushOutwardFace(vertices, faces, [a, c, d], sub(faceCenter(vertices, [a, c, d]), segmentCenter));
    }
  }

  if ((opts.cap ?? true) && !closed) {
    addCap(vertices, faces, 0, ringSize, sub(sectionCenters[0], sectionCenters[1]));
    addCap(vertices, faces, (sections.length - 1) * ringSize, ringSize, sub(sectionCenters[sections.length - 1], sectionCenters[sections.length - 2]));
  }
  return { kind: 'mesh_geometry', vertices, faces };
}

export function isMeshGeometry(value: unknown): value is MeshGeometry {
  return (value as MeshGeometry | undefined)?.kind === 'mesh_geometry';
}

export function translateMesh(mesh: MeshGeometry, offset: Vec3): MeshGeometry {
  return mapMesh(mesh, p => add(p, offset));
}

export function scaleMesh(mesh: MeshGeometry, factor: number, center: Vec3): MeshGeometry {
  return mapMesh(mesh, p => add(center, scale(sub(p, center), factor)));
}

export function rotateMesh(mesh: MeshGeometry, angleDeg: number, origin: Vec3, axis: Vec3): MeshGeometry {
  const len = norm(axis);
  if (len <= EPS) throw new BakerError('rotate: axis must be non-zero');
  const u = scale(axis, 1 / len);
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return mapMesh(mesh, (p) => {
    const v = sub(p, origin);
    const dot = dot3(u, v);
    const crossUv = cross(u, v);
    return add(origin, add(add(scale(v, c), scale(crossUv, s)), scale(u, dot * (1 - c))));
  });
}

export function mirrorMesh(mesh: MeshGeometry, plane: string, origin: Vec3): MeshGeometry {
  const upper = plane.toUpperCase();
  const mirrored = mapMesh(mesh, (p) => {
    if (upper === 'XY') return [p[0], p[1], origin[2] * 2 - p[2]];
    if (upper === 'YZ') return [origin[0] * 2 - p[0], p[1], p[2]];
    if (upper === 'XZ') return [p[0], origin[1] * 2 - p[1], p[2]];
    throw new BakerError('mirror: plane must be XY/YZ/XZ');
  });
  return { ...mirrored, faces: mirrored.faces.map(([a, b, c]) => [a, c, b] as const) };
}

export function combineMeshes(meshes: readonly MeshGeometry[]): MeshGeometry {
  const vertices: Vec3[] = [];
  const faces: Array<readonly [number, number, number]> = [];
  for (const mesh of meshes) {
    const base = vertices.length;
    vertices.push(...mesh.vertices.map(p => [p[0], p[1], p[2]] as Vec3));
    faces.push(...mesh.faces.map(([a, b, c]) => [a + base, b + base, c + base] as const));
  }
  return { kind: 'mesh_geometry', vertices, faces };
}

function mapMesh(mesh: MeshGeometry, fn: (point: Vec3) => Vec3): MeshGeometry {
  return {
    kind: 'mesh_geometry',
    vertices: mesh.vertices.map(p => fn([p[0], p[1], p[2]])),
    faces: mesh.faces,
  };
}

function sampleBezierChain(points: readonly Vec3[], samples: number, closed: boolean): Vec3[] {
  if ((points.length - 1) % 3 !== 0) {
    throw new BakerError('bezier spline requires 3n+1 points');
  }
  const out: Vec3[] = [];
  for (let i = 0; i < points.length - 1; i += 3) {
    for (let s = 0; s < samples; s++) {
      if (i > 0 && s === 0) continue;
      out.push(cubicBezier(points[i], points[i + 1], points[i + 2], points[i + 3], s / samples));
    }
  }
  out.push(points[points.length - 1]);
  return removeShortSegments(out, closed);
}

function sampleCatmullRom(points: readonly Vec3[], samples: number, closed: boolean, alpha: number): Vec3[] {
  const pts = closed
    ? [points[points.length - 1], ...points, points[0], points[1]]
    : [points[0], ...points, points[points.length - 1]];
  const out: Vec3[] = [];
  for (let i = 0; i < pts.length - 3; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const p2 = pts[i + 2];
    const p3 = pts[i + 3];
    for (let s = 0; s < samples; s++) {
      if (i > 0 && s === 0) continue;
      out.push(catmullRomPoint(p0, p1, p2, p3, s / samples, alpha));
    }
  }
  if (!closed) out.push(points[points.length - 1]);
  return removeShortSegments(out, closed);
}

function catmullRomPoint(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number, alpha: number): Vec3 {
  const t0 = 0;
  const t1 = tj(t0, p0, p1, alpha);
  const t2 = tj(t1, p1, p2, alpha);
  const t3 = tj(t2, p2, p3, alpha);
  const tt = t1 + (t2 - t1) * t;
  // Open-curve boundary padding duplicates the first/last control point (p0===p1 or
  // p2===p3), which pins t1-t0 (or t3-t2) at exactly EPS for the *whole* segment. Letting
  // safeRatio zero out both weights there would pull a1/a3 toward the world origin instead
  // of the coincident point, producing a spurious loop right at the path's ends. Resolve to
  // the coincident point directly instead.
  const a1 = t1 - t0 <= EPS ? p1 : lerpPoint(p0, p1, safeRatio(t1 - tt, t1 - t0), safeRatio(tt - t0, t1 - t0));
  const a2 = lerpPoint(p1, p2, safeRatio(t2 - tt, t2 - t1), safeRatio(tt - t1, t2 - t1));
  const a3 = t3 - t2 <= EPS ? p2 : lerpPoint(p2, p3, safeRatio(t3 - tt, t3 - t2), safeRatio(tt - t2, t3 - t2));
  const b1 = lerpPoint(a1, a2, safeRatio(t2 - tt, t2 - t0), safeRatio(tt - t0, t2 - t0));
  const b2 = lerpPoint(a2, a3, safeRatio(t3 - tt, t3 - t1), safeRatio(tt - t1, t3 - t1));
  return lerpPoint(b1, b2, safeRatio(t2 - tt, t2 - t1), safeRatio(tt - t1, t2 - t1));
}

function tj(ti: number, pi: Vec3, pj: Vec3, alpha: number): number {
  return ti + Math.max(Math.pow(norm(sub(pj, pi)), alpha), EPS);
}

function safeRatio(num: number, den: number): number {
  return Math.abs(den) <= EPS ? 0 : num / den;
}

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return [
    u ** 3 * p0[0] + 3 * u ** 2 * t * p1[0] + 3 * u * t ** 2 * p2[0] + t ** 3 * p3[0],
    u ** 3 * p0[1] + 3 * u ** 2 * t * p1[1] + 3 * u * t ** 2 * p2[1] + t ** 3 * p3[1],
    u ** 3 * p0[2] + 3 * u ** 2 * t * p1[2] + 3 * u * t ** 2 * p2[2] + t ** 3 * p3[2],
  ];
}

function makePathFrames(path: readonly Vec3[], upHint: Vec3, closed: boolean): Array<{ xAxis: Vec3; yAxis: Vec3 }> {
  const frames: Array<{ xAxis: Vec3; yAxis: Vec3 }> = [];
  let prevX: Vec3 | null = null;
  for (let i = 0; i < path.length; i++) {
    const prev = i === 0 ? (closed ? path[path.length - 1] : path[i]) : path[i - 1];
    const next = i === path.length - 1 ? (closed ? path[0] : path[i]) : path[i + 1];
    const tangent = normalize(sub(next, prev));
    let xAxis = normalize(cross(upHint, tangent));
    if (norm(xAxis) <= EPS) xAxis = normalize(cross(pickFallbackUp(tangent), tangent));
    let yAxis = normalize(cross(tangent, xAxis));
    if (prevX && dot3(xAxis, prevX) < 0) {
      xAxis = scale(xAxis, -1);
      yAxis = scale(yAxis, -1);
    }
    frames.push({ xAxis, yAxis });
    prevX = xAxis;
  }
  return frames;
}

function addCap(
  vertices: Vec3[],
  faces: Array<readonly [number, number, number]>,
  start: number,
  ringSize: number,
  outwardRef: Vec3,
): void {
  const center = average(vertices.slice(start, start + ringSize));
  const centerIndex = vertices.length;
  vertices.push(center);
  for (let j = 0; j < ringSize; j++) {
    const nj = (j + 1) % ringSize;
    pushOutwardFace(vertices, faces, [centerIndex, start + j, start + nj], outwardRef);
  }
}

function pushOutwardFace(
  vertices: readonly Vec3[],
  faces: Array<readonly [number, number, number]>,
  face: readonly [number, number, number],
  outwardRef: Vec3,
): void {
  const normal = faceNormal(vertices, face);
  faces.push(dot3(normal, outwardRef) < 0 ? [face[0], face[2], face[1]] : face);
}

function faceNormal(vertices: readonly Vec3[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return cross(sub(b, a), sub(c, a));
}

function faceCenter(vertices: readonly Vec3[], face: readonly [number, number, number]): Vec3 {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return scale(add(add(a, b), c), 1 / 3);
}

function removeShortSegments(points: readonly Vec3[], closed: boolean): Vec3[] {
  const out: Vec3[] = [];
  for (const p of points) {
    const v: Vec3 = [p[0], p[1], p[2]];
    if (out.length === 0 || norm(sub(v, out[out.length - 1])) > EPS) out.push(v);
  }
  if (!closed && out.length >= 2 && norm(sub(out[0], out[out.length - 1])) <= EPS) out.pop();
  return out;
}

function pickFallbackUp(tangent: Vec3): Vec3 {
  return Math.abs(tangent[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
}

function clampInt(value: number, min: number, max: number): number {
  const n = Math.round(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function lerpPoint(a: Vec3, b: Vec3, wa: number, wb: number): Vec3 {
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

function average(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return scale(sum, 1 / points.length);
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n <= EPS ? [0, 0, 0] : scale(a, 1 / n);
}
