/**
 * mesh_to_node — hang a mesh on a one-node scene (grid2node counterpart).
 *
 * Output scene content is `{ schema:'mesh', mesh }`. Compose via add_child.
 */

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  meshContent,
  type SceneMesh,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface MeshToNodeResult {
  scene?: ScenePortValue
  triangleCount: number
  error?: string
}

function isMesh(value: unknown): value is SceneMesh {
  if (!value || typeof value !== 'object') return false
  const rec = value as { positions?: unknown; indices?: unknown }
  return Array.isArray(rec.positions) && Array.isArray(rec.indices)
}

export function meshToNode(input: Record<string, unknown>): MeshToNodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { triangleCount: 0, error: 'name is required' }
  if (rawName.includes('/')) return { triangleCount: 0, error: "name must not contain '/'" }
  if (!isMesh(input.mesh)) return { triangleCount: 0, error: 'mesh is required' }

  const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
    { name: rawName, schema: 'mesh', content: meshContent(input.mesh) },
  ])
  return {
    scene: makeScenePort(graph, ids[0]!),
    triangleCount: input.mesh.indices.length / 3,
  }
}
