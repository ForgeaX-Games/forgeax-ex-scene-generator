/**
 * g_geometry_qc —— 静态几何质量检查（含已废弃 g_validate 合并进来的 SSA / URDF 语义检查）。
 *
 *   ⓪ **SSA / 类型校验 + URDF 语义**（合并自 g_validate）
 *      跑一遍 Geometry 的 SSA（id 唯一 / ref 存在）与参数类型校验，再加几条 URDF 语义检查：
 *      至少有一个 part、joint 的 parent/child 必须是 part 类型、joint.type 必须是 URDF
 *      允许的值、joint 不能形成自环。这一层是后面所有几何检查的地基——ref 断链或
 *      id 重复时，AABB / 连通分量等检查会拿到不可靠的 byId 映射。
 *
 * 以下是"在没有 mesh 烘焙、没有 fcl/trimesh"也能做的几何检查：
 *
 *   ① **连通分量 (islands)**
 *      把每个 `joint(parent, child)` 当无向边，跑一遍 union-find；
 *      孤岛（多个连通分量）= URDF 里多根树，运行时只渲染一棵 → 用户经常发现"零件没了"。
 *
 *   ② **shape AABB 解析失败 (missing_aabb)**
 *      每个 `part(shape=ref(...))` 沿引用链解析 → `localAabbFromShapeInGeometry`；
 *      返回 null = mesh 形状或未注册的 op，会让 placement / inertia / collision 三条
 *      下游能力同时失效，需要尽早暴露。
 *
 *   ③ **joint origin 距 part AABB 异常远**
 *      这里走"point-AABB 距离"代数式：
 *      把 joint.origin 投到 parent / child AABB 上，超过 tol 就报告。
 *      更精确的算法可用 fcl；TS 端我们走 AABB 即可，对绝大多数 bug case 已经够诊断。
 *
 *   ④ **兄弟 part AABB rest-pose 重叠**
 *      把每个 part 的 AABB 用 part.origin / part.rpy 旋转到"父坐标系"，
 *      然后两两 AABB-vs-AABB depth 检测。更精确的做法可用 OBB SAT；
 *      这里采用"先把 AABB 用 origin 平移 + rpy=0 时直接比较"，rpy 非零时把
 *      AABB 八角点旋转后取重新包络（保守 AABB），保持算法简单且永远不漏报，
 *      只可能因为 rotated AABB 膨胀产生少量误报（注释里有说明）。
 *
 * 设计取舍：
 *   - 完全静态、纯几何，不需要 baker / fcl，可以在画布每次 tick 都跑
 *   - rest pose 检测；没有 pose-sampling，这是当前 TS 端能做的最大范围
 *   - 输出 multiline 字符串，valid/report/count 是唯一权威校验出口（g_validate 已删除，
 *     其 SSA + URDF 语义检查已并入下方 ⓪）
 */

import {
  aabbAabbDistance,
  aabbOverlapDepth,
  addVec,
  buildJointMotionEdges,
  computeWorldTransforms,
  IDENTITY_XFORM,
  isGeometry,
  localAabbFromPart,
  mat3Vec3,
  partsMoveRelativeToEachOther,
  pointAabbDistance,
  readVec3,
  transformAabbByMatOrigin,
  transformAabbByOriginRpy,
  validateStatements,
  type Arg,
  type Geometry,
  type LocalAABB,
  type Statement,
  type Vec3,
} from '../../../../vendor/dist/shared/types/index.js';

/** URDF 允许的 joint.type 取值（合并自 g_validate）。 */
const URDF_JOINT_TYPES: ReadonlySet<string> = new Set([
  'fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar',
]);

/**
 * 「裸 primitive」shape op（Primitive 家族，mesh 除外 —— mesh 引用外部网格，
 * 视为已经是丰富几何，不应触发 primitive-only 提示）。
 */
const BARE_PRIMITIVE_OPS: ReadonlySet<string> = new Set([
  'box',
  'cylinder',
  'sphere',
  'cone',
  'capsule',
  'torus',
  'dome',
]);

