/**
 * Baker 内部类型定义。
 *
 * 设计要点：
 *   - `OpBuilder` 是单一 op 的纯函数：给定 replicad 模块 + DSL args，返回一个 Shape3D。
 *     这层把 op 的几何意图与 OCCT WASM 实例解耦，便于未来切到 worker thread 时
 *     只搬 replicad 调用上下文，不动 op 实现。
 *   - `OpContext` 把全局工具（replicad 模块、tessellation 默认值）打成一束，
 *     避免 op 文件互相 import replicad、互相依赖默认值。
 *   - `BakeResult` 故意只暴露 cache key / blob hash + 计数，不暴露 OBJ bytes ——
 *     真正的 bytes 已经由 baker.service 自己经 library.importFromBuffer() 落盘。
 */

import type * as Replicad from 'replicad';
import type { Arg } from './shared-types.js';

/** replicad 全模块（含 setOC、makeBaseBox、makeCylinder、draw 等顶级函数） */
export type ReplicadModule = typeof Replicad;

/** 由曲线/曲面 helper 直接生成的三角网格。 */
export interface MeshGeometry {
  readonly kind: 'mesh_geometry';
  readonly vertices: readonly (readonly [number, number, number])[];
  readonly faces: readonly (readonly [number, number, number])[];
}

export type ReplicadShape = Replicad.Shape3D;

export type BakeableShape = ReplicadShape;
export type BakeProduct = BakeableShape | MeshGeometry;

/** Tessellation 参数；linDeflection=最大弦距(米)，angDeflection=最大相邻面夹角(rad)
 *
 * 相对容差（relativeDeflection > 0 时启用）：
 *   有效弦距 = clamp(relativeDeflection × 形状包围盒对角线, minLinearDeflection, maxLinearDeflection)
 *   —— 让大零件（如 5cm 齿轮）自动用更粗的网格、小零件保持精细，避免绝对容差
 *   把大件三角面拉爆（meshing 成本随面数指数增长）。relativeDeflection=0 时退回纯
 *   绝对 linearDeflection。
 */
export interface TessellationOptions {
  /** 绝对最大弦距（米）。relativeDeflection=0 或拿不到包围盒时用此值。 */
  linearDeflection: number;
  /** 最大相邻面夹角（弧度）。默认 0.5 ≈ 28.6° */
  angularDeflection: number;
  /** 相对弦距：包围盒对角线的比例。0 = 关闭相对模式。 */
  relativeDeflection?: number;
  /** 相对模式下弦距下限（米）——保证小特征不会比此更粗，也不会比此更细。 */
  minLinearDeflection?: number;
  /** 相对模式下弦距上限（米）——保证大件不会粗到失形。 */
  maxLinearDeflection?: number;
}

/**
 * 默认相对容差（**low-poly 取向**）：
 *   - angularDeflection=0.35（≈20°）—— 曲面分面的主控杠杆。它直接决定球 / 圆柱 /
 *     圆锥这类回转面**每圈分几段**：值越大、段数越少。0.35 给出约 18~20 段的
 *     圆，比旧的 0.6（≈34°，约 10 段）更圆润、棱角不再扎眼，但仍保持 low-poly。
 *   - relativeDeflection=0.015（包围盒对角线的 1.5%）+ 上限 0.01（1cm）：弦距是
 *     另一个会逼出细分的约束（OCCT 取角度/弦距里更细的那个）。放粗到 1.5% / 1cm 后，
 *     弦距通常不再是瓶颈，回转面段数由上面的 angular 杠杆主控。
 *   - 下限 minLinearDeflection=0.0001（0.1mm）保持不变：**独立的小零件包围盒小，
 *     弦距按比例自然回到 0.1mm 级**，所以螺孔 / 小倒角等真实小特征精度不退化；
 *     放粗只作用在"大回转面"上 = 正是我们要的 low-poly。
 *
 * 取舍：relativeDeflection 用整体包围盒，所以**大零件上的小曲面特征**（如 1m 大件
 * 上的 1cm 圆角）会被 1cm 上限粗化。这是 low-poly 工作台刻意的取向（要"少面、带棱"）；
 * 真要某件更精细，回该件 PART A/B 把它单独建小一点 / 单独 bake 即可。
 */
export const DEFAULT_TESSELLATION: TessellationOptions = {
  linearDeflection: 0.0001,
  angularDeflection: 0.35,
  relativeDeflection: 0.015,
  minLinearDeflection: 0.0001,
  maxLinearDeflection: 0.01,
};

/** 注入到每个 op builder 的上下文。后续要加日志 / 性能计时 / 容差覆写 都加在这里。 */
export interface OpContext {
  readonly replicad: ReplicadModule;
  readonly tessellation: TessellationOptions;
}

/** 单一 op 的几何生成函数。从 DSL args 构造 OCCT Shape3D 或直接三角网格。 */
export type OpBuilder = (ctx: OpContext, args: Record<string, Arg>) => BakeProduct;

/** bake 调用结果。url 是相对 baseUrl 的资源段（例如 "<blobSha256>.obj"）。 */
export interface BakeResult {
  /** 内容寻址 URL 末尾段，URDF 里直接 <mesh filename="${url}"/> */
  url: string;
  /** bake 参数缓存键，用来判断同参数是否命中，而不是 OBJ 内容 hash。 */
  sha256: string;
  /** OBJ 字节内容哈希（也即 library blob 的 sha256），用于 /library/blob URL。 */
  blobSha256?: string;
  /** mesh 顶点数（调试 / 监控用） */
  vertexCount: number;
  /** mesh 三角形数 */
  triangleCount: number;
  /** OBJ 字节大小 */
  byteSize: number;
  /** 该次 bake 是否命中缓存（true → 没真 build，直接复用 library blob） */
  cacheHit: boolean;
  /** baked OBJ 的局部 AABB 最小角（米，相对 part 原点）；空 mesh 时为 undefined。
   *  下游 g_bake_part → g_mesh(bbox_min/bbox_max) 用它在场景里解出 mesh AABB，
   *  让 QC 的 overlap 检测在场景组装时生效。 */
  bboxMin?: [number, number, number];
  /** baked OBJ 的局部 AABB 最大角（米，相对 part 原点）。 */
  bboxMax?: [number, number, number];
}

/** baker 内部 library 句柄——故意比 BatteryLibraryHandle 更窄，只暴露 bake 必需能力。
 *  这样 baker.service 不直接依赖 BatteryContext，可以独立测试。 */
export interface BakerLibraryHandle {
  /** 按 alias 查询 asset 元数据；用于在 OCCT 前做磁盘 cache 短路。 */
  getByAlias?(
    alias: string,
    zone?: string,
  ): { alias: string; blobId: string; sizeBytes?: number } | null;
  /** 按 alias 解析磁盘 blob 路径；用于读取 OBJ 计数而不是重新 tessellate。 */
  resolveBlobPath?(alias: string, zone?: string): string | null;
  /** 按内容 sha256 解析磁盘 blob 路径（mesh(filename="<sha>.obj") 里的 <sha>）；
   *  角色路把分件预烘的 <sha>.obj 一起合并成可蒙皮网格时用它回读 blob。 */
  resolveBlobPathBySha?(sha256: string): string | null;
  importFromBuffer(
    buffer: Buffer,
    filename: string,
    alias?: string,
    opts?: { zone?: string; source?: 'manual' | 'pipeline' | 'ai_gen'; tags?: string[] },
  ): Promise<{ alias: string; blobId: string }>;
}
