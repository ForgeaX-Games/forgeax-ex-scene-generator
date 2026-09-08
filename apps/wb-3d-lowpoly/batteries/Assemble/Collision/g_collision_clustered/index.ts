/**
 * g_collision_clustered —— autocollide_part(mode="clustered")。
 *
 * 算法：沿 part.shape 引用链做"自然簇拆分"——把组合形状（union / array_linear /
 * array_radial）拆开成多个独立的 AABB，每簇 emit 一条 box collision。
 *
 * 拆分规则：
 *   - union(a, b)        → 簇 = clusters(a) ⊕ clusters(b)
 *   - array_linear       → 把单个 base AABB 沿 step 复制 count 份，每份一簇
 *   - array_radial       → 每份是 base AABB 绕 axis 旋转 i*angle/total
 *   - difference(base,_) → 簇 = clusters(base)（差集不会扩大轮廓，只用 base）
 *   - intersection(a,b)  → 簇 = clusters(a) 与 clusters(b) 的两两 AABB 交集
 *   - translate / rotate / scale / mirror → 对每个 sub 簇做几何变换
 *   - 其它（叶子 / 解析不出簇）→ 单簇 = 该 shape 的整体 AABB
 *
 * 还有"AABB-touch 邻接合并"那一步，用来把"无意拆出来的细碎簇"重新粘起来。
 * 这里用 cluster_tol（默认 0.005m）做邻接合并。
 *
 * 安全阈值 max_clusters：array_radial(count=128) 真按 128 个簇展开会让 URDF 巨大且
 * 仿真器 broadphase 也吃不消，超出则退化为单 box。
 */

