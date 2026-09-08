/**
 * CSG 布尔运算助手 —— 执行操作后自动释放旧 shape + 工具，防止 OCCT WASM 堆泄漏。
 *
 * 用法：
 *   shape = csgCut(shape, tool)   替代  shape = shape.cut(tool)
 *   shape = csgFuse(shape, tool)  替代  shape = shape.fuse(tool)
 */

import type { ReplicadShape } from './types.js';
import { safeDelete } from './op_helpers.js';

export function csgCut(body: ReplicadShape, tool: ReplicadShape): ReplicadShape {
  const result = body.cut(tool);
  safeDelete(body);
  safeDelete(tool);
  return result;
}

export function csgFuse(body: ReplicadShape, tool: ReplicadShape): ReplicadShape {
  const result = body.fuse(tool);
  safeDelete(body);
  safeDelete(tool);
  return result;
}

export function csgIntersect(body: ReplicadShape, tool: ReplicadShape): ReplicadShape {
  const result = body.intersect(tool);
  safeDelete(body);
  safeDelete(tool);
  return result;
}
