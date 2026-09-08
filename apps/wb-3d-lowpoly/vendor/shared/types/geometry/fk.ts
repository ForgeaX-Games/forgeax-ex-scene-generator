/**
 * 正向运动学（joint 树 → 每个 part 的世界位姿）+ AABB 几何数学。
 *
 * 这里集中 `g_geometry_qc` / `g_metrics` 等只读几何分析件共享的纯数学：
 *   - `computeWorldTransforms`：沿 joint 树累计每个 part 的世界变换（rpy→mat3 · 平移）
 *   - AABB 变换 / 距离 / 重叠深度（point-AABB、AABB-AABB、三轴重叠深度）
 *   - rpy→mat3、mat3 乘法 / mat3·vec3、向量加法、AABB 八角点
 *
 * 抽出的动机（去冗余 / SSOT）：这些函数原先内联在 `g_geometry_qc`，`g_metrics`
 * 需要同一套"世界帧 FK + AABB 干涉"数学。抽到本模块后两者共享同一实现，避免
 * 第二份漂移。行为与原 QC 内联实现逐字节等价（QC 的回归测试守住这一点）。
 */

import type { Arg, Statement } from './types.js';
import type { LocalAABB } from './aabb.js';
import type { Vec3 } from './surface.js';

export type Mat3 = readonly [Vec3, Vec3, Vec3];

export interface Xform {
  readonly rot: Mat3;
  readonly origin: Vec3;
}

export const IDENTITY_XFORM: Xform = { rot: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], origin: [0, 0, 0] };

/**
 * 沿 joint 树（parent→child）累计每个 part 的世界变换。
 *   childWorld.rot    = parentWorld.rot · jointRot(rpy)
 *   childWorld.origin = parentWorld.origin + parentWorld.rot · jointOrigin
 * 根 part（不是任何 joint.child）取恒等。未连通到根的 part（孤岛/环）兜底恒等。
 * 每个 link 只认第一条父 joint（URDF 树约束）。
 */
export function computeWorldTransforms(parts: readonly Statement[], joints: readonly Statement[]): Map<string, Xform> {
  const partIds = new Set(parts.map(p => p.id));
  const edge = new Map<string, { parent: string; origin: Vec3; rpy: Vec3 }>();
  const childrenOf = new Map<string, string[]>();
  for (const id of partIds) childrenOf.set(id, []);
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!partIds.has(p.name) || !partIds.has(c.name)) continue;
    if (edge.has(c.name)) continue;
    const origin = readVec3(j.args.origin) ?? [0, 0, 0];
    const rpy = readVec3(j.args.rpy) ?? [0, 0, 0];
    edge.set(c.name, { parent: p.name, origin, rpy });
    childrenOf.get(p.name)!.push(c.name);
  }
  const world = new Map<string, Xform>();
  const queue: string[] = [];
  for (const id of partIds) {
    if (!edge.has(id)) { world.set(id, IDENTITY_XFORM); queue.push(id); }
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curW = world.get(cur)!;
    for (const ch of childrenOf.get(cur) ?? []) {
      if (world.has(ch)) continue;
      const e = edge.get(ch)!;
      const rot = mat3Mul(curW.rot, rpyToMat3(e.rpy));
      const origin = addVec(curW.origin, mat3Vec3(curW.rot, e.origin));
      world.set(ch, { rot, origin });
      queue.push(ch);
    }
  }
  for (const id of partIds) if (!world.has(id)) world.set(id, IDENTITY_XFORM);
  return world;
}

export function transformAabbByOriginRpy(
  local: LocalAABB,
  origin: Vec3,
  rpy: Vec3,
): LocalAABB {
  // rpy = [0,0,0] 时简化为平移
  if (rpy[0] === 0 && rpy[1] === 0 && rpy[2] === 0) {
    return translateAabb(local, origin);
  }
  // rpy 非零：八角点旋转后取重新包络（保守 AABB），可能比原始 OBB 略大但不漏报
  const corners = aabbCorners(local);
  const rot = rpyToMat3(rpy);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const r = mat3Vec3(rot, c);
    const x = r[0] + origin[0];
    const y = r[1] + origin[1];
    const z = r[2] + origin[2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    halfExtent: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
  };
}

export function translateAabb(a: LocalAABB, offset: Vec3): LocalAABB {
  return {
    center: [a.center[0] + offset[0], a.center[1] + offset[1], a.center[2] + offset[2]],
    halfExtent: a.halfExtent,
  };
}

