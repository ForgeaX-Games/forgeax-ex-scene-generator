/**
 * empty_scene — 无输入，输出一个空场景。
 *
 * 构造一棵只含空根节点（children 为空 map）的 scene graph，并包成 scene 端口值。
 * focus 指向根节点，便于下游在此根之下挂接子节点。
 */

import {
  emptyScene as emptySceneGraph,
  makeScenePort,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface EmptySceneResult {
  scene: ScenePortValue;
}

export function emptyScene(_input: Record<string, unknown>): EmptySceneResult {
  const { graph, focus } = emptySceneGraph();
  return { scene: makeScenePort(graph, focus) };
}
