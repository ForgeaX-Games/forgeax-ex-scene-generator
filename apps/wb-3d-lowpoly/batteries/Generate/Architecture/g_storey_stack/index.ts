/**
 * g_storey_stack —— 标准层复制：把已建好的一层整体沿 Z 复制成多层。
 *
 * 高层 / 塔楼的标准层是逐字重复的，手写几十遍同样的 wall/slab/column + joint 既费 token
 * 又极易在层号算术上出错。这个电池让你只建**一层**，然后用一行 DSL 把它当作一个整体复制上去：
 *
 *   lv = storey_stack(parts=[p_slab, p_w1, p_w2, p_c1], root=p_slab,
 *                     count=8, storey_height=3.2)
 *   j_roof = joint(type="fixed", parent=lv, child=p_roof, origin=[0, 0, 3.2])
 *
 * ── mode="merge"（默认，轻形态）────────────────────────────────────────────
 * 把这一层的**全部构件烘成单个多材质 GLB**，然后每层只放**一个** part 引用它：
 * 20 层塔楼从 600 个 part 降到 20 个。做法是先沿层内 joint 做一遍正向运动学，把每件
 * 构件的位姿展平到"层根坐标系"，交给 `baker.bakeColoredAssembly` 烘出一张
 * `<sha>.glb`（逐件颜色内嵌进网格），再把原来那一层的 part / 层内 joint 从 Geometry 里
 * **摘掉**，换成 N 个 `part(shape=mesh(<sha>.glb))`。整栋楼只烘一次、只有一份网格数据，
 * N 层共享同一个 `<sha>.glb`。引用它的 part 一律**不上 material**，否则 viewer 会用
 * link 材质盖掉内嵌的逐件颜色。
 *
 * ── mode="instance"（图级实例化，保留逐件可寻址）───────────────────────────
 * 不烘焙，改为逐层复制 `part` / `joint` 行（与 g_bone_chain 同范式）。副本引用同一批
 * shape / material 语句，因此同一个 `<sha>.obj` 被 N 层共用、不重烘、每件材质保留，
 * 但 part 数是 merge 模式的 N 倍。**需要单独寻址某一层的某一件时才用**：给某层的门挂
 * revolute、给某件单独做碰撞体、后续要改某一层的局部构件。
 *
 * 两种模式下层间关系的处理一致（按整段 Geometry 里有没有 `joint` 自动判定，与编译器的
 * 三路管线判定同源）：
 *   - 关节路（有 joint / URDF）：层与层之间补一条 `joint(type="fixed", origin=[0,0,层高])`，
 *     整棵树仍然只有一个根。
 *   - 静态路（无 joint）：不生成 joint，改为把每层 part 的 `origin` 抬高 Δz。
 *
 * 静态路上 merge 出来的 mesh 引用件与手写的真形状件（屋顶、雨棚…）可以自由混用：编译器
 * 只要看到任一真形状 part 就仍会插入 g_bake_object（并传 include_mesh_parts=false），
 * 真形状件进合并 GLB、mesh 引用件各自作为一条场景 item，两边都不会被丢掉。
 *
 * 输出 id 指向**最高层**，可直接作为屋顶 / 女儿墙的 joint parent（静态路则直接给屋顶
 * part 写绝对 origin，或用 place_local 把它摆到最高层上）。
 * 额外输出 `level_roots` = 各层根 part 的 id（JSON 数组，含最底层）。
 */

import {
  addVec,
  computeWorldTransforms,
  geometryFromStatements,
  IDENTITY_XFORM,
  isValidId,
  makeGeometry,
  mat3Mul,
  mat3ToRpy,
  mat3Vec3,
  numList,
  parseGeometryPort,
  readVec3,
  ref,
  rpyToMat3,
  str,
  type Arg,
  type Geometry,
  type Statement,
  type Vec3,
} from '../../../../vendor/dist/shared/types/index.js';

interface ColoredAssemblyPartInput {
  shapeId: string;
  rgba: [number, number, number, number];
  origin?: [number, number, number];
  rpy?: [number, number, number];
  metalness?: number;
  roughness?: number;
}
interface BakeResultShape {
  url: string;
  sha256: string;
  vertexCount: number;
  triangleCount: number;
  cacheHit: boolean;
  bboxMin?: [number, number, number];
  bboxMax?: [number, number, number];
}
interface BakerHandle {
  bakeColoredAssembly?(
    parts: readonly ColoredAssemblyPartInput[],
    geometry: Geometry,
  ): Promise<BakeResultShape>;
}
interface CtxLike {
  services?: { baker?: BakerHandle };
}

