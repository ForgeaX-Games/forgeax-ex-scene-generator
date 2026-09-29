// Consume generated declarations so the pure-renderer build stays inside its source root.
import type { SceneMesh } from '../../../vendor/dist/shared/types/scene/content'

export type Point3D = { x: number; y: number; z: number; token?: string; state?: Record<string, unknown> }
export type ViewMode = 'default' | 'top' | 'topBillboard' | 'iso' | 'free3d' | '3DMesh'
export type DrawMode = 'wire' | 'color' | 'asset'
/** Type-filter layers in Default (and later usdview-style schema rows). */
export type DisplaySchema = 'voxel' | 'grid' | 'mesh' | 'road' | 'houses' | 'guide' | 'ref'

/** Switcher / agent order. Plugins still self-register; this is the product table. */
export const VIEW_MODE_ORDER: readonly ViewMode[] = [
  'default',
  'top',
  'topBillboard',
  'iso',
  'free3d',
  '3DMesh',
]

export const DEFAULT_SCHEMA_VISIBLE: Record<DisplaySchema, boolean> = {
  voxel: true,
  grid: false,
  mesh: true,
  road: true,
  houses: true,
  guide: true,
  ref: true,
}

export function meshRoleToSchema(role: 'terrain' | 'road' | 'houses' | undefined): DisplaySchema {
  if (role === 'road') return 'road'
  if (role === 'houses') return 'houses'
  return 'mesh'
}

export function isViewMode(value: unknown): value is ViewMode {
  return typeof value === 'string' && (VIEW_MODE_ORDER as readonly string[]).includes(value)
}

/** Orbit-camera plugins own their pointer events; the host must not pan/zoom 2D. */
export function isOrbit3dView(mode: ViewMode): boolean {
  return mode === 'default' || mode === 'free3d' || mode === '3DMesh'
}

// The scene_output battery's wire output (see shared/types/scene/projection.ts).
// `tokens`/`cellsByToken` are present only on multi-value layers (a node whose
// cells carry >1 distinct voxel token) — they drive the collapsible sub-layer
// rows + per-token visibility in the Layers panel.
export interface VoxelLayer {
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  cells: Point3D[]
  tokens?: string[]
  cellsByToken?: Record<string, Point3D[]>
}
export interface NameListEntry { id: number; name: string; type?: string }

// A dense 2D preview layer projected from any node's `grid` output port (legacy
// "preview" channel). `data` is indexed [row][col]. Legacy 2D cell previews
// treat 0 as empty; numeric-field consumers such as 3DMesh preserve every
// finite value, including 0 (the XY plane) and negatives. Unlike voxel layers
// (only from the scene_output sink), every executed node with a grid output
// contributes one of these, so the preview updates live as a graph is wired up
// — even without a scene_output.
export interface GridLayer {
  key: string // `${nodeId}:${portName}`
  nodeId: string
  portName: string
  nodeName: string
  data: number[][]
  rows: number
  cols: number
  outputType: 'grid'
  visible: boolean
  updatedAt: number
}

/** Continuous triangle mesh from a Geometry `kind:'mesh'` port. */
export interface MeshPayload {
  positions: readonly number[]
  indices: readonly number[]
  normals?: readonly number[]
  uvs?: SceneMesh['uvs']
  colors?: readonly number[]
  color?: readonly [number, number, number]
  role?: 'terrain' | 'road' | 'houses'
  /**
   * Baked by `paintSurface`. `indices` is already grouped so each run is one
   * contiguous slice, which maps onto a THREE geometry group the same way it
   * maps onto an engine submesh — the viewport and the export therefore show the
   * same appearance without either re-deriving the partition.
   */
  material?: SceneMesh['material']
}

export type GuideStyle = 'polyline' | 'points'

export interface GuidePoint {
  x: number
  y: number
  /** World Z when the user lifted the point; omitted means sit on terrain. */
  z?: number
  sourceNodeId?: string
  sourceOpId?: string
  sourceIndex?: number
  /** Authoring-local XY before ancestor `place()` / node.transform. */
  localX?: number
  localY?: number
  parentTx?: number
  parentTy?: number
  parentYaw?: number
}

export interface GuideLayer {
  key: string
  nodeId: string
  portName: string
  nodeName: string
  points: GuidePoint[]
  /** `polyline` draws CV+segments; `points` draws disconnected handles. */
  style: GuideStyle
  visible: boolean
  updatedAt: number
}

export interface MeshInstanceXform {
  matrix?: readonly number[]
  tx: number
  ty: number
  tz: number
  yaw: number
}

export interface MeshLayer {
  key: string // `${nodeId}:${portName}`
  nodeId: string
  portName: string
  nodeName: string
  mesh: MeshPayload
  triangleCount: number
  visible: boolean
  updatedAt: number
  /** Shared local mesh drawn many times. Authoring metres; renderer flips Y. */
  instances?: readonly MeshInstanceXform[]
}

// The renderer's internal layer (VoxelLayer + resolved name/type + bookkeeping):
export interface RendererVoxelLayer {
  key: string // `${nodeId}:${nodePath}`
  nodeId: string
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  cells: Point3D[]
  /** Summary-only fetch: cell count without loading the full cell array. */
  cellCount?: number
  visible: boolean
  /**
   * True when the layer is switched off by its SOURCE NODE's preview gate
   * (`Disable Preview` on the scene_output battery), as opposed to the user
   * hiding this one layer with the panel eye. Both end up `visible:false`, so
   * without this flag the panel cannot tell them apart and a gated row looks
   * like an ordinary hidden one — clicking its eye then appears to do nothing
   * (the next refresh re-applies the gate).
   */
  nodeDisabled?: boolean
  updatedAt: number
  assetName: string
  assetAlias?: string
  assetType?: string
  /** Scene-node attribute bag (baked layers only; output may omit). */
  attributes?: Record<string, unknown>
  version?: number
  bounds?: { width: number; height: number }
  /**
   * Cached XY extent of `cells`, maintained incrementally by paintBakedCells (an
   * additive paint extends it in O(k); a non-append change drops it). Lets
   * voxelLayerCellSource skip the O(N) bbox scan over all cells on every paint —
   * the per-paint cell-source recreation was the last O(N)-per-paint cost in the
   * paint→visible React render. `undefined` → caller computes it by scanning.
   */
  bbox?: { minX: number; minY: number; maxX: number; maxY: number }
  /**
   * Multi-value (G2) sub-layer breakdown: the distinct voxel `token`s present on
   * this node, in stable first-seen order. A node carrying >1 token becomes a
   * collapsible parent row with one sub-layer per token.
   */
  subTokens?: string[]
  /** Per-token visibility, key = token. Absent → the layer is single-value. */
  subVisible?: Record<string, boolean>
  /** Per-token cell buckets so the canvas can hide a single sub-layer's voxels. */
  cellsByToken?: Record<string, Point3D[]>
}
