import { transformMatrix, multiplyMatrices, transformPoint, IDENTITY_MATRIX, type Matrix4 } from '@forgeax/scene-authoring/scene-transform'
import type { SceneTransform, FloatBuffer, IndexBuffer } from '@forgeax/scene-authoring/scene-tree'
import { SURFACE_TEXTURE_CHANNELS, surfaceTextureKey, surfaceTextureMapsKey, validateSurfaceTextureMaps, projectSurfaceUvs, type SurfaceTextureMaps, type SurfaceTexture } from '../../../vendor/dist/shared/types/scene/surfaceTexture.js'
export { decodeSurfaceTexture, SURFACE_TEXTURE_CHANNELS, surfaceTextureKey } from '../../../vendor/dist/shared/types/scene/surfaceTexture.js'
/**
 * SceneTree -> engine-ready vertex/entity IR. Pure: no engine, no backend, no
 * repo imports, so the exporter can copy this file verbatim into the emitted
 * `platform/` and both sides run the *same* projection. That is what makes
 * "导出的场景 == scene output 的场景" a construction guarantee instead of a
 * comparison. The engine-typed half (meshFromInterleaved / Materials /
 * definePack) lives only in the emitted `<slug>.pack.ts`.
 *
 * Because the copy lands in a foreign package, the SceneTree input is typed
 * structurally here rather than imported from `@forgeax/scene-authoring`.
 */

/** Interleaved stride the engine's `meshFromInterleaved` expects: pos3 + normal3 + uv2. */
export const PACK_FLOATS_PER_VERTEX = 8

/** Scene space is +Z up; the engine is +Y up. Same quaternion the GLB exporter emits. */
export const Y_UP_QUAT: readonly [number, number, number, number] = [
  -0.7071067811865475, 0, 0, 0.7071067811865476,
]

interface BridgeMesh {
  readonly positions: FloatBuffer
  readonly indices: IndexBuffer
  readonly normals?: FloatBuffer
  readonly uvs?: FloatBuffer
  readonly colors?: FloatBuffer
  readonly color?: readonly number[]
  readonly material?: {
    /** `defineMaterial` name. Absent for an unpainted mesh. */
    readonly id?: string
    readonly surface?: BridgeAppearance
    /** Distinct appearances a material rule produced over this mesh. */
    readonly palette?: readonly BridgeAppearance[]
    /** Contiguous index slices, one per palette entry. `indices` is pre-grouped. */
    readonly runs?: readonly {
      readonly surface?: number
      readonly indexOffset?: number
      readonly indexCount?: number
    }[]
  }
}

interface BridgeAppearance extends SurfaceTextureMaps {
  readonly alphaCutoff?: number
  readonly baseColor?: readonly number[]
  readonly roughness?: number
  readonly metallic?: number
  readonly emissive?: readonly number[]
  readonly emissiveIntensity?: number
}

interface BridgeNode {
  readonly transform?: SceneTransform
  readonly id: string
  readonly name?: string
  readonly parent?: string | null
  readonly children?: ReadonlyMap<string, string> | Readonly<Record<string, string>>
  readonly order?: number
  readonly content?: { readonly schema?: string; readonly mesh?: BridgeMesh }
}

interface BridgeGraph {
  get?(id: string): BridgeNode | null | undefined
}

export interface BridgeSceneTree {
  readonly graph: BridgeGraph | Readonly<Record<string, BridgeNode>>
  readonly focus: string
}

export interface PackSurface extends SurfaceTextureMaps {
  readonly alphaCutoff?: number
  readonly baseColor: readonly [number, number, number, number]
  readonly roughness: number
  readonly metallic: number
  readonly emissive?: readonly [number, number, number]
  readonly emissiveIntensity?: number
}

/**
 * One `material/*` asset in the emitted pack, deduped across the WHOLE scene by
 * (material name, appearance). A hundred houses sharing one `defineMaterial`
 * therefore cost one material asset, not a hundred.
 */
