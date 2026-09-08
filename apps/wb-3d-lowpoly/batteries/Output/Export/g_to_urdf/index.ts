/**
 * g_to_urdf —— Geometry DSL → URDF XML 字符串。
 *
 * 翻译规则（v1）：
 *   material(rgba=[r,g,b,a])         → <material name="<id>"><color rgba="r g b a"/></material>
 *   box / cylinder / sphere / mesh   → 暂存到 shape 表，不直接产 XML；由 part 引用时展开
 *   <composite shape op>             → 调 ctx.services.baker.bake() 烘焙成 OBJ，
 *                                       写入 library 后用 <mesh filename="<sha>.obj"/> 引用
 *   part(shape=ref, material=ref?, origin=[x,y,z]?, rpy=[r,p,y]?, mass=?)
 *                                    → <link name="<id>"><visual>... </visual><collision>...</collision>
 *                                       [<inertial mass=.../>]?</link>
 *   joint(type=str, parent=ref, child=ref, origin?, rpy?, axis?, lower?, upper?, effort?, velocity?)
 *                                    → <joint name="<id>" type=...> ... </joint>
 *
 * 容错：
 *   - 未知 op / 缺 ref：写入 <!-- error: ... --> 注释；不抛异常
 *   - composite shape 缺 bake asset（无 baker / 未注册 / bake 抛错）：默认**直接报错**
 *     （`out.error` 含 `BAKE_FALLBACK_USED`，severity=error），不再静默退化成一个看起来
 *     "合理"却错误的 AABB box——这是唯一会让几何本身错误却外观无异样的兜底，所以单独收紧。
 *     显式传 `allow_bake_fallback: true` 才会退回旧的宽松行为：写 fallback box AABB，
 *     夹一行 `<!-- baker error: ... -->` 或 `<!-- no baker registered ... -->`，
 *     severity 降级为 warning。
 */

import {
  isGeometry,
  makeGeometry,
  parseDSL,
  localAabbFromShape,
  localAabbFromShapeInGeometry,
  listBakeableShapeOps,
  listSubgraphBakeOps,
  listUrdfNativeShapeOps,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

// 电池层不能 import backend，所以 ctx 句柄用最小化的局部 interface 复刻。
interface BakerHandle {
  bake(opName: string, args: Record<string, unknown>): Promise<{
    url: string;
    sha256: string;
    vertexCount: number;
    triangleCount: number;
    byteSize: number;
    cacheHit: boolean;
    blobSha256?: string;
  }>;
  bakeGeometryShape?(rootId: string, geometry: Geometry): Promise<{
    url: string;
    sha256: string;
    vertexCount: number;
    triangleCount: number;
    byteSize: number;
    cacheHit: boolean;
    blobSha256?: string;
  }>;
  listBakeableOps(): readonly string[];
}
interface CtxLike {
  services?: { baker?: BakerHandle };
}

type AssetKind = 'static' | 'assembly' | 'mechanism';
type DiagnosticSeverity = 'error' | 'warning' | 'note';

interface UrdfDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  nodeId?: string;
  shapeId?: string;
  partId?: string;
}

interface UrdfStats {
  explicitLinks: number;
  implicitLinks: number;
  explicitJoints: number;
  autoJoints: number;
  bakeFallbacks: number;
  /**
   * 每条 visual / collision 几何的来源追溯（`_mesh_provenance`）。
   * 调试 CSG 链路出错 / 找出哪些 part 走了 AABB fallback 时，直接看这里。
   */
  meshProvenance: MeshProvenanceEntry[];
}

/** 一条 visual 或 collision 几何的来源 */
interface MeshProvenanceEntry {
  /** 'visual' | 'collision'（按 URDF 元素分类） */
  kind: 'visual' | 'collision';
  /** 所属 link id（part id 或 implicit "<shape>_link"） */
  linkId: string;
  /** 直接引用的 shape id（叶子或 CSG 根） */
  shapeId: string;
  /** shape 的 op（box / cylinder / spur_gear / union / extrude / mesh / ...） */
  op: string;
  /**
   * 几何如何到达 URDF：
   *   - 'native'           → URDF 原生 box/cylinder/sphere/mesh，未走 baker
   *   - 'baked_mesh'       → composite shape 由 baker 烘成 OBJ 后写为 <mesh>
   *   - 'aabb_fallback'    → composite shape 烘焙缺失 / 失败，AABB 等效 box 写入
   *   - 'collision_box'    → 显式 collision 语句的内联 box
   *   - 'collision_cyl'    → 显式 collision 语句的内联 cylinder
   *   - 'collision_sphere' → 显式 collision 语句的内联 sphere
   *   - 'collision_shape'  → 显式 collision 语句通过 ref 复用了一个 shape
   *   - 'collision_proxy_box' → 默认碰撞：composite/烘焙网格自动用 AABB 盒代理
   *   - 'error'            → 编译失败（comment 已写入 XML）
   */
  source: MeshProvenanceSource;
  /** baker 失败时的错误说明（source = 'aabb_fallback' / 'error'） */
  error?: string;
}

type MeshProvenanceSource =
  | 'native'
  | 'baked_mesh'
  | 'aabb_fallback'
  | 'collision_box'
  | 'collision_cyl'
  | 'collision_sphere'
  | 'collision_shape'
  // 默认碰撞代理：composite/烘焙网格自动降级成 AABB 盒（非用户显式 collision 语句）
  | 'collision_proxy_box'
  | 'error';

interface CompileOptions {
  strict: boolean;
  allowBakeFallback: boolean;
  allowAutoWrapOrphans: boolean;
  allowAutoStitchRoots: boolean;
  /** 默认碰撞用 AABB 盒代理（true）还是复制完整可视网格（false）。 */
  collisionProxy: boolean;
  assetKind?: AssetKind;
}

interface CompileState {
  options: CompileOptions;
  diagnostics: UrdfDiagnostic[];
  stats: UrdfStats;
  fallbackShapes: Set<string>;
}

// 纯创作 / 元数据 op：不产出任何 URDF，编译期静默忽略（不写 <!-- error --> 注释）。
// `animation`（作者关节轨迹 q(t)）由前端 GLB 烘焙链路消费，URDF 里没有对应元素。
const NON_URDF_OPS = new Set(['animation']);

// 这些 primitive 形状 URDF 原生支持，无需烘焙
const URDF_NATIVE_SHAPES = new Set(listUrdfNativeShapeOps());
const COMPOSITE_BAKE_OPS = new Set(listBakeableShapeOps());
const CSG_SUBGRAPH_BAKE_OPS = new Set(listSubgraphBakeOps());

