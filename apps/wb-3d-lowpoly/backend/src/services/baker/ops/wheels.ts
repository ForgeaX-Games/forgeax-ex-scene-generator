/**
 * Wheels 家族 —— wheel / tire。
 *
 * WheelGeometry / TireGeometry 可有大量 sub-spec（spokes / flange /
 * bolt / tread / sidewall / shoulder ...），但我们这边 DSL 只承载 radius / width
 * （+ inner_radius for tire）；所以 v1 仅实现"主形态" —— 外圈 + 轮毂 + 中心孔，
 * 不做辐条 / 法兰 / 螺栓孔。等 DSL 扩字段时再补。
 *
 * 坐标约定：
 *   - wheel 沿 local X 旋转，所以 axis is X
 *   - 圆环 / 圆柱沿 X 居中（_cq_annulus_x: extrude(width/2, both=True)）
 *   - 用 replicad 时 makeCylinder 的 location 是底面圆心，需把底面挪到 x=-width/2
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import { optionalBool, optionalNumber, requireNumber } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';

// ── 工具：沿 +X 轴的圆柱（`Workplane("YZ").circle(r).extrude(w, both=True)`）

function xAxisCylinder(
  ctx: OpContext,
  radius: number,
  width: number,
  centerOffset = 0,
): BakeableShape {
  return ctx.replicad.makeCylinder(
    radius,
    width,
    [centerOffset - width / 2, 0, 0],
    [1, 0, 0],
  );
}

/** annulus_x: outer 圆柱 cut inner 圆柱，沿 X 居中。 */
function xAxisAnnulus(
  ctx: OpContext,
  outerR: number,
  innerR: number,
  width: number,
  centerOffset = 0,
): BakeableShape {
  const outer = xAxisCylinder(ctx, outerR, width, centerOffset);
  const inner = xAxisCylinder(ctx, Math.max(innerR, 1e-4), width + 0.01, centerOffset);
  return csgCut(outer, inner);
}

/** center=false 时把整体沿 +X 平移 width/2，使 -X 端贴 x=0（`_mesh_geometry_shifted_to_axis0(geom, 0)`）。 */
function maybeShiftToX0(shape: BakeableShape, width: number, args: Record<string, Arg>): BakeableShape {
  const center = optionalBool(args, 'center', true);
  return center ? shape : shape.translateX(width / 2);
}

// ── wheel ──────────────────────────────────────────────────────────

export const wheel: OpBuilder = (ctx, args) => {
  const radius = requireNumber(args, 'radius', 'wheel');
  const width  = requireNumber(args, 'width', 'wheel');

  if (radius <= 0 || width <= 0) throw new BakerError('wheel: radius and width must be positive');

  // 默认：rim outer = radius, rim inner = radius * 0.68；hub = 0.18*radius / 0.55*width
  const rimOuter = radius;
  const rimInner = radius * 0.68;
  const hubRadius = radius * 0.18;
  const hubWidth = width * 0.55;
  // bore_d 可选参数：>0 时用用户值（直径），否则回退默认 0.18*radius。
  const boreOverride = optionalNumber(args, 'bore_d', 0);
  const boreDiameter = boreOverride > 0
    ? boreOverride
    : Math.max(radius * 0.18, 0.004);
  if (boreOverride > 0 && boreOverride >= radius * 2)
    throw new BakerError('wheel: bore_d must be smaller than the wheel diameter (2*radius)');

  // 1) 外圈环
  const rim = xAxisAnnulus(ctx, rimOuter, rimInner, width);

  // 2) 轮毂实心圆柱
  const hub = xAxisCylinder(ctx, hubRadius, hubWidth);

  let shape: BakeableShape = csgFuse(rim, hub);

  // 3) 轮盘连接：spoke_count>0 → 用 N 根辐条；否则用默认双侧 face disc。
  const spokeCount = Math.round(optionalNumber(args, 'spoke_count', 0));
  if (spokeCount > 0) {
    const n = Math.min(spokeCount, 12); // 控制布尔次数
    const spokeThickness = Math.max(width * 0.32, 0.003);   // 沿 X
    const spokeWidthTan = Math.max(rimInner * 0.18, 0.003); // 切向宽
    const spokeLen = rimInner - hubRadius + spokeWidthTan;  // 径向跨度（略搭接）
    const rMid = (hubRadius + rimInner) / 2;
    for (let i = 0; i < n; i++) {
      const theta = (Math.PI * 2 * i) / n;
      // 辐条：沿 +Y 的细板（length=spokeLen 沿 Y, 宽 spokeWidthTan 沿 Z, 厚 spokeThickness 沿 X），
      // 居中后平移到半径 rMid 处，再绕 X 轴旋转 theta。
      let spoke = ctx.replicad.makeBaseBox(spokeThickness, spokeLen, spokeWidthTan)
        .translate(0, rMid, -spokeWidthTan / 2) as BakeableShape;
      const rotated = spoke.rotate((theta * 180) / Math.PI, [0, 0, 0], [1, 0, 0]);
      if (rotated !== spoke) spoke = rotated;
      shape = csgFuse(shape, spoke);
    }
  } else {
    const discThickness = Math.max(width * 0.08, 0.002);
    const faceOuter = Math.max(hubRadius * 1.6, rimInner * 0.55);
    const faceInner = hubRadius * 0.78;
    const frontDisc = xAxisAnnulus(ctx, faceOuter, faceInner, discThickness, width / 2 - discThickness / 2);
    const rearDisc  = xAxisAnnulus(ctx, faceOuter, faceInner, discThickness, -(width / 2 - discThickness / 2));
    shape = csgFuse(shape, frontDisc);
    shape = csgFuse(shape, rearDisc);
  }

  const bore = xAxisCylinder(ctx, boreDiameter * 0.5, width + 0.04);
  shape = csgCut(shape, bore);

  return maybeShiftToX0(shape, width, args);
};

