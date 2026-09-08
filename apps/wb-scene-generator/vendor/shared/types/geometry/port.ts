/**
 * Geometry 端口语义。
 *
 * Geometry 已自带 `source / statements / focus / version`，本身就是端口值。
 * 这里只提供 type guard + 端口值结构校验，供下游电池在收输入时做 unsafe cast 防御。
 */

import type { Geometry } from './types.js';

/**
 * 端口形态校验：必须有 string source、Array statements、number version。
 * focus 可缺省。
 */
export function isGeometry(value: unknown): value is Geometry {
  if (!value || typeof value !== 'object') return false;
  const g = value as Partial<Geometry>;
  if (typeof g.source !== 'string') return false;
  if (typeof g.version !== 'number') return false;
  if (!Array.isArray(g.statements)) return false;
  if (g.focus !== undefined && typeof g.focus !== 'string') return false;
  return true;
}

/**
 * 安全解析：未知值 → Geometry 或 null。
 *
 * 行为：合法 Geometry 透传；undefined/null 返回 null；
 *       其他形态返回 null（电池调用方可决定回落到空 Geometry）。
 */
export function parseGeometryPort(value: unknown): Geometry | null {
  return isGeometry(value) ? value : null;
}