export interface PackMaterial {
  /** sourceKey suffix: the asset is `material/<key>`. */
  readonly key: string
  readonly surface: PackSurface
}

/**
 * One draw range of a mesh. Maps 1:1 onto the engine's `Submesh` +
 * `materialSlots` pair; `material` indexes `PackProjection.materials`.
 */
export interface PackMeshRun {
  readonly material: number
  readonly indexOffset: number
  readonly indexCount: number
}

export interface PackMesh {
  readonly colors?: Float32Array
  readonly localBounds: readonly number[]
  /** stride-8 interleaved buffer, ready for `meshFromInterleaved`. */
  readonly vertices: Float32Array
  readonly indices: Uint32Array
  readonly vertexCount: number
  readonly triangleCount: number
  /**
   * Draw ranges in index order, at least one, together covering `indices`
   * exactly. An unpainted mesh has a single run over the whole buffer, which is
   * the shape the exporter emitted before materials existed.
   */
  readonly runs: readonly PackMeshRun[]
  /** true when uvs were projected here because the scene mesh carried none. */
  readonly uvsGenerated: boolean
  /** Legacy projection field; zero because mesh coordinates stay author-local. */
  readonly pivot: readonly [number, number, number]
}

export interface PackEntity {
  readonly transform: SceneTransform
  readonly worldMatrix: Matrix4
  readonly slug: string
  readonly name: string
  /** index into the returned `entities`, or null for a child of the scene root. */
  readonly parentIndex: number | null
  /**
   * Local `Transform.pos`: this entity's pivot expressed in its parent's frame.
   * Still on scene-space axes — the emitted pack's single axis root carries the
   * +Z-up -> +Y-up rotation and child transforms remain full parent-local TRS.
   */
  readonly translation: readonly [number, number, number]
  readonly mesh?: PackMesh
}

/**
 * Axis-aligned extent of every projected mesh, in scene metres. The emitted
 * pack sizes its default sun's shadow coverage off `diagonal`; a fixed metre
 * value cannot serve both a 40 m courtyard and a 2 km range.
 */
export interface PackBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
  /** Body diagonal. 0 when the scene carries no mesh. */
  readonly diagonal: number
}

export interface PackProjection {
  readonly entities: readonly PackEntity[]
  /** Scene-global, deduped. Every `PackMeshRun.material` indexes this. */
  readonly materials: readonly PackMaterial[]
  readonly meshCount: number
  readonly vertexCount: number
  readonly triangleCount: number
  readonly bounds: PackBounds
}

const DEFAULT_SURFACE: PackSurface = { baseColor: [0.62, 0.62, 0.62, 1], roughness: 0.85, metallic: 0 }

function readNode(tree: BridgeSceneTree, id: string): BridgeNode | undefined {
  const graph = tree.graph as BridgeGraph & Record<string, BridgeNode>
  const node = typeof graph.get === 'function' ? graph.get(id) : graph[id]
  return node ?? undefined
}

function childIds(node: BridgeNode): string[] {
  const children = node.children
  if (!children) return []
  return children instanceof Map ? [...children.values()] : Object.values(children)
}

/**
 * `^[a-z0-9][a-z0-9._-]*` per segment — the engine's PACK_SOURCE_KEY_RE.
 * Collisions are resolved by the caller (`uniqueSlug`), never silently merged.
 */
export function slugify(name: string, fallback: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+/, '')
    .replace(/[^a-z0-9._-]+$/, '')
  return cleaned || fallback
}