export function transformAabbByMatOrigin(local: LocalAABB, rot: Mat3, origin: Vec3): LocalAABB {
  const corners = aabbCorners(local);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const c of corners) {
    const r = mat3Vec3(rot, c);
    const x = r[0] + origin[0];
    const y = r[1] + origin[1];
    const z = r[2] + origin[2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    halfExtent: [(maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2],
  };
}

export interface JointMotionEdge {
  readonly parent: string;
  /** joint.type !== 'fixed'（该 child 是否随此关节相对 parent 运动）。 */
  readonly moving: boolean;
}

/**
 * 从 joint 语句构建 child → {parent, moving} 边表。与 `computeWorldTransforms`
 * 同一条"每个 child 只认第一条父 joint"规则，保证与 FK 树一致。
 */
export function buildJointMotionEdges(joints: readonly Statement[]): Map<string, JointMotionEdge> {
  const edge = new Map<string, JointMotionEdge>();
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (edge.has(c.name)) continue;
    const typeArg = j.args.type;
    const moving = typeArg?.kind === 'string' && typeArg.value !== 'fixed';
    edge.set(c.name, { parent: p.name, moving });
  }
  return edge;
}

function ancestorChain(id: string, edges: ReadonlyMap<string, JointMotionEdge>): string[] {
  const chain = [id];
  const seen = new Set([id]);
  let cur = id;
  while (edges.has(cur)) {
    const parent = edges.get(cur)!.parent;
    if (seen.has(parent)) break; // 环兜底
    chain.push(parent);
    seen.add(parent);
    cur = parent;
  }
  return chain;
}

/**
 * 两个 part 之间的运动学路径上是否存在非 fixed joint —— 即它们的相对位姿会不会
 * 随关节运动改变。只有这种情况下 rest-pose AABB 重叠才是**真实碰撞风险**；同一刚性
 * 子树内（路径上全是 fixed joint）的重叠，即使模型别处存在某个可动关节（如另一扇
 * 门用了 revolute），依然是静态装配的合理交叠（墙角 T 形接头 / 嵌框 / 门扇落位 / 楼梯
 * 落井…），不应被牵连升级为致命错误——这正是修复"一装可动关节，全楼交叠全报错"
 * 的 moving-joint trap 的关键。
 * 两者不在同一 joint 树（不同 island，压根没有 joint 把二者连起来）时，各自都只能
 * 沿自己那条链回溯到"没有父 joint"的根，而未连通到任何 joint 的 part 在 FK 里恒定
 * 取世界原点恒等变换（见 `computeWorldTransforms`）——也就是二者都是绝对静止的，谁都
 * 不会因为模型别处某个可动关节而移动，因此天然不存在"相对运动"，返回 false。
 */
export function partsMoveRelativeToEachOther(
  a: string,
  b: string,
  edges: ReadonlyMap<string, JointMotionEdge>,
): boolean {
  if (a === b) return false;
  const chainA = ancestorChain(a, edges);
  const chainB = ancestorChain(b, edges);
  const indexInB = new Map<string, number>();
  chainB.forEach((id, i) => { if (!indexInB.has(id)) indexInB.set(id, i); });
  let lcaA = -1;
  let lcaB = -1;
  for (let i = 0; i < chainA.length; i++) {
    const j = indexInB.get(chainA[i]);
    if (j !== undefined) { lcaA = i; lcaB = j; break; }
  }
  if (lcaA === -1) return false; // 不同 island，二者各自绝对静止，不存在相对运动
  for (let i = 0; i < lcaA; i++) if (edges.get(chainA[i])?.moving) return true;
  for (let i = 0; i < lcaB; i++) if (edges.get(chainB[i])?.moving) return true;
  return false;
}