/** 非 shape 的辅助语句 op（不参与"几何是否丰富"判断）。 */
const NON_SHAPE_AUX_OPS: ReadonlySet<string> = new Set([
  'material',
  'inertial',
  'collision',
  'part',
  'joint',
]);

/**
 * 2D sketch / profile op 全集（含圆角矩形 / 正多边形）。
 * profile 是 2D 截面、不是实体 shape，**不计入「几何丰富度」**——
 * 一段 profile 必须被 extrude/loft/revolve 消费后才产出真实建模。
 *
 * 注意：孤立 profile（orphan）与 revolve XY 误用两项检查都必须覆盖**全部** 5 个
 * profile op。此前它们只查 rect/circle/polygon，漏掉了 rounded_rect / regular_polygon
 * —— 一个孤立的 g_profile_rounded_rect 或喂进 revolve 的 g_profile_regular_polygon 会被
 * 静默放过（前者烘成 ~2mm 薄片，后者按 (r,z) 误读产出错误回转体）。统一用 SKETCH_OPS。
 */
const SKETCH_OPS: ReadonlySet<string> = new Set([
  'profile_rect',
  'profile_circle',
  'profile_polygon',
  'profile_rounded_rect',
  'profile_regular_polygon',
]);

/** 孤立 profile 检测集合 == 全部 sketch op。 */
const PROFILE_OPS: ReadonlySet<string> = SKETCH_OPS;

/** XY 语义（居中于原点）的 profile op —— 喂给 revolve 会被误读为 r,z。全部 5 个都居中。 */
const XY_PROFILE_OPS: ReadonlySet<string> = SKETCH_OPS;

/** mesh-backed 曲线/曲面 op —— 不能作为布尔操作的操作数（baker 会抛错）。 */
const MESH_BACKED_OPS: ReadonlySet<string> = new Set([
  'pipe',
  'sweep',
  'section_loft',
  'rock',
  'boulder', // rock 的同义 op，参数/限制完全一致
  'sdf_blob',
]);

/** 单输入变换 op：解析布尔操作数 / profile 消费链时需要穿透。 */
const TRANSFORM_OPS: ReadonlySet<string> = new Set([
  'translate',
  'rotate',
  'scale',
  'mirror',
  'array_linear',
  'array_radial',
]);

const BOOLEAN_OPS: ReadonlySet<string> = new Set([
  'union',
  'difference',
  'intersection',
]);

type SignalSeverity = 'error' | 'warning' | 'note';

interface QcSignal {
  code: string;
  severity: SignalSeverity;
  message: string;
  ids?: string[];
}

interface PartAabbWorld {
  /** 父坐标系（geom 全局）下的 AABB */
  readonly aabb: LocalAABB;
  /** part.origin（缺省 [0,0,0]） */
  readonly origin: Vec3;
}

