/**
 * SDF 距离函数 —— sphere/capsule/box/cone/ellipsoid 的标准闭式公式。
 *
 * 所有函数都在 primitive 的*局部*坐标系下求值（原点 = primitive 中心，局部轴已按
 * primitive.rotation 摆正）；世界坐标 → 局部坐标的变换在 `sdfLocalPoint` 里完成。
 */
import type { SdfPrimitiveSpec, SdfVector } from './types.js';

export function sdfSphere(lx: number, ly: number, lz: number, radius: number): number {
  return Math.sqrt(lx * lx + ly * ly + lz * lz) - radius;
}

/** 局部沿 Y 轴的胶囊：两端半球在 y=±height/2。 */
export function sdfCapsule(lx: number, ly: number, lz: number, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const cy = Math.max(-halfHeight, Math.min(halfHeight, ly));
  const dx = lx;
  const dy = ly - cy;
  const dz = lz;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
}

/** 局部 AABB 全尺寸盒（标准 "round box" 无圆角形式：exact SDF）。 */
export function sdfBox(lx: number, ly: number, lz: number, size: SdfVector): number {
  const qx = Math.abs(lx) - size[0] * 0.5;
  const qy = Math.abs(ly) - size[1] * 0.5;
  const qz = Math.abs(lz) - size[2] * 0.5;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.sqrt(ox * ox + oy * oy + oz * oz);
  const inside = Math.min(Math.max(qx, qy, qz), 0);
  return outside + inside;
}

/** 局部沿 Y 轴的圆锥：底面 y=-height/2（半径 radius），锥尖 y=+height/2（半径 0）。 */
export function sdfCone(lx: number, ly: number, lz: number, radius: number, height: number): number {
  const halfHeight = height * 0.5;
  const taper = radius * (1 - (ly + halfHeight) / height);
  const radial = Math.sqrt(lx * lx + lz * lz) - Math.max(0, taper);
  const capped = Math.abs(ly) - halfHeight;
  return Math.max(radial, capped);
}

/** 三轴半径椭球（近似 SDF：径向缩放后取最小半径做距离标定，对融合/marching cubes 已足够精确）。 */
export function sdfEllipsoid(lx: number, ly: number, lz: number, radii: SdfVector): number {
  const sx = lx / radii[0];
  const sy = ly / radii[1];
  const sz = lz / radii[2];
  const k = Math.sqrt(sx * sx + sy * sy + sz * sz);
  return (k - 1) * Math.min(radii[0], radii[1], radii[2]);
}

/** 世界坐标 → primitive 局部坐标（平移 + 绕 XYZ 欧拉角的逆旋转）。 */
export function sdfLocalPoint(
  x: number, y: number, z: number,
  center: SdfVector, rotation: SdfVector,
): readonly [number, number, number] {
  const dx = x - center[0];
  const dy = y - center[1];
  const dz = z - center[2];
  if (rotation[0] === 0 && rotation[1] === 0 && rotation[2] === 0) {
    return [dx, dy, dz];
  }
  // 世界→局部需要旋转矩阵的逆（= 转置，因为是正交旋转）。primitive 的局部朝向是
  // R = Rz(rotation[2]) · Ry(rotation[1]) · Rx(rotation[0])——标准外旋 XYZ / roll-pitch-yaw
  // 约定，与本 DSL 里 part.rpy / joint origin 的 rpy 语义一致（注意：这**不是**三.js
  // Object3D.rotation 的 Euler('XYZ')，那是内旋 XYZ，等价矩阵是 Rx·Ry·Rz，顺序相反——
  // 之前这里错误地把两者划了等号，是份过期/写错的注释，已更正，避免下次又被拿去对齐三.js）。
  // 所以局部点 = R^T · (world - center) = Rx(-rx) · Ry(-ry) · Rz(-rz) · (world - center)。
  const [rx, ry, rz] = rotation;
  // 先撤销 Rz
  const cz = Math.cos(-rz), sz = Math.sin(-rz);
  const x1 = dx * cz - dy * sz;
  const y1 = dx * sz + dy * cz;
  const z1 = dz;
  // 再撤销 Ry
  const cy = Math.cos(-ry), sy = Math.sin(-ry);
  const x2 = x1 * cy + z1 * sy;
  const y2 = y1;
  const z2 = -x1 * sy + z1 * cy;
  // 再撤销 Rx
  const cx = Math.cos(-rx), sx = Math.sin(-rx);
  const x3 = x2;
  const y3 = y2 * cx - z2 * sx;
  const z3 = y2 * sx + z2 * cx;
  return [x3, y3, z3];
}

/** 按 primitive.type 分发到对应距离函数；`params`/`center`/`rotation` 语义见 types.ts 顶部注释。 */
export function sdfPrimitiveDistance(x: number, y: number, z: number, primitive: SdfPrimitiveSpec): number {
  const [lx, ly, lz] = sdfLocalPoint(x, y, z, primitive.center, primitive.rotation);
  const p = primitive.params;
  switch (primitive.type) {
    case 'sphere':
      return sdfSphere(lx, ly, lz, p[0]);
    case 'capsule':
      return sdfCapsule(lx, ly, lz, p[0], p[1]);
    case 'box':
      return sdfBox(lx, ly, lz, p);
    case 'cone':
      return sdfCone(lx, ly, lz, p[0], p[1]);
    case 'ellipsoid':
      return sdfEllipsoid(lx, ly, lz, p);
  }
}
