/**
 * Point2D — 二维点值类型。
 *
 * 跨节点端口（type='point2d'）的运行时表示。
 * 字段全部 number 且为有限值；NaN/Infinity 在构造电池处校验拦截。
 */

export interface Point2D {
  x: number;
  y: number;
}

export function makePoint2D(x: number, y: number): Point2D {
  return { x, y };
}

export function isPoint2D(v: unknown): v is Point2D {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.x === 'number' && Number.isFinite(p.x) &&
    typeof p.y === 'number' && Number.isFinite(p.y)
  );
}
