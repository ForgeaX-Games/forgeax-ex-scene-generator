/**
 * scene_output — 把 scene 同步到渲染器（sink）。
 *
 * 输入：
 *   - scene  : 要同步的 scene（focus 子树为同步范围）
 *
 * 输出：
 *   - layers : VoxelLayer[]（每个带 cells 的节点一条；value 1..N）
 *   - names  : NameListEntry[]（与 layers 对齐；mesh-only 场景仍带 triangleCount）
 *
 * UI 上 hideOutputs:true 隐藏右侧 handle，但 NODE_OUTPUT 仍正常发射；
 * 渲染器订阅 outputType==='voxel_layers' 写入 layers 桶完成同步。
 *
 * 投影逻辑全部委托给 shared/types/scene/projection.ts，电池仅做端口校验 + 调用。
 * Execute summaries often omit the passthrough `scene` port, so names carries
 * compact mesh counts that verification can see without the geometry payload.
 */

import {
  childrenOf,
  getNode,
  parseScenePort,
  projectSceneToVoxelLayers,
  type NameListEntry,
  type SceneGraph,
  type SceneNode,
  type VoxelLayer,
} from '../../../../vendor/shared/types/index.js'

interface SceneOutputName extends NameListEntry {
  meshCount?: number
  triangleCount?: number
}

interface SceneOutputResult {
  layers?: VoxelLayer[];
  names?: SceneOutputName[];
  scene?: unknown;
  graph?: unknown;
  focus?: string;
  error?: string;
}

function meshTriangles(node: SceneNode): number {
  const content = node.content as { schema?: unknown; mesh?: { indices?: unknown; positions?: unknown } } | undefined
  if (!content || content.schema !== 'mesh' || !content.mesh) return 0
  const indices = content.mesh.indices
  if (Array.isArray(indices) && indices.length >= 3) return Math.floor(indices.length / 3)
  const positions = content.mesh.positions
  return Array.isArray(positions) && positions.length >= 9 ? Math.floor(positions.length / 9) : 0
}

function countFocusMeshes(graph: SceneGraph, focus: string): { meshes: number; triangles: number } {
  let meshes = 0
  let triangles = 0
  const walk = (id: string): void => {
    const node = getNode(graph, id)
    if (!node) return
    const count = meshTriangles(node)
    if (count > 0) {
      meshes += 1
      triangles += count
    }
    for (const child of childrenOf(graph, node.id)) walk(child.id)
  }
  walk(focus)
  return { meshes, triangles }
}

export function sceneOutput(input: Record<string, unknown>): SceneOutputResult {
  const port = parseScenePort(input.scene);
  if (!port) {
    return { error: 'scene is required and must be a SceneTree' }
  }
  const { layers, names } = projectSceneToVoxelLayers(port.graph, port.focus);
  const geometry = countFocusMeshes(port.graph, port.focus)
  const listed: SceneOutputName[] = names.length > 0
    ? names.map((entry) => ({ ...entry }))
    : geometry.meshes > 0
      ? [{
          id: 1,
          name: getNode(port.graph, port.focus)?.name || 'Terrain',
          type: 'mesh',
        }]
      : []
  if (geometry.meshes > 0 && listed[0]) {
    listed[0] = {
      ...listed[0],
      meshCount: geometry.meshes,
      triangleCount: geometry.triangles,
    }
  }
  return { layers, names: listed, scene: port, graph: port.graph, focus: port.focus };
}
