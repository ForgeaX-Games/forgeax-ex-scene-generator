/**
 * g_metrics —— 几何/输出的**量化评估**电池（只读分析，不改 Geometry、不新增 DSL op）。
 *
 * 定位与 g_geometry_qc 互补：
 *   - g_geometry_qc 出**布尔信号**（有没有问题，供修复循环）；
 *   - g_metrics 出**量化数值 + 综合评分**（问题有多严重、结果有多好）。
 *
 * 输出一段多行 `report`（既含结果基本信息，又含能评判好坏的质量指标），一个
 * 0–100 的综合健康分 `score` 与分级 `grade`，外加各标量端口便于下游读取。
 *
 * 复用 vendor/shared/types/geometry/fk.ts 的世界帧 FK + AABB 干涉数学（与 g_geometry_qc
 * 同一实现，避免第二份漂移），以及 aabb.ts 的 shape→局部 AABB 解析。
 */

import {
  aabbAabbDistance,
  aabbOverlapDepth,
  computeWorldTransforms,
  IDENTITY_XFORM,
  isGeometry,
  listShapeOps,
  localAabbFromPart,
  readVec3,
  transformAabbByMatOrigin,
  transformAabbByOriginRpy,
  type Arg,
  type Geometry,
  type LocalAABB,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

/** 裸 primitive shape op（mesh 视为已丰富，不计入）。 */
const BARE_PRIMITIVE_OPS: ReadonlySet<string> = new Set([
  'box', 'cylinder', 'sphere', 'cone', 'capsule', 'torus', 'dome',
]);

/** Architecture 家族 op（语义建筑件）。 */
const ARCHITECTURE_OPS: ReadonlySet<string> = new Set([
  'wall', 'floor_slab', 'stairs', 'roof', 'facade_panel',
  'window', 'door_frame', 'door_leaf', 'railing', 'column',
]);

/** CSG / 拉伸 / 回转 / 阵列等"实体建模"op。 */
const CSG_OPS: ReadonlySet<string> = new Set([
  'union', 'difference', 'intersection',
  'extrude', 'extrude_with_holes', 'loft', 'revolve',
  'sweep', 'pipe', 'section_loft',
]);

/** 2D sketch / profile op（不计入几何丰富度）。 */
const SKETCH_OPS: ReadonlySet<string> = new Set([
  'profile_rect', 'profile_circle', 'profile_polygon',
  'profile_rounded_rect', 'profile_regular_polygon',
]);

type Status = 'pass' | 'warn' | 'fail' | 'n/a';

interface PartBox {
  readonly id: string;
  readonly aabb: LocalAABB;
}

/** 每种关节类型对应的自由度（DOF）。 */
function dofOfJoint(type: string): number {
  switch (type) {
    case 'revolute':
    case 'continuous':
    case 'prismatic':
      return 1;
    case 'planar':
      return 2;
    case 'floating':
      return 6;
    default:
      return 0; // fixed / unknown
  }
}

export function gMetrics(input: Record<string, unknown>): Record<string, unknown> {
  const geom = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geom) {
    return {
      geometry: null,
      report: 'no Geometry input',
      score: 0,
      grade: 'F',
      overlap_pairs: 0,
      overlap_volume: 0,
      max_penetration: 0,
      overlap_ratio: 0,
      moving_joint_collisions: 0,
      islands: 0,
      floating_links: 0,
      joints_with_gap: 0,
      max_joint_gap: 0,
      ground_offset: 0,
      dof: 0,
      primitive_only: false,
      primitive_ratio: 0,
      tri_count: 0,
      vertex_count: 0,
      over_budget: false,
    };
  }

  const bake = input.bake === true;
  const overlapTol = readPositiveNumber(input.overlap_tol, 0.001);
  const gapTol = readPositiveNumber(input.gap_tol, 0.02);
  const triBudget = Math.max(0, Math.round(readPositiveNumber(input.tri_budget, 0)));
  const precision = Math.min(6, Math.max(0, Math.round(readPositiveNumber(input.precision, 3))));

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);

  const parts: Statement[] = [];
  const joints: Statement[] = [];
  let materialCount = 0;
  let profileCount = 0;
  for (const s of geom.statements) {
    if (s.op === 'part') parts.push(s);
    else if (s.op === 'joint') joints.push(s);
    else if (s.op === 'material') materialCount++;
    else if (SKETCH_OPS.has(s.op)) profileCount++;
  }

  const shapeOps = new Set(listShapeOps());
  const shapeStatements = geom.statements.filter(s => shapeOps.has(s.op));
  const primitiveCount = shapeStatements.filter(s => BARE_PRIMITIVE_OPS.has(s.op)).length;
  const richCount = shapeStatements.length - primitiveCount;
  const architectureCount = geom.statements.filter(s => ARCHITECTURE_OPS.has(s.op)).length;
  const csgCount = geom.statements.filter(s => CSG_OPS.has(s.op)).length;
  const primitiveOnly = primitiveCount > 0 && richCount === 0;
  const primitiveRatio = shapeStatements.length > 0 ? primitiveCount / shapeStatements.length : 0;

  // joint 按 type 分组计数 + DOF 汇总。
  const jointsByType = new Map<string, number>();
  let dof = 0;
  for (const j of joints) {
    const t = readString(j.args.type) ?? 'fixed';
    jointsByType.set(t, (jointsByType.get(t) ?? 0) + 1);
    dof += dofOfJoint(t);
  }

  // ── 世界帧 part AABB（part.origin/rpy + joint-FK），与 g_geometry_qc 同一路径 ──
  const worldXform = computeWorldTransforms(parts, joints);
  const partBoxes: PartBox[] = [];
  const boxById = new Map<string, LocalAABB>();
  for (const part of parts) {
    const local = localAabbFromPart(part, byId);
    if (!local) continue; // AABB 不可解的 part 交给 g_geometry_qc 报；这里跳过量化
    const origin = readVec3(part.args.origin) ?? [0, 0, 0];
    const rpy = readVec3(part.args.rpy) ?? [0, 0, 0];
    const linkLocal = transformAabbByOriginRpy(local, origin, rpy);
    const w = worldXform.get(part.id) ?? IDENTITY_XFORM;
    const world = transformAabbByMatOrigin(linkLocal, w.rot, w.origin);
    partBoxes.push({ id: part.id, aabb: world });
    boxById.set(part.id, world);
  }

  // ── 基本空间信息：整体世界 AABB ──
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const b of partBoxes) {
    minX = Math.min(minX, b.aabb.center[0] - b.aabb.halfExtent[0]);
    minY = Math.min(minY, b.aabb.center[1] - b.aabb.halfExtent[1]);
    minZ = Math.min(minZ, b.aabb.center[2] - b.aabb.halfExtent[2]);
    maxX = Math.max(maxX, b.aabb.center[0] + b.aabb.halfExtent[0]);
    maxY = Math.max(maxY, b.aabb.center[1] + b.aabb.halfExtent[1]);
    maxZ = Math.max(maxZ, b.aabb.center[2] + b.aabb.halfExtent[2]);
  }
  const hasBox = partBoxes.length > 0 && Number.isFinite(minX);
  const bboxW = hasBox ? maxX - minX : 0;
  const bboxD = hasBox ? maxY - minY : 0;
  const bboxH = hasBox ? maxZ - minZ : 0;
  const footprintArea = bboxW * bboxD;
  const boundingVolume = bboxW * bboxD * bboxH;
  const groundOffset = hasBox ? minZ : 0;

  // ── 重叠 / 干涉：兄弟 part 两两世界 AABB ──
  let overlapPairs = 0;
  let overlapVolume = 0;
  let maxPenetration = 0;
  const overlapping = new Set<string>(); // "a|b" 键，供可动碰撞判定复用
  const sorted = partBoxes.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const depth = aabbOverlapDepth(sorted[i].aabb, sorted[j].aabb);
      if (depth[0] > overlapTol && depth[1] > overlapTol && depth[2] > overlapTol) {
        overlapPairs++;
        overlapVolume += depth[0] * depth[1] * depth[2];
        maxPenetration = Math.max(maxPenetration, Math.min(depth[0], depth[1], depth[2]));
        overlapping.add(pairKey(sorted[i].id, sorted[j].id));
      }
    }
  }
  const overlapRatio = boundingVolume > 1e-12 ? overlapVolume / boundingVolume : 0;

  // ── 可动关节休止位互穿（真实缺陷，重罚）──
  let movingJointCollisions = 0;
  for (const j of joints) {
    const type = readString(j.args.type) ?? 'fixed';
    if (type === 'fixed') continue;
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (overlapping.has(pairKey(p.name, c.name))) movingJointCollisions++;
  }

  // ── 连接质量：islands / floating / joint 缝隙 ──
  const partIds = parts.map(p => p.id);
  const islands = countIslands(partIds, joints);
  const floating = findFloatingLinks(parts, joints);
  let jointsWithGap = 0;
  let maxJointGap = 0;
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    const pb = boxById.get(p.name);
    const cb = boxById.get(c.name);
    if (!pb || !cb) continue;
    const gap = aabbAabbDistance(pb, cb);
    if (gap > gapTol) {
      jointsWithGap++;
      maxJointGap = Math.max(maxJointGap, gap);
    }
  }

  // ── 面数预算：本电池不接 baker（保持只读、无 bake 副作用），tri/vertex 恒未知。
  // `bake` 输入目前只是个占位开关——传 true 也不会真的去烘，因此 over_budget 永远
  // 测不出来。polyStatus 必须恒为 n/a（见下），不能因为 bake=true 就伪装"已测量通过"。
  // 真要卡三角面预算：g_bake_part 把 part 逐个烘成 <sha>.obj 并登记进 parts.json，
  // 再用 g_geometry_qc/mesh-qc 读那份真实面数。
  const triCount = 0;
  const vertexCount = 0;
  const overBudget = false;

  // ── 综合评分：各质量项按权重扣分 ──
  // 连接性（islands/floating）重罚；重叠仅信息性轻扣（低模少量交叠是常态）。
  let score = 100;
  score -= Math.min(50, 20 * floating.length);
  score -= Math.min(40, 10 * Math.max(0, islands - (joints.length === 0 ? parts.length : 1)));
  score -= Math.min(15, 5 * movingJointCollisions);
  score -= Math.min(5, 1 * Math.max(0, overlapPairs - movingJointCollisions));
  score -= Math.min(20, 5 * jointsWithGap);
  if (hasBox && Math.abs(groundOffset) > gapTol) score -= 5;
  if (primitiveOnly) score -= 10;
  // 面数预算从不参与评分：over_budget 从未被真正测量过（见上），不能假装扣了这一项。
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  // ── 各项 pass/warn/fail 明细 ──
  const overlapStatus: Status = overlapPairs === 0 ? 'pass' : 'warn';
  const collisionStatus: Status = movingJointCollisions > 0 ? 'warn' : 'pass';
  const connectStatus: Status =
    floating.length > 0 || (joints.length > 0 && islands > 1) ? 'fail' : jointsWithGap > 0 ? 'warn' : 'pass';
  const groundingStatus: Status = !hasBox ? 'n/a' : Math.abs(groundOffset) > gapTol ? 'warn' : 'pass';
  const richnessStatus: Status = primitiveOnly ? 'warn' : 'pass';
  // 恒为 n/a：这个电池从不烘焙，triCount/overBudget 从未被真正测量过，`bake=true`
  // 不应该让它看起来像"已测量并通过"。见上面 over_budget 的注释。
  const polyStatus: Status = 'n/a';

  const n = (v: number): string => fmt(v, precision);
  const jointsSummary = joints.length === 0
    ? 'joints=0'
    : `joints=${joints.length} (${[...jointsByType.entries()].map(([t, c]) => `${t}:${c}`).join(', ')})`;

  const lines: string[] = [];
  lines.push(
    `[basic]   parts=${parts.length} ${jointsSummary} DOF=${dof} | ` +
    `bbox=${n(bboxW)}×${n(bboxD)}×${n(bboxH)}m footprint=${n(footprintArea)}m² | ` +
    `shapes=${shapeStatements.length} rich=${richCount} primitive=${primitiveCount} ` +
    `(arch=${architectureCount} csg=${csgCount} materials=${materialCount} profiles=${profileCount})`,
  );
  lines.push(`[quality] score=${score}/100 (${grade})`);
  lines.push(`  overlap:    pairs=${overlapPairs} volume=${n(overlapVolume)}m³ max_pen=${n(maxPenetration)}m ratio=${fmt(overlapRatio * 100, 1)}%   [${overlapStatus}]`);
  lines.push(`  collision:  moving_joint=${movingJointCollisions}                              [${collisionStatus}]`);
  lines.push(`  connect:    islands=${islands} floating=${floating.length} joints_with_gap=${jointsWithGap} max_gap=${n(maxJointGap)}m   [${connectStatus}]`);
  lines.push(`  grounding:  min_z=${n(groundOffset)}m                              [${groundingStatus}]`);
  lines.push(`  richness:   primitive_only=${primitiveOnly} (primitive ${fmt(primitiveRatio * 100, 0)}%)   [${richnessStatus}]`);
  lines.push(
    `  polybudget: not measured (this battery never bakes; bake=${bake} has no effect) — ` +
    `use g_bake_part + g_geometry_qc for real tri/vertex counts   [${polyStatus}]`,
  );

  return {
    geometry: geom,
    report: lines.join('\n'),
    score,
    grade,
    overlap_pairs: overlapPairs,
    overlap_volume: round(overlapVolume, 6),
    max_penetration: round(maxPenetration, 6),
    overlap_ratio: round(overlapRatio, 6),
    moving_joint_collisions: movingJointCollisions,
    islands,
    floating_links: floating.length,
    joints_with_gap: jointsWithGap,
    max_joint_gap: round(maxJointGap, 6),
    ground_offset: round(groundOffset, 6),
    dof,
    primitive_only: primitiveOnly,
    primitive_ratio: round(primitiveRatio, 6),
    tri_count: triCount,
    vertex_count: vertexCount,
    over_budget: overBudget,
  };
}