// ── tire ───────────────────────────────────────────────────────────

export const tire: OpBuilder = (ctx, args) => {
  const outerR = requireNumber(args, 'outer_radius', 'tire');
  const width  = requireNumber(args, 'width', 'tire');
  const innerR = optionalNumber(args, 'inner_radius', outerR * 0.58);

  if (outerR <= 0 || width <= 0 || innerR <= 0)
    throw new BakerError('tire: outer_radius, width, and inner_radius must be positive');
  if (innerR >= outerR)
    throw new BakerError('tire: inner_radius must be less than outer_radius');

  let shape = xAxisAnnulus(ctx, outerR, innerR, width);

  // ── 参数化胎面/胎侧（tire：tread / sidewall） ──

  // tread：沿胎宽方向切若干圈周向花纹槽（每槽是一圈外缘环带 cut）
  const treadDepth = optionalNumber(args, 'tread_depth', 0);
  const treadCount = Math.round(optionalNumber(args, 'tread_count', 0));
  if (treadDepth > 0 && treadCount > 0) {
    if (treadDepth >= (outerR - innerR))
      throw new BakerError('tire: tread_depth must be smaller than (outer_radius - inner_radius)');
    const n = Math.min(treadCount, 6); // 控制布尔次数，避免 OCCT 过载
    const grooveW = Math.min(width / (n * 2.5), width * 0.18);
    for (let k = 0; k < n; k++) {
      // 在胎宽内均匀分布 n 个槽中心
      const frac = (k + 0.5) / n;
      const xCenter = -width / 2 + frac * width;
      const groove = xAxisAnnulus(ctx, outerR + 0.001, outerR - treadDepth, grooveW, xCenter);
      shape = csgCut(shape, groove);
    }
  }

  // sidewall：两侧面各切一道浅环形凹槽（品牌/造型用），sidewall_depth 控制深度
  const sidewallDepth = optionalNumber(args, 'sidewall_depth', 0);
  if (sidewallDepth > 0) {
    if (sidewallDepth >= width * 0.5)
      throw new BakerError('tire: sidewall_depth must be smaller than half the width');
    const bandOuter = outerR - (outerR - innerR) * 0.18;
    const bandInner = innerR + (outerR - innerR) * 0.22;
    if (bandOuter > bandInner) {
      // 左侧 (-X 面) 凹槽
      const left = xAxisAnnulus(ctx, bandOuter, bandInner, sidewallDepth, -width / 2 + sidewallDepth / 2);
      shape = csgCut(shape, left);
      // 右侧 (+X 面) 凹槽
      const right = xAxisAnnulus(ctx, bandOuter, bandInner, sidewallDepth, width / 2 - sidewallDepth / 2);
      shape = csgCut(shape, right);
    }
  }

  return maybeShiftToX0(shape, width, args);
};
