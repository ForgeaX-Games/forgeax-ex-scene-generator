/**
 * g_box —— 在 Geometry DSL 末尾追加一行 `id = box(size=[w, d, h])`。
 *
 * 输入：
 *   - geometry?  上游 Geometry（缺省 = 空 geometry）
 *   - w / d / h  三轴尺寸
 *   - id?        可选自定义 id；缺省自动生成 box{n}
 * 输出：
 *   - geometry   追加后的 Geometry
 *   - id         本行的 id（供下游 part/visual 通过 ref 引用）
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBox(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const w = Number(input.w ?? 1);
  const d = Number(input.d ?? 1);
  const h = Number(input.h ?? 1);
  if (!Number.isFinite(w) || !Number.isFinite(d) || !Number.isFinite(h) || w <= 0 || d <= 0 || h <= 0) {
    return { geometry: incoming, id: '', error: 'w/d/h must be positive finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'box');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}" (must match [A-Za-z_][A-Za-z0-9_]*)` };
  }

  const next = emit(incoming, id, 'box', {
    size: numList([w, d, h]),
  });
  return { geometry: next, id };
}

export default gBox;