/** g_bake_object 的同款缺省灰：part 没接 material 时用它，保证烘出来的面不是黑的。 */
const DEFAULT_RGBA: [number, number, number, number] = [0.7, 0.7, 0.7, 1];

export async function gStoreyStack(
  input: Record<string, unknown>,
  ctx?: CtxLike,
): Promise<Record<string, unknown>> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => out(incoming, '', [], null, error);

  const mode = readMode(input.mode);
  if (!mode) return fail(`storey_stack: mode must be "merge" (one baked GLB per storey) or "instance" (copy every part), got "${String(input.mode)}"`);

  const partIds = readIdList(input.part_ids ?? input.parts);
  if (partIds.length === 0) {
    return fail('storey_stack requires parts=[p1, p2, ...] — the part ids that make up the storey being repeated');
  }

  const byId = new Map(incoming.statements.map((s) => [s.id, s]));
  const partSet = new Set(partIds);
  if (partSet.size !== partIds.length) {
    return fail('storey_stack: parts lists the same part id more than once');
  }
  const partStmts: Statement[] = [];
  for (const id of partIds) {
    const stmt = byId.get(id);
    if (!stmt) return fail(`storey_stack: parts references undefined id "${id}"`);
    if (stmt.op !== 'part') return fail(`storey_stack: parts must reference part statements, but "${id}" is op "${stmt.op}"`);
    partStmts.push(stmt);
  }

  // 层内关节 = parent 与 child 都落在本层构件里的 joint（跨层 / 挂到外部的关节不属于本层）。
  const internalJoints = incoming.statements.filter(
    (s) =>
      s.op === 'joint' &&
      s.args.parent?.kind === 'ref' && partSet.has(s.args.parent.name) &&
      s.args.child?.kind === 'ref' && partSet.has(s.args.child.name),
  );
  const jointed = incoming.statements.some((s) => s.op === 'joint');

  const rootId = resolveRoot(readId(input.root_id ?? input.root), partIds, internalJoints);
  if (!partSet.has(rootId)) {
    return fail(`storey_stack: root "${rootId}" must be one of the ids listed in parts`);
  }

  // 关节路要求这一层本身是一棵以 root 为根的自洽子树：否则 instance 模式会产出接不回根的
  // 构件（下游 QC 直接报致命的 floating_link），merge 模式则会把它按恒等位姿烘错位置。
  if (jointed) {
    const reached = reachableFrom(rootId, internalJoints);
    const stranded = partIds.filter((id) => !reached.has(id));
    if (stranded.length > 0) {
      return fail(
        `storey_stack: ${stranded.join(', ')} have no fixed-joint path to root "${rootId}" within this storey. ` +
          'List every part of the storey and wire them into one subtree rooted at root before repeating it.',
      );
    }
  }

  const plan = readLevelPlan(input);
  if ('error' in plan) return fail(plan.error);

  const rawPrefix = readId(input.prefix ?? input.id) || 'lv';
  if (!isValidId(rawPrefix)) return fail(`storey_stack: invalid prefix "${rawPrefix}" (must match [A-Za-z_][A-Za-z0-9_]*)`);

  const shared = { incoming, partIds, partSet, partStmts, internalJoints, jointed, rootId, plan, prefix: rawPrefix, byId };
  return mode === 'merge' ? mergeStoreys(shared, ctx) : instanceStoreys(shared);
}

interface Shared {
  incoming: Geometry;
  partIds: string[];
  partSet: Set<string>;
  partStmts: Statement[];
  internalJoints: Statement[];
  jointed: boolean;
  rootId: string;
  plan: LevelPlan;
  prefix: string;
  byId: Map<string, Statement>;
}

// ════════════════════════════════════════════════════════════════════════════
// mode="merge" —— 一层烘成一个多材质 GLB，每层只剩 1 个 part
// ════════════════════════════════════════════════════════════════════════════