import {
  emit,
  freshId,
  geometryFromStatements,
  isGeometry,
  isValidId,
  localAabbFromShape,
  localAabbFromShapeInGeometry,
  makeGeometry,
  numList,
  ref,
  str,
  type Arg,
  type Geometry,
  type LocalAABB,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

type Vec3 = [number, number, number];

/** 簇间合并容差（米） */
const CLUSTER_MERGE_TOL = 0.005;

export function gCollisionClustered(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = isGeometry(input.geometry) ? (input.geometry as Geometry) : makeGeometry();

  const partId = String(input.part_id ?? '').trim();
  if (!partId) return empty(incoming, 'part_id is required');

  const byId = new Map<string, Statement>();
  for (const s of incoming.statements) byId.set(s.id, s);

  const part = byId.get(partId);
  if (!part) return empty(incoming, `part_id "${partId}" not in geometry`);
  if (part.op !== 'part') {
    return empty(incoming, `id "${partId}" is op "${part.op}", expected "part"`);
  }

  const shapeRef = part.args.shape;
  if (!shapeRef || shapeRef.kind !== 'ref') {
    return empty(incoming, `part "${partId}" missing shape ref`);
  }
  const shape = byId.get(shapeRef.name);
  if (!shape) {
    return empty(incoming, `shape "${shapeRef.name}" not in geometry`);
  }

  const padding = readNonNeg(input.padding, 0);
  const minSize = readNonNeg(input.min_size, 1e-4);
  const maxClusters = Math.max(1, Math.floor(readNonNeg(input.max_clusters, 32)));
  const replace = input.replace === true || input.replace === 'true';

  // 1) 拆簇（递归）
  let clusters = clusterShape(shape, byId, new Set());

  // 2) 合并相邻簇（cluster_tol 行为；幂等收敛）
  clusters = mergeTouchingClusters(clusters, CLUSTER_MERGE_TOL);

  // 3) 上限 / 退化
  let fallback = false;
  if (clusters.length === 0) {
    // 解析失败：退化为整体 AABB
    const whole = localAabbFromShapeInGeometry(shape, byId) ?? localAabbFromShape(shape);
    if (!whole) {
      return empty(incoming, `cannot derive AABB from shape "${shape.id}" (op="${shape.op}")`);
    }
    clusters = [whole];
    fallback = true;
  } else if (clusters.length > maxClusters) {
    const merged = unionAll(clusters);
    clusters = [merged];
    fallback = true;
  } else if (clusters.length === 1) {
    fallback = true;
  }

  // 4) replace 时先清掉同 link 旧的 collision
  let baseGeom: Geometry = replace ? removeCollisionsFor(incoming, partId) : incoming;

  // 5) emit
  let count = 0;
  for (const aabb of clusters) {
    const sx = Math.max(minSize, aabb.halfExtent[0] * 2 + 2 * padding);
    const sy = Math.max(minSize, aabb.halfExtent[1] * 2 + 2 * padding);
    const sz = Math.max(minSize, aabb.halfExtent[2] * 2 + 2 * padding);
    const cx = aabb.center[0];
    const cy = aabb.center[1];
    const cz = aabb.center[2];

    const id = freshId(baseGeom, 'col');
    if (!isValidId(id)) continue;

    const args: Record<string, Arg> = {
      link: ref(partId),
      box: numList([sx, sy, sz]),
    };
    if (cx !== 0 || cy !== 0 || cz !== 0) args.origin = numList([cx, cy, cz]);
    args.name = str(`${partId}_cluster_${count + 1}`);

    baseGeom = emit(baseGeom, id, 'collision', args);
    count++;
  }

  return {
    geometry: baseGeom,
    cluster_count: count,
    fallback_used: fallback,
  };
}

// ════════════════════════════════════════════════════════════════════
// 簇拆分递归
// ════════════════════════════════════════════════════════════════════

function clusterShape(
  shape: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): LocalAABB[] {
  if (visiting.has(shape.id)) return [];
  visiting.add(shape.id);
  try {
    switch (shape.op) {
      case 'union': {
        const a = clusterRef(shape.args.a, byId, visiting);
        const b = clusterRef(shape.args.b, byId, visiting);
        return [...a, ...b];
      }
      case 'difference': {
        // base - tool：tool 不会让外轮廓变大，只用 base 的簇
        return clusterRef(shape.args.base, byId, visiting);
      }
      case 'intersection': {
        const a = clusterRef(shape.args.a, byId, visiting);
        const b = clusterRef(shape.args.b, byId, visiting);
        // 取两两簇的 AABB 交集，过滤空盒
        const out: LocalAABB[] = [];
        for (const ca of a) {
          for (const cb of b) {
            const inter = intersectAabb(ca, cb);
            if (inter) out.push(inter);
          }
        }
        return out;
      }
      case 'array_linear': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const count = readCount(shape.args.count);
        const step = readVec3(shape.args.step);
        if (!step || count === null || base.length === 0) return base;
        const out: LocalAABB[] = [];
        for (let i = 0; i < count; i++) {
          const offset: Vec3 = [step[0] * i, step[1] * i, step[2] * i];
          for (const c of base) out.push(translateAabb(c, offset));
        }
        return out;
      }
      case 'array_radial': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const count = readCount(shape.args.count);
        const total = readNumber(shape.args.angle_deg) ?? 360;
        const axis = readVec3(shape.args.axis) ?? [0, 0, 1];
        const origin = readVec3(shape.args.origin) ?? [0, 0, 0];
        if (count === null || base.length === 0) return base;
        const denom = Math.abs(total) >= 360 - 1e-9 ? count : Math.max(count - 1, 1);
        const out: LocalAABB[] = [];
        for (let i = 0; i < count; i++) {
          const angle = (total * i) / denom;
          for (const c of base) out.push(rotateAabbAround(c, angle, axis, origin));
        }
        return out;
      }
      case 'translate': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const offset = readVec3(shape.args.offset);
        if (!offset || base.length === 0) return base;
        return base.map(c => translateAabb(c, offset));
      }
      case 'rotate': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const angle = readNumber(shape.args.angle_deg);
        const axis = readVec3(shape.args.axis) ?? [0, 0, 1];
        const origin = readVec3(shape.args.origin) ?? [0, 0, 0];
        if (angle === undefined || base.length === 0) return base;
        return base.map(c => rotateAabbAround(c, angle, axis, origin));
      }
      case 'mirror': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const plane = (readString(shape.args.plane) ?? 'YZ').toUpperCase();
        const origin = readVec3(shape.args.origin) ?? [0, 0, 0];
        if (base.length === 0) return base;
        return base.map(c => mirrorAabb(c, plane, origin));
      }
      case 'scale': {
        const base = clusterRef(shape.args.shape, byId, visiting);
        const factor = readNumber(shape.args.factor);
        const center = readVec3(shape.args.center) ?? [0, 0, 0];
        if (factor === undefined || factor <= 0 || base.length === 0) return base;
        return base.map(c => ({
          center: [
            center[0] + (c.center[0] - center[0]) * factor,
            center[1] + (c.center[1] - center[1]) * factor,
            center[2] + (c.center[2] - center[2]) * factor,
          ],
          halfExtent: [
            c.halfExtent[0] * factor,
            c.halfExtent[1] * factor,
            c.halfExtent[2] * factor,
          ],
        }));
      }
      default: {
        // 叶子 / extrude / revolve / 语义零件 / 齿轮 → 用整体 AABB 当一簇
        const whole =
          localAabbFromShapeInGeometry(shape, byId) ?? localAabbFromShape(shape);
        return whole ? [whole] : [];
      }
    }
  } finally {
    visiting.delete(shape.id);
  }
}

