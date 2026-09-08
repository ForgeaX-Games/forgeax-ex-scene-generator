/**
 * Controls 家族 —— knob / bezel。
 *
 * 简化策略（DSL 暴露的子集是 body 几何，skirt/grip/indicator/
 * top_feature/bore/reliefs 等都没承载，v1 全部跳过）：
 *   knob:
 *     - body_style ∈ {cylindrical, tapered, domed, mushroom, skirted, hourglass, faceted, lobed}
 *     - 5 段 loft（偏移 0 / 0.18 / 0.42 / 0.72 / 1.0）
 *     - 顶角 crown_radius（>Z 面边缘）+ 侧边 edge_radius（|Z）
 *   bezel:
 *     - opening_shape / outer_shape ∈ {rect, rounded_rect, circle, ellipse, superellipse}
 *     - 平板 ring，深度 depth；ring = outer 2D − inner 2D 然后挤出
 *
 * 与 z=0 的关系：knob 沿 ±h/2 居中，bezel 沿 ±depth/2 居中，都遵守 center=true。
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，op-registry.ts / dsl-to-graph.ts
 * 已同步移除这些 op（见 CHANGELOG "Removed"）。这里的形状构建函数保留供内部测试直接调用。
 */

import type { OpBuilder, BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import { maybeShiftToZ0 } from '../op_helpers.js';
import { optionalBool, optionalNumber, optionalString, requireNumber, requireNumList } from '../arg_readers.js';

// ── knob 几何 ─────────────────────────────────────────────────────

/**
 * `body_radius_at(t)`：给定归一化高度 t∈[0,1] 返回该高度的半径。
 * 内部不做拔模角处理，但 domed 用 side_draft_deg 微调。
 */
function bodyRadiusAt(
  bodyStyle: string,
  t: number,
  baseDiameter: number,
  topDiameter: number,
  diameter: number,
  sideDraftDeg: number,
): number {
  switch (bodyStyle) {
    case 'cylindrical':
      return Math.max(baseDiameter, topDiameter) * 0.5;
    case 'tapered':
      return (baseDiameter * (1 - t) + topDiameter * t) * 0.5;
    case 'domed': {
      if (t < 0.72) {
        const draftFactor = Math.min(Math.max(sideDraftDeg / 50, -0.2), 0.2);
        return (baseDiameter * 0.5) * (1 - draftFactor * t);
      }
      const u = (t - 0.72) / 0.28;
      return Math.max(
        0.001,
        topDiameter * 0.5 + (baseDiameter * 0.5 - topDiameter * 0.5) * (1 - u * u),
      );
    }
    case 'mushroom': {
      const stem = Math.min(baseDiameter, topDiameter, diameter) * 0.28;
      const cap  = Math.max(baseDiameter, topDiameter, diameter) * 0.5;
      if (t < 0.42) return stem;
      if (t < 0.62) return stem + (cap - stem) * ((t - 0.42) / 0.20);
      if (t < 0.85) return cap;
      const u = (t - 0.85) / 0.15;
      return Math.max(cap * (1 - 0.20 * u * u), stem);
    }
    case 'skirted': {
      const skirtR = Math.max(baseDiameter * 0.55, diameter * 0.52);
      const crownR = topDiameter * 0.5;
      if (t < 0.40) return skirtR;
      if (t < 0.56) return skirtR + (crownR - skirtR) * ((t - 0.40) / 0.16);
      return crownR;
    }
    case 'hourglass': {
      const waistR = Math.min(baseDiameter, topDiameter, diameter) * 0.32;
      if (t < 0.5) return baseDiameter * 0.5 + (waistR - baseDiameter * 0.5) * (t / 0.5);
      return waistR + (topDiameter * 0.5 - waistR) * ((t - 0.5) / 0.5);
    }
    case 'faceted':
      return (baseDiameter * (1 - t) + topDiameter * t) * 0.5;
    case 'lobed': {
      const lowerR = baseDiameter * 0.5;
      const upperR = Math.max(topDiameter, diameter * 1.02) * 0.5;
      if (t < 0.24) return lowerR + (upperR * 0.92 - lowerR) * (t / 0.24);
      if (t < 0.80) {
        const u = (t - 0.24) / 0.56;
        return upperR * (0.92 + 0.08 * Math.sin(u * Math.PI));
      }
      return upperR + (topDiameter * 0.5 - upperR) * ((t - 0.80) / 0.20);
    }
    default:
      throw new BakerError(`knob: unsupported body_style "${bodyStyle}"`);
  }
}

/**
 * `section_outline(radius, t)`：仅 faceted / lobed 用多边形，
 * 其它一律 null（→ 用圆形截面）。
 */
function sectionPolygonPoints(
  bodyStyle: string,
  radius: number,
  t: number,
): [number, number][] | null {
  if (bodyStyle === 'faceted') {
    const n = 6;
    const phase = Math.PI / n;
    return Array.from({ length: n }, (_, i) => {
      const theta = phase + 2 * Math.PI * i / n;
      return [radius * Math.cos(theta), radius * Math.sin(theta)];
    });
  }
  if (bodyStyle === 'lobed') {
    const lobeCount = 5;
    const pointCount = 72;
    const blend = Math.min(Math.max((t - 0.10) / 0.30, 0), 1);
    const amplitude = radius * (0.04 + 0.14 * blend);
    const valleyFloor = radius * 0.62;
    return Array.from({ length: pointCount }, (_, i) => {
      const theta = 2 * Math.PI * i / pointCount;
      const lr = Math.max(
        radius - amplitude * (0.5 - 0.5 * Math.cos(lobeCount * theta)),
        valleyFloor,
      );
      return [lr * Math.cos(theta), lr * Math.sin(theta)];
    });
  }
  return null;
}

function buildSection(
  ctx: OpContext,
  bodyStyle: string,
  radius: number,
  zOffset: number,
  t: number,
): unknown {
  const r = Math.max(radius, 0.001);
  const polygon = sectionPolygonPoints(bodyStyle, r, t);
  let drawing;
  if (polygon === null) {
    drawing = ctx.replicad.drawCircle(r);
  } else {
    const pen = ctx.replicad.draw(polygon[0]);
    for (let i = 1; i < polygon.length; i++) pen.lineTo(polygon[i]);
    drawing = pen.close();
  }
  return drawing.sketchOnPlane('XY', zOffset);
}

export const knob: OpBuilder = (ctx, args) => {
  const diameter = requireNumber(args, 'diameter', 'knob');
  const height   = requireNumber(args, 'height', 'knob');
  if (diameter <= 0 || height <= 0)
    throw new BakerError('knob: diameter and height must be positive');

  const bodyStyle = optionalString(args, 'body_style', 'cylindrical');
  const topD      = optionalNumber(args, 'top_diameter', diameter);
  const baseD     = optionalNumber(args, 'base_diameter', diameter);
  const crownR    = Math.max(0, optionalNumber(args, 'crown_radius', 0));
  const edgeR     = Math.max(0, optionalNumber(args, 'edge_radius', 0));
  const draftDeg  = optionalNumber(args, 'side_draft_deg', 0);
  if (topD <= 0)  throw new BakerError('knob: top_diameter must be positive');
  if (baseD <= 0) throw new BakerError('knob: base_diameter must be positive');
  if (Math.abs(draftDeg) >= 45)
    throw new BakerError('knob: |side_draft_deg| must be < 45');

  const sectionTs = [0, 0.18, 0.42, 0.72, 1.0];
  const bodyBottom = -height * 0.5;

  type SketchLike = ReturnType<InstanceType<typeof ctx.replicad.Drawing>['sketchOnPlane']>;
  const sketches: SketchLike[] = sectionTs.map((t) => {
    const r = bodyRadiusAt(bodyStyle, t, baseD, topD, diameter, draftDeg);
    return buildSection(ctx, bodyStyle, r, bodyBottom + height * t, t) as SketchLike;
  });

  const [first, ...rest] = sketches;
  // Sketch.loftWith 接受同类 sketch 列表，返回 Shape3D
  let shape = (first as unknown as { loftWith: (s: unknown[], cfg?: { ruled?: boolean }) => BakeableShape })
    .loftWith(rest as unknown[], { ruled: false });

  const maxRadius = Math.max(baseD, topD, diameter) * 0.5;

  if (edgeR > 0) {
    try {
      shape = shape.fillet(
        Math.min(edgeR, maxRadius * 0.35, height * 0.18),
        (e) => e.inDirection([0, 0, 1]),
      );
    } catch { /* 圆角失败保留原 shape */ }
  }
  if (crownR > 0) {
    try {
      const topZ = bodyBottom + height;
      shape = shape.fillet(
        Math.min(crownR, maxRadius * 0.25, height * 0.16),
        (e) => e.inPlane('XY', topZ),
      );
    } catch { /* 圆角失败保留原 shape */ }
  }

  // ── 参数化附加几何（skirt / indicator / bore） ──

  // skirt：底部加一圈更宽的裙边圆台（skirt_diameter > body 时才有意义）
  const skirtD = optionalNumber(args, 'skirt_diameter', 0);
  const skirtH = optionalNumber(args, 'skirt_height', 0);
  if (skirtD > 0 && skirtH > 0) {
    if (skirtD <= maxRadius * 2)
      throw new BakerError('knob: skirt_diameter must be larger than the body diameter');
    const h = Math.min(skirtH, height * 0.6);
    const skirt = ctx.replicad.makeCylinder(
      skirtD * 0.5, h, [0, 0, bodyBottom], [0, 0, 1],
    ) as BakeableShape;
    shape = csgFuse(shape, skirt);
  }

  // indicator：顶面一道朝 +X 的指示槽（便于读取旋钮角度）
  const indicator = optionalBool(args, 'indicator', false);
  if (indicator) {
    const topZ = bodyBottom + height;
    const grooveW = Math.max(maxRadius * 0.12, 0.0006);
    const grooveDepth = Math.min(height * 0.12, maxRadius * 0.3);
    const groove = ctx.replicad.makeBaseBox(maxRadius * 1.1, grooveW, grooveDepth * 2)
      .translate(maxRadius * 0.55, 0, topZ) as BakeableShape;
    shape = csgCut(shape, groove);
  }

  // bore：中心轴孔（贯穿整个 body）
  const boreD = optionalNumber(args, 'bore_d', 0);
  if (boreD > 0) {
    if (boreD >= maxRadius * 2)
      throw new BakerError('knob: bore_d must be smaller than the body diameter');
    const bore = ctx.replicad.makeCylinder(
      boreD * 0.5, height + 0.01, [0, 0, bodyBottom - 0.005], [0, 0, 1],
    ) as BakeableShape;
    shape = csgCut(shape, bore);
  }

  return maybeShiftToZ0(shape, height, args);
};

// ── bezel 几何 ────────────────────────────────────────────────────

type Drawing = ReturnType<typeof import('replicad')['drawCircle']>;

/**
 * 不同 shape 关键字构造对应 2D drawing。
 * 所有图形居中于 (0,0)。super-ellipse 使用 n=4 的 Lamé 曲线参数化。
 */
function buildShapeDrawing(
  ctx: OpContext,
  shape: string,
  w: number,
  h: number,
  cornerR: number,
): Drawing {
  switch (shape) {
    case 'rect':
    case 'rounded_rect': {
      const maxR = Math.min(w, h) * 0.5;
      const r = Math.max(0, Math.min(cornerR, maxR - 1e-4));
      return ctx.replicad.drawRoundedRectangle(w, h, r);
    }
    case 'circle': {
      const r = Math.min(w, h) * 0.5;
      return ctx.replicad.drawCircle(r);
    }
    case 'ellipse': {
      return ctx.replicad.drawEllipse(w * 0.5, h * 0.5);
    }
    case 'superellipse': {
      const a = w * 0.5;
      const b = h * 0.5;
      const n = 4;
      return ctx.replicad.drawParametricFunction(
        (t: number) => {
          const theta = 2 * Math.PI * t;
          const c = Math.cos(theta);
          const s = Math.sin(theta);
          const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
          const y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
          return [x, y];
        },
        { pointsCount: 96, start: 0, stop: 1, closeShape: true },
      );
    }
    default:
      throw new BakerError(`bezel: unsupported shape "${shape}"`);
  }
}

export const bezel: OpBuilder = (ctx, args) => {
  // DSL 传的是 opening_size: [w, h] 和 outer_size: [w, h]（numList），
  // 而非独立的 opening_w / opening_h / outer_w / outer_h 标量。
  const openingSz = requireNumList(args, 'opening_size', 2, 'bezel');
  const outerSz   = requireNumList(args, 'outer_size', 2, 'bezel');
  const openingW  = openingSz[0];
  const openingH  = openingSz[1];
  const outerW    = outerSz[0];
  const outerH    = outerSz[1];
  const depth    = requireNumber(args, 'depth', 'bezel');
  const openingShape = optionalString(args, 'opening_shape', 'rect');
  const outerShape   = optionalString(args, 'outer_shape', 'rect');
  const openingCR    = Math.max(0, optionalNumber(args, 'opening_corner_radius', 0));
  const outerCR      = Math.max(0, optionalNumber(args, 'outer_corner_radius', 0));
  const wallOverride = optionalNumber(args, 'wall', 0);

  if (openingW <= 0 || openingH <= 0) throw new BakerError('bezel: opening_size values must be positive');
  if (outerW <= 0 || outerH <= 0)     throw new BakerError('bezel: outer_size values must be positive');
  if (depth <= 0)                       throw new BakerError('bezel: depth must be positive');

  let effOpeningW = openingW;
  let effOpeningH = openingH;
  if (wallOverride > 0) {
    effOpeningW = Math.max(1e-4, outerW - 2 * wallOverride);
    effOpeningH = Math.max(1e-4, outerH - 2 * wallOverride);
  }
  if (effOpeningW >= outerW || effOpeningH >= outerH)
    throw new BakerError('bezel: opening must be strictly smaller than outer');

  const outer = buildShapeDrawing(ctx, outerShape, outerW, outerH, outerCR);
  const inner = buildShapeDrawing(ctx, openingShape, effOpeningW, effOpeningH, openingCR);
  const ring  = outer.cut(inner);

  const sketch = ring.sketchOnPlane('XY', -depth * 0.5);
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  let shape = (sketch as unknown as SolidSketch).extrude(depth);

  // ── 参数化附加几何（bezel：recess / flange） ──

  // flange：背面（-Z 端）加一圈更宽的安装法兰（薄板，超出 outer flange_width）
  const flangeWidth = optionalNumber(args, 'flange_width', 0);
  if (flangeWidth > 0) {
    const flangeT = Math.min(depth * 0.4, depth - 1e-4);
    const flangeOuter = buildShapeDrawing(ctx, outerShape, outerW + 2 * flangeWidth, outerH + 2 * flangeWidth, outerCR);
    const flangeRing = flangeOuter.cut(inner);
    const flangeSketch = flangeRing.sketchOnPlane('XY', -depth * 0.5);
    const flange = (flangeSketch as unknown as SolidSketch).extrude(flangeT);
    shape = csgFuse(shape, flange);
  }

  // recess：正面（+Z 端）切一个比 opening 略大的浅台阶座（放屏幕/镜片用）
  const recessDepth = optionalNumber(args, 'recess_depth', 0);
  if (recessDepth > 0) {
    if (recessDepth >= depth)
      throw new BakerError('bezel: recess_depth must be smaller than depth');
    const seatMargin = Math.min(openingW, openingH) * 0.12 + 1e-4;
    const recessW = Math.min(effOpeningW + 2 * seatMargin, outerW - 1e-4);
    const recessH = Math.min(effOpeningH + 2 * seatMargin, outerH - 1e-4);
    const recessShape = buildShapeDrawing(ctx, openingShape, recessW, recessH, openingCR);
    const recessSketch = recessShape.sketchOnPlane('XY', depth * 0.5 - recessDepth);
    const recessSolid = (recessSketch as unknown as SolidSketch).extrude(recessDepth + 0.001);
    shape = csgCut(shape, recessSolid);
  }

  return maybeShiftToZ0(shape, depth, args);
};
