// 💡 mode-topBillboard voxel master 内部类型
//
// 公开类型(VoxelLayerInput / BuildVoxelMasterOpts / VoxelMaster)从 ./index 透传给上游
// (modes/topBillboard/index.tsx);其余是模块内部中间表示。
//
// Stage-2c.2: asset autotile —— LayerAssetBinding / regions / rule sprites 已 port,
// VoxelLayerInput 的 assetName/assetType/nodePath 被 asset drawMode 消费。

import type { CellSource } from '../../../framework/cellSource'
import type { DrawMode } from '../../../types'
import type { AliasMeta } from '../../../framework/asset/matchAssetEntry'
import type { NormalizedRule } from '../../../framework/asset/ruleCache'
import type { AssetMatch } from '../../../framework/asset/matchAssetEntry'
import type { VariantPool } from '../../../framework/asset/variantCandidates'

// ── 输入(公开)─────────────────────────────────────────────────────────

export interface VoxelLayerInput {
  source: CellSource
  /** 该层在所有 voxel layers 的 z-order 中的序号(painter 第三键 / 取色 hue) */
  layerIdx: number
  /** layer 自身被选中;本 slice 恒 false(选中高亮 deferred) */
  isSelected: boolean
  /** editor 端选中;本 slice 恒 false */
  isEditorSelected: boolean
  /** scene 节点的 asset_name(Stage-2c.2 autotile sprites 用) */
  assetName: string
  /** scene 节点的 asset_alias; 存在时精确绑定到用户选择的素材 */
  assetAlias?: string
  /** scene 节点的 asset_type(Stage-2c.2 autotile sprites 用) */
  assetType?: string
  /** 该 layer 在 scene tree 里的 nodePath(Stage-2c.2 region scope 用) */
  nodePath?: string
}

export interface BuildVoxelMasterOpts {
  drawMode: DrawMode
  /** asset drawMode 必备:合并后的 alias 池(空则 asset path 退化为 color) */
  aliases?: ReadonlyArray<AliasMeta>
  /** asset drawMode 命名匹配是否允许模糊;默认 false */
  fuzzy?: boolean
  /**
   * ADDITIVE capture sink (Path A). When provided, every sprite the bake
   * RESOLVES-AND-DRAWS is also reported here, in exact draw order, AFTER
   * cull + painter-sort + face-choice + variant-filter — i.e. the renderer's
   * actual draw RESULT. The cook (export) consumes this instead of re-deriving
   * occlusion/order/face. Passing no sink leaves the draw loop byte-for-byte
   * unchanged; this is instrumentation, not a refactor of the paint path.
   */
  onResolve?: ResolvedDrawSink
}

/** Which billboard face a resolved draw belongs to. */
export type ResolvedFace = 'top' | 'front' | 'object'

/**
 * One resolved-and-drawn sprite, captured at the exact point the bake draws it.
 * `drawSeq` is the global painter order (ascending = drawn earlier = visually
 * lower). Culled / skipped sprites are simply never emitted — that omission IS
 * the renderer's occlusion result. Screen cell is the voxel's projected billboard
 * row: top cap at (x, y-z-1), front wall at (x, y-z). `srcRect` is the atlas slice
 * actually blitted; `spriteIndex` is the rule sprite idx (−1 for a whole-image /
 * object sprite with no rule slice).
 */
export interface ResolvedDraw {
  drawSeq: number
  screenX: number
  screenY: number
  /** Source voxel world row (the painter-order first key; NOT the screen row). */
  srcY: number
  /** Source voxel elevation (the export group key / `height`). */
  z: number
  face: ResolvedFace
  layerIdx: number
  spriteIndex: number
  srcRect: { x: number; y: number; w: number; h: number } | null
}

export type ResolvedDrawSink = (draw: ResolvedDraw) => void

export interface VoxelMaster {
  canvas: import('../../../framework/canvas2d').Surface2D
  bbox: import('../../../framework/geometry/topBillboard').VoxelBbox
  /**
   * Snapshot of what was baked, enabling an incremental dirty-region re-bake
   * (see incrementalBake.ts) instead of recollecting/sorting/redrawing the whole
   * scene on every painted cell. Present only for the incremental-safe path
   * (no irregular object sprites); absent → callers must do a full rebuild.
   */
  incremental?: IncrementalBakeState
  /**
   * Master-px rect that the LAST incremental append rewrote (clamped to canvas).
   * Lets the visible-canvas compose blit ONLY this sub-rect instead of re-drawing
   * (and downscaling) the entire — potentially enormous — master each paint.
   * Undefined after a full build (caller does a full compose). Transient.
   */
  lastDirtyPx?: { x0: number; y0: number; x1: number; y1: number }
}