export async function gToUrdf(
  input: Record<string, unknown>,
  ctx?: CtxLike,
): Promise<Record<string, unknown>> {
  const geom: Geometry =
    isGeometry(input.geometry)
      ? (input.geometry as Geometry)
      : typeof input.source === 'string'
        ? geometryFromInline(input.source)
        : makeGeometry();

  // URDF 规范要求 <robot> 必须有 name 属性。用户没填时按以下顺序回退：
  //   1) 上游 part 的第一个 id        （形状已被 g_part 包过 → 名字更有语义）
  //   2) 上游 shape 的第一个 id       （g_box / g_cylinder / ... 的孤儿场景）
  //   3) "untitled"                  （完全空的 Geometry，纯保底）
  const explicit = String(input.name ?? '').trim();
  const robotName = explicit !== '' ? explicit : deriveDefaultRobotName(geom);
  const options = resolveCompileOptions(input);

  // 1) 先把所有 composite shape 烘成 mesh URL，得到 shapeId → "<sha>.obj" 映射。
  //    单独这一步而不是边编译边烘，是因为同一 shapeId 可能被多次引用（part visual /
  //    collision / 多个 part 共享），统一预烘可保证只算一次 sha 且代码更干净。
  const bakeT0 = Date.now();
  const bakedUrls = await bakeAllComposites(geom, ctx);
  const bakeMs = Date.now() - bakeT0;
  const bakedCount = Array.from(bakedUrls.values()).filter((v) => v.ok).length;
  if (bakedUrls.size > 0) {
    console.debug('[g_to_urdf] bake summary', {
      shapeCount: bakedUrls.size,
      bakedCount,
      failedCount: bakedUrls.size - bakedCount,
      totalBakeMs: bakeMs,
    });
  }

  const result = compileToUrdf(geom, robotName, bakedUrls, options);
  const report = buildCompileReport(bakedUrls, result.diagnostics, result.stats, bakeMs);
  const errorDiagnostics = result.diagnostics.filter(d => d.severity === 'error');
  const out: Record<string, unknown> = {
    urdf: result.xml,
    name: robotName,
    diagnostics: result.diagnostics,
    stats: result.stats,
    report,
  };
  if (errorDiagnostics.length > 0) {
    out.error = errorDiagnostics.map(d => `${d.code}: ${d.message}`).join('\n');
  }
  return out;
}

/**
 * 扫一遍 geom.statements，遇到 composite shape op 就调 baker.bake()，
 * 返回 shapeId → bakeUrl 映射。缺 ctx 或缺 baker 时返回空 Map（下游走 AABB fallback）。
 * 单个 bake 抛错时记 console.warn 跳过，使整张图尽量能渲染出可见的部分。
 */
async function bakeAllComposites(
  geom: Geometry,
  ctx: CtxLike | undefined,
): Promise<Map<string, BakeOutcome>> {
  const out = new Map<string, BakeOutcome>();
  const baker = ctx?.services?.baker;
  if (!baker) return out;

  const bakeable = new Set(baker.listBakeableOps());
  const consumedShapeRefs = collectConsumedShapeRefs(geom.statements);
  const partShapeRefs = collectPartShapeRefs(geom.statements);

  // 收集需要 bake 的 statements，去重（同一 shape 可能被多个 part 引用）
  const toBake: Statement[] = [];
  const seen = new Set<string>();
  for (const s of geom.statements) {
    if (URDF_NATIVE_SHAPES.has(s.op)) continue;
    if (!bakeable.has(s.op) && !isSubgraphBakeOp(s.op)) continue;
    // 被其它 shape op 消费的中间 shape 不会直接进入 URDF，除非用户显式用 part(shape=...)
    // 包装了它。跳过这些中间件可以避免 CSG/transform 链路重复 bake。
    if (consumedShapeRefs.has(s.id) && !partShapeRefs.has(s.id)) continue;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    toBake.push(s);
  }

  if (toBake.length === 0) return out;

  // 并行发起所有 bake 请求。OCCT WASM 是单线程同步的，真正的 CPU 工作仍串行，
  // 但 library 写盘（async I/O）可以重叠，且缓存命中的调用能立即返回不阻塞后续。
  const results = await Promise.allSettled(
    toBake.map((s) => {
      if (isSubgraphBakeOp(s.op)) {
        if (!baker.bakeGeometryShape) {
          throw new Error(`baker does not support geometry-subgraph bake for "${s.op}"`);
        }
        return baker.bakeGeometryShape(s.id, geom);
      }
      return baker.bake(s.op, s.args as Record<string, unknown>);
    }),
  );

  for (let i = 0; i < toBake.length; i++) {
    const s = toBake[i];
    const r = results[i];
    if (r.status === 'fulfilled') {
      out.set(s.id, {
        ok: true,
        url: r.value.url,
        op: s.op,
        vertexCount: r.value.vertexCount,
        triangleCount: r.value.triangleCount,
        byteSize: r.value.byteSize,
        sha256: r.value.sha256,
        cacheHit: r.value.cacheHit,
      });
    } else {
      out.set(s.id, { ok: false, error: (r.reason as Error).message, op: s.op });
    }
  }

  return out;
}

