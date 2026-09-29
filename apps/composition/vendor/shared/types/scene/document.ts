import { staticMeshAsset } from '@forgeax/scene-authoring/mesh-asset'
import type {
  SceneDocument,
  SceneEntity,
  MeshAsset,
} from '@forgeax/scene-authoring/scene-asset'
import type {
  SceneMesh,
  SceneTransform,
} from '@forgeax/scene-authoring/scene-tree'
import { childId, type SceneGraph, type SceneNode } from './graph.js'
import { PersistentStringMap } from './persistent-map.js'
import { reviveContentFromWire } from './content.js'

/** Native scene data is +Y-up. Authoring geometry uses XY plans with +Z elevation. */
function vector(values: ArrayLike<number>, inverse = false): Float32Array {
  const out = new Float32Array(values.length)
  for (let i = 0; i + 2 < values.length; i += 3) {
    out[i] = values[i]!
    out[i + 1] = inverse ? -values[i + 2]! : values[i + 2]!
    out[i + 2] = inverse ? values[i + 1]! : -values[i + 1]!
  }
  return out
}
function pose(value: SceneTransform, inverse = false): SceneTransform {
  const pos = value.pos,
    quat = value.quat,
    scale = value.scale
  return {
    ...(pos
      ? { pos: Array.from(vector(pos, inverse)) as [number, number, number] }
      : {}),
    ...(quat
      ? {
          quat: [
            quat[0],
            inverse ? -quat[2] : quat[2],
            inverse ? quat[1] : -quat[1],
            quat[3],
          ] as const,
        }
      : {}),
    ...(scale ? { scale: [scale[0], scale[2], scale[1]] as const } : {}),
  }
}
function resourceGuid(key: string): string {
  const hex =
    childId('scene-resource', key) + childId('scene-resource-suffix', key)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}
function meshAsset(mesh: SceneMesh): MeshAsset {
  return staticMeshAsset({
    ...mesh,
    positions: vector(mesh.positions),
    ...(mesh.normals ? { normals: vector(mesh.normals) } : {}),
  })
}

/** Native entity/resource snapshot; authoring metadata contains no duplicate mesh buffers. */
export function sceneDocumentFromGraph(
  graph: SceneGraph,
  focus: string,
  focusOrigin?: string,
): SceneDocument {
  const nodes = [...graph.entries()].map(([, node]) => node)
  const ids = new Map(nodes.map((node, index) => [node.id, index]))
  const entities: SceneEntity[] = [],
    assets: Record<string, MeshAsset> = {}
  const meshIds = new Map<SceneMesh, string>(),
    metadata: Record<string, unknown> = {}
  for (const node of nodes) {
    const content =
      node.content && 'schema' in node.content && node.content.schema === 'mesh'
        ? node.content
        : undefined
    const mesh = content?.mesh
    let guid: string | undefined
    if (mesh) {
      guid = meshIds.get(mesh)
      if (!guid) {
        guid = resourceGuid(node.id)
        meshIds.set(mesh, guid)
        assets[guid] = meshAsset(mesh)
      }
    }
    const components: Record<string, Readonly<Record<string, unknown>>> = {
      Name: { value: node.name },
      Transform: pose(node.transform ?? {}) as Readonly<
        Record<string, unknown>
      >,
      ...(node.parent === null
        ? {}
        : { ChildOf: { parent: ids.get(node.parent) } }),
      ...(guid
        ? { MeshFilter: { assetHandle: guid }, MeshRenderer: { materials: [] } }
        : {}),
    }
    entities.push({
      localId: ids.get(node.id)!,
      bindingKey: node.id,
      components,
    })
    metadata[node.id] = {
      hasTransform: !!node.transform,
      order: node.order,
      schema: node.schema,
      bounds: node.bounds,
      attributes: node.attributes,
      ...(mesh
        ? {
            mesh: {
              hasNormals: !!mesh.normals,
              hasUvs: !!mesh.uvs,
              color: mesh.color,
              role: mesh.role,
              structure: mesh.structure,
              part: mesh.part,
              material: mesh.material,
            },
          }
        : { content: node.content }),
    }
  }
  return {
    scene: { kind: 'scene', entities },
    assets,
    authoring: { focus, focusOrigin, nodes: metadata, frame: 'authoring-z-up' },
  }
}

