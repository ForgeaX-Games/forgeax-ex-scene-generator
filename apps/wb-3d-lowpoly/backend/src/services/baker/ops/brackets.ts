/**
 * Brackets 家族：clevis_bracket / pivot_fork / trunnion_yoke。
 *
 *
 * 坐标约定：
 *   - cadquery `Workplane("XY").box(w, d, h)` 在三轴全居中（origin in middle）
 *   - replicad `makeBaseBox(w, d, h)` 在 X/Y 居中但 z∈[0, h]
 *   → 这里统一用 `centeredBox(w, d, h)` 包一层，再做对应的 translate
 *
 *   - cadquery `Workplane("YZ").circle(r).extrude(L)` 沿 +X 拉出长 L 的圆柱
 *   - replicad `makeCylinder(r, L, location, direction=[1,0,0])` 沿 +X
 *     `both=True` 时 `cq` 把圆柱朝两侧各 L 拉，对应 replicad 取 `2L` + center 在 origin
 *
 * 关于 `corner_radius`：cadquery `edges("|Z").fillet(r)` 倒所有平行 Z 轴的竖直边。
 * 对应 replicad `shape.fillet(r, (e) => e.inDirection([0,0,1]))`。
 *
 * 关于 `center: false`：语义是"把模型平移到 z=0 起的位置"。这里
 * v1 默认 center=true，false 时整体 +z 平移 height/2 以让底面贴 z=0。
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, OpContext, BakeableShape } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import { centeredBox, maybeShiftToZ0 } from '../op_helpers.js';
import {
  optionalNumber,
  requireNumber,
  requireNumList,
} from '../arg_readers.js';

// ── 公共助手 ─────────────────────────────────────────────────────────

/**
 * 沿 X 轴的圆柱（对应 cadquery `Workplane("YZ").circle(r).extrude(L, both=True)`)：
 * 总长 totalLength，中心在 (cx, cy, cz)。
 */
function xCylinder(
  ctx: OpContext,
  r: number,
  totalLength: number,
  cx: number, cy: number, cz: number,
): BakeableShape {
  // makeCylinder(radius, height, location, direction)；这里 location 是底面圆心
  return ctx.replicad.makeCylinder(
    r,
    totalLength,
    [cx - totalLength / 2, cy, cz],
    [1, 0, 0],
  );
}

/** Z 方向竖直边倒圆角；半径 0 时跳过。 */
function filletVerticalEdges(shape: BakeableShape, radius: number): BakeableShape {
  if (radius <= 0) return shape;
  return shape.fillet(radius, (e) => e.inDirection([0, 0, 1]));
}

// ── clevis_bracket ──────────────────────────────────────────────────

export const clevisBracket: OpBuilder = (ctx, args) => {
  const [w, d, h]   = requireNumList(args, 'overall_size', 3, 'clevis_bracket');
  const gap         = requireNumber(args, 'gap_width', 'clevis_bracket');
  const boreD       = requireNumber(args, 'bore_diameter', 'clevis_bracket');
  const boreCz      = requireNumber(args, 'bore_center_z', 'clevis_bracket');
  const baseT       = requireNumber(args, 'base_thickness', 'clevis_bracket');
  const cornerR     = optionalNumber(args, 'corner_radius', 0);

  // 几何合法性约束
  if (w <= 0 || d <= 0 || h <= 0)        throw new BakerError('clevis_bracket: overall_size must be positive');
  if (gap <= 0 || gap >= w)               throw new BakerError('clevis_bracket: gap_width must be > 0 and < width');
  const cheekT = 0.5 * (w - gap);
  if (cheekT <= 1e-6)                     throw new BakerError('clevis_bracket: gap_width leaves no side wall');
  if (baseT <= 0 || baseT >= h)           throw new BakerError('clevis_bracket: base_thickness must be > 0 and < height');
  const boreR = boreD * 0.5;
  if (boreD <= 0 || boreD >= Math.min(cheekT * 2, d, h))
    throw new BakerError('clevis_bracket: bore_diameter too large');
  if (boreCz - boreR <= baseT || boreCz + boreR >= h)
    throw new BakerError('clevis_bracket: bore must clear base and top');

  // 1) 实心体
  let shape = centeredBox(ctx, w, d, h);

  const slot = centeredBox(ctx, gap, d + 0.004, h - baseT).translateZ(baseT * 0.5);
  shape = csgCut(shape, slot);

  shape = filletVerticalEdges(shape, Math.min(cornerR, cheekT * 0.6, d * 0.25, h * 0.25));

  const boreZ = -h * 0.5 + boreCz;
  const bore  = xCylinder(ctx, boreR, w + 0.01, 0, 0, boreZ) as BakeableShape;
  shape = csgCut(shape, bore);

  return maybeShiftToZ0(shape, h, args);
};

// ── pivot_fork ──────────────────────────────────────────────────────

