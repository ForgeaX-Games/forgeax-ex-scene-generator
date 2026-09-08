/**
 * scope_scene_node: a named grouping prim with no geometry of its own.
 */

import {
  ROOT_ID,
  addChildren,
  emptyScene,
  makeScenePort,
  type ScenePortValue,
} from '../../../../vendor/shared/types/index.js'

export interface ScopeSceneNodeResult {
  scene?: ScenePortValue
  error?: string
}

export function scopeSceneNode(input: Record<string, unknown>): ScopeSceneNodeResult {
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (!rawName) return { error: 'name is required' }
  if (rawName.includes('/')) return { error: "name must not contain '/'" }
  const schema = typeof input.schema === 'string' && input.schema.trim() ? input.schema.trim() : 'scope'
  const { graph, ids } = addChildren(emptyScene().graph, ROOT_ID, [
    { name: rawName, schema },
  ])
  return { scene: makeScenePort(graph, ids[0]!) }
}