/** Rebuild the editing index from our explicit authoring snapshot, never guess unknown asset semantics. */
export function graphFromSceneDocument(document: SceneDocument): {
  graph: SceneGraph
  focus: string
  focusOrigin?: string
} {
  if (document.authoring?.frame !== 'authoring-z-up')
    throw new Error(
      'Scene document needs an authoring adapter before editing; native asset data remains available unchanged',
    )
  const { scene, assets, authoring } = document
  const metadata = authoring.nodes as Record<
    string,
    Partial<SceneNode> & {
      hasTransform?: boolean
      mesh?: Partial<SceneMesh> & { hasNormals?: boolean; hasUvs?: boolean }
    }
  >
  const ids = new Map(
    scene.entities.map((entity) => [entity.localId, entity.bindingKey!]),
  )
  const nodes = new Map<string, SceneNode>(),
    meshes = new Map<string, SceneMesh>()
  for (const entity of scene.entities) {
    const id = entity.bindingKey!,
      meta = metadata[id]!,
      components = entity.components
    const guid = components.MeshFilter?.assetHandle as string | undefined
    let mesh: SceneMesh | undefined
    if (guid) {
      mesh = meshes.get(guid)
      if (!mesh) {
        const asset = assets[guid] as MeshAsset
        if (
          !(asset.vertices instanceof Float32Array) ||
          asset.vertices.length % 12 ||
          !asset.indices
        )
          throw new Error(
            'Authoring adapter requires the native static triangle layout',
          )
        const attribute = (
          name: 'position' | 'normal' | 'uv',
          offset: number,
          width: number,
        ): Float32Array => {
          const explicit = asset.attributes[name]
          if (explicit instanceof Float32Array) return explicit
          const values = new Float32Array((asset.vertices.length / 12) * width)
          for (let i = 0; i < values.length / width; i++)
            for (let k = 0; k < width; k++)
              values[i * width + k] = asset.vertices[i * 12 + offset + k]!
          return values
        }
        const position = attribute('position', 0, 3)
        const { hasNormals, hasUvs, ...meshMetadata } = meta.mesh ?? {}
        mesh = {
          ...meshMetadata,
          positions: vector(position, true),
          indices: asset.indices,
          ...(hasNormals
            ? { normals: vector(attribute('normal', 3, 3), true) }
            : {}),
          ...(hasUvs ? { uvs: attribute('uv', 6, 2) } : {}),
          ...(asset.attributes.color instanceof Float32Array
            ? { colors: asset.attributes.color.filter((_, i) => i % 4 !== 3) }
            : {}),
        }
        meshes.set(guid, mesh)
      }
    }
    nodes.set(id, {
      id,
      name: components.Name?.value as string,
      parent: components.ChildOf
        ? ids.get(components.ChildOf.parent as number)!
        : null,
      children: new Map(),
      order: meta.order ?? 0,
      ...(meta.hasTransform
        ? { transform: pose(components.Transform as SceneTransform, true) }
        : {}),
      schema: meta.schema,
      attributes: meta.attributes,
      bounds: meta.bounds,
      ...(mesh
        ? { content: { schema: 'mesh', mesh } }
        : meta.content
          ? { content: reviveContentFromWire(meta.content) }
          : {}),
    })
  }
  for (const node of nodes.values())
    if (node.parent !== null)
      (nodes.get(node.parent)!.children as Map<string, string>).set(
        node.name,
        node.id,
      )
  let graph = PersistentStringMap.empty<SceneNode>()
  for (const [id, node] of nodes) graph = graph.set(id, node)
  return {
    graph,
    focus: authoring.focus as string,
    ...(typeof authoring.focusOrigin === 'string'
      ? { focusOrigin: authoring.focusOrigin }
      : {}),
  }
}