function appearanceOf(surface: BridgeAppearance | undefined, fallbackColor?: readonly number[]): PackSurface {
  const rgba = surface?.baseColor ?? fallbackColor
  const baseColor: readonly [number, number, number, number] = rgba
    ? [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0, rgba[3] ?? 1]
    : DEFAULT_SURFACE.baseColor
  const emissive = surface?.emissive
  if (surface) validateSurfaceTextureMaps(surface)
  const alphaCutoff = surface?.alphaCutoff
  if (alphaCutoff !== undefined && (typeof alphaCutoff !== 'number' || !Number.isFinite(alphaCutoff) || alphaCutoff < 0 || alphaCutoff > 1)) {
    throw new Error('surface alphaCutoff must be a finite number in [0, 1]')
  }
  return {
    ...(alphaCutoff === undefined ? {} : { alphaCutoff }),
    ...Object.fromEntries(SURFACE_TEXTURE_CHANNELS.filter(k => surface?.[k]).map(k => [k, surface![k]])),
    baseColor,
    roughness: surface?.roughness ?? DEFAULT_SURFACE.roughness,
    metallic: surface?.metallic ?? DEFAULT_SURFACE.metallic,
    ...(emissive && emissive.length >= 3
      ? { emissive: [emissive[0] ?? 0, emissive[1] ?? 0, emissive[2] ?? 0] as const }
      : {}),
    ...(surface?.emissiveIntensity === undefined ? {} : { emissiveIntensity: surface.emissiveIntensity }),
  }
}

/** Stable identity of an appearance, so the scene-global table dedupes by value. */
export function surfaceKey(surface: PackSurface): string {
  const { baseColor: c, roughness, metallic, emissive, emissiveIntensity } = surface
  const textures = surfaceTextureMapsKey(surface)
  return [
    c[0], c[1], c[2], c[3], roughness, metallic,
    emissive ? `${emissive[0]},${emissive[1]},${emissive[2]}` : '',
    emissiveIntensity ?? '', ...(textures ? [textures] : []),
    ...(surface.alphaCutoff === undefined ? [] : [`alphaCutoff:${surface.alphaCutoff}`]),
  ].join('|')
}

interface LocalPalette {
  readonly surfaces: readonly PackSurface[]
  /** Local runs: `surface` indexes `surfaces`, offsets are into the index buffer. */
  readonly runs: readonly { readonly surface: number; readonly indexOffset: number; readonly indexCount: number }[]
}

/**
 * The mesh's own material partition. `paintSurface` already grouped `indices` and
 * recorded the runs, so this only validates and normalizes — a run set that does
 * not tile the index buffer exactly would silently drop or double-draw triangles,
 * which is invisible until someone looks at the mesh in the editor.
 */
function paletteOf(mesh: BridgeMesh, indexCount: number): LocalPalette {
  const palette = mesh.material?.palette
  const runs = mesh.material?.runs
  if (!palette || palette.length === 0 || !runs || runs.length === 0) {
    return {
      surfaces: [appearanceOf(mesh.material?.surface, mesh.color)],
      runs: [{ surface: 0, indexOffset: 0, indexCount }],
    }
  }
  const normalized = runs.map((run, at) => ({
    surface: run.surface ?? at,
    indexOffset: run.indexOffset ?? 0,
    indexCount: run.indexCount ?? 0,
  }))
  let cursor = 0
  for (const run of normalized) {
    if (run.indexOffset !== cursor) {
      throw new Error(`material '${mesh.material?.id ?? '?'}' run ${run.surface} starts at ${run.indexOffset}, expected ${cursor}: runs must tile the index buffer in order`)
    }
    if (run.surface < 0 || run.surface >= palette.length) {
      throw new Error(`material '${mesh.material?.id ?? '?'}' run points at palette entry ${run.surface}, which does not exist`)
    }
    cursor += run.indexCount
  }
  if (cursor !== indexCount) {
    throw new Error(`material '${mesh.material?.id ?? '?'}' runs cover ${cursor} of ${indexCount} indices`)
  }
  return { surfaces: palette.map((entry) => appearanceOf(entry, mesh.color)), runs: normalized }
}

