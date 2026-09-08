/**
 * Hinges 家族 —— barrel_hinge / piano_hinge。
 *
 * `BarrelHingeGeometry`：
 *   - 两片叶（leaf_a / leaf_b）沿 X 方向延展、Y=厚度、Z=length
 *   - leaf_b 绕 Z 轴旋转 (180 - open_angle_deg)°
 *   - knuckle_count 个圆柱（沿 Z 轴）叠在 Z 方向，整体居中
 *   - 销钉：一根贯穿 length 的细圆柱
 *
 * `PianoHingeGeometry`：
 *   - 等价于 BarrelHinge 自动算 knuckle_count = max(3, length/knuckle_pitch)，
 *     强制奇数（让两叶 knuckle 互相错开），knuckle_outer_diameter = pin_diameter*1.55
 *
 * v1 不实现：HingeHolePattern / HingePinStyle（DSL 未暴露 → 默认值 = 无）
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, BakeableShape } from '../types.js';
import { BakerError } from '../errors.js';
import { csgFuse } from '../csg_helpers.js';
import { safeDelete, maybeShiftToZ0, centeredBox } from '../op_helpers.js';
import { optionalNumber, requireNumber } from '../arg_readers.js';

/** 把一组 Solid 依次 fuse 成一个。列表至少 1 个。 */
function fuseAll(shapes: BakeableShape[]): BakeableShape {
  let acc = shapes[0];
  for (let i = 1; i < shapes.length; i++) {
    acc = csgFuse(acc, shapes[i]);
  }
  return acc;
}

// ── 共用构造：参考 BarrelHingeGeometry —————————————————————

interface BarrelHingeSpec {
  length: number;
  leafWidthA: number;
  leafWidthB: number;
  leafThickness: number;
  pinDiameter: number;
  knuckleOuterDiameter: number;
  knuckleCount: number;
  clearance: number;
  openAngleDeg: number;
}

function buildBarrelHinge(
  ctx: Parameters<OpBuilder>[0],
  s: BarrelHingeSpec,
): BakeableShape {
  const { length, leafWidthA, leafWidthB, leafThickness, pinDiameter,
          knuckleOuterDiameter, knuckleCount, clearance, openAngleDeg } = s;

  if (Math.min(length, leafWidthA, leafWidthB, leafThickness, pinDiameter, knuckleOuterDiameter) <= 0) {
    throw new BakerError('barrel_hinge: length / leaf widths / thickness / pin / knuckle must be positive');
  }
  if (knuckleCount < 3) {
    throw new BakerError('barrel_hinge: knuckle_count must be at least 3');
  }
  if (pinDiameter >= knuckleOuterDiameter) {
    throw new BakerError('barrel_hinge: pin_diameter must be less than knuckle_outer_diameter');
  }
  const segmentLength = (length - clearance * (knuckleCount - 1)) / knuckleCount;
  if (segmentLength <= 0) {
    throw new BakerError('barrel_hinge: clearance/knuckle_count leave no knuckle length');
  }

  const leafOverlap = Math.min(leafThickness * 0.75, knuckleOuterDiameter * 0.12);

  // 真实铰链：knuckle 按归属在两叶间交替（A/B 交错指状）。偶数 index 属叶 A，
  // 奇数属叶 B；每叶与其拥有的 knuckle 先 fuse 成一个件，再整体旋转叶 B，
  // 使得展开时呈交错指状（旧实现把所有 knuckle 同轴叠在一起、与两叶都连，看不出交错）。
  const groupA: BakeableShape[] = [];
  const groupB: BakeableShape[] = [];

  // Leaf A：沿 -X 侧（不旋转）
  groupA.push(
    centeredBox(ctx, leafWidthA, leafThickness, length).translateX(
      -(knuckleOuterDiameter * 0.5 + leafWidthA * 0.5 - leafOverlap),
    ),
  );
  // Leaf B（未旋转）：沿 +X 侧
  groupB.push(
    centeredBox(ctx, leafWidthB, leafThickness, length).translateX(
      knuckleOuterDiameter * 0.5 + leafWidthB * 0.5 - leafOverlap,
    ),
  );

  const zStart = -length * 0.5;
  for (let i = 0; i < knuckleCount; i++) {
    const centerZ = zStart + segmentLength * 0.5 + i * (segmentLength + clearance);
    const knuckle = ctx.replicad.makeCylinder(
      knuckleOuterDiameter * 0.5,
      segmentLength,
      [0, 0, centerZ - segmentLength * 0.5],
      [0, 0, 1],
    ) as BakeableShape;
    // 交替归属：knuckle 同轴于销钉（绕 Z 对称），但其连接的叶不同——
    // 旋转叶 B 时它的 knuckle 跟着转，A 的 knuckle 留在原位 → 指状交错。
    (i % 2 === 0 ? groupA : groupB).push(knuckle);
  }

  const shapeA = fuseAll(groupA);
  let shapeB = fuseAll(groupB);
  // 叶 B（含其 knuckle）整体绕 Z 旋转 (180 - openAngleDeg)°
  const rotatedB = shapeB.rotate(180 - openAngleDeg, [0, 0, 0], [0, 0, 1]);
  safeDelete(shapeB);
  shapeB = rotatedB;

  let shape: BakeableShape = csgFuse(shapeA, shapeB);

  // 销钉：贯穿 length 的细圆柱（共享，置于销轴上）
  const pinShape = ctx.replicad.makeCylinder(
    pinDiameter * 0.5,
    length,
    [0, 0, -length * 0.5],
    [0, 0, 1],
  ) as BakeableShape;
  shape = csgFuse(shape, pinShape);

  return shape;
}