async function mergeStoreys(s: Shared, ctx?: CtxLike): Promise<Record<string, unknown>> {
  const { incoming, partSet, partStmts, internalJoints, jointed, rootId, plan, prefix, byId } = s;
  const fail = (error: string): Record<string, unknown> => out(incoming, '', [], null, error);

  const baker = ctx?.services?.baker;
  if (!baker?.bakeColoredAssembly) {
    return fail('storey_stack: mode="merge" needs baker.bakeColoredAssembly on ctx.services.baker to fuse the storey into one GLB; pass mode="instance" to expand without baking');
  }

  const consumed = new Set<string>([...partSet, ...internalJoints.map((st) => st.id)]);

  // 合并后整层只剩一个 link，层内构件不再单独可寻址 —— 外部关节只能挂在层根上。
  for (const stmt of incoming.statements) {
    if (stmt.op !== 'joint' || consumed.has(stmt.id)) continue;
    for (const side of ['parent', 'child'] as const) {
      const a = stmt.args[side];
      if (a?.kind !== 'ref' || !partSet.has(a.name) || a.name === rootId) continue;
      return fail(
        `storey_stack: joint "${stmt.id}" attaches to "${a.name}", which mode="merge" folds into the storey mesh — ` +
          `it stops being an addressable link. Re-parent that joint onto root "${rootId}", or pass mode="instance".`,
      );
    }
  }

  // 层内 joint 决定构件位姿，而合并后的 GLB 里没有关节可言：先跑一遍正向运动学，
  // 把每件的 link 位姿与它自身的 origin/rpy 叠成"相对层根"的单一位姿再交给 baker。
  const world = computeWorldTransforms(partStmts, internalJoints);
  const assembly: ColoredAssemblyPartInput[] = [];
  for (const p of partStmts) {
    const shapeRef = p.args.shape;
    if (!shapeRef || shapeRef.kind !== 'ref') return fail(`storey_stack: part "${p.id}" is missing a shape ref`);
    const shapeStmt = byId.get(shapeRef.name);
    if (!shapeStmt) return fail(`storey_stack: part "${p.id}" references unknown shape "${shapeRef.name}"`);

    const mat = readMaterial(p.args.material, byId);
    if (mat.textured) {
      return fail(
        `storey_stack: part "${p.id}" uses a textured material, which mode="merge" cannot bake yet. ` +
          'Use a flat-colour material for the repeated storey, or pass mode="instance".',
      );
    }

    const w = world.get(p.id) ?? IDENTITY_XFORM;
    const localOrigin = readVec3(p.args.origin) ?? [0, 0, 0];
    const localRpy = readVec3(p.args.rpy) ?? [0, 0, 0];
    assembly.push({
      shapeId: shapeRef.name,
      rgba: mat.rgba,
      origin: roundVec(addVec(w.origin, mat3Vec3(w.rot, localOrigin))),
      rpy: roundVec(mat3ToRpy(mat3Mul(w.rot, rpyToMat3(localRpy)))),
      ...(mat.metalness !== undefined ? { metalness: mat.metalness } : {}),
      ...(mat.roughness !== undefined ? { roughness: mat.roughness } : {}),
    });
  }

  let baked: BakeResultShape;
  try {
    baked = await baker.bakeColoredAssembly(assembly, incoming);
  } catch (e) {
    return fail(`storey_stack: storey bake failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const meshId = `${prefix}_mesh`;
  const levelIds = plan.absolute.map((_, i) => `${prefix}_l${i + 2}`);
  levelIds.unshift(`${prefix}_l1`);

  const surviving = new Set(
    incoming.statements.filter((st) => !consumed.has(st.id)).map((st) => st.id),
  );
  for (const id of [meshId, ...levelIds, ...levelIds.slice(1).map((_, i) => `${prefix}_j${i + 2}`)]) {
    if (surviving.has(id)) return fail(`storey_stack: generated id "${id}" already exists — pass a different prefix`);
  }

  const inserted: Statement[] = [
    mk(meshId, 'mesh', {
      filename: str(baked.url),
      ...(baked.bboxMin && baked.bboxMax
        ? { bbox_min: numList(roundVec(baked.bboxMin)), bbox_max: numList(roundVec(baked.bboxMax)) }
        : {}),
    }),
  ];
  for (let i = 0; i < levelIds.length; i++) {
    // 内嵌逐件颜色只有在 link 不覆盖材质时才显示，所以这些 part 一律不接 material。
    inserted.push(mk(levelIds[i]!, 'part', {
      shape: ref(meshId),
      ...(jointed || i === 0 ? {} : { origin: numList([0, 0, plan.absolute[i - 1]!]) }),
    }));
    if (jointed && i > 0) {
      inserted.push(mk(`${prefix}_j${i + 1}`, 'joint', {
        type: str('fixed'),
        parent: ref(levelIds[i - 1]!),
        child: ref(levelIds[i]!),
        origin: numList([0, 0, plan.steps[i - 1]!]),
      }));
    }
  }

  // 原来挂在层根上的外部关节改挂最底层的合并 part —— GLB 的坐标系就是层根坐标系，
  // 关节 origin 不用动。
  const remap = (stmt: Statement): Statement =>
    stmt.op === 'joint' ? remapJointRefs(stmt, rootId, levelIds[0]!) : stmt;

  // 合并后这一层的 shape / material 语句多半没人再引用了，但 g_to_urdf 会把**每一条**
  // 顶层 composite shape 都送去烘焙 —— 留着它们等于每次 apply 白烘一遍整层的构件。
  // 只摘"原本挂在被吃掉的 part 下、且现在再没别处引用"的那些。
  const kept = incoming.statements.filter((stmt) => !consumed.has(stmt.id)).map(remap);
  const dead = reachableRefs(partStmts, byId);
  for (const id of reachableRefs([...kept, ...inserted], byId)) dead.delete(id);

  // 新语句插在被摘掉的第一条语句处，保证引用它们的行（重挂到 l1 的外部关节）仍在其后。
  const rebuilt: Statement[] = [];
  let spliced = false;
  for (const stmt of incoming.statements) {
    if (consumed.has(stmt.id)) {
      if (!spliced) rebuilt.push(...inserted);
      spliced = true;
      continue;
    }
    if (dead.has(stmt.id)) continue;
    rebuilt.push(remap(stmt));
  }
  if (!spliced) rebuilt.push(...inserted);

  const geom = geometryFromStatements(rebuilt, {
    previous: incoming,
    focus: levelIds[levelIds.length - 1],
  });

  const note =
    `merged ${partStmts.length} part${partStmts.length === 1 ? '' : 's'} into one storey GLB → ${baked.url}` +
    `${baked.cacheHit ? ' (cache hit)' : ''}; ${levelIds.length} storeys now cost ${levelIds.length} parts ` +
    `instead of ${partStmts.length * levelIds.length}.`;
  return out(geom, levelIds[levelIds.length - 1]!, levelIds, baked, '', note);
}

// ════════════════════════════════════════════════════════════════════════════
// mode="instance" —— 图级实例化，逐层复制 part / joint
// ════════════════════════════════════════════════════════════════════════════

function instanceStoreys(s: Shared): Record<string, unknown> {
  const { incoming, partStmts, internalJoints, jointed, rootId, plan, prefix } = s;
  const fail = (error: string): Record<string, unknown> => out(incoming, '', [], null, error);

  const used = new Set(incoming.statements.map((st) => st.id));
  const copyId = (level: number, origId: string): string => `${prefix}_l${level}_${origId}`;

  let geom = incoming;
  const levelRoots: string[] = [rootId];
  let prevRoot = rootId;

  for (let i = 0; i < plan.absolute.length; i++) {
    const level = i + 2; // 原始层记为第 1 层
    const thisRoot = copyId(level, rootId);
    const appended: Statement[] = [];

    for (const stmt of partStmts) {
      const id = copyId(level, stmt.id);
      if (used.has(id)) return fail(`storey_stack: generated id "${id}" already exists — pass a different prefix`);
      used.add(id);
      const args = { ...stmt.args };
      // 静态路没有关节可以摆位，副本靠自己的 origin 抬高到本层标高。
      if (!jointed) {
        const o = readVec3(stmt.args.origin) ?? [0, 0, 0];
        args.origin = numList([o[0], o[1], roundNoise(o[2] + plan.absolute[i]!)]);
      }
      appended.push(mk(id, 'part', args));
    }

    if (jointed) {
      for (const stmt of internalJoints) {
        const id = copyId(level, stmt.id);
        if (used.has(id)) return fail(`storey_stack: generated id "${id}" already exists — pass a different prefix`);
        used.add(id);
        appended.push(mk(id, 'joint', {
          ...stmt.args,
          parent: ref(copyId(level, (stmt.args.parent as { name: string }).name)),
          child: ref(copyId(level, (stmt.args.child as { name: string }).name)),
        }));
      }

      const linkId = `${prefix}_j${level}`;
      if (used.has(linkId)) return fail(`storey_stack: generated id "${linkId}" already exists — pass a different prefix`);
      used.add(linkId);
      appended.push(mk(linkId, 'joint', {
        type: str('fixed'),
        parent: ref(prevRoot),
        child: ref(thisRoot),
        origin: numList([0, 0, plan.steps[i]!]),
      }));
    }

    geom = geometryFromStatements([...geom.statements, ...appended], { previous: geom, focus: thisRoot });
    levelRoots.push(thisRoot);
    prevRoot = thisRoot;
  }

  return out(geom, prevRoot, levelRoots, null, '', `expanded ${plan.absolute.length} storey copies (${partStmts.length} parts each) reusing the same shape/material statements`);
}

// ════════════════════════════════════════════════════════════════════════════
// helpers
// ════════════════════════════════════════════════════════════════════════════

function out(
  geometry: Geometry,
  id: string,
  levelRoots: readonly string[],
  baked: BakeResultShape | null,
  error: string,
  note = '',
): Record<string, unknown> {
  return {
    geometry,
    id,
    level_roots: JSON.stringify(levelRoots),
    filename: baked?.url ?? '',
    sha256: baked?.sha256 ?? '',
    vertex_count: baked?.vertexCount ?? 0,
    triangle_count: baked?.triangleCount ?? 0,
    note,
    error,
  };
}

function mk(id: string, op: string, args: Readonly<Record<string, Arg>>): Statement {
  return Object.freeze({ id, op, args: Object.freeze({ ...args }), line: 0 }) as Statement;
}

/** 从一组语句的 args 出发，沿 ref 递归收集所有被引用到的语句 id（不含起点自身）。 */
function reachableRefs(roots: readonly Statement[], byId: ReadonlyMap<string, Statement>): Set<string> {
  const seen = new Set<string>();
  const queue: Arg[] = roots.flatMap((st) => Object.values(st.args));
  while (queue.length > 0) {
    const a = queue.pop()!;
    if (a.kind === 'list') queue.push(...a.items);
    else if (a.kind === 'ref' && !seen.has(a.name)) {
      seen.add(a.name);
      const target = byId.get(a.name);
      if (target) queue.push(...Object.values(target.args));
    }
  }
  return seen;
}

/** 把 joint 里指向 from 的 parent/child 换成 to（合并后层根被单个 mesh part 顶替）。 */
function remapJointRefs(stmt: Statement, from: string, to: string): Statement {
  const parent = stmt.args.parent;
  const child = stmt.args.child;
  const hits = (a: Arg | undefined): boolean => a?.kind === 'ref' && a.name === from;
  if (!hits(parent) && !hits(child)) return stmt;
  return mk(stmt.id, 'joint', {
    ...stmt.args,
    ...(hits(parent) ? { parent: ref(to) } : {}),
    ...(hits(child) ? { child: ref(to) } : {}),
  });
}

function readMode(v: unknown): 'merge' | 'instance' | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === '' || s === 'merge') return 'merge';
  if (s === 'instance') return 'instance';
  return null;
}

/** part.material(ref) → 烘焙需要的 rgba / metalness / roughness，外加"带贴图"标记。 */
function readMaterial(
  materialArg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
): { rgba: [number, number, number, number]; metalness?: number; roughness?: number; textured: boolean } {
  if (materialArg?.kind !== 'ref') return { rgba: DEFAULT_RGBA, textured: false };
  const mat = byId.get(materialArg.name);
  if (!mat || mat.op !== 'material') return { rgba: DEFAULT_RGBA, textured: false };
  const rgba = readNumList(mat.args.rgba, 4);
  const metalness = mat.args.metalness?.kind === 'number' ? clamp01(mat.args.metalness.value) : undefined;
  const roughness = mat.args.roughness?.kind === 'number' ? clamp01(mat.args.roughness.value) : undefined;
  return {
    rgba: rgba ? [clamp01(rgba[0]!), clamp01(rgba[1]!), clamp01(rgba[2]!), clamp01(rgba[3]!)] : DEFAULT_RGBA,
    ...(metalness !== undefined ? { metalness } : {}),
    ...(roughness !== undefined ? { roughness } : {}),
    textured: mat.args.texture?.kind === 'ref',
  };
}

/** 缺省 root = 本层里不作为任何层内关节 child 的那件（即这棵子树的根）。 */
function resolveRoot(explicit: string, partIds: string[], internalJoints: readonly Statement[]): string {
  if (explicit) return explicit;
  const children = new Set(
    internalJoints.map((s) => (s.args.child as { name: string }).name),
  );
  return partIds.find((id) => !children.has(id)) ?? partIds[0]!;
}

/** 从 root 出发沿层内关节（parent → child）能走到的 part 集合。 */
function reachableFrom(rootId: string, internalJoints: readonly Statement[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const s of internalJoints) {
    const p = (s.args.parent as { name: string }).name;
    const c = (s.args.child as { name: string }).name;
    const bucket = children.get(p);
    if (bucket) bucket.push(c);
    else children.set(p, [c]);
  }
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    for (const next of children.get(queue.pop()!) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

interface LevelPlan { absolute: number[]; steps: number[] }

/**
 * 每个副本的标高计划：显式 levels 优先，否则 count × storey_height 等距。
 *   absolute[i] —— 第 i 个副本相对最底层的 Z 偏移（静态路直接加到 part origin 上）
 *   steps[i]    —— 相对**下一层**的 Z 增量（关节路的层间 joint origin）
 * 两者都过一遍 roundNoise：否则 3×3.2 这类累加会在 DSL 里写出 9.600000000000001。
 */
function readLevelPlan(input: Record<string, unknown>): LevelPlan | { error: string } {
  const levels = readNumberList(input.levels);
  if (levels.length > 0) {
    if (levels[0] === 0) {
      return { error: 'storey_stack: levels are offsets ABOVE the modelled storey, so the first entry must be non-zero' };
    }
    for (let i = 1; i < levels.length; i++) {
      if (levels[i]! <= levels[i - 1]!) {
        return { error: 'storey_stack: levels must be strictly increasing Z offsets (meters) above the modelled storey' };
      }
    }
    const absolute = levels.map(roundNoise);
    return { absolute, steps: absolute.map((z, i) => roundNoise(z - (i === 0 ? 0 : absolute[i - 1]!))) };
  }

  const count = Math.round(Number(input.count ?? 0));
  const storeyHeight = Number(input.storey_height ?? 0);
  if (!Number.isFinite(count) || count < 2) {
    return { error: 'storey_stack: count must be >= 2 (total storeys including the one you modelled)' };
  }
  if (!Number.isFinite(storeyHeight) || storeyHeight <= 0) {
    return { error: 'storey_stack: storey_height must be a positive number of meters' };
  }
  const absolute: number[] = [];
  const steps: number[] = [];
  for (let k = 1; k < count; k++) {
    absolute.push(roundNoise(k * storeyHeight));
    steps.push(storeyHeight);
  }
  return { absolute, steps };
}

/** 抹掉浮点累加噪声（1 nm 以下），让生成的 DSL 里是 9.6 而不是 9.600000000000001。 */
function roundNoise(v: number): number {
  return Math.round(v * 1e9) / 1e9;
}

/** FK 出来的位姿要进 bake 签名，抹噪声才能让同一层在重复 apply 时命中缓存。 */
function roundVec(v: Vec3 | readonly number[]): [number, number, number] {
  return [roundNoise(v[0] ?? 0), roundNoise(v[1] ?? 0), roundNoise(v[2] ?? 0)];
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function readNumList(a: Arg | undefined, n: number): number[] | undefined {
  if (a?.kind !== 'list' || a.items.length !== n) return undefined;
  const outv: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    outv.push(item.value);
  }
  return outv;
}

function readId(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * 读 id 列表。DSL 编译走 refList（已是 string[]）；节点编辑器的字符串端口给的是
 * JSON 数组或逗号/空格分隔的一行，两种都收。
 */
function readIdList(value: unknown): string[] {
  let v = value;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'part_ids' in v) {
    v = (v as { part_ids?: unknown }).part_ids;
  }
  if (typeof v === 'string') {
    const text = v.trim();
    if (text === '') return [];
    if (text.startsWith('[')) {
      try {
        v = JSON.parse(text);
      } catch {
        return [];
      }
    } else {
      return text.split(/[,\s]+/).filter((s) => s !== '');
    }
  }
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((s) => s !== '');
}

function readNumberList(value: unknown): number[] {
  let v = value;
  if (v !== null && typeof v === 'object' && !Array.isArray(v) && 'levels' in v) {
    v = (v as { levels?: unknown }).levels;
  }
  if (typeof v === 'string') {
    const text = v.trim();
    if (text === '') return [];
    try {
      v = JSON.parse(text);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const outv: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (!Number.isFinite(n)) return [];
    outv.push(n);
  }
  return outv;
}

export default gStoreyStack;