export function gGeometryQc(input: Record<string, unknown>): Record<string, unknown> {
  const geom = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geom) {
    return {
      geometry: null,
      valid: false,
      report: 'no Geometry input',
      count: 1,
      islands: 0,
      missing_aabb: 0,
      overlaps: 0,
      primitive_only: false,
    };
  }

  const jointOriginTol = readPositiveNumber(input.joint_origin_tol, 0.05);
  const overlapTol = readPositiveNumber(input.overlap_tol, 0.001);
  const checkOverlaps = input.check_overlaps !== false; // 默认 true
  const allowPairs = readStringSet(input.allow_pairs);
  const allowJoints = readStringSet(input.allow_joints);

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);

  const parts: Statement[] = [];
  const joints: Statement[] = [];
  for (const s of geom.statements) {
    if (s.op === 'part') parts.push(s);
    else if (s.op === 'joint') joints.push(s);
  }

  const issues: string[] = [];
  // joint origin/距离启发式信号：对**可动**关节（revolute/prismatic/...）是致命错误
  // （origin 必须落在转轴/滑轴上，靠近父子件）；对**fixed** 关节降级为 note ——
  // 静态装配（如用 g_wall/g_floor_slab/g_stairs/g_roof + fixed joint 以世界式偏移
  // 手工拼一栋楼时把屋顶/上层楼板挂到单一根 slab）下，"子件远离父级 AABB" 是合法摆位而非 bug。
  const jointHeuristicSignals: QcSignal[] = [];
  // 静态全 fixed 装配（建筑外壳：墙在墙角/T 形接头按一个墙厚交叠、楼梯占楼梯井
  // 与楼板 AABB 交叠）在休止位的 AABB 互穿属于低模常态，非致命；仅当模型含可动
  // 关节（revolute/prismatic/...）时互穿才是真问题（运动碰撞）→ 那时才判致命。
  const overlapAdvisories: QcSignal[] = [];

  // ════════════════════════════════════════════════════════════════════
  // ⓪ SSA / 类型校验 + URDF 语义检查（合并自已删除的 g_validate）
  // ════════════════════════════════════════════════════════════════════
  const ssa = validateStatements(geom.statements);
  for (const e of ssa.errors) {
    issues.push(`ssa_error: line ${e.line}: ${e.message}`);
  }

  if (parts.length === 0) {
    issues.push(
      'no_part: geometry has no part; URDF will only contain auto-wrapped orphan shapes ' +
        '(which is fine for preview, but no real assembly)',
    );
  }

  const jointParentChild: Array<{ joint: Statement; parentId: string; childId: string }> = [];
  for (const j of joints) {
    const typeArg = j.args.type;
    if (typeArg && typeArg.kind === 'string' && !URDF_JOINT_TYPES.has(typeArg.value)) {
      issues.push(
        `joint_invalid_type: line ${j.line}: joint "${j.id}" has unknown type "${typeArg.value}" ` +
          `(URDF allows: ${[...URDF_JOINT_TYPES].join('/')})`,
      );
    }

    const pRef = j.args.parent;
    const cRef = j.args.child;
    if (pRef && pRef.kind === 'ref') {
      const target = byId.get(pRef.name);
      if (target && target.op !== 'part') {
        issues.push(
          `joint_endpoint_not_part: line ${j.line}: joint "${j.id}" parent "${pRef.name}" is op "${target.op}", expected "part"`,
        );
      }
      if (cRef && cRef.kind === 'ref') {
        const ctarget = byId.get(cRef.name);
        if (ctarget && ctarget.op !== 'part') {
          issues.push(
            `joint_endpoint_not_part: line ${j.line}: joint "${j.id}" child "${cRef.name}" is op "${ctarget.op}", expected "part"`,
          );
        }
        jointParentChild.push({ joint: j, parentId: pRef.name, childId: cRef.name });
      }
    }
  }

  // 简单成环检测：把 (parent, child) 当有向边，从每条边的 parent 出发反向 BFS
  // 祖先链，若能绕回 child 自身就是环。
  const childToParents = new Map<string, string[]>();
  for (const { parentId, childId } of jointParentChild) {
    if (!childToParents.has(childId)) childToParents.set(childId, []);
    childToParents.get(childId)!.push(parentId);
  }
  for (const { joint, parentId, childId } of jointParentChild) {
    const seen = new Set<string>([childId]);
    const stack = [parentId];
    let cycle = false;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (seen.has(cur)) { cycle = true; break; }
      seen.add(cur);
      const ps = childToParents.get(cur);
      if (ps) for (const p of ps) stack.push(p);
    }
    if (cycle) {
      issues.push(`joint_cycle: line ${joint.line}: joint "${joint.id}" introduces a cycle (${childId} ↔ ${parentId})`);
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ① 连通分量（孤岛检测）
  // ════════════════════════════════════════════════════════════════════
  const partIds = parts.map(p => p.id);
  const islands = countIslands(partIds, joints);
  // 无 joint 的纯摆放场景（PART C）：每个 part 各自是根，islands>1 是预期行为，
  // auto-stitch 会缝成单根树 —— 不算缺陷，也不应 fail valid。
  if (joints.length > 0 && parts.length > 1 && islands > 1) {
    const components = listComponents(partIds, joints);
    issues.push(
      `islands: ${islands} disconnected component(s) — URDF requires a single root tree. ` +
        `components: ${components.map(c => `[${c.join(', ')}]`).join(' | ')}. ` +
        `add fixed/revolute joints to stitch them.`,
    );
  }

  // 正向运动学：沿 joint 树累计每个 part 的世界变换。建筑拼装流程通常
  // 把元素摆位编码在 joint.origin 而非 part.origin —— 不做 FK
  // 会把所有 part 误判为堆在世界原点（假 aabb_overlap），并把"墙立在楼板上"
  // 误判为 joint 远离父级（假 joint_attaches_distant_child）。所有 joint 都在
  // 原点（摆位写在 part.origin）时 FK = 恒等，与旧行为逐字节一致（向后兼容）。
  const worldXform = computeWorldTransforms(parts, joints);

  // ════════════════════════════════════════════════════════════════════
  // ② AABB 解析（part → shape），并按 part.origin/rpy + joint-FK 摆到世界帧
  // ════════════════════════════════════════════════════════════════════
  const partAabbs = new Map<string, PartAabbWorld>();
  let missingAabb = 0;
  for (const part of parts) {
    const local = localAabbFromPart(part, byId);
    if (!local) {
      missingAabb++;
      const shapeRef = part.args.shape;
      const shapeName =
        shapeRef && shapeRef.kind === 'ref' ? shapeRef.name : '<no shape ref>';
      const shape = shapeRef && shapeRef.kind === 'ref' ? byId.get(shapeRef.name) : undefined;
      const opLabel = shape ? shape.op : '<unknown>';
      issues.push(
        `aabb_missing: part "${part.id}" → shape "${shapeName}" (op="${opLabel}") cannot be reduced to an AABB. ` +
          `mesh shapes / unregistered ops do not support placement / inertia / collision auto-derivation.`,
      );
      continue;
    }
    const origin = readVec3(part.args.origin) ?? [0, 0, 0];
    const rpy = readVec3(part.args.rpy) ?? [0, 0, 0];
    // 1) part.origin/rpy：visual 在 link 内的偏移；2) joint-FK：link 在世界中的位姿
    const linkLocal = transformAabbByOriginRpy(local, origin, rpy);
    const w = worldXform.get(part.id) ?? IDENTITY_XFORM;
    const world = transformAabbByMatOrigin(linkLocal, w.rot, w.origin);
    partAabbs.set(part.id, { aabb: world, origin });
  }

  // ════════════════════════════════════════════════════════════════════
  // ③ joint origin 距 parent / child AABB 异常远（在世界帧比较）
  // ════════════════════════════════════════════════════════════════════
  for (const j of joints) {
    if (allowJoints.has(j.id)) continue;
    const parentRef = j.args.parent;
    const childRef = j.args.child;
    if (
      !parentRef ||
      parentRef.kind !== 'ref' ||
      !childRef ||
      childRef.kind !== 'ref'
    ) {
      continue; // 上面 ⓪ 已报（joint_endpoint_not_part 等）；这里只关心几何
    }
    const parentBox = partAabbs.get(parentRef.name);
    const childBox = partAabbs.get(childRef.name);
    if (!parentBox || !childBox) continue;

    // fixed 关节：远离父级是合法摆位（静态装配）→ note；可动关节 → error。
    const jointType = readString(j.args.type) ?? 'fixed';
    const isMovingJoint = jointType !== 'fixed';
    const pushJointSignal = (code: string, message: string): void => {
      if (isMovingJoint) {
        issues.push(`${code}: ${message}`);
      } else {
        jointHeuristicSignals.push({ code, severity: 'note', message: `${message} (fixed joint — treated as intentional static placement)` });
      }
    };

    // joint.origin 在 parent-local 帧；先用 parent 的世界变换抬到世界帧再比较。
    const jointOriginLocal = readVec3(j.args.origin) ?? [0, 0, 0];
    const pW = worldXform.get(parentRef.name) ?? IDENTITY_XFORM;
    const jointOriginWorld = addVec(pW.origin, mat3Vec3(pW.rot, jointOriginLocal));

    const parentDist = pointAabbDistance(jointOriginWorld, parentBox.aabb);
    if (parentDist > jointOriginTol) {
      pushJointSignal(
        'joint_origin_far_from_parent',
        `joint "${j.id}" origin=[${fmt3(jointOriginLocal)}] ` +
          `is ${fmt(parentDist)}m outside parent "${parentRef.name}" AABB (tol=${fmt(jointOriginTol)}m). ` +
          `usually means the joint origin is given in world frame instead of parent local frame.`,
      );
    }

    // child 世界 AABB（FK 已含 joint 摆位）与 parent 世界 AABB 的最近间距。
    // 连接良好的相邻件应贴合（≈0）；墙立在楼板上 → 间距 0，不再误报。
    // 仅当 child 被整体甩离父级（典型：joint.origin 误填世界坐标导致双重平移）才触发。
    const childToParent = aabbAabbDistance(childBox.aabb, parentBox.aabb);
    if (childToParent > jointOriginTol * 4) {
      pushJointSignal(
        'joint_attaches_distant_child',
        `joint "${j.id}" places child "${childRef.name}" ` +
          `${fmt(childToParent)}m away from parent "${parentRef.name}" AABB (tol=${fmt(jointOriginTol * 4)}m). ` +
          `consider g_align_centers / g_place_on_surface to compute origin first.`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ④ 兄弟 part rest-pose AABB 重叠（sibling pair-wise interpenetration）
  //
  //    重叠**一律不 fail valid** —— 低模里少量 AABB 交叠（墙角/T 形接头/嵌框/门扇落位/
  //    楼梯井…）很常见，agent 不应为了消 overlap 去硬挪 part 或摘 joint（那会制造
  //    真正该修的孤立 part）。信号分级：
  //      · 刚性子树内交叠 → note（纯信息，默认忽略）
  //      · 运动学路径上有非 fixed joint 的交叠 → warning（视情况审查，仍不 fail valid）
  //    用 `allow_pairs` 白名单或 `g_metrics max_penetration/overlap_ratio` 辅助判断。
  // ════════════════════════════════════════════════════════════════════
  let overlapCount = 0;
  if (checkOverlaps) {
    const motionEdges = buildJointMotionEdges(joints);
    const ids = Array.from(partAabbs.keys()).sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = partAabbs.get(ids[i])!;
        const b = partAabbs.get(ids[j])!;
        const depth = aabbOverlapDepth(a.aabb, b.aabb);
        if (depth[0] > overlapTol && depth[1] > overlapTol && depth[2] > overlapTol) {
          if (pairAllowed(ids[i], ids[j], allowPairs)) continue;
          overlapCount++;
          const minDepth = Math.min(depth[0], depth[1], depth[2]);
          const movesRelative = partsMoveRelativeToEachOther(ids[i], ids[j], motionEdges);
          const message =
            `aabb_overlap: parts "${ids[i]}" and "${ids[j]}" interpenetrate in rest pose ` +
            `(min depth=${fmt(minDepth)}m, tol=${fmt(overlapTol)}m). ` +
            (movesRelative
              ? `these parts move relative to each other through a non-fixed joint — review if this is a real ` +
                `collision risk or an intentional rest pose (e.g. door leaf parked in frame). do NOT detach or ` +
                `reposition parts just to silence this — that creates isolated parts. note: AABB-only check, ` +
                `conservative for rotated meshes.`
              : `rigidly linked (fixed joints only) — likely a benign low-poly overlap (corner/T-joint/embedded ` +
                `frame/stair well), not a defect. whitelist with allow_pairs if intentional, or check ` +
                `g_metrics max_penetration/overlap_ratio if unsure. note: AABB-only check, conservative for rotated meshes.`);
          overlapAdvisories.push({
            code: 'aabb_overlap',
            severity: movesRelative ? 'warning' : 'note',
            ids: [ids[i], ids[j]],
            message,
          });
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  // ⑤ 几何丰富度信号（非致命警告，「QC 作为传感器」闸门）
  //    判据只看「形状」：模型里**所有** shape 都是裸 primitive
  //    （box/cylinder/sphere/...），完全没有任何富几何 —— 即没有 CSG 实体
  //    (extrude/revolve/loft/union/difference/...)、没有 Parts（含齿轮）/Architecture
  //    语义件、也没有引用 Phase-1 烘焙细节的 mesh —— 多半是"堆方块"反模式。
  //    **是否用 g_part / g_joint 组装无关**：把一堆 box 包成 part 再连 joint
  //    依然是堆方块，旧逻辑因此漏报，这里改为只要"全是裸 primitive"就警告。
  //    纯摆放 transform / 2D profile / material 等辅助语句都不算富几何。
  //    不计入 issue / 不改 valid，只追加一行 report + 暴露 primitive_only。
  // ════════════════════════════════════════════════════════════════════
  const primitiveCount = geom.statements.filter(s => BARE_PRIMITIVE_OPS.has(s.op)).length;
  const hasRichShape = geom.statements.some(
    s =>
      !BARE_PRIMITIVE_OPS.has(s.op) &&
      !TRANSFORM_OPS.has(s.op) &&
      !SKETCH_OPS.has(s.op) &&
      !NON_SHAPE_AUX_OPS.has(s.op),
  );
  const primitiveOnly = primitiveCount > 0 && !hasRichShape;

  // 非致命建议（不影响 valid，但进入 report + structured signals）
  const advisories: QcSignal[] = [...jointHeuristicSignals, ...overlapAdvisories];

  if (primitiveOnly) {
    advisories.push({
      code: 'primitive_only',
      severity: 'warning',
      message:
        `model is ${primitiveCount} bare primitive shape(s) with no rich geometry at all ` +
        `(no CSG solid, no Parts (incl. gears)/Architecture, no baked mesh) — ` +
        `even wrapped in g_part + g_joint this is still a "stacked boxes" decomposition. ` +
        `model each part for real first (g_difference/g_revolve/... or a semantic Parts op such as a gear, ` +
        `bake it with g_bake_part), then assemble those meshes with g_mesh + g_part + g_joint_*.`,
    });
  }

  // ⑥ 悬空件：有 joint 时，未被任何 joint 连接到根树的 part（无关节路径到根）
  //    → 致命 error：URDF 只渲染根连通树，这些 part 会被静默丢弃。这才是关节要修的硬伤。
  const floating = findFloatingLinks(parts, joints);
  if (floating.length > 0) {
    issues.push(
      `floating_link: ${floating.length} part(s) have no joint path to the root: [${floating.join(', ')}]. ` +
        `URDF only renders the root-connected tree, so these will be dropped at runtime — ` +
        `attach them with g_joint_* (fixed/revolute/...). do NOT "fix" overlap warnings by detaching parts.`,
    );
  }

  // ⑦ 孤立 profile：profile_* 未被任何下游消费（extrude/loft/revolve/part/...）
  const referenced = collectAllRefs(geom.statements);
  const orphanProfiles = geom.statements
    .filter(s => PROFILE_OPS.has(s.op) && !referenced.has(s.id))
    .map(s => s.id);
  if (orphanProfiles.length > 0) {
    advisories.push({
      code: 'orphan_profile',
      severity: 'warning',
      ids: orphanProfiles,
      message:
        `${orphanProfiles.length} profile(s) are not consumed by extrude/loft/revolve/part: ` +
        `[${orphanProfiles.join(', ')}]. a lone profile bakes to a ~2mm preview slab — ` +
        `feed it into g_extrude / g_loft / g_revolve or remove it.`,
    });
  }

  // ⑧ revolve 喂入 XY 语义 profile（被误读为 r,z → 静默错误回转体）
  const revolveXy: string[] = [];
  for (const s of geom.statements) {
    if (s.op !== 'revolve') continue;
    const pr = s.args.profile;
    if (!pr || pr.kind !== 'ref') continue;
    const src = byId.get(pr.name);
    if (src && XY_PROFILE_OPS.has(src.op)) revolveXy.push(`${s.id}←${src.id}(${src.op})`);
  }
  if (revolveXy.length > 0) {
    advisories.push({
      code: 'revolve_xy_profile',
      severity: 'warning',
      message:
        `revolve consumes XY-centered profile(s): [${revolveXy.join(', ')}]. ` +
        `revolve treats profile points as (r,z); an origin-centered rect/circle has negative r and will ` +
        `error or produce a wrong solid of revolution. author a dedicated r,z profile with all r>=0.`,
    });
  }

  // ⑨ mesh-backed 布尔误用：union/difference/intersection 操作数（穿透 transform）
  //    最终落到 pipe/sweep/section_loft/rock → baker 会抛 "boolean on mesh-backed" 错。
  const meshBoolMisuse: string[] = [];
  for (const s of geom.statements) {
    if (!BOOLEAN_OPS.has(s.op)) continue;
    const operandArgs = ['a', 'b', 'base', 'tool'];
    for (const key of operandArgs) {
      const ref = s.args[key];
      if (!ref || ref.kind !== 'ref') continue;
      const meshSrc = resolveMeshBackedSource(ref.name, byId, new Set());
      if (meshSrc) meshBoolMisuse.push(`${s.id}.${key}←${meshSrc}`);
    }
  }
  if (meshBoolMisuse.length > 0) {
    advisories.push({
      code: 'mesh_boolean_misuse',
      severity: 'error',
      message:
        `boolean op operand(s) resolve to mesh-backed pipe/sweep/section_loft/rock: [${meshBoolMisuse.join(', ')}]. ` +
        `union/difference/intersection cannot consume triangle meshes and the baker will throw. ` +
        `build the boolean from solids (box/cylinder/sphere/extrude/loft/revolve) instead.`,
    });
  }

  // ── 汇总 structured signals（fatal issues → error；advisories 各自 severity） ──
  const signals: QcSignal[] = [];
  for (const issue of issues) {
    const code = issue.slice(0, issue.indexOf(':'));
    signals.push({ code: code || 'issue', severity: 'error', message: issue });
  }
  for (const a of advisories) signals.push(a);
  // mesh_boolean_misuse 虽走 advisory 列表，但语义是致命的 → 计入 valid 判定
  const fatalAdvisories = advisories.filter(a => a.severity === 'error');

  const reportLines = [...issues, ...advisories.map(a => `${a.code}: ${a.message}`)];

  const valid = issues.length === 0 && fatalAdvisories.length === 0;
  return {
    geometry: geom,
    valid,
    report: reportLines.join('\n'),
    count: issues.length + fatalAdvisories.length,
    islands,
    missing_aabb: missingAabb,
    overlaps: overlapCount,
    primitive_only: primitiveOnly,
    floating_links: floating.length,
    orphan_profiles: orphanProfiles.length,
    signals,
  };
}

/** 收集所有语句 args 里出现过的 ref name（用于孤立 profile 检测）。 */
function collectAllRefs(statements: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  const walk = (arg: Arg | undefined): void => {
    if (!arg) return;
    if (arg.kind === 'ref') out.add(arg.name);
    else if (arg.kind === 'list') for (const it of arg.items) walk(it);
  };
  for (const s of statements) for (const a of Object.values(s.args)) walk(a);
  return out;
}

/**
 * 悬空件：有 joint 时，从未出现在任何 joint parent/child 里的 part。
 * URDF 只渲染 joint 连通树里的 link —— 完全没挂 joint 的 part 会被静默丢弃。
 * （与 islands 不同：islands 是 joint 图的多连通分量；floating 是"压根没接线"的 part。）
 */
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

/**
 * 从一个 ref name 出发，穿透单输入 transform op，判断其几何源是否 mesh-backed
 * (pipe/sweep/section_loft/rock)。是 → 返回该源的 "id(op)"；否则 undefined。
 */
function resolveMeshBackedSource(
  name: string,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): string | undefined {
  if (visiting.has(name)) return undefined;
  visiting.add(name);
  const s = byId.get(name);
  if (!s) return undefined;
  if (MESH_BACKED_OPS.has(s.op)) return `${s.id}(${s.op})`;
  if (TRANSFORM_OPS.has(s.op)) {
    // 透传第一个 shape ref（translate/rotate/... 的 shape 参数）
    for (const key of ['shape', 'a', 'base', 'input']) {
      const ref = s.args[key];
      if (ref && ref.kind === 'ref') {
        const r = resolveMeshBackedSource(ref.name, byId, visiting);
        if (r) return r;
      }
    }
  }
  if (BOOLEAN_OPS.has(s.op)) {
    for (const key of ['a', 'b', 'base', 'tool']) {
      const ref = s.args[key];
      if (ref && ref.kind === 'ref') {
        const r = resolveMeshBackedSource(ref.name, byId, visiting);
        if (r) return r;
      }
    }
  }
  return undefined;
}

// ════════════════════════════════════════════════════════════════════
// 连通分量（union-find）
// ════════════════════════════════════════════════════════════════════

function countIslands(partIds: readonly string[], joints: readonly Statement[]): number {
  return listComponents(partIds, joints).length;
}

function listComponents(
  partIds: readonly string[],
  joints: readonly Statement[],
): string[][] {
  if (partIds.length === 0) return [];
  const parent = new Map<string, string>();
  for (const id of partIds) parent.set(id, id);

  const find = (x: string): string => {
    let cur = x;
    while (parent.get(cur)! !== cur) cur = parent.get(cur)!;
    // 路径压缩
    let p = x;
    while (parent.get(p)! !== cur) {
      const next = parent.get(p)!;
      parent.set(p, cur);
      p = next;
    }
    return cur;
  };

  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const j of joints) {
    const p = j.args.parent;
    const c = j.args.child;
    if (!p || p.kind !== 'ref' || !c || c.kind !== 'ref') continue;
    if (!parent.has(p.name) || !parent.has(c.name)) continue;
    union(p.name, c.name);
  }

  const groups = new Map<string, string[]>();
  for (const id of partIds) {
    const r = find(id);
    const list = groups.get(r);
    if (list) list.push(id);
    else groups.set(r, [id]);
  }
  return [...groups.values()].map(arr => arr.slice().sort());
}

// ════════════════════════════════════════════════════════════════════
// Arg 读取 / 格式化
//   （FK / AABB 数学抽到 vendor/shared/types/geometry/fk.ts，QC 与 g_metrics 共享）
// ════════════════════════════════════════════════════════════════════

function readString(arg: Arg | undefined): string | undefined {
  if (!arg || arg.kind !== 'string') return undefined;
  return arg.value;
}

function readPositiveNumber(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readStringSet(raw: unknown): Set<string> {
  if (!Array.isArray(raw)) return new Set();
  return new Set(raw.map(v => String(v).trim()).filter(v => v !== ''));
}

function pairAllowed(a: string, b: string, allowed: ReadonlySet<string>): boolean {
  return allowed.has(`${a}:${b}`) || allowed.has(`${b}:${a}`) || allowed.has(`${a},${b}`) || allowed.has(`${b},${a}`);
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Math.abs(n) >= 1e4 || (n !== 0 && Math.abs(n) < 1e-3)) return n.toExponential(3);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

function fmt3(v: Vec3): string {
  return v.map(fmt).join(', ');
}

export default gGeometryQc;