// ── barrel_hinge ──────────────────────────────────────────────────

export const barrelHinge: OpBuilder = (ctx, args) => {
  const length        = requireNumber(args, 'length', 'barrel_hinge');
  const leafWidthA    = requireNumber(args, 'leaf_width_a', 'barrel_hinge');
  const leafWidthB    = optionalNumber(args, 'leaf_width_b', leafWidthA);
  const leafThickness = requireNumber(args, 'leaf_thickness', 'barrel_hinge');
  const pinDiameter   = requireNumber(args, 'pin_diameter', 'barrel_hinge');
  const knuckleOuter  = optionalNumber(args, 'knuckle_outer_diameter', pinDiameter * 1.75);
  let knuckleCount    = Math.round(optionalNumber(args, 'knuckle_count', 5));
  if (knuckleCount < 3) knuckleCount = 3;
  if (knuckleCount % 2 === 0) knuckleCount += 1; // 强制奇数：两端 knuckle 同属叶 A，A/B 真正交错（与 piano 一致）
  const clearance     = optionalNumber(args, 'clearance', 0.0005);
  const openAngleDeg  = optionalNumber(args, 'open_angle_deg', 180);

  const shape = buildBarrelHinge(ctx, {
    length, leafWidthA, leafWidthB, leafThickness, pinDiameter,
    knuckleOuterDiameter: knuckleOuter, knuckleCount, clearance, openAngleDeg,
  });

  return maybeShiftToZ0(shape, length, args);
};

// ── piano_hinge ───────────────────────────────────────────────────

export const pianoHinge: OpBuilder = (ctx, args) => {
  const length        = requireNumber(args, 'length', 'piano_hinge');
  const leafWidthA    = requireNumber(args, 'leaf_width_a', 'piano_hinge');
  const leafWidthB    = optionalNumber(args, 'leaf_width_b', leafWidthA);
  const leafThickness = requireNumber(args, 'leaf_thickness', 'piano_hinge');
  const pinDiameter   = requireNumber(args, 'pin_diameter', 'piano_hinge');
  const knucklePitch  = requireNumber(args, 'knuckle_pitch', 'piano_hinge');
  const clearance     = optionalNumber(args, 'clearance', 0.0005);
  const openAngleDeg  = optionalNumber(args, 'open_angle_deg', 180);

  if (knucklePitch <= 0) throw new BakerError('piano_hinge: knuckle_pitch must be positive');
  let knuckleCount = Math.max(3, Math.floor(length / knucklePitch));
  if (knuckleCount % 2 === 0) knuckleCount += 1; // 强制奇数
  const knuckleOuter = pinDiameter * 1.55;       // 写死系数

  const shape = buildBarrelHinge(ctx, {
    length, leafWidthA, leafWidthB, leafThickness, pinDiameter,
    knuckleOuterDiameter: knuckleOuter, knuckleCount, clearance, openAngleDeg,
  });

  return maybeShiftToZ0(shape, length, args);
};
