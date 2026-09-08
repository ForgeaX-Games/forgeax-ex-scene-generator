/**
 * scene_output — 把 scene 同步到渲染器（sink）。
 *
 * 输入：
 *   - scene  : 要同步的 scene（focus 子树为同步范围）
 *
 * 输出：
 *   - layers : VoxelLayer[]（每个带 cells 的节点一条；value 1..N）
 *   - names  : NameListEntry[]（与 layers 对齐；name/type 优先取 attributes.asset_name/asset_type）
 *
 * UI 上 hideOutputs:true 隐藏右侧 handle，但 NODE_OUTPUT 仍正常发射；
 * 渲染器订阅 outputType==='voxel_layers' 写入 layers 桶完成同步。
 *
 * 投影逻辑全部委托给 shared/types/scene/projection.ts，电池仅做端口校验 + 调用。
 */

import {
  parseScenePort,
  projectSceneToVoxelLayers,
  type VoxelLayer,
  type NameListEntry,
} from '../../../../vendor/dist/shared/types/index.js';

interface SceneOutputResult {
  layers?: VoxelLayer[];
  names?: NameListEntry[];
  scene?: unknown;
  graph?: unknown;
  focus?: string;
  error?: string;
}

export function sceneOutput(input: Record<string, unknown>): SceneOutputResult {
  const port = parseScenePort(input.scene);
  if (!port) return { error: 'scene is required and must be a ScenePortValue' };
  const { layers, names } = projectSceneToVoxelLayers(port.graph, port.focus);
  return { layers, names, scene: port, graph: port.graph, focus: port.focus };
}