/** Area-weighted vertex normals, used only when the scene mesh carries none. */
function computeNormals(positions: ArrayLike<number>, indices: ArrayLike<number>): Float32Array {
  const normals = new Float32Array(positions.length)
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i]! * 3
    const b = indices[i + 1]! * 3
    const c = indices[i + 2]! * 3
    const ux = positions[b]! - positions[a]!
    const uy = positions[b + 1]! - positions[a + 1]!
    const uz = positions[b + 2]! - positions[a + 2]!
    const vx = positions[c]! - positions[a]!
    const vy = positions[c + 1]! - positions[a + 1]!
    const vz = positions[c + 2]! - positions[a + 2]!
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    for (const base of [a, b, c]) {
      normals[base] += nx
      normals[base + 1] += ny
      normals[base + 2] += nz
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!)
    if (length === 0) {
      normals[i + 2] = 1
      continue
    }
    normals[i] /= length
    normals[i + 1] /= length
    normals[i + 2] /= length
  }
  return normals
}

/**
 * Per-vertex box projection, one metre per uv unit, picked by the dominant
 * axis of the vertex normal. `meshFromInterleaved` derives tangents from uv:
 * zero uvs do not error, they silently produce a degenerate tangent frame, so
 * every mesh without authored uvs must get some here.
 * Per-vertex (not per-triangle) keeps the vertex/index buffers byte-identical
 * to the scene output — seams at axis boundaries are the accepted cost.
 */

interface BuiltMesh extends Omit<PackMesh, 'runs'> {
  readonly palette: LocalPalette
  readonly materialId?: string
}

function buildMesh(mesh: BridgeMesh): BuiltMesh {
  const unsupported=['attributes','tangents','lods','morphTargets','morphWeights','skinIndex','skinWeight','uv1','uv2','uv3','uv4','uv5','uv6','uv7'].filter(key=>key in mesh)
  if(unsupported.length) throw new Error(`Static scene authoring cannot publish native mesh fields: ${unsupported.join(', ')}. Preserve these in a native SceneDocument until an editing adapter is available.`)
  const { positions, indices } = mesh
  const vertexCount = positions.length / 3
  if(!Number.isInteger(vertexCount)||!Array.from(positions).every(Number.isFinite)||indices.length%3||Array.from(indices).some(i=>!Number.isInteger(i)||i<0||i>=vertexCount)) throw new Error('Pack mesh requires finite xyz vertices and in-range triangle indices')
  for(const [label,values,width] of [['normals',mesh.normals,3],['uvs',mesh.uvs,2],['colors',mesh.colors,3]] as const) if(values && (values.length!==vertexCount*width || !Array.from(values).every(Number.isFinite))) throw new Error(`Pack mesh ${label} has an invalid vertex attribute layout`)
  if(vertexCount && !Array.from(indices).includes(vertexCount-1)) throw new Error('Pack mesh has unused trailing vertices; compact before publication')
  let colors:Float32Array|undefined
  if(mesh.colors) {colors=new Float32Array(vertexCount*4);for(let i=0;i<vertexCount;i++) colors.set([mesh.colors[i*3]!,mesh.colors[i*3+1]!,mesh.colors[i*3+2]!,1],i*4)}
  const pivot: [number, number, number] = [0, 0, 0]
  const local = Float32Array.from(positions)
  const normals =
    mesh.normals && mesh.normals.length === positions.length
      ? mesh.normals
      : computeNormals(local, indices)
  const uvsGenerated = !(mesh.uvs && mesh.uvs.length === vertexCount * 2)
  const uvs = uvsGenerated ? projectSurfaceUvs(local, normals) : mesh.uvs!
  const vertices = new Float32Array(vertexCount * PACK_FLOATS_PER_VERTEX)
  for (let v = 0; v < vertexCount; v++) {
    const out = v * PACK_FLOATS_PER_VERTEX
    const p = v * 3
    const t = v * 2
    vertices[out] = local[p]!
    vertices[out + 1] = local[p + 1]!
    vertices[out + 2] = local[p + 2]!
    vertices[out + 3] = normals[p]!
    vertices[out + 4] = normals[p + 1]!
    vertices[out + 5] = normals[p + 2]!
    vertices[out + 6] = uvs[t]!
    vertices[out + 7] = uvs[t + 1]!
  }
  const localBounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]
  for(let i=0;i<local.length;i++){const axis=i%3;localBounds[axis]=Math.min(localBounds[axis]!,local[i]!);localBounds[axis+3]=Math.max(localBounds[axis+3]!,local[i]!)}
  return {
    ...(colors?{colors}:{}),
    localBounds,
    vertices,
    indices: Uint32Array.from(indices),
    vertexCount,
    triangleCount: Math.floor(indices.length / 3),
    uvsGenerated,
    pivot,
    palette: paletteOf(mesh, indices.length),
    ...(mesh.material?.id ? { materialId: mesh.material.id } : {}),
  }
}

