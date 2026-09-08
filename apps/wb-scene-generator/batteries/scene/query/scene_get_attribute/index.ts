/**
 * scene_get_attribute — 读 focus 节点 attributes[key]。
 *
 * 节点缺失 / 无 attributes / key 未命中 → exists=false, value=null（保持端口可序列化）。
 * 不输出 scene。
 */

import {
  getAttribute,
  parseScenePort,
} from '../../../../vendor/dist/shared/types/index.js';

interface Result {
  value: unknown;
  exists: boolean;
}

const MISS: Result = { value: null, exists: false };

export function sceneGetAttribute(input: Record<string, unknown>): Result {
  const sin = parseScenePort(input.scene);
  if (!sin) return MISS;

  const key = input.key;
  if (typeof key !== 'string' || key.length === 0) return MISS;

  const r = getAttribute(sin.graph, sin.focus, key);
  if (!r.exists) return MISS;
  return { value: r.value, exists: true };
}
