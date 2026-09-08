/**
 * Point3D — 三维点值类型。
 *
 * 跨节点端口（type='point3D'）的运行时表示。
 * 字段全部 number 且为有限值；NaN/Infinity 在构造电池处校验拦截。
 */

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export function makePoint3D(x: number, y: number, z: number): Point3D {
  return { x, y, z };
}

export function isPoint3D(v: unknown): v is Point3D {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.x === 'number' && Number.isFinite(p.x) &&
    typeof p.y === 'number' && Number.isFinite(p.y) &&
    typeof p.z === 'number' && Number.isFinite(p.z)
  );
}
