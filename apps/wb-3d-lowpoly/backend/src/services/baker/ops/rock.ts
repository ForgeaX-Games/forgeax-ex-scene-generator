/**
 * rock / boulder —— 不规则石头 primitive：icosphere 细分 + 基于 seed 的确定性顶点位移。
 *
 * 与 pipe/sweep/section_loft 一样直接产出三角网格（`MeshGeometry`），不走 OCCT 布尔管线——
 * 这类形状本来就"形态即最终形态"，不需要参与 union/difference/intersection。
 *
 * 算法：
 *   1. 标准正二十面体（12 顶点/20 面）作为 detail=0 的基础网格，按 detail 做中点细分
 *      （每次细分：每条边取中点、投影回单位球，1 个三角面拆成 4 个），detail∈{0,1,2}。
 *   2. 对细分后单位球每个顶点 v（本身就是该点的法线/径向方向），用一个基于顶点坐标+seed
 *      的确定性哈希（正弦哈希，取小数部分）算出 noise∈[-1,1]，径向位移
 *      = radius * irregularity * noise，即 bumpedRadius = radius * (1 + irregularity*noise)。
 *      同参数（含 seed）重复调用永远得到同一个形状——满足 DSL 复算/缓存的确定性要求。
 *   3. 按 stretch=[sx,sy,sz] 对 (x,y,z) 分量各自非等比缩放，做出椭圆/长条状石头。
 */
import type { MeshGeometry } from '../types.js';
import { BakerError } from '../errors.js';
import type { Arg } from '../shared-types.js';
import { requireNumber, optionalNumber, readNumList } from '../arg_readers.js';

type Vec3 = readonly [number, number, number];

export function rock(_ctx: unknown, args: Record<string, Arg>): MeshGeometry {
  const radius = requireNumber(args, 'radius', 'rock');
  if (radius <= 0) throw new BakerError('rock: radius must be positive');

  const irregularity = optionalNumber(args, 'irregularity', 0.35);
  if (!(irregularity >= 0 && irregularity <= 1)) {
    throw new BakerError('rock: irregularity must be within [0, 1]');
  }

  const seed = optionalNumber(args, 'seed', 0);
  if (!Number.isFinite(seed)) throw new BakerError('rock: seed must be a finite number');

  const detailRaw = optionalNumber(args, 'detail', 1);
  const detail = Math.round(detailRaw);
  if (detail < 0 || detail > 2) throw new BakerError('rock: detail must be an integer in [0, 2]');

  const stretch = readNumList(args.stretch, 3) ?? [1, 1, 1];
  if (stretch.some((s) => !(s > 0))) throw new BakerError('rock: stretch components must be positive');

  return buildRockMesh(radius, irregularity, seed, detail, [stretch[0], stretch[1], stretch[2]]);
}

/** `boulder` 是 `rock` 的同义 op；实现完全一致。 */
export const boulder = rock;

export function buildRockMesh(
  radius: number,
  irregularity: number,
  seed: number,
  detail: number,
  stretch: Vec3,
): MeshGeometry {
  const { vertices: unitVertices, faces } = buildIcosphere(detail);

  const vertices: Vec3[] = unitVertices.map((v) => {
    const noise = hashNoise(v, seed); // in [-1, 1]
    const bumpedRadius = radius * (1 + irregularity * noise);
    return [
      v[0] * bumpedRadius * stretch[0],
      v[1] * bumpedRadius * stretch[1],
      v[2] * bumpedRadius * stretch[2],
    ];
  });

  return { kind: 'mesh_geometry', vertices, faces };
}

// ── Icosphere construction ──────────────────────────────────────────────

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function buildIcosphere(detail: number): { vertices: Vec3[]; faces: Array<readonly [number, number, number]> } {
  let { vertices, faces } = baseIcosahedron();
  for (let i = 0; i < detail; i++) {
    ({ vertices, faces } = subdivide(vertices, faces));
  }
  return { vertices, faces };
}

function baseIcosahedron(): { vertices: Vec3[]; faces: Array<readonly [number, number, number]> } {
  const t = GOLDEN_RATIO;
  const raw: Vec3[] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const vertices = raw.map(normalize);
  const faces: Array<[number, number, number]> = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  // 保证每个面绕向朝外（正二十面体标准坐标本就朝外，这里以质心方向复核一遍，
  // 避免手抄坐标/面表出现符号笔误导致法线朝内）。
  return { vertices, faces: faces.map((f) => ensureOutward(vertices, f)) };
}

function subdivide(
  vertices: readonly Vec3[],
  faces: readonly (readonly [number, number, number])[],
): { vertices: Vec3[]; faces: Array<readonly [number, number, number]> } {
  const nextVertices = vertices.slice();
  const midpointCache = new Map<string, number>();

  const midpoint = (i: number, j: number): number => {
    const key = i < j ? `${i}_${j}` : `${j}_${i}`;
    const cached = midpointCache.get(key);
    if (cached !== undefined) return cached;
    const a = nextVertices[i];
    const b = nextVertices[j];
    const mid = normalize([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
    const idx = nextVertices.length;
    nextVertices.push(mid);
    midpointCache.set(key, idx);
    return idx;
  };

  const nextFaces: Array<readonly [number, number, number]> = [];
  for (const [a, b, c] of faces) {
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    nextFaces.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
  }
  return { vertices: nextVertices, faces: nextFaces };
}

function ensureOutward(vertices: readonly Vec3[], face: readonly [number, number, number]): [number, number, number] {
  const [a, b, c] = face;
  const centroid = average([vertices[a], vertices[b], vertices[c]]);
  const normal = cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a]));
  return dot(normal, centroid) < 0 ? [a, c, b] : [a, b, c];
}

// ── 确定性哈希噪声（正弦哈希，取小数部分；零外部依赖） ───────────────────────

function hashNoise(v: Vec3, seed: number): number {
  const s = Math.sin(v[0] * 12.9898 + v[1] * 78.233 + v[2] * 37.719 + seed * 94.673) * 43758.5453;
  const frac = s - Math.floor(s); // ∈ [0, 1)
  return frac * 2 - 1; // ∈ [-1, 1)
}

// ── vec3 helpers ─────────────────────────────────────────────────────────

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len <= 1e-12) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function average(points: readonly Vec3[]): Vec3 {
  const sum = points.reduce<[number, number, number]>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
}