/**
 * Collects the scene-global `material/*` table. Keys are
 * `<slug(material name)>.<n>` for a painted mesh — shared by every mesh that
 * paints with the same rule and lands the same appearance — and the entity slug
 * for an unpainted one, which is the key the exporter used before materials
 * existed, so those exports are unchanged.
 */
function createMaterialTable() {
  const materials: PackMaterial[] = []
  const byKey = new Map<string, number>()
  const usedKeys = new Set<string>()
  return {
    materials,
    /** Local palette -> global indices, in local order. */
    register(built: BuiltMesh, entitySlug: string): number[] {
      const named = built.materialId !== undefined
      const base = named ? slugify(built.materialId!, entitySlug) : entitySlug
      const referenced = new Set(built.palette.runs.filter(run => run.indexCount > 0).map(run => run.surface))
      return built.palette.surfaces.map((surface, at) => {
        if (!referenced.has(at)) return -1
        const identity = `${base}\u0000${surfaceKey(surface)}`
        const seen = byKey.get(identity)
        if (seen !== undefined) return seen
        // Named materials suffix the variant ordinal; an unpainted mesh keeps the
        // bare entity slug so its sourceKey does not move.
        let key = named ? `${base}.${at}` : base
        for (let bump = 2; usedKeys.has(key); bump++) key = `${base}.${at}-${bump}`
        usedKeys.add(key)
        byKey.set(identity, materials.length)
        materials.push({ key, surface })
        return materials.length - 1
      })
    },
  }
}

/**
 * Depth-first walk from `focus`, one entity per scene node so the emitted pack
 * keeps the authored hierarchy. Order is the node's `order` then child-key
 * order — deterministic, because sourceKeys are derived from it.
 */
