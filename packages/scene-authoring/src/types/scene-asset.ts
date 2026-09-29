/** Scene interchange protocol, matched to Engine c5f44d1e1.
 * Structural types only. No Engine implementation, branded runtime handles or ECS.
 */
export type ComponentValues = Readonly<
  Record<string, Readonly<Record<string, unknown>>>
>
export interface SceneEntity {
  readonly localId: number
  readonly bindingKey?: string
  readonly components: ComponentValues
}
export interface SceneMount {
  readonly localId: number
  readonly source: string | number
  readonly memberFirst: number
  readonly memberCount: number
  readonly parent?: number
  readonly components?: ComponentValues
  readonly overrides?: readonly {
    localId: number
    comp: string
    field?: string
    value: unknown
  }[]
  readonly publicationFence?: {
    schemaVersion: 'scene-publication-fence/1'
    sourcePath: string
    sourceRevision: string
    publicationGeneration: number
    outputDigest: string
    outputSetDigest: string
    receiptIdentity: string
  }
}
export interface SceneAsset {
  readonly kind: 'scene'
  readonly sourceKey?: string
  readonly entities: readonly SceneEntity[]
  readonly mounts?: readonly SceneMount[]
  readonly skinGuids?: readonly string[]
}
export type VertexAttributeName =
  | 'position'
  | 'normal'
  | 'uv'
  | 'tangent'
  | 'skinIndex'
  | 'skinWeight'
  | 'uv1'
  | 'uv2'
  | 'uv3'
  | 'uv4'
  | 'uv5'
  | 'uv6'
  | 'uv7'
  | 'color'
export type MeshAttributes = Partial<
  Record<VertexAttributeName, ArrayBuffer | Float32Array | Uint16Array>
>
export interface MeshAsset {
  readonly kind: 'mesh'
  readonly vertices: Float32Array
  readonly indices?: Uint16Array | Uint32Array
  readonly attributes: MeshAttributes
  readonly aabb?: Float32Array
  readonly submeshes: readonly {
    indexOffset: number
    indexCount: number
    vertexCount: number
    topology:
      | 'point-list'
      | 'line-list'
      | 'line-strip'
      | 'triangle-list'
      | 'triangle-strip'
    materialSlot: number
  }[]
  readonly materialSlots: readonly {
    slotName: string
    sourceKey?: string
    defaultMaterial?: Uint8Array
  }[]
  readonly lods?: readonly { mesh: Uint8Array; screenCoverage: number }[]
  readonly lodHysteresis?: number
  readonly morphTargets?: readonly {
    position?: Float32Array
    normal?: Float32Array
    tangent?: Float32Array
  }[]
  readonly morphWeights?: Float32Array
}

/** The original asset payload is retained even when preview supports only a subset. */
export interface SceneDocument {
  readonly scene: SceneAsset
  readonly assets: Readonly<
    Record<
      string,
      | MeshAsset
      | SceneAsset
      | { readonly kind: string; readonly [field: string]: unknown }
    >
  >
  readonly authoring?: Readonly<Record<string, unknown>>
}