// ── 连通分量 / 悬空件（与 g_geometry_qc 同算法；纯拓扑，无 AABB 依赖）──

function countIslands(partIds: readonly string[], joints: readonly Statement[]): number {
  if (partIds.length === 0) return 0;
  const parent = new Map<string, string>();
  for (const id of partIds) parent.set(id, id);
  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur)! !== cur) cur = parent.get(cur)!;
    let p = x;
    while (parent.get(p)! !== cur) { const next = parent.get(p)!; parent.set(p, cur); p = next; }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a); const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const j of joints) {
    const p = j.args.parent; const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!parent.has(p.name) || !parent.has(c.name)) continue;
    union(p.name, c.name);
  }
  const roots = new Set<string>();
  for (const id of partIds) roots.add(find(id));
  return roots.size;
}

function findFloatingLinks(parts: readonly Statement[], joints: readonly Statement[]): string[] {
  if (parts.length <= 1 || joints.length === 0) return [];
  const partIds = new Set(parts.map(p => p.id));
  const linked = new Set<string>();
  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (p?.kind === 'ref' && partIds.has(p.name)) linked.add(p.name);
    if (c?.kind === 'ref' && partIds.has(c.name)) linked.add(c.name);
  }
  return [...partIds].filter(id => !linked.has(id)).sort();
}

// ── 工具 ──

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function readString(arg: Arg | undefined): string | undefined {
  if (!arg || arg.kind !== 'string') return undefined;
  return arg.value;
}

function readPositiveNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function round(n: number, prec: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** prec;
  return Math.round(n * f) / f;
}

function fmt(n: number, prec: number): string {
  if (!Number.isFinite(n)) return String(n);
  return n.toFixed(prec).replace(/\.?0+$/, '') || '0';
}

export default gMetrics;
