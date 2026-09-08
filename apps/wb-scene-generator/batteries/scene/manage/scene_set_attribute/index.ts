/**
 * scene_set_attribute — 在 focus 节点的 attributes 上写入 (key, value)，
 * 返回新树（focus 不变）。同 key 覆盖；其他 key 自动保留。
 *
 * value 类型 unknown：scene 树透明持有，不做 JSON-safe 校验（业务侧自负责）。
 */

import {
  makeScenePort,
  parseScenePort,
  setAttribute,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  scene?: ScenePortValue;
  error?: string;
}

export function sceneSetAttribute(input: Record<string, unknown>): Result {
  const sin = parseScenePort(input.scene);
  if (!sin) return { error: 'scene input must be a ScenePortValue' };

  const key = input.key;
  if (typeof key !== 'string' || key.length === 0) {
    return { error: 'key must be a non-empty string' };
  }

  let nextGraph;
  try {
    nextGraph = setAttribute(sin.graph, sin.focus, key, input.value);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return { scene: makeScenePort(nextGraph, sin.focus) };
}