function clusterRef(
  arg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): LocalAABB[] {
  if (!arg || arg.kind !== 'ref') return [];
  const target = byId.get(arg.name);
  return target ? clusterShape(target, byId, visiting) : [];
}

// ════════════════════════════════════════════════════════════════════
// 邻接合并（cluster_tol）
// ════════════════════════════════════════════════════════════════════

function mergeTouchingClusters(clusters: LocalAABB[], tol: number): LocalAABB[] {
  if (clusters.length <= 1) return clusters;
  let pool = clusters.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const next: LocalAABB[] = [];
    const used = new Array(pool.length).fill(false);
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      let merged = pool[i];
      used[i] = true;
      for (let j = i + 1; j < pool.length; j++) {
        if (used[j]) continue;
        if (touchOrOverlap(merged, pool[j], tol)) {
          merged = unionAabb(merged, pool[j]);
          used[j] = true;
          changed = true;
        }
      }
      next.push(merged);
    }
    pool = next;
  }
  return pool;
}

// ════════════════════════════════════════════════════════════════════
// AABB 几何工具
// ════════════════════════════════════════════════════════════════════

function translateAabb(a: LocalAABB, offset: Vec3): LocalAABB {
  return {
    center: [a.center[0] + offset[0], a.center[1] + offset[1], a.center[2] + offset[2]],
    halfExtent: a.halfExtent,
  };
}

function rotateAabbAround(a: LocalAABB, angleDeg: number, axis: Vec3, origin: Vec3): LocalAABB {
  // 把 8 角点旋转后取 AABB（保守）
  const corners = aabbCorners(a);
  const rotated = corners.map(c => rotatePoint(c, angleDeg, axis, origin));
  return aabbFromPoints(rotated);
}

function mirrorAabb(a: LocalAABB, plane: string, origin: Vec3): LocalAABB {
  const corners = aabbCorners(a).map(c => mirrorPoint(c, plane, origin));
  return aabbFromPoints(corners);
}

function intersectAabb(a: LocalAABB, b: LocalAABB): LocalAABB | null {
  const [aMin, aMax] = minMax(a);
  const [bMin, bMax] = minMax(b);
  const min: Vec3 = [
    Math.max(aMin[0], bMin[0]),
    Math.max(aMin[1], bMin[1]),
    Math.max(aMin[2], bMin[2]),
  ];
  const max: Vec3 = [
    Math.min(aMax[0], bMax[0]),
    Math.min(aMax[1], bMax[1]),
    Math.min(aMax[2], bMax[2]),
  ];
  if (min[0] >= max[0] || min[1] >= max[1] || min[2] >= max[2]) return null;
  return aabbFromMinMax(min, max);
}

function unionAabb(a: LocalAABB, b: LocalAABB): LocalAABB {
  const [aMin, aMax] = minMax(a);
  const [bMin, bMax] = minMax(b);
  return aabbFromMinMax(
    [Math.min(aMin[0], bMin[0]), Math.min(aMin[1], bMin[1]), Math.min(aMin[2], bMin[2])],
    [Math.max(aMax[0], bMax[0]), Math.max(aMax[1], bMax[1]), Math.max(aMax[2], bMax[2])],
  );
}

function unionAll(clusters: LocalAABB[]): LocalAABB {
  let cur = clusters[0];
  for (let i = 1; i < clusters.length; i++) cur = unionAabb(cur, clusters[i]);
  return cur;
}

function touchOrOverlap(a: LocalAABB, b: LocalAABB, tol: number): boolean {
  const [aMin, aMax] = minMax(a);
  const [bMin, bMax] = minMax(b);
  for (let i = 0; i < 3; i++) {
    if (aMax[i] + tol < bMin[i]) return false;
    if (bMax[i] + tol < aMin[i]) return false;
  }
  return true;
}

