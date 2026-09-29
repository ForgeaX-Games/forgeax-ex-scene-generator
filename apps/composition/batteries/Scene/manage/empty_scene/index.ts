/**
 * emptyScene — empty SceneTree root. Graft children with addChild.
 */

import {
  emptyScene as emptySceneGraph,
  makeScenePort,
  type ScenePortValue,
} from '../../../../vendor/shared/types/index.js'

interface EmptySceneResult {
  scene: ScenePortValue
}

export function emptyScene(_input: Record<string, unknown> = {}): EmptySceneResult {
  const { graph, focus } = emptySceneGraph()
  return { scene: makeScenePort(graph, focus) }
}