export function projectScene(input: BridgeSceneTree | { readonly scene: BridgeSceneTree }): PackProjection {
  const tree = 'graph' in input ? input : input.scene
  if (!tree?.graph || typeof tree.focus !== 'string') throw new Error('Selected scene entry must return a SceneTree or an object containing scene')
  const entities: PackEntity[] = []
  const materialTable = createMaterialTable()
  const meshCache = new Map<BridgeMesh,PackMesh>()
  const used = new Map<string, number>()
  const uniqueSlug = (name: string, fallback: string): string => {
    const base = slugify(name, fallback)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}-${seen + 1}`
  }
  const visit = (
    id: string,
    parentIndex: number | null,
    parentPivot: readonly [number, number, number],
    seen: Set<string>,
    parentWorld: Matrix4,
  ): void => {
    if (seen.has(id)) throw new Error(`Scene hierarchy repeats node '${id}' (cycle or multiple parents)`)
    seen.add(id)
    const node = readNode(tree, id)
    if (!node) throw new Error(`Scene hierarchy references missing node '${id}'`)
    const name = node.name || id
    if(node.content && node.content.schema !== 'mesh' && node.content.schema !== 'ref') throw new Error(`Scene node '${name}' has unsupported native-pack content '${node.content.schema ?? 'voxel'}'; produce an explicit mesh before publication`)
    const raw = node.content?.mesh
    const cachedMesh = raw ? meshCache.get(raw) : undefined
    const built = !cachedMesh && raw && raw.positions.length >= 3 && raw.indices.length >= 3 ? buildMesh(raw) : undefined
    // A mesh-less node has no geometry of its own to anchor, so it stays a pure
    // pass-through: it inherits the parent's pivot and contributes no offset.
    const pivot = built ? built.pivot : parentPivot
    const index = entities.length
    const slug = uniqueSlug(id, `node-${index}`)
    const transform = node.transform ?? {}
    const worldMatrix = multiplyMatrices(parentWorld, transformMatrix(transform))
    let mesh: PackMesh | undefined = cachedMesh
    if (built) {
      const { palette, materialId: _materialId, ...core } = built
      const globalIndices = materialTable.register(built, slug)
      mesh = {
        ...core,
        runs: palette.runs.map((run) => ({
          material: globalIndices[run.surface]!,
          indexOffset: run.indexOffset,
          indexCount: run.indexCount,
        })),
      }
      meshCache.set(raw!,mesh)
    }
    entities.push({
      slug,
      name,
      parentIndex,
      translation: transform.pos ?? [0, 0, 0],
      transform, worldMatrix,
      ...(mesh ? { mesh } : {}),
    })
    // Same ordering as the graph's own `childrenOf`: (order, id).
    const kids = childIds(node)
      .map((childId) => ({ childId, order: readNode(tree, childId)?.order ?? 0 }))
      .sort((a, b) => a.order - b.order || (a.childId < b.childId ? -1 : a.childId > b.childId ? 1 : 0))
    for (const { childId } of kids) visit(childId, index, pivot, seen, worldMatrix)
  }
  visit(tree.focus, null, [0, 0, 0], new Set(), IDENTITY_MATRIX)
  const meshes = entities.filter((entity) => entity.mesh)
  return {
    entities,
    materials: materialTable.materials,
    meshCount: meshes.length,
    vertexCount: meshes.reduce((sum, entity) => sum + entity.mesh!.vertexCount, 0),
    triangleCount: meshes.reduce((sum, entity) => sum + entity.mesh!.triangleCount, 0),
    bounds: (() => {
      const min: [number,number,number] = [Infinity,Infinity,Infinity], max: [number,number,number] = [-Infinity,-Infinity,-Infinity]
      for (const entity of meshes) for (let i=0;i<8;i++) {
        const b=entity.mesh!.localBounds, p=transformPoint(entity.worldMatrix,b[(i&1)?3:0]!,b[(i&2)?4:1]!,b[(i&4)?5:2]!)
        for(let axis=0;axis<3;axis++){ min[axis]=Math.min(min[axis]!,p[axis]!);max[axis]=Math.max(max[axis]!,p[axis]!) }
      }
      return min[0] === Infinity ? {min:[0,0,0] as const,max:[0,0,0] as const,diagonal:0} : {min,max,diagonal:Math.hypot(max[0]-min[0],max[1]-min[1],max[2]-min[2])}
    })(),
  }
}

/** Texture images dedupe across material names and UV scales. First occurrence fixes stable keys. */
export function collectMaterialTextures(materials: readonly PackMaterial[]): { key: string; source: SurfaceTexture }[] {
  const seen = new Set<string>(), result: { key: string; source: SurfaceTexture }[] = []
  for (const material of materials) for (const channel of SURFACE_TEXTURE_CHANNELS) {
    const source = material.surface[channel]
    if (!source) continue
    const identity = surfaceTextureKey(source)
    if (!seen.has(identity)) { seen.add(identity); result.push({ key: `surface-${result.length}`, source }) }
  }
  return result
}