/** 两 AABB 的最近间距（相交 → 0）。 */
export function aabbAabbDistance(a: LocalAABB, b: LocalAABB): number {
  const aMin: Vec3 = [a.center[0] - a.halfExtent[0], a.center[1] - a.halfExtent[1], a.center[2] - a.halfExtent[2]];
  const aMax: Vec3 = [a.center[0] + a.halfExtent[0], a.center[1] + a.halfExtent[1], a.center[2] + a.halfExtent[2]];
  const bMin: Vec3 = [b.center[0] - b.halfExtent[0], b.center[1] - b.halfExtent[1], b.center[2] - b.halfExtent[2]];
  const bMax: Vec3 = [b.center[0] + b.halfExtent[0], b.center[1] + b.halfExtent[1], b.center[2] + b.halfExtent[2]];
  const dx = Math.max(0, bMin[0] - aMax[0], aMin[0] - bMax[0]);
  const dy = Math.max(0, bMin[1] - aMax[1], aMin[1] - bMax[1]);
  const dz = Math.max(0, bMin[2] - aMax[2], aMin[2] - bMax[2]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const out: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      out[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return [
    [out[0][0], out[0][1], out[0][2]],
    [out[1][0], out[1][1], out[1][2]],
    [out[2][0], out[2][1], out[2][2]],
  ];
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function aabbCorners(a: LocalAABB): Vec3[] {
  const c = a.center;
  const h = a.halfExtent;
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        out.push([c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]]);
      }
    }
  }
  return out;
}

/** 点到 AABB 的最短距离；点在内部 → 0 */
export function pointAabbDistance(p: Vec3, a: LocalAABB): number {
  const minX = a.center[0] - a.halfExtent[0];
  const minY = a.center[1] - a.halfExtent[1];
  const minZ = a.center[2] - a.halfExtent[2];
  const maxX = a.center[0] + a.halfExtent[0];
  const maxY = a.center[1] + a.halfExtent[1];
  const maxZ = a.center[2] + a.halfExtent[2];
  const dx = Math.max(0, Math.max(minX - p[0], p[0] - maxX));
  const dy = Math.max(0, Math.max(minY - p[1], p[1] - maxY));
  const dz = Math.max(0, Math.max(minZ - p[2], p[2] - maxZ));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** 两 AABB 在三轴上的重叠深度；任何轴 ≤ 0 表示该轴未重叠 */
export function aabbOverlapDepth(a: LocalAABB, b: LocalAABB): Vec3 {
  const aMin: Vec3 = [
    a.center[0] - a.halfExtent[0],
    a.center[1] - a.halfExtent[1],
    a.center[2] - a.halfExtent[2],
  ];
  const aMax: Vec3 = [
    a.center[0] + a.halfExtent[0],
    a.center[1] + a.halfExtent[1],
    a.center[2] + a.halfExtent[2],
  ];
  const bMin: Vec3 = [
    b.center[0] - b.halfExtent[0],
    b.center[1] - b.halfExtent[1],
    b.center[2] - b.halfExtent[2],
  ];
  const bMax: Vec3 = [
    b.center[0] + b.halfExtent[0],
    b.center[1] + b.halfExtent[1],
    b.center[2] + b.halfExtent[2],
  ];
  return [
    Math.min(aMax[0], bMax[0]) - Math.max(aMin[0], bMin[0]),
    Math.min(aMax[1], bMax[1]) - Math.max(aMin[1], bMin[1]),
    Math.min(aMax[2], bMax[2]) - Math.max(aMin[2], bMin[2]),
  ];
}

export function rpyToMat3(rpy: Vec3): readonly [Vec3, Vec3, Vec3] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  const cp = Math.cos(p);
  const sp = Math.sin(p);
  const cy = Math.cos(y);
  const sy = Math.sin(y);
  // R = Rz(yaw) * Ry(pitch) * Rx(roll)（与 URDF 一致）
  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

/**
 * mat3 → URDF rpy（R = Rz(yaw)·Ry(pitch)·Rx(roll)，与 `rpyToMat3` 互逆）。
 * 万向锁（|pitch| = 90°）时 roll 与 yaw 简并，取 roll=0 把旋转全折进 yaw。
 */
export function mat3ToRpy(m: Mat3): Vec3 {
  const cp = Math.hypot(m[0][0], m[1][0]);
  if (cp < 1e-9) return [0, Math.atan2(-m[2][0], cp), Math.atan2(-m[0][1], m[1][1])];
  return [Math.atan2(m[2][1], m[2][2]), Math.atan2(-m[2][0], cp), Math.atan2(m[1][0], m[0][0])];
}

export function mat3Vec3(m: readonly [Vec3, Vec3, Vec3], v: Vec3): Vec3 {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}

/** 读取一个 3 元素 number list 为 Vec3；形态不符返回 undefined。 */
export function readVec3(arg: Arg | undefined): Vec3 | undefined {
  if (!arg || arg.kind !== 'list' || arg.items.length !== 3) return undefined;
  const out: number[] = [];
  for (const item of arg.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return [out[0], out[1], out[2]];
}
