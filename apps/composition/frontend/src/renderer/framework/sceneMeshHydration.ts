import { determinant3 } from '@forgeax/scene-authoring/scene-transform'
import { isNumericBuffer } from '@forgeax/scene-authoring/scene-tree'
/**
 * Pull triangle meshes off SceneGraph prims that have no mesh output port.
 *
 * House geometry often hangs on a Ref node's content. Roads / landmarks /
 * mesh_to_node prims hang on `{ schema:'mesh', mesh }`. Preview otherwise only
 * reads declared `mesh` ports, so composed scene trees would draw a top-level
 * Terrain mesh and drop hung house / road prims.
 *
 * Placement instances share one prototype mesh. Hydration groups them so
 * Default can draw InstancedMesh instead of one BufferGeometry per house.
 */

import { childrenOf, pathOf, type NodeId, type SceneGraph } from '../../../../vendor/shared/types/scene/graph.js'
import { contentSchema } from '../../../../vendor/shared/types/scene/content.js'
import type { ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'
import type { MeshInstanceXform, MeshPayload } from '../types'
import { alignPlacementXformToTerrain, applyAuthoringXformToPositions, authoringMeshToRenderer, isIdentityXform, matrixOfXform, relativeXformOf, stageRootOf, worldXformOf } from './sceneWorldXform.js'

export interface SceneContentMesh {
  name: string
  path: string
  portName: string
  mesh: MeshPayload
  instances?: MeshInstanceXform[]
}

function asMeshPayload(value: unknown): MeshPayload | null {
  if (!value || typeof value !== 'object') return null
  const rec = value as {
    positions?: unknown
    indices?: unknown
    uvs?: unknown
    normals?: unknown
    colors?: unknown
    color?: unknown
    role?: unknown
    material?: unknown
  }
  if (!isNumericBuffer(rec.positions) || !isNumericBuffer(rec.indices) || rec.indices.length === 0) return null
  return {
    positions: Array.from(rec.positions),
    indices: Array.from(rec.indices),
    ...(isNumericBuffer(rec.uvs) ? { uvs: Array.from(rec.uvs) } : {}),
    ...(isNumericBuffer(rec.normals) ? { normals: Array.from(rec.normals) } : {}),
    ...(isNumericBuffer(rec.colors) ? { colors: Array.from(rec.colors) } : {}),
    ...(Array.isArray(rec.color) && rec.color.length >= 3
      ? { color: [Number(rec.color[0]), Number(rec.color[1]), Number(rec.color[2])] as [number, number, number] }
      : {}),
    ...(rec.role === 'terrain' || rec.role === 'road' || rec.role === 'houses' ? { role: rec.role } : {}),
    ...(rec.material && typeof rec.material === 'object'
      ? { material: rec.material as MeshPayload['material'] }
      : {}),
  }
}

function meshOf(node: { content?: unknown }): MeshPayload | null {
  if (!node.content || typeof node.content !== 'object') return null
  return asMeshPayload((node.content as { mesh?: unknown }).mesh)
}

function collectPrototypeParts(
  graph: SceneGraph,
  protoRoot: NodeId,
): Array<{ name: string; key:string; mesh: MeshPayload }> {
  const parts: Array<{ name: string; key:string; mesh: MeshPayload }> = []
  const walk = (id: NodeId): void => {
    const node = graph.get(id)
    if (!node) return
    const mesh = meshOf(node)
    if (mesh) {
      const xform = relativeXformOf(graph, id, graph.get(protoRoot)?.parent ?? '')
      parts.push({ name: node.name, key:id, mesh: authoringMeshToRenderer(mesh, xform) })
    }
    for (const child of childrenOf(graph, id)) walk(child.id)
  }
  walk(protoRoot)
  return parts
}

function collectPrototypeLibrary(graph: SceneGraph, root: NodeId): Map<string, Array<{ name: string; key:string; mesh: MeshPayload }>> {
  const out = new Map<string, Array<{ name: string; key:string; mesh: MeshPayload }>>()
  const walk = (id: NodeId): void => {
    const node = graph.get(id)
    if (!node) return
    if (node.name === 'Prototypes') {
      for (const child of childrenOf(graph, id)) {
        const parts = collectPrototypeParts(graph, child.id)
        if (parts.length > 0) out.set(child.name, parts)
      }
      return
    }
    for (const child of childrenOf(graph, id)) walk(child.id)
  }
  walk(root)
  return out
}

export function collectRefMeshesFromScene(port: ScenePortValue): SceneContentMesh[] {
  return collectRefMeshesFromGraph(port.graph, port.focus)
}

export function collectRefMeshesFromGraph(graph: SceneGraph, focus: NodeId): SceneContentMesh[] {
  const root = stageRootOf(graph, focus)
  const library = collectPrototypeLibrary(graph, root)
  const groups = new Map<string, { name: string; mesh: MeshPayload; instances: MeshInstanceXform[] }>()
  const unique: SceneContentMesh[] = []
  let terrain: MeshPayload | null = null

  const collectTerrain = (id: NodeId): void => {
    const node = graph.get(id)
    if (!node || node.name === 'Prototypes') return
    const mesh = meshOf(node)
    if (mesh?.role === 'terrain' && !terrain) {
      const xform = worldXformOf(graph, id)
      terrain = isIdentityXform(xform)
        ? mesh
        : { ...mesh, positions: applyAuthoringXformToPositions(mesh.positions, xform) }
    }
    for (const child of childrenOf(graph, id)) collectTerrain(child.id)
  }
  collectTerrain(root)

  const walk = (id: NodeId): void => {
    const node = graph.get(id)
    if (!node) return
    if (node.name === 'Prototypes') return
    const protoKey = node.attributes?.prototypeKey
    if (typeof protoKey === 'string' && library.has(protoKey)) {
      const xform = alignPlacementXformToTerrain(worldXformOf(graph, id), terrain)
      for (const part of library.get(protoKey)!) {
        const key = `${protoKey}:${part.key}`
        if(determinant3(matrixOfXform(xform))<0) {
          const path=pathOf(graph,id) ?? id
          const authored=authoringMeshToRenderer(part.mesh,{tx:0,ty:0,tz:0,yaw:0})
          unique.push({name:part.name,path,portName:`mirrored:${path}:${part.key}`,mesh:authoringMeshToRenderer(authored,xform)})
          continue
        }
        let group = groups.get(key)
        if (!group) {
          group = { name: part.name, mesh: part.mesh, instances: [] }
          groups.set(key, group)
        }
        group.instances.push(xform)
      }
      return
    }
    const schema = node.schema || contentSchema(node.content)
    if (schema === 'ref' || schema === 'mesh') {
      const mesh = meshOf(node)
      if (mesh) {
        const path = pathOf(graph, id) ?? `/${node.name}`
        const xform = worldXformOf(graph, id)
        unique.push({
          name: node.name,
          path,
          portName: `${schema}:${path}`,
          mesh: authoringMeshToRenderer(mesh, xform),
        })
      }
    }
    for (const child of childrenOf(graph, id)) walk(child.id)
  }
  walk(root)

  const instanced: SceneContentMesh[] = []
  for (const [key, group] of groups) {
    instanced.push({
      name: group.name,
      path: `/instances/${key}`,
      portName: `instance:${key}`,
      mesh: group.mesh,
      instances: group.instances,
    })
  }
  return [...unique, ...instanced]
}
