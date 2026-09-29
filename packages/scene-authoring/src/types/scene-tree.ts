/** Live authoring graph view, shared across the Scene Script host and composition.
 * The native SceneAsset entity table is the interchange format, not this editing index.
 * SceneMesh is static triangle authoring input; native MeshAsset also carries wider
 * engine-only capabilities which are preserved by the document codec.
 */

export type SceneNodeId = string

/** Data contract only: metres, quaternion [x,y,z,w], parent-local TRS. */
export interface SceneTransform {
  readonly pos?: readonly [number, number, number]
  readonly quat?: readonly [number, number, number, number]
  readonly scale?: readonly [number, number, number]
}
export type FloatBuffer = readonly number[] | Float32Array
export type IndexBuffer = readonly number[] | Uint16Array | Uint32Array
export function isNumericBuffer(value: unknown): value is FloatBuffer | IndexBuffer {
  return Array.isArray(value) || value instanceof Float32Array || value instanceof Uint16Array || value instanceof Uint32Array
}

export const SCENE_CONTENT_SCHEMAS = ['voxel', 'mesh'] as const
export type SceneContentSchema = (typeof SCENE_CONTENT_SCHEMAS)[number]

/**
 * One baked material appearance. Every field maps 1:1 onto the engine's
 * `Materials.standard` opts, so the exporter never has to translate: a rule
 * returns these and they become a `material/*` asset verbatim.
 */
/** Self-contained image data; no file-system or renderer dependency. */
export interface SurfaceTexture {
  readonly width: number
  readonly height: number
  readonly rgba8: string
  readonly colorSpace: 'srgb' | 'linear'
  readonly scale?: readonly [number, number]
}
export interface SurfaceAppearance {
  /** [0, 1]; positive values discard alpha <= cutoff, write depth and cast cutout shadows. */
  readonly alphaCutoff?: number
  readonly baseColorTexture?: SurfaceTexture
  readonly normalTexture?: SurfaceTexture
  readonly metallicRoughnessTexture?: SurfaceTexture
  readonly baseColor: readonly [number, number, number, number]
  readonly roughness?: number
  readonly metallic?: number
  readonly emissive?: readonly [number, number, number]
  readonly emissiveIntensity?: number
}

/**
 * One contiguous slice of `SceneMesh.indices` sharing a palette entry.
 * `paintSurface` reorders the index buffer so every run is contiguous, which is
 * what lets both the engine (`submeshes`) and the viewport (`addGroup`) consume
 * the partition without re-deriving it.
 */
export interface SurfaceRun {
  /** Index into `SceneMesh.material.palette`. */
  readonly surface: number
  readonly indexOffset: number
  readonly indexCount: number
}

export interface SceneMesh {
  readonly positions: FloatBuffer
  readonly indices: IndexBuffer
  readonly normals?: FloatBuffer
  /** Per-vertex uv pairs. Produced by heightfield_mesh / surfaceBand; absent elsewhere. */
  readonly uvs?: FloatBuffer
  /** Linear RGB triples. Native publication expands these to RGBA. */
  readonly colors?: FloatBuffer
  readonly color?: readonly [number, number, number]
  readonly role?: 'terrain' | 'road' | 'houses'
  readonly structure?: string
  readonly part?: string
  /**
   * Baked material. `surface` alone is the constant case; `palette` + `runs`
   * carry a rule that varied across the surface (see `paintSurface`). Painted
   * meshes always have both, and `indices` is already grouped to match.
   */
  readonly material?: {
    /** `defineMaterial` name. The exporter derives the asset sourceKey from it. */
    readonly id?: string
    readonly surface?: SurfaceAppearance
    readonly palette?: readonly SurfaceAppearance[]
    readonly runs?: readonly SurfaceRun[]
  }
}

/** Official scene content. Grid is a script value, not a scene-tree schema. */
export type SceneContent =
  | { readonly schema: 'voxel'; readonly volume?: unknown }
  | { readonly schema: 'mesh'; readonly mesh?: SceneMesh }

/** Discriminated content, or a raw volume still treated as voxel. */
export type SceneNodeContent =
  | SceneContent
  | { readonly kind: 'empty' | 'uniform' | 'dense' | 'sparse' }

export interface SceneNode<Content = SceneNodeContent, Children = ReadonlyMap<string, SceneNodeId> | Readonly<Record<string, SceneNodeId>>> {
  readonly id: SceneNodeId
  readonly name: string
  readonly parent: SceneNodeId | null
  readonly children: Children
  readonly order?: number
  readonly content?: Content
  readonly schema?: SceneContentSchema | string
  readonly transform?: SceneTransform
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly bounds?: Readonly<{ width: number; height: number }>
}

/** Live map (has `get`) or revived JSON record. */
export type SceneGraph =
  | { get(id: SceneNodeId): SceneNode | null | undefined }
  | Readonly<Record<SceneNodeId, SceneNode>>

export interface SceneTree {
  readonly graph: SceneGraph
  readonly focus: SceneNodeId
  readonly focusOrigin?: string
}

/** Old wire name. Same value as SceneTree. */
export type ScenePortValue = SceneTree

export function isSceneTree(value: unknown): value is SceneTree {
  if (!value || typeof value !== 'object') return false
  const rec = value as { graph?: unknown; focus?: unknown }
  return typeof rec.focus === 'string' && rec.graph !== null && typeof rec.graph === 'object'
}

export const isScenePortValue = isSceneTree