/** What a master canvas needs to support an in-place dirty-region re-bake. */
export interface IncrementalBakeState {
  /** Painter-sorted (back→front) visible cells that were drawn into the canvas. */
  cells: ReadonlyArray<CollectedCell>
  /** master cell pixel density used when baking (see pickMasterCellSize). */
  cellSize: number
  drawMode: DrawMode
  /** asset-mode per-layer binding (autotile neighbor sprites); null otherwise. */
  assetByLayer: Map<number, LayerAssetBinding | null> | null
  /** per-layer 3D coord sets for autotile neighbor lookups. */
  coordsByLayerIdx: Map<number, Set<string>>
  /** Object-instance column cells that the full build SKIPS (only the anchor draws
   *  the sprite). The append path must skip them too, or it would double-draw. */
  objectColumnCells?: ReadonlySet<CollectedCell>
  /** Per-cell oversized sprite visual bounds (master-grid units), for cells that
   *  draw a non-tile object sprite. The append path unions these into the dirty
   *  rect when a painted tile overlaps an object, so the object is correctly
   *  cleared + repainted (a plain 1-cell footprint would leave stale pixels). */
  objectBoundsByCell?: ReadonlyMap<CollectedCell, { minX: number; minY: number; maxX: number; maxY: number }>
  /** Footprint-center anchor for grouped object layers (geometry anchor lands here). */
  objectAnchorPointByLayer?: ReadonlyMap<number, { x: number; y: number }>
  /** Spatial bucket index: coarse master-grid screen tile → cells whose footprint
   *  touches it. Lets the incremental append visit only the O(k) cells near the
   *  dirty rect instead of scanning all N cells every paint. Buckets are keyed in
   *  WORLD screen-grid units (origin-independent) so a bbox-grow doesn't invalidate
   *  them. Mutated in place as cells are appended. */
  cellBuckets?: Map<string, CollectedCell[]>
}

// ── 内部:扁平化 cell + 元数据 ─────────────────────────────────────────

export interface CollectedCell {
  x: number
  y: number
  z: number
  value: number
  layerIdx: number
  isSelected: boolean
  isEditorSelected: boolean
  isMultiValue: boolean
  state?: Record<string, unknown>
}

/** asset path 的 per-layer 预解析(每层一次,不下沉到 cell) */
export interface LayerAssetBinding {
  match: AssetMatch
  /**
   * matchAssetEntry 命中的 alias 若带 tileType,异步 ruleCache 取对应 rule 资产
   * (规范化形态,带 faces.top? / faces.front?)。
   *   * rule 命中且加载完 → 走 autotile 分支(各 face 独立邻域查表)
   *   * rule 还在 fetch / 不存在 → null,本帧整图直贴;onload 后 readiness pulse
   *     触发 master 重 build,届时 autotile 启用。faces 缺哪面就跳过那面绘制。
   */
  rule: NormalizedRule | null
  imgUrl: string
  /**
   * 各 face 的 sprites[basePieces..] 区段中实际有内容的 idx 列表,randomRules
   * 命中后从这里均匀采样。每个 face 单独一份(同一 atlas,但 basePieces 不一样,
   * 变体区段也不同)。空数组 = 该 face 没变体或图未加载完。
   */
  validVariantIdxs: { top: number[]; front: number[]; entry: number[] }
  /** 与 validVariantIdxs 等长；face.variantWeights 过滤后 */
  validVariantWeights: { top?: number[]; front?: number[]; entry?: number[] }
  validVariantPoolsByTileId: { top: Map<number, VariantPool>; front: Map<number, VariantPool>; entry: Map<number, VariantPool> }
  /**
   * rule.regions 解析后的 cell 集合,key 是 region 名,value 是 "x,y" 形式 set。
   *   * source: "parent" → 渲染当下,本 layer 直接父路径下所有 voxel 的 xy 并集
   *   * source: "self"   → 当前 layer 自己的 xy 并集
   * face.variants 的 when.regionContains 在这里查表。
   */
  regions: Map<string, Set<string>>
}

// ── collect 阶段产物(共享给后续 cull / paint / bindings 阶段)──────

export interface CollectResult {
  /** painter sort 之前的全 cell 列表(同 (x,y,z) 多 layer 都在) */
  allCells: CollectedCell[]
  /** 3D 占位查询(occlusion cull / 邻域查询) */
  hasCell: Set<string>
  /** per-layer 3D 集合(autotile 同层邻域查询) */
  coordsByLayerIdx: Map<number, Set<string>>
  /** per-layer xy 投影集(rule.regions source: "self") */
  xyByLayerIdx: Map<number, Set<string>>
  /** 按"直接父路径"分组的 xy 投影集(rule.regions source: "parent") */
  xyByParentPath: Map<string, Set<string>>
  /** layerIdx → 直接父路径,bindings 阶段查 region 用 */
  parentPathByLayerIdx: Map<number, string>
}
