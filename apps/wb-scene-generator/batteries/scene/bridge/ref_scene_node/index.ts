/**
 * ref_scene_node: hang a reference to another .scene.ts as a Prim.
 * Mesh is optional — missing geometry stays a Ref, it does not 500.
 */

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  refContent,
  type SceneMesh,
  type ScenePortValue,
} from '../../../../vendor/shared/types/index.js'

export interface RefSceneNodeResult {
  scene?: ScenePortValue
  triangleCount: number
  error?: string
}

function isMesh(value: unknown): value is SceneMesh {
  if (!value || typeof value !== 'object') return false
  const rec = value as { positions?: unknown; indices?: unknown }
  return Array.isArray(rec.positions) && Array.isArray(rec.indices)
}

export function refSceneNode(input: Record<string, unknown>): RefSceneNodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { triangleCount: 0, error: 'name is required' }
  if (rawName.includes('/')) return { triangleCount: 0, error: "name must not contain '/'" }
  const modulePath = typeof input.module === 'string' ? input.module.trim() : ''
  if (!modulePath) return { triangleCount: 0, error: 'module is required' }
  const exportName = typeof input.exportName === 'string' && input.exportName.trim()
    ? input.exportName.trim()
    : undefined
  const mesh = isMesh(input.mesh) ? input.mesh : undefined
  const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
    {
      name: rawName,
      schema: 'ref',
      content: refContent({ module: modulePath, ...(exportName ? { exportName } : {}), ...(mesh ? { mesh } : {}) }),
      attributes: { ref: { module: modulePath, ...(exportName ? { exportName } : {}) } },
    },
  ])
  return {
    scene: makeScenePort(graph, ids[0]!),
    triangleCount: mesh ? mesh.indices.length / 3 : 0,
  }
}