function aabbCorners(a: LocalAABB): Vec3[] {
  const [mn, mx] = minMax(a);
  return [
    [mn[0], mn[1], mn[2]],
    [mn[0], mn[1], mx[2]],
    [mn[0], mx[1], mn[2]],
    [mn[0], mx[1], mx[2]],
    [mx[0], mn[1], mn[2]],
    [mx[0], mn[1], mx[2]],
    [mx[0], mx[1], mn[2]],
    [mx[0], mx[1], mx[2]],
  ];
}

function minMax(a: LocalAABB): [Vec3, Vec3] {
  return [
    [a.center[0] - a.halfExtent[0], a.center[1] - a.halfExtent[1], a.center[2] - a.halfExtent[2]],
    [a.center[0] + a.halfExtent[0], a.center[1] + a.halfExtent[1], a.center[2] + a.halfExtent[2]],
  ];
}

function aabbFromMinMax(min: Vec3, max: Vec3): LocalAABB {
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    halfExtent: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
  };
}

function aabbFromPoints(pts: Vec3[]): LocalAABB {
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
  let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
  for (const p of pts) {
    if (p[0] < mnX) mnX = p[0];
    if (p[1] < mnY) mnY = p[1];
    if (p[2] < mnZ) mnZ = p[2];
    if (p[0] > mxX) mxX = p[0];
    if (p[1] > mxY) mxY = p[1];
    if (p[2] > mxZ) mxZ = p[2];
  }
  return aabbFromMinMax([mnX, mnY, mnZ], [mxX, mxY, mxZ]);
}

function rotatePoint(p: Vec3, angleDeg: number, axis: Vec3, origin: Vec3): Vec3 {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  if (len <= 1e-9) return p;
  const ux = axis[0] / len;
  const uy = axis[1] / len;
  const uz = axis[2] / len;
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = p[0] - origin[0];
  const y = p[1] - origin[1];
  const z = p[2] - origin[2];
  const dot = ux * x + uy * y + uz * z;
  return [
    origin[0] + x * c + (uy * z - uz * y) * s + ux * dot * (1 - c),
    origin[1] + y * c + (uz * x - ux * z) * s + uy * dot * (1 - c),
    origin[2] + z * c + (ux * y - uy * x) * s + uz * dot * (1 - c),
  ];
}

function mirrorPoint(p: Vec3, plane: string, origin: Vec3): Vec3 {
  if (plane === 'XY') return [p[0], p[1], 2 * origin[2] - p[2]];
  if (plane === 'YZ') return [2 * origin[0] - p[0], p[1], p[2]];
  return [p[0], 2 * origin[1] - p[1], p[2]]; // XZ
}

// ════════════════════════════════════════════════════════════════════
// Arg / 工具读取
// ════════════════════════════════════════════════════════════════════

function readVec3(arg: Arg | undefined): Vec3 | undefined {
  if (!arg || arg.kind !== 'list' || arg.items.length !== 3) return undefined;
  const out: number[] = [];
  for (const it of arg.items) {
    if (it.kind !== 'number') return undefined;
    out.push(it.value);
  }
  return [out[0], out[1], out[2]];
}

function readNumber(arg: Arg | undefined): number | undefined {
  if (!arg || arg.kind !== 'number') return undefined;
  return arg.value;
}

function readString(arg: Arg | undefined): string | undefined {
  if (!arg || arg.kind !== 'string') return undefined;
  return arg.value;
}

function readCount(arg: Arg | undefined): number | null {
  const raw = readNumber(arg);
  if (raw === undefined) return null;
  const n = Math.round(raw);
  return Number.isFinite(n) && n >= 1 && n <= 256 ? n : null;
}

function readNonNeg(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function empty(geom: Geometry, error: string): Record<string, unknown> {
  return {
    geometry: geom,
    cluster_count: 0,
    fallback_used: false,
    error,
  };
}

function removeCollisionsFor(geom: Geometry, linkId: string): Geometry {
  const keep = geom.statements.filter(s => {
    if (s.op !== 'collision') return true;
    const r = s.args.link;
    return !(r && r.kind === 'ref' && r.name === linkId);
  });
  if (keep.length === geom.statements.length) return geom;
  return geometryFromStatements(keep, { previous: geom, focus: geom.focus });
}

export default gCollisionClustered;