/** 把所有 sha256 排序拼接后做一个轻量 FNV-1a 32-bit 哈希，作为产物指纹。 */
function fingerprintOf(shas: string[]): string {
  const joined = [...shas].sort().join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function buildCompileReport(
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  diagnostics: readonly UrdfDiagnostic[],
  stats: UrdfStats,
  bakeMs: number,
): CompileReport {
  let meshFileCount = 0;
  let meshTotalBytes = 0;
  let totalVertices = 0;
  let totalTriangles = 0;
  let cacheHits = 0;
  const shas: string[] = [];
  for (const v of bakedUrls.values()) {
    if (!v.ok) continue;
    meshFileCount++;
    meshTotalBytes += v.byteSize ?? 0;
    totalVertices += v.vertexCount ?? 0;
    totalTriangles += v.triangleCount ?? 0;
    if (v.cacheHit) cacheHits++;
    if (v.sha256) shas.push(v.sha256);
  }
  const codes: Record<string, number> = {};
  let errors = 0;
  let warnings = 0;
  let notes = 0;
  for (const d of diagnostics) {
    codes[d.code] = (codes[d.code] ?? 0) + 1;
    if (d.severity === 'error') errors++;
    else if (d.severity === 'warning') warnings++;
    else notes++;
  }
  return {
    meshFileCount,
    meshTotalBytes,
    totalVertices,
    totalTriangles,
    bakeMs,
    cacheHits,
    bakeFallbacks: stats.bakeFallbacks,
    fingerprint: fingerprintOf(shas),
    signalBundle: { errors, warnings, notes, codes },
  };
}

interface BakeOutcome {
  ok: boolean;
  url?: string;
  error?: string;
  op?: string;
  vertexCount?: number;
  triangleCount?: number;
  byteSize?: number;
  sha256?: string;
  cacheHit?: boolean;
}

/** compile report —— 供 agent 修复循环消费的结构化交付物。 */
interface CompileReport {
  /** 成功烘成 mesh 的文件数 */
  meshFileCount: number;
  /** 所有 baked mesh 的 OBJ 总字节数 */
  meshTotalBytes: number;
  /** 顶点 / 三角面合计 */
  totalVertices: number;
  totalTriangles: number;
  /** 烘焙总耗时（ms，含并行 I/O 重叠） */
  bakeMs: number;
  /** 命中进程内缓存的 bake 次数 */
  cacheHits: number;
  /** AABB 兜底次数（烘焙失败 / 无 baker） */
  bakeFallbacks: number;
  /** 内容指纹：所有 baked sha256 排序后再哈希，便于判定"产物是否变化" */
  fingerprint: string;
  /** 结构化 signal 汇总（按 severity 分桶 + code 计数），对接 g_geometry_qc 循环 */
  signalBundle: {
    errors: number;
    warnings: number;
    notes: number;
    codes: Record<string, number>;
  };
}

function resolveCompileOptions(input: Record<string, unknown>): CompileOptions {
  const strict = readBoolInput(input.strict) ?? false;
  const assetKind = readAssetKind(input.assetKind) ?? readAssetKind(input.asset_kind);
  return {
    strict,
    // 默认 false（不跟随 !strict）：一次烘焙失败/缺失就悄悄退化成一个看起来"合理"的
    // AABB box，是三个 allow* 开关里唯一一个会让**几何本身错误**却看起来没事的——不像
    // orphan-wrap / root-stitch 只是放宽了图结构上的便利假设。所以这里单独收紧默认值，
    // 需要旧的"宽松预览"行为时显式传 allow_bake_fallback=true（见下面
    // "explicit allow_bake_fallback=true opt-in" 的单测）。
    allowBakeFallback: readBoolInput(input.allow_bake_fallback)
      ?? readBoolInput(input.allowBakeFallback)
      ?? false,
    allowAutoWrapOrphans: readBoolInput(input.allow_auto_wrap_orphans)
      ?? readBoolInput(input.allowAutoWrapOrphans)
      ?? !strict,
    allowAutoStitchRoots: readBoolInput(input.allow_auto_stitch_roots)
      ?? readBoolInput(input.allowAutoStitchRoots)
      ?? !strict,
    collisionProxy: readBoolInput(input.collision_proxy)
      ?? readBoolInput(input.collisionProxy)
      ?? true,
    assetKind,
  };
}

function readBoolInput(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function readAssetKind(value: unknown): AssetKind | undefined {
  if (value === 'static' || value === 'assembly' || value === 'mechanism') return value;
  return undefined;
}

function makeStats(): UrdfStats {
  return {
    explicitLinks: 0,
    implicitLinks: 0,
    explicitJoints: 0,
    autoJoints: 0,
    bakeFallbacks: 0,
    meshProvenance: [],
  };
}

function deriveDefaultRobotName(geom: Geometry): string {
  for (const s of geom.statements) {
    if (s.op === 'part') return s.id;
  }
  for (const s of geom.statements) {
    if (isShapeOp(s.op)) return s.id;
  }
  return 'untitled';
}

function geometryFromInline(src: string): Geometry {
  const { statements } = parseDSL(src);
  return Object.freeze({
    source: src,
    statements: Object.freeze(statements),
    version: 1,
  }) as Geometry;
}

function collectPartShapeRefs(statements: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) {
    if (s.op !== 'part') continue;
    const shapeRef = s.args.shape;
    if (shapeRef?.kind === 'ref') out.add(shapeRef.name);
  }
  return out;
}

function collectConsumedShapeRefs(statements: readonly Statement[]): Set<string> {
  const out = new Set<string>();
  for (const s of statements) {
    if (!isShapeOp(s.op)) continue;
    for (const arg of Object.values(s.args)) collectRefs(arg, out);
  }
  return out;
}

function collectRefs(arg: Arg | undefined, out: Set<string>): void {
  if (!arg) return;
  if (arg.kind === 'ref') {
    out.add(arg.name);
  } else if (arg.kind === 'list') {
    for (const item of arg.items) collectRefs(item, out);
  }
}

// ── 编译 ─────────────────────────────────────────────────────────────────

function compileToUrdf(
  geom: Geometry,
  robotName: string,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  options: CompileOptions,
): { xml: string; diagnostics: UrdfDiagnostic[]; stats: UrdfStats } {
  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const state: CompileState = {
    options,
    diagnostics: [],
    stats: makeStats(),
    fallbackShapes: new Set(),
  };

  // 把 inertial 语句按目标 link 索引，供 emitPart / emitImplicitLinkForShape 注入
  const inertialByLink = new Map<string, Statement>();
  for (const s of geom.statements) {
    if (s.op !== 'inertial') continue;
    const linkRef = s.args.link;
    if (linkRef && linkRef.kind === 'ref') inertialByLink.set(linkRef.name, s);
  }

  // 把 collision 语句按目标 link 索引（box-cluster 模式：一个 link 可挂多条）。
  // 没有 collision 语句的 part 仍走旧路径：visual = collision（向后兼容）。
  const collisionsByLink = new Map<string, Statement[]>();
  for (const s of geom.statements) {
    if (s.op !== 'collision') continue;
    const linkRef = s.args.link;
    if (!linkRef || linkRef.kind !== 'ref') continue;
    const list = collisionsByLink.get(linkRef.name);
    if (list) list.push(s);
    else collisionsByLink.set(linkRef.name, [s]);
  }

  const lines: string[] = [];
  lines.push('<?xml version="1.0"?>');
  lines.push(`<robot name="${escapeXml(robotName)}">`);

  // 1) 先吐 materials（顺序无关，URDF 允许 link 引用任何位置定义的 material）
  for (const s of geom.statements) {
    if (s.op === 'material') {
      lines.push(...emitMaterial(s));
    }
  }

  // 2) parts → <link>
  const referencedShapes = collectPartShapeRefs(geom.statements);
  const consumedShapeRefs = collectConsumedShapeRefs(geom.statements);
  for (const s of geom.statements) {
    if (s.op === 'part') {
      state.stats.explicitLinks++;
      lines.push(...emitPart(s, byId, inertialByLink.get(s.id), collisionsByLink.get(s.id), bakedUrls, state));
    }
  }

  // 2b) 自动包裹孤儿形状（box / cylinder / sphere / mesh / composite）
  //    若用户直接 g_box → g_to_urdf 而没有 g_part 包裹，URDF 需要 <link> 来携带形状。
  //    对每个未被 part.shape 直接引用、也未被其它 shape op 消费的最终形状，
  //    合成 <link name="<shapeId>_link">。
  //    并按"靠近"策略继承一条 material：先看形状之后最近的 material（典型用法
  //    g_box → g_material 的语义），再退化到形状之前的 material；都没有则不带颜色。
  //    多个孤儿之间用 fixed joint 串联到第一个，保证 URDF 是单根连通树。
  const orphanShapes: Statement[] = [];
  for (const s of geom.statements) {
    if (isShapeOp(s.op) && !referencedShapes.has(s.id) && !consumedShapeRefs.has(s.id)) {
      orphanShapes.push(s);
    }
  }
  const allowStaticSingleOrphan = options.assetKind === 'static'
    && orphanShapes.length === 1
    && !geom.statements.some(s => s.op === 'part' || s.op === 'joint');
  const canAutoWrapOrphans = options.allowAutoWrapOrphans || allowStaticSingleOrphan;
  if (orphanShapes.length > 0) {
    const severity: DiagnosticSeverity = allowStaticSingleOrphan
      ? 'note'
      : canAutoWrapOrphans
        ? 'warning'
        : 'error';
    const suffix = allowStaticSingleOrphan
      ? 'static asset preview explicitly allows one terminal orphan shape'
      : canAutoWrapOrphans
        ? 'lenient preview will auto-wrap terminal orphan shapes'
        : 'wrap visible shapes with g_part, or declare asset_kind="static" for a single terminal static preview';
    for (const shape of orphanShapes) {
      addDiagnostic(state, {
        severity,
        code: 'AUTO_WRAP_ORPHAN_SHAPE',
        shapeId: shape.id,
        message: `terminal shape "${shape.id}" (${shape.op}) is not wrapped by g_part; ${suffix}`,
      });
    }
  }
  for (const shape of canAutoWrapOrphans ? orphanShapes : []) {
    const shapeIndex = geom.statements.indexOf(shape);
    const inheritedMaterialId = findInheritedMaterialId(geom.statements, shapeIndex);
    state.stats.implicitLinks++;
    lines.push(...emitImplicitLinkForShape(shape, inheritedMaterialId, bakedUrls, byId, state));
  }

  // 3) joints (用户显式 + 串联孤儿的 fixed joint)
  for (const s of geom.statements) {
    if (s.op === 'joint') {
      state.stats.explicitJoints++;
      lines.push(...emitJoint(s));
    }
  }
  if (canAutoWrapOrphans && orphanShapes.length > 1) {
    const rootLinkName = `${orphanShapes[0].id}_link`;
    for (let i = 1; i < orphanShapes.length; i++) {
      const childLinkName = `${orphanShapes[i].id}_link`;
      state.stats.autoJoints++;
      lines.push(`  <joint name="auto_joint_${i}" type="fixed">`);
      lines.push(`    <parent link="${escapeXml(rootLinkName)}"/>`);
      lines.push(`    <child link="${escapeXml(childLinkName)}"/>`);
      lines.push(`  </joint>`);
    }
  }

  // 3b) 自动连通多根 part —— URDF 要求所有 link 形成单根树。
  //    若用户用 g_box → g_part → g_place_on_face 这种"零 joint"接法（典型场景：
  //    新手只想把圆柱摆到立方体顶上），geometry 里会出现两个孤立 part；urdf-loader
  //    只渲染一棵根树，第二个 part 直接被忽略，于是看起来"圆柱不见了"。
  //    解决：把任何"未出现在任何 joint.child 里"的 part 视为孤根，全部用 fixed
  //    joint 串到第一个孤根上。已有 joint 的 part 不会被打乱（它们都不是孤根）。
  const childParts = new Set<string>();
  for (const s of geom.statements) {
    if (s.op !== 'joint') continue;
    const c = s.args.child;
    if (c && c.kind === 'ref') childParts.add(c.name);
  }
  const orphanParts = geom.statements.filter(
    s => s.op === 'part' && !childParts.has(s.id),
  );
  if (orphanParts.length > 1) {
    addDiagnostic(state, {
      severity: options.allowAutoStitchRoots ? 'warning' : 'error',
      code: 'AUTO_STITCH_ROOT_PARTS',
      message: `${orphanParts.length} root part(s) (${orphanParts.map(p => p.id).join(', ')}) require explicit joints for strict delivery`,
    });
    if (options.allowAutoStitchRoots) {
      const rootName = orphanParts[0].id;
      for (let i = 1; i < orphanParts.length; i++) {
        const childName = orphanParts[i].id;
        state.stats.autoJoints++;
        lines.push(`  <joint name="auto_part_joint_${i}" type="fixed">`);
        lines.push(`    <parent link="${escapeXml(rootName)}"/>`);
        lines.push(`    <child link="${escapeXml(childName)}"/>`);
        lines.push(`  </joint>`);
      }
    }
  }
  addAssetKindDiagnostics(geom, orphanShapes, orphanParts, state);
  addMeshProvenanceSummary(state);

  lines.push('</robot>');
  return { xml: lines.join('\n'), diagnostics: state.diagnostics, stats: state.stats };
}

/**
 * 把 `state.stats.meshProvenance` 聚合成一条 'note' diagnostic：
 *   - 列出哪些 part 走了 AABB fallback / 哪些走了 baked_mesh / 哪些是 native；
 *   - 列出 collision 是来自显式 collision 语句还是与 visual 同形；
 *   - 错误条目独立列一段（已有 'error' 诊断了，这里再补一条聚合方便排查）。
 *
 * 这就是 B3 'mesh_provenance' 的用户面：用户调用 g_to_urdf 后，从 diagnostics 里
 * 直接能看到"我这次编译里有 3 个 part 用了 AABB fallback、4 个 part 走了 baked_mesh"
 * 这样的总览信息，不用翻 stats.meshProvenance 数组。
 */
function addMeshProvenanceSummary(state: CompileState): void {
  const prov = state.stats.meshProvenance;
  if (prov.length === 0) return;

  const sourceCount: Record<MeshProvenanceSource, number> = {
    native: 0,
    baked_mesh: 0,
    aabb_fallback: 0,
    collision_box: 0,
    collision_cyl: 0,
    collision_sphere: 0,
    collision_shape: 0,
    collision_proxy_box: 0,
    error: 0,
  };
  for (const e of prov) sourceCount[e.source]++;

  const totalVisuals = prov.filter(e => e.kind === 'visual').length;
  const totalCollisions = prov.filter(e => e.kind === 'collision').length;

  const summary =
    `meshes: visual=${totalVisuals}, collision=${totalCollisions} ` +
    `[native=${sourceCount.native}, baked=${sourceCount.baked_mesh}, ` +
    `aabb_fallback=${sourceCount.aabb_fallback}, ` +
    `collision_box=${sourceCount.collision_box + sourceCount.collision_cyl + sourceCount.collision_sphere + sourceCount.collision_shape}, ` +
    `collision_proxy=${sourceCount.collision_proxy_box}` +
    (sourceCount.error > 0 ? `, errors=${sourceCount.error}` : '') +
    `]`;
  addDiagnostic(state, {
    severity: 'note',
    code: 'MESH_PROVENANCE_SUMMARY',
    message: summary,
  });

  // AABB fallback 单列一条，容易定位"我哪个 part 没烘成"
  const fallbacks = prov.filter(e => e.source === 'aabb_fallback');
  if (fallbacks.length > 0) {
    const list = fallbacks.map(e => `${e.linkId}:${e.shapeId}(${e.op})`).join(', ');
    addDiagnostic(state, {
      severity: 'note',
      code: 'MESH_PROVENANCE_FALLBACKS',
      message: `parts using AABB fallback (no baker / bake failed): ${list}`,
    });
  }
}

function addDiagnostic(state: CompileState, diagnostic: UrdfDiagnostic): void {
  const key = [
    diagnostic.severity,
    diagnostic.code,
    diagnostic.nodeId ?? '',
    diagnostic.shapeId ?? '',
    diagnostic.partId ?? '',
    diagnostic.message,
  ].join('\0');
  const exists = state.diagnostics.some(existing => [
    existing.severity,
    existing.code,
    existing.nodeId ?? '',
    existing.shapeId ?? '',
    existing.partId ?? '',
    existing.message,
  ].join('\0') === key);
  if (!exists) state.diagnostics.push(diagnostic);
}

function addAssetKindDiagnostics(
  geom: Geometry,
  orphanShapes: readonly Statement[],
  rootParts: readonly Statement[],
  state: CompileState,
): void {
  const kind = state.options.assetKind;
  if (!kind) return;
  const parts = geom.statements.filter(s => s.op === 'part');
  const joints = geom.statements.filter(s => s.op === 'joint');
  const movingJoints = joints.filter(s => {
    const type = readString(s.args.type) ?? 'fixed';
    return type !== 'fixed';
  });

  if (kind === 'static') {
    if (orphanShapes.length > 1) {
      addDiagnostic(state, {
        severity: state.options.allowAutoWrapOrphans ? 'warning' : 'error',
        code: 'STATIC_MULTIPLE_TERMINAL_SHAPES',
        message: `static asset has ${orphanShapes.length} terminal shapes; union them or wrap a fixed assembly explicitly`,
      });
    }
    if (movingJoints.length > 0) {
      addDiagnostic(state, {
        severity: 'error',
        code: 'STATIC_HAS_MOVING_JOINTS',
        message: `static asset declares moving joint(s): ${movingJoints.map(j => j.id).join(', ')}`,
      });
    }
    return;
  }

  if ((kind === 'assembly' || kind === 'mechanism') && orphanShapes.length > 0) {
    addDiagnostic(state, {
      severity: 'error',
      code: 'ASSET_KIND_ORPHAN_SHAPES',
      message: `${kind} assets must wrap every visible terminal shape with g_part; orphan shape(s): ${orphanShapes.map(s => s.id).join(', ')}`,
    });
  }
  if ((kind === 'assembly' || kind === 'mechanism') && parts.length === 0) {
    addDiagnostic(state, {
      severity: 'error',
      code: 'ASSET_KIND_REQUIRES_PARTS',
      message: `${kind} assets require explicit g_part links`,
    });
  }
  if ((kind === 'assembly' || kind === 'mechanism') && rootParts.length !== 1 && parts.length > 0) {
    addDiagnostic(state, {
      severity: 'error',
      code: 'ASSET_KIND_ROOT_COUNT',
      message: `${kind} assets require exactly one explicit root part; found ${rootParts.length}`,
    });
  }
  if (kind === 'mechanism' && movingJoints.length === 0) {
    addDiagnostic(state, {
      severity: 'error',
      code: 'MECHANISM_REQUIRES_MOVING_JOINT',
      message: 'mechanism assets require at least one non-fixed joint',
    });
  }
}

function isShapeOp(op: string): boolean {
  // 纯创作 op（animation 等）永远不是 URDF 形状：显式排除，避免被 orphan-shape
  // 自动包裹逻辑误当成待渲染几何。
  if (NON_URDF_OPS.has(op)) return false;
  if (URDF_NATIVE_SHAPES.has(op)) return true;
  if (CSG_SUBGRAPH_BAKE_OPS.has(op)) return true;
  // Composite shapes (clevis_bracket / spur_gear / ...) 由 baker 烘成 mesh 后也按 shape 处理
  return isCompositeBakeOp(op);
}

function isCompositeBakeOp(op: string): boolean {
  return COMPOSITE_BAKE_OPS.has(op) || CSG_SUBGRAPH_BAKE_OPS.has(op);
}

function isSubgraphBakeOp(op: string): boolean {
  return CSG_SUBGRAPH_BAKE_OPS.has(op);
}

// 给孤儿形状寻找一条要继承的 material id：
//   1) 先看形状之后定义的最近一条 material（"先放形状，再调材质" 的常见用法）；
//   2) 否则退化到形状之前的最近一条 material；
//   3) 都没有 → 返回 null（→ <link> 不带 <material/>）。
function findInheritedMaterialId(
  statements: readonly Statement[],
  shapeIndex: number,
): string | null {
  for (let i = shapeIndex + 1; i < statements.length; i++) {
    if (statements[i].op === 'material') return statements[i].id;
  }
  for (let i = shapeIndex - 1; i >= 0; i--) {
    if (statements[i].op === 'material') return statements[i].id;
  }
  return null;
}

// 给孤儿形状合成一个最小 <link>：visual + collision，可选附带继承来的 material。
function emitImplicitLinkForShape(
  shape: Statement,
  materialId: string | null,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  byId: ReadonlyMap<string, Statement>,
  state: CompileState,
): string[] {
  const out: string[] = [];
  const linkName = `${shape.id}_link`;
  const visualXml = renderShapeGeometry(shape, bakedUrls, byId, state, {
    linkId: linkName,
    kind: 'visual',
  });
  out.push(`  <link name="${escapeXml(linkName)}">`);
  out.push(`    <visual>`);
  out.push(`      <geometry>`);
  for (const g of visualXml) out.push(`        ${g}`);
  out.push(`      </geometry>`);
  if (materialId) out.push(`      <material name="${escapeXml(materialId)}"/>`);
  out.push(`    </visual>`);
  // 默认碰撞：composite/烘焙网格走 AABB 盒代理，原生 primitive 用本体（见函数注释）
  const collisionXml = renderDefaultCollisionGeometry(shape, bakedUrls, byId, state, linkName);
  out.push(`    <collision>`);
  out.push(`      <geometry>`);
  for (const g of collisionXml) out.push(`        ${g}`);
  out.push(`      </geometry>`);
  out.push(`    </collision>`);
  out.push(`  </link>`);
  return out;
}

// ── 子部分编译 ────────────────────────────────────────────────────────────

/**
 * URDF <material> 只标准支持 <color>/<texture>；metalness/roughness 不是标准 URDF 属性，
 * 这里作为自定义 `<pbr metalness=".." roughness=".."/>` 子元素输出——纯色路径的补充
 * （贴图/PBR 的"真值"路径是 g_bake_object 烘的 GLB，那边走 pbrMetallicRoughness）。
 * 只有本项目前端 viewer（urdf-parser.ts）会读这个扩展，标准 URDF 消费者会忽略未知子元素。
 */
function emitMaterial(s: Statement): string[] {
  const rgba = readNumList(s.args.rgba, 4) ?? [0.7, 0.7, 0.7, 1];
  const metalness = readNumber(s.args.metalness);
  const roughness = readNumber(s.args.roughness);
  const out = [
    `  <material name="${escapeXml(s.id)}">`,
    `    <color rgba="${rgba.map(fmt).join(' ')}"/>`,
  ];
  if (metalness !== undefined || roughness !== undefined) {
    const attrs = [
      metalness !== undefined ? `metalness="${fmt(metalness)}"` : null,
      roughness !== undefined ? `roughness="${fmt(roughness)}"` : null,
    ].filter((a): a is string => a !== null);
    out.push(`    <pbr ${attrs.join(' ')}/>`);
  }
  out.push(`  </material>`);
  return out;
}

function emitPart(
  s: Statement,
  byId: ReadonlyMap<string, Statement>,
  inertialStmt: Statement | undefined,
  collisionStmts: readonly Statement[] | undefined,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  state: CompileState,
): string[] {
  const out: string[] = [];
  out.push(`  <link name="${escapeXml(s.id)}">`);

  // shape ref
  const shapeRef = s.args.shape;
  const shape = shapeRef && shapeRef.kind === 'ref' ? byId.get(shapeRef.name) : undefined;

  if (!shape) {
    out.push(`    <!-- error: part "${s.id}" missing or unknown shape ref -->`);
    addDiagnostic(state, {
      severity: 'error',
      code: 'PART_SHAPE_REF_MISSING',
      partId: s.id,
      message: `part "${s.id}" is missing or references an unknown shape`,
    });
  } else {
    const geomXml = renderShapeGeometry(shape, bakedUrls, byId, state, {
      linkId: s.id,
      kind: 'visual',
    });
    const originXml = renderOriginRpy(s.args.origin, s.args.rpy);
    const materialXml = renderMaterialRef(s.args.material);

    out.push(`    <visual>`);
    if (originXml) out.push(`      ${originXml}`);
    out.push(`      <geometry>`);
    for (const g of geomXml) out.push(`        ${g}`);
    out.push(`      </geometry>`);
    if (materialXml) out.push(`      ${materialXml}`);
    out.push(`    </visual>`);

    // <collision>：优先消费显式 collision 语句（box-cluster 模式）；
    // 否则退化到 visual = collision 的旧行为。
    if (collisionStmts && collisionStmts.length > 0) {
      for (const c of collisionStmts) {
        out.push(...renderCollisionStmt(c, byId, bakedUrls, state, s.id));
      }
    } else {
      // 默认碰撞：composite/烘焙网格走 AABB 盒代理，原生 primitive 用本体（见函数注释）
      const collisionGeomXml = renderDefaultCollisionGeometry(shape, bakedUrls, byId, state, s.id);
      out.push(`    <collision>`);
      if (originXml) out.push(`      ${originXml}`);
      out.push(`      <geometry>`);
      for (const g of collisionGeomXml) out.push(`        ${g}`);
      out.push(`      </geometry>`);
      out.push(`    </collision>`);
    }
  }

  // <inertial>：优先用 inertial 语句（来自 g_inertial_from_geometry），
  // 否则退化到 part.mass 的简化对角张量（兼容旧用法）
  if (inertialStmt) {
    out.push(...renderInertial(inertialStmt));
  } else {
    const mass = readNumber(s.args.mass);
    if (mass !== undefined && mass > 0) {
      out.push(`    <inertial>`);
      out.push(`      <mass value="${fmt(mass)}"/>`);
      out.push(`      <inertia ixx="1e-3" ixy="0" ixz="0" iyy="1e-3" iyz="0" izz="1e-3"/>`);
      out.push(`    </inertial>`);
    }
  }

  out.push(`  </link>`);
  return out;
}

function renderCollisionStmt(
  c: Statement,
  byId: ReadonlyMap<string, Statement>,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  state: CompileState,
  linkId: string,
): string[] {
  const out: string[] = [];
  const nameAttr = readString(c.args.name);
  const open =
    nameAttr && nameAttr.length > 0
      ? `    <collision name="${escapeXml(nameAttr)}">`
      : `    <collision>`;
  out.push(open);
  const originXml = renderOriginRpy(c.args.origin, c.args.rpy);
  if (originXml) out.push(`      ${originXml}`);

  // 几何描述：四选一（box / cylinder / sphere_radius / shape ref）
  const boxSize = readNumList(c.args.box, 3);
  const cyl = readNumList(c.args.cylinder, 2);
  const sphR = readNumber(c.args.sphere_radius);
  const shapeRef = c.args.shape;

  out.push(`      <geometry>`);
  if (boxSize) {
    out.push(`        <box size="${boxSize.map(fmt).join(' ')}"/>`);
    state.stats.meshProvenance.push({
      kind: 'collision',
      linkId,
      shapeId: c.id,
      op: 'collision',
      source: 'collision_box',
    });
  } else if (cyl) {
    out.push(`        <cylinder radius="${fmt(cyl[0])}" length="${fmt(cyl[1])}"/>`);
    state.stats.meshProvenance.push({
      kind: 'collision',
      linkId,
      shapeId: c.id,
      op: 'collision',
      source: 'collision_cyl',
    });
  } else if (sphR !== undefined) {
    out.push(`        <sphere radius="${fmt(sphR)}"/>`);
    state.stats.meshProvenance.push({
      kind: 'collision',
      linkId,
      shapeId: c.id,
      op: 'collision',
      source: 'collision_sphere',
    });
  } else if (shapeRef && shapeRef.kind === 'ref') {
    const target = byId.get(shapeRef.name);
    if (target) {
      const g = renderShapeGeometry(target, bakedUrls, byId, state, {
        linkId,
        kind: 'collision',
      });
      for (const line of g) out.push(`        ${line}`);
      // 重新分类：复用现有 shape ref（renderShapeGeometry 已记录原 shape op 的 provenance）
      // 但同时也记一条 'collision_shape' 标记，让"显式 collision 语句"可被检索到
      state.stats.meshProvenance.push({
        kind: 'collision',
        linkId,
        shapeId: c.id,
        op: 'collision',
        source: 'collision_shape',
      });
    } else {
      out.push(`        <!-- error: collision shape ref "${shapeRef.name}" not found -->`);
      state.stats.meshProvenance.push({
        kind: 'collision',
        linkId,
        shapeId: c.id,
        op: 'collision',
        source: 'error',
        error: `collision shape ref "${shapeRef.name}" not found`,
      });
    }
  } else {
    out.push(`        <!-- error: collision "${c.id}" has no box / cylinder / sphere_radius / shape -->`);
    addDiagnostic(state, {
      severity: 'error',
      code: 'COLLISION_NO_GEOMETRY',
      message: `collision "${c.id}" must define one of: box, cylinder, sphere_radius, shape`,
    });
    state.stats.meshProvenance.push({
      kind: 'collision',
      linkId,
      shapeId: c.id,
      op: 'collision',
      source: 'error',
      error: 'no geometry',
    });
  }
  out.push(`      </geometry>`);
  out.push(`    </collision>`);
  return out;
}

function renderInertial(s: Statement): string[] {
  const mass = readNumber(s.args.mass) ?? 0;
  const ixx = readNumber(s.args.ixx) ?? 0;
  const ixy = readNumber(s.args.ixy) ?? 0;
  const ixz = readNumber(s.args.ixz) ?? 0;
  const iyy = readNumber(s.args.iyy) ?? 0;
  const iyz = readNumber(s.args.iyz) ?? 0;
  const izz = readNumber(s.args.izz) ?? 0;
  const originXml = renderOriginRpy(s.args.origin, s.args.rpy);
  const out: string[] = [];
  out.push(`    <inertial>`);
  if (originXml) out.push(`      ${originXml}`);
  out.push(`      <mass value="${fmt(mass)}"/>`);
  out.push(
    `      <inertia ixx="${fmt(ixx)}" ixy="${fmt(ixy)}" ixz="${fmt(ixz)}" iyy="${fmt(iyy)}" iyz="${fmt(iyz)}" izz="${fmt(izz)}"/>`,
  );
  out.push(`    </inertial>`);
  return out;
}

function renderShapeGeometry(
  shape: Statement,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  byId: ReadonlyMap<string, Statement>,
  state: CompileState,
  provenance?: { linkId: string; kind: 'visual' | 'collision' },
): string[] {
  const recordProv = (source: MeshProvenanceSource, error?: string): void => {
    if (!provenance) return;
    state.stats.meshProvenance.push({
      kind: provenance.kind,
      linkId: provenance.linkId,
      shapeId: shape.id,
      op: shape.op,
      source,
      ...(error ? { error } : {}),
    });
  };
  switch (shape.op) {
    case 'box': {
      const size = readNumList(shape.args.size, 3) ?? [1, 1, 1];
      recordProv('native');
      return [`<box size="${size.map(fmt).join(' ')}"/>`];
    }
    case 'cylinder': {
      const r = readNumber(shape.args.radius) ?? 1;
      const l = readNumber(shape.args.length) ?? 1;
      recordProv('native');
      return [`<cylinder radius="${fmt(r)}" length="${fmt(l)}"/>`];
    }
    case 'sphere': {
      const r = readNumber(shape.args.radius) ?? 1;
      recordProv('native');
      return [`<sphere radius="${fmt(r)}"/>`];
    }
    case 'mesh': {
      const fn = readString(shape.args.filename) ?? '';
      const scale = readNumList(shape.args.scale, 3);
      const scaleAttr = scale ? ` scale="${scale.map(fmt).join(' ')}"` : '';
      recordProv('native');
      return [`<mesh filename="${escapeXml(fn)}"${scaleAttr}/>`];
    }
    default: {
      // Composite shape：要么已烘焙成 mesh URL，要么走 AABB box fallback
      if (isCompositeBakeOp(shape.op)) {
        const baked = bakedUrls.get(shape.id);
        if (baked?.ok && baked.url) {
          recordProv('baked_mesh');
          return [`<mesh filename="${escapeXml(baked.url)}"/>`];
        }
        const reason = baked?.error
          ? `baker failed for "${shape.id}" (${shape.op}): ${baked.error}`
          : `no bake asset is available for "${shape.id}" (${shape.op})`;
        markBakeFallback(shape, reason, state);
        if (!state.options.allowBakeFallback) {
          recordProv('error', reason);
          return [`<!-- error: ${escapeXml(reason)}; AABB fallback disabled -->`];
        }
        // 没烘成功（无 baker / 未注册 / bake 抛错）→ 用 AABB 兜底
        const aabb = isSubgraphBakeOp(shape.op)
          ? localAabbFromShapeInGeometry(shape, byId)
          : localAabbFromShape(shape);
        if (aabb) {
          const sx = aabb.halfExtent[0] * 2;
          const sy = aabb.halfExtent[1] * 2;
          const sz = aabb.halfExtent[2] * 2;
          const errComment = baked?.error
            ? [`<!-- baker error on "${shape.id}" (${shape.op}): ${escapeXml(baked.error)} -->`]
            : [`<!-- no baker registered for "${shape.op}" → AABB fallback -->`];
          recordProv('aabb_fallback', baked?.error);
          return [...errComment, `<box size="${fmt(sx)} ${fmt(sy)} ${fmt(sz)}"/>`];
        }
        recordProv('error', `composite shape op "${shape.op}" has no AABB and no bake URL`);
        return [`<!-- error: composite shape op "${shape.op}" has no AABB and no bake URL -->`];
      }
      recordProv('error', `unknown shape op "${shape.op}"`);
      return [`<!-- error: unknown shape op "${shape.op}" on id "${shape.id}" -->`];
    }
  }
}

/**
 * 默认碰撞几何（仅当该 link 没有显式 g_collision_* 语句时调用）。
 *   - 原生 box/cylinder/sphere/mesh：本体已是粗几何，直接复用（kind=collision）。
 *   - composite / CSG 子图（会被烘成高面数网格）：collisionProxy=true 时改用 AABB
 *     盒代理，避免把完整可视网格塞进碰撞（更省 + 物理更稳）；false 时回到
 *     visual=collision 旧行为。
 */
function renderDefaultCollisionGeometry(
  shape: Statement,
  bakedUrls: ReadonlyMap<string, BakeOutcome>,
  byId: ReadonlyMap<string, Statement>,
  state: CompileState,
  linkId: string,
): string[] {
  const provenance = { linkId, kind: 'collision' as const };
  // 代理关闭 / 原生 primitive 已足够粗 → 直接用本体几何
  if (!state.options.collisionProxy || URDF_NATIVE_SHAPES.has(shape.op)) {
    return renderShapeGeometry(shape, bakedUrls, byId, state, provenance);
  }
  // composite / 子图 → AABB 盒代理
  if (isCompositeBakeOp(shape.op)) {
    const aabb = isSubgraphBakeOp(shape.op)
      ? localAabbFromShapeInGeometry(shape, byId)
      : localAabbFromShape(shape);
    if (aabb) {
      const sx = aabb.halfExtent[0] * 2;
      const sy = aabb.halfExtent[1] * 2;
      const sz = aabb.halfExtent[2] * 2;
      state.stats.meshProvenance.push({
        kind: 'collision',
        linkId,
        shapeId: shape.id,
        op: shape.op,
        source: 'collision_proxy_box',
      });
      return [`<box size="${fmt(sx)} ${fmt(sy)} ${fmt(sz)}"/>`];
    }
  }
  // 拿不到 AABB（异常 op）→ 退回完整渲染（含 baker fallback 链路）
  return renderShapeGeometry(shape, bakedUrls, byId, state, provenance);
}

function markBakeFallback(shape: Statement, reason: string, state: CompileState): void {
  const firstFallbackForShape = !state.fallbackShapes.has(shape.id);
  if (firstFallbackForShape) {
    state.fallbackShapes.add(shape.id);
    state.stats.bakeFallbacks++;
  }
  // 单条诊断即可：reason 已含"为什么缺 asset"，后半句说明 fallback 行为。
  // （此前拆成 BAKE_FALLBACK_USED + BAKE_ASSET_MISSING 两条，信息重复。）
  addDiagnostic(state, {
    severity: state.options.allowBakeFallback ? 'warning' : 'error',
    code: 'BAKE_FALLBACK_USED',
    shapeId: shape.id,
    message: `${reason}; ${state.options.allowBakeFallback ? 'using AABB fallback for preview' : 'strict mode requires a successful bake'}`,
  });
}

function renderOriginRpy(origin: Arg | undefined, rpy: Arg | undefined): string | null {
  const xyz = readNumList(origin, 3);
  const rrpy = readNumList(rpy, 3);
  if (!xyz && !rrpy) return null;
  const xyzAttr = xyz  ? ` xyz="${xyz.map(fmt).join(' ')}"` : '';
  const rpyAttr = rrpy ? ` rpy="${rrpy.map(fmt).join(' ')}"` : '';
  return `<origin${xyzAttr}${rpyAttr}/>`;
}

function renderMaterialRef(material: Arg | undefined): string | null {
  if (!material || material.kind !== 'ref') return null;
  return `<material name="${escapeXml(material.name)}"/>`;
}

function emitJoint(s: Statement): string[] {
  const type = readString(s.args.type) ?? 'fixed';
  const parent = s.args.parent;
  const child  = s.args.child;
  if (!parent || parent.kind !== 'ref' || !child || child.kind !== 'ref') {
    return [`  <!-- error: joint "${s.id}" missing parent/child refs -->`];
  }

  const out: string[] = [];
  out.push(`  <joint name="${escapeXml(s.id)}" type="${escapeXml(type)}">`);
  const originXml = renderOriginRpy(s.args.origin, s.args.rpy);
  if (originXml) out.push(`    ${originXml}`);
  out.push(`    <parent link="${escapeXml(parent.name)}"/>`);
  out.push(`    <child link="${escapeXml(child.name)}"/>`);

  const axis = readNumList(s.args.axis, 3);
  if (axis) out.push(`    <axis xyz="${axis.map(fmt).join(' ')}"/>`);

  if (type === 'revolute' || type === 'prismatic' || type === 'continuous') {
    const lower    = readNumber(s.args.lower);
    const upper    = readNumber(s.args.upper);
    const effort   = readNumber(s.args.effort)   ?? 1;
    const velocity = readNumber(s.args.velocity) ?? 1;
    if (type === 'continuous') {
      out.push(`    <limit effort="${fmt(effort)}" velocity="${fmt(velocity)}"/>`);
    } else if (lower !== undefined && upper !== undefined) {
      out.push(`    <limit lower="${fmt(lower)}" upper="${fmt(upper)}" effort="${fmt(effort)}" velocity="${fmt(velocity)}"/>`);
    }
  }

  const mimicJoint = s.args.mimic_joint;
  if (mimicJoint?.kind === 'ref') {
    const multiplier = readNumber(s.args.mimic_multiplier) ?? 1;
    const offset = readNumber(s.args.mimic_offset) ?? 0;
    out.push(`    <mimic joint="${escapeXml(mimicJoint.name)}" multiplier="${fmt(multiplier)}" offset="${fmt(offset)}"/>`);
  }

  out.push(`  </joint>`);
  return out;
}

// ── Arg 读取工具 ─────────────────────────────────────────────────────────

function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
  return a.value;
}
function readString(a: Arg | undefined): string | undefined {
  if (!a || a.kind !== 'string') return undefined;
  return a.value;
}
function readNumList(a: Arg | undefined, n?: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  if (n !== undefined && out.length !== n) return undefined;
  return out;
}

// ── XML / number 格式化 ──────────────────────────────────────────────────

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(6).replace(/\.?0+$/, '');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default gToUrdf;
