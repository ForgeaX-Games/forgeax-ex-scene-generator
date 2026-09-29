/**
 * Ambient types for the vendored scene bundle(s).
 *
 * The compiled bundles ship no `.d.ts`, and their `.ts` source lives outside
 * the backend `rootDir`, so we declare the small surface actually used here.
 * The runtime loads the real (ESM) bundles — the SAME ones the batteries
 * import — so behavior stays byte-for-byte consistent with the graph's scene
 * semantics.
 *
 * Two separate module declarations, mirroring the two independent formats:
 *   - `scene/tree.js`  — OLD nested-tree implementation. Kept alive ONLY for
 *     `baked/store.ts`'s own persisted `baked-scene.json` format, which is a
 *     second, graph-independent service deliberately excluded from the v3
 *     SceneGraph refactor (see scene-v3-refactor-spec canvas's "范围之外"
 *     callout). Not exported from the main barrel — see `scene/index.ts`.
 *   - `scene/index.js` — the v3 barrel (SceneGraph/NodeId/Volume/ScenePortValue
 *     + projectSceneToVoxelLayers). Used by `snapshot-from-execute.ts` to
 *     project a raw in-process ExecutionResult's scene ports into bake layers.
 */
declare module '*/vendor/dist/shared/types/scene/tree.js' {
  export interface VoxelCell {
    x: number
    y: number
    z: number
    token: string
    state?: Readonly<Record<string, unknown>>
  }
  export interface SceneNodeSnapshot {
    name: string
    path: string
    schema?: string
    version: number
    cells?: readonly VoxelCell[]
    children: readonly SceneNodeSnapshot[]
    attributes?: Readonly<Record<string, unknown>>
    bounds?: Readonly<{ width: number; height: number }>
  }
  export function emptyTree(): SceneNodeSnapshot
  export function readNode(root: SceneNodeSnapshot, path: string): SceneNodeSnapshot | null
  export function splitPath(path: string): string[]
  export function upsertCells(
    root: SceneNodeSnapshot,
    path: string,
    data: { schema: string; cells: readonly VoxelCell[]; bounds?: { width: number; height: number } },
    newVersion: number,
  ): SceneNodeSnapshot
  export function setAttribute(
    root: SceneNodeSnapshot,
    path: string,
    key: string,
    value: unknown,
    newVersion: number,
  ): SceneNodeSnapshot
  export function upsertSubtree(
    root: SceneNodeSnapshot,
    destPath: string,
    source: SceneNodeSnapshot,
    newVersion: number,
  ): SceneNodeSnapshot
}

declare module '*/vendor/dist/shared/types/scene/index.js' {
  export interface VoxelCell {
    x: number
    y: number
    z: number
    token: string
    state?: Readonly<Record<string, unknown>>
  }
  /** Kept as an alias for the old baked-store ambient surface; unrelated to SceneNode/SceneGraph. */
  export interface SceneNodeSnapshot {
    name: string
    path: string
    schema?: string
    version: number
    cells?: readonly VoxelCell[]
    children: readonly SceneNodeSnapshot[]
    attributes?: Readonly<Record<string, unknown>>
    bounds?: Readonly<{ width: number; height: number }>
  }

  /** Opaque NodeId — a string handle, never constructed by hand outside vendor. */
  export type NodeId = string
  export interface SceneNode {
    id: NodeId
    name: string
    parent: NodeId | null
    order: number
    schema?: string
    content?: Volume
    bounds?: Readonly<{ width: number; height: number }>
    attributes?: Readonly<Record<string, unknown>>
  }
  /** Opaque persistent graph handle — treated mostly as a black box outside vendor. */
  export interface SceneGraph {
    get(id: NodeId): SceneNode | undefined
  }
  export interface ScenePortValue {
    graph: SceneGraph
    focus: NodeId
  }
  export function parseScenePort(value: unknown): ScenePortValue | null
  export function isLiveSceneGraph(value: unknown): value is SceneGraph
  export function getNode(graph: SceneGraph, id: NodeId): SceneNode | null
  export function childrenOf(graph: SceneGraph, id: NodeId): SceneNode[]
  export function pathOf(graph: SceneGraph, id: NodeId): string | null

  export type Volume =
    | { kind: 'empty' }
    | { kind: 'uniform'; token: string }
    | { kind: 'dense'; count: number }
    | { kind: 'sparse'; cells: ReadonlyMap<string, { token: string }> }
  export function cellCount(v: Volume): number

  export interface VoxelLayer {
    nodePath: string
    nodeName: string
    value: number
    schema?: string
    cells: ReadonlyArray<VoxelCell>
  }
  export interface NameListEntry {
    id: number
    name: string
    alias?: string
    type?: string
  }
  export interface VoxelOutputBundle {
    layers: readonly VoxelLayer[]
    names: readonly NameListEntry[]
  }
  export function projectSceneToVoxelLayers(graph: SceneGraph, focus: NodeId): VoxelOutputBundle
}