export const pivotFork: OpBuilder = (ctx, args) => {
  const [w, d, h]    = requireNumList(args, 'overall_size', 3, 'pivot_fork');
  const gap          = requireNumber(args, 'gap_width', 'pivot_fork');
  const boreD        = requireNumber(args, 'bore_diameter', 'pivot_fork');
  const boreCz       = requireNumber(args, 'bore_center_z', 'pivot_fork');
  const bridgeT      = requireNumber(args, 'bridge_thickness', 'pivot_fork');
  const cornerR      = optionalNumber(args, 'corner_radius', 0);

  if (w <= 0 || d <= 0 || h <= 0)        throw new BakerError('pivot_fork: overall_size must be positive');
  if (gap <= 0 || gap >= w)               throw new BakerError('pivot_fork: gap_width must be > 0 and < width');
  const cheekT = 0.5 * (w - gap);
  if (cheekT <= 1e-6)                     throw new BakerError('pivot_fork: gap_width leaves no side wall');
  if (bridgeT <= 0 || bridgeT >= d)       throw new BakerError('pivot_fork: bridge_thickness must be > 0 and < depth');
  const boreR = boreD * 0.5;
  if (boreD <= 0 || boreD >= Math.min(cheekT * 2, d, h))
    throw new BakerError('pivot_fork: bore_diameter too large');
  if (boreCz - boreR <= 0 || boreCz + boreR >= h)
    throw new BakerError('pivot_fork: bore must stay inside fork cheeks');

  // 左右叉齿（沿 X 方向各 cheekT 厚，沿 Y 全 depth）
  const leftTine  = centeredBox(ctx, cheekT, d, h).translateX(-(gap * 0.5 + cheekT * 0.5));
  const rightTine = centeredBox(ctx, cheekT, d, h).translateX( (gap * 0.5 + cheekT * 0.5));

  // 后桥（沿 X 全 width，沿 Y 取 bridgeT 厚度并紧贴 -Y 侧）
  const rearBridge = centeredBox(ctx, w, bridgeT, h)
    .translateY(-d * 0.5 + bridgeT * 0.5);

  let shape: BakeableShape = csgFuse(leftTine, rightTine);
  shape = csgFuse(shape, rearBridge);

  shape = filletVerticalEdges(shape, Math.min(cornerR, cheekT * 0.6, bridgeT * 0.6, h * 0.25));

  const boreZ = -h * 0.5 + boreCz;
  const bore  = xCylinder(ctx, boreR, w + 0.01, 0, 0, boreZ) as BakeableShape;
  shape = csgCut(shape, bore);

  return maybeShiftToZ0(shape, h, args);
};

// ── trunnion_yoke ───────────────────────────────────────────────────

export const trunnionYoke: OpBuilder = (ctx, args) => {
  const [w, d, h]    = requireNumList(args, 'overall_size', 3, 'trunnion_yoke');
  const span         = requireNumber(args, 'span_width', 'trunnion_yoke');
  const trunD        = requireNumber(args, 'trunnion_diameter', 'trunnion_yoke');
  const trunCz       = requireNumber(args, 'trunnion_center_z', 'trunnion_yoke');
  const baseT        = requireNumber(args, 'base_thickness', 'trunnion_yoke');
  const cornerR      = optionalNumber(args, 'corner_radius', 0);

  if (w <= 0 || d <= 0 || h <= 0)        throw new BakerError('trunnion_yoke: overall_size must be positive');
  if (span <= 0 || span >= w)             throw new BakerError('trunnion_yoke: span_width must be > 0 and < width');
  const cheekT = 0.5 * (w - span);
  if (cheekT <= 1e-6)                     throw new BakerError('trunnion_yoke: span_width leaves no side wall');
  if (baseT <= 0 || baseT >= h)           throw new BakerError('trunnion_yoke: base_thickness must be > 0 and < height');
  const trunR = trunD * 0.5;
  if (trunD <= 0 || trunD >= Math.min(cheekT * 2, d, h))
    throw new BakerError('trunnion_yoke: trunnion_diameter too large');
  if (trunCz - trunR <= baseT || trunCz + trunR >= h)
    throw new BakerError('trunnion_yoke: trunnion must clear base and top');

  // 底座
  const base = centeredBox(ctx, w, d, baseT)
    .translateZ(-h * 0.5 + baseT * 0.5);

  // 左右脸颊
  const cheekH = h - baseT;
  const cheekZ = -h * 0.5 + baseT + cheekH * 0.5;
  const leftCheek  = centeredBox(ctx, cheekT, d, cheekH)
    .translate(-(span * 0.5 + cheekT * 0.5), 0, cheekZ);
  const rightCheek = centeredBox(ctx, cheekT, d, cheekH)
    .translate( (span * 0.5 + cheekT * 0.5), 0, cheekZ);

  // 外凸耳轴轴座（向脸颊外侧凸出）
  const bossR = Math.max(trunR * 1.4, cheekT * 0.55);
  const bossL = Math.min(cheekT * 0.75, d * 0.35);
  const bossZ = -h * 0.5 + trunCz;
  // 左轴座中心在 -span/2 - cheekT，向 -X 凸 bossL，所以圆柱起点 X = -span/2 - cheekT - bossL
  const leftBoss  = ctx.replicad.makeCylinder(
    bossR, bossL,
    [-(span * 0.5 + cheekT) - bossL, 0, bossZ],
    [1, 0, 0],
  );
  // 右轴座中心在 +span/2 + cheekT，向 +X 凸 bossL
  const rightBoss = ctx.replicad.makeCylinder(
    bossR, bossL,
    [ (span * 0.5 + cheekT), 0, bossZ],
    [1, 0, 0],
  );

  let shape: BakeableShape = csgFuse(base, leftCheek);
  shape = csgFuse(shape, rightCheek);
  shape = csgFuse(shape, leftBoss as BakeableShape);
  shape = csgFuse(shape, rightBoss as BakeableShape);

  shape = filletVerticalEdges(shape, Math.min(cornerR, cheekT * 0.5, d * 0.2, h * 0.2));

  const bore = xCylinder(
    ctx,
    trunR,
    w + bossL * 2 + 0.01,
    0, 0, bossZ,
  ) as BakeableShape;
  shape = csgCut(shape, bore);

  return maybeShiftToZ0(shape, h, args);
};
