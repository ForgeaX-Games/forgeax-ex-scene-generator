/**
 * scene_set_transform — 在 focus 节点上设置局部 translation（v1 仅平移），
 * 返回新树（focus 不变）。
 */

import {
  isPoint3D,
  makeScenePort,
  parseScenePort,
  setTransform,
  type ScenePortValue,
} from '../../../../vendor/dist/shared/types/index.js';

interface SetTransformResult {
  scene?: ScenePortValue;
  error?: string;
}

export function sceneSetTransform(input: Record<string, unknown>): SetTransformResult {
  const sin = parseScenePort(input.scene);
  if (!sin) return { error: 'scene input must be a ScenePortValue' };

  const t = input.translation;
  let tx = 0, ty = 0, tz = 0;
  if (t !== undefined && t !== null) {
    if (!isPoint3D(t)) {
      return { error: 'translation must be a Point3D { x, y, z } with finite numbers' };
    }
    tx = t.x; ty = t.y; tz = t.z;
  }

  let nextGraph;
  try {
    nextGraph = setTransform(sin.graph, sin.focus, { translation: [tx, ty, tz] });
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return { scene: makeScenePort(nextGraph, sin.focus) };
}
