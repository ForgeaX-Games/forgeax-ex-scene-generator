/**
 * Gears 家族的 replicad 几何助手层（自 ops/gears.ts 抽出）。
 *
 * 这里集中放置所有 op builder 共享的底层工具：
 *   - 形状清理 / 居中（safeDelete / maybeShiftToZ0）
 *   - 2D 点列 → Drawing（pointsToDrawing）
 *   - stepped-twist extrude 及其 herringbone 变体（绕开 OCCT twistAngle 数值异常）
 *   - 各齿轮 spec 读取（readSpurSpec / readRingSpec / readRackSpec）
 *   - 中心轴孔（applyBore）
 * 纯几何/参数逻辑，不含 op 注册；op builder 本身仍在 ops/gears.ts。
 */

import type { BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut } from '../csg_helpers.js';
import { optionalBool, optionalNumber, requireNumber } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';
import {
  buildGearOutline,
  dedupAdjacent,
  SPUR_DEFAULTS,
  type Point2D,
  type RackGearSpec,
  type RingGearSpec,
  type SpurGearGeom,
  type SpurGearSpec,
} from './gear_math.js';

// safeDelete 收敛到共享 op_helpers；这里 re-export 以保持 gears 内部 import 路径不变。
import { safeDelete } from '../op_helpers.js';
export { safeDelete };

export function maybeShiftToZ0(shape: BakeableShape, h: number, args: Record<string, Arg>): BakeableShape {
  const center = optionalBool(args, 'center', true);
  if (center) return shape;
  const moved = shape.translateZ(h / 2);
  safeDelete(shape);
  return moved;
}

/** 抽象 Drawing 类型：`.close()` 返回的对象有 `sketchOnPlane` / `cut` 等方法。 */
export type ClosedDrawing = ReturnType<ReturnType<OpContext['replicad']['draw']>['close']>;

/**
 * 把一个 2D 闭合点列（CCW）转成 replicad Drawing（已 close）。
 * 用 draw(points[0]).lineTo(points[1])... 然后 close()。
 */
export function pointsToDrawing(
  ctx: OpContext,
  points: Point2D[],
): ClosedDrawing {
  if (points.length < 3) throw new BakerError('gear outline must have >=3 points');
  const cleaned = dedupAdjacent(points);
  if (cleaned.length < 3) throw new BakerError('gear outline degenerate after dedup');
  const pen = ctx.replicad.draw([cleaned[0][0], cleaned[0][1]]);
  for (let i = 1; i < cleaned.length; i++) {
    pen.lineTo([cleaned[i][0], cleaned[i][1]]);
  }
  return pen.close();
}

/**
 * Drawing -> Sketch -> extrude，支持 stepped-twist 螺旋齿。
 *
 * 关于 `twistRad`：replicad 的 `extrude({ twistAngle })` 在 1000+ 点的渐开线
 * 多边形 + 凹齿根弧上会触发 OCCT `BRepOffsetAPI_*` 数值异常。我们绕开方法是
 * **stepped-twist**：把 height 切成 N 段，每段是直 extrude，第 i 段绕 Z 旋转
 * `i * twistRad / N`，最后用 `makeCompound` 包成一个 TopoDS_Compound。
 *
 * 视觉效果：远看是螺旋齿，近看每两片之间有"小棱"（约 STEP_DEG/2 度）。STEP_DEG
 * 越小越平滑，但段数越多 → bake 时间越长。15° 是默认 spline 段数对应
 * 的近似分辨率。
 *
 * twist=0 时退化成 1 段直 extrude，与之前性能等价。
 */
const STEP_DEG = 15;
export const MIN_TWIST_SLICES = 2; // 任何非零 twist 至少 2 段就能看出"扭"了

/**
 * 把 drawing 沿 z 从 zStart 到 zEnd extrude，旋转从 thetaStartDeg 线性插值到 thetaEndDeg。
 * 用 N 段 stepped extrude + makeCompound 拼合。
 *
 * N 选择：
 *   - thetaStart == thetaEnd（无 twist）→ 1 段
 *   - 否则 → max(MIN_TWIST_SLICES, ceil(|delta| / STEP_DEG))
 *
 * 每段的旋转角用端点插值：i-th slice 的角度 = thetaStart + i*(thetaEnd-thetaStart)/(N-1)
 * 这样底面正好在 thetaStart、顶面正好在 thetaEnd，对接 herringbone 上下两半时
 * 中心面对齐于 theta=0 不留缝。
 *
 * 这是底层 primitive，extrudeDrawing / extrudeDrawingHerringbone 都建立在它之上。
 */
function steppedTwistExtrude(
  ctx: OpContext,
  drawing: ClosedDrawing,
  zStart: number,
  zEnd: number,
  thetaStartDeg: number,
  thetaEndDeg: number,
): BakeableShape {
  const slices = buildSlicesStepped(ctx, drawing, zStart, zEnd, thetaStartDeg, thetaEndDeg);
  if (slices.length === 1) return slices[0];
  const compound = ctx.replicad.makeCompound(slices) as BakeableShape;
  for (const s of slices) safeDelete(s);
  return compound;
}

/**
 * Drawing -> Sketch -> extrude 居中沿 Z。zStart=baseZ ?? -h/2，theta 从 0 到 twistDeg。
 */
export function extrudeDrawing(
  ctx: OpContext,
  drawing: ClosedDrawing,
  height: number,
  twistRad = 0,
  baseZ?: number,
): BakeableShape {
  const z0 = baseZ ?? -height * 0.5;
  const twistDeg = (twistRad * 180) / Math.PI;
  return steppedTwistExtrude(ctx, drawing, z0, z0 + height, 0, twistDeg);
}

/**
 * 人字齿专用：上下两半在 z=0 对接，扭向相反，形成"V/Λ"形齿面。
 *   z ∈ [0, +h/2]:   theta 从 0 上行到 +twist/2  (CCW)
 *   z ∈ [-h/2, 0]:   theta 从 +twist/2 下降到 0  (CW，等效 z 自下而上 -twist/2→0)
 * 在 z=0 处两半同处于 theta=0，齿面对齐，形成对称人字。
 *
 * 实现细节：直接把上下两半的 slices 平铺到一个 makeCompound，避免嵌套 compound
 * （compound-of-compound 在 OCCT BRepMesh 上偶发 fault）。
 */
export function extrudeDrawingHerringbone(
  ctx: OpContext,
  drawing: ClosedDrawing,
  height: number,
  twistRad: number,
): BakeableShape {
  if (Math.abs(twistRad) < 1e-9) {
    return extrudeDrawing(ctx, drawing, height, 0);
  }
  const halfH = height / 2;
  const halfDeg = (twistRad * 180) / Math.PI / 2;
  const topSlices = buildSlicesStepped(ctx, drawing, 0, +halfH, 0, +halfDeg);
  const botSlices = buildSlicesStepped(ctx, drawing, -halfH, 0, +halfDeg, 0);
  const all = [...topSlices, ...botSlices];
  const compound = ctx.replicad.makeCompound(all) as BakeableShape;
  for (const s of all) safeDelete(s);
  return compound;
}

/**
 * 把 steppedTwistExtrude 内部的"产生 slices"步骤暴露出来，供 herringbone 拼合用。
 * 返回 N 个 Shape3D；调用方负责后续 makeCompound + safeDelete。
 */
export function buildSlicesStepped(
  _ctx: OpContext,
  drawing: ClosedDrawing,
  zStart: number,
  zEnd: number,
  thetaStartDeg: number,
  thetaEndDeg: number,
): BakeableShape[] {
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const totalH = zEnd - zStart;
  const deltaTheta = thetaEndDeg - thetaStartDeg;
  const N = Math.abs(deltaTheta) < 1e-9
    ? 1
    : Math.max(MIN_TWIST_SLICES, Math.ceil(Math.abs(deltaTheta) / STEP_DEG));
  const sliceH = totalH / N;
  const slices: BakeableShape[] = [];
  for (let i = 0; i < N; i++) {
    const sketch = drawing.sketchOnPlane('XY', zStart + i * sliceH) as unknown as SolidSketch;
    let s = sketch.extrude(sliceH);
    const ang = N === 1
      ? thetaStartDeg
      : thetaStartDeg + (deltaTheta * i) / (N - 1);
    if (Math.abs(ang) > 1e-9) {
      const rotated = s.rotate(ang, [0, 0, 0], [0, 0, 1]);
      safeDelete(s);
      s = rotated;
    }
    slices.push(s);
  }
  return slices;
}

/** 读 SpurGearSpec 公用部分（所有齿轮共享）。 */
export function readSpurSpec(args: Record<string, Arg>, op: string): SpurGearSpec {
  const m = requireNumber(args, 'module', op);
  const z = Math.round(requireNumber(args, 'teeth_number', op));
  const w = requireNumber(args, 'width', op);
  if (z < 3) throw new BakerError(`${op}: teeth_number must be >= 3`);
  if (m <= 0 || w <= 0) throw new BakerError(`${op}: module and width must be positive`);
  return {
    module: m,
    teethNumber: z,
    width: w,
    pressureAngleDeg: optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg),
    helixAngleDeg: optionalNumber(args, 'helix_angle', SPUR_DEFAULTS.helixAngleDeg),
    clearance: optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance),
    backlash: optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash),
    addCoeff: SPUR_DEFAULTS.addCoeff,
    dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
}

export function readRingSpec(args: Record<string, Arg>, op: string): RingGearSpec {
  const base = readSpurSpec(args, op);
  const rim = requireNumber(args, 'rim_width', op);
  if (rim <= 0) throw new BakerError(`${op}: rim_width must be positive`);
  return { ...base, rimWidth: rim };
}

export function readRackSpec(args: Record<string, Arg>, op: string): RackGearSpec {
  const m = requireNumber(args, 'module', op);
  const len = requireNumber(args, 'length', op);
  const w = requireNumber(args, 'width', op);
  const h = requireNumber(args, 'height', op);
  if (m <= 0 || len <= 0 || w <= 0 || h <= 0)
    throw new BakerError(`${op}: module/length/width/height must be positive`);
  return {
    module: m,
    length: len,
    width: w,
    height: h,
    pressureAngleDeg: optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg),
    helixAngleDeg: optionalNumber(args, 'helix_angle', SPUR_DEFAULTS.helixAngleDeg),
    clearance: optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance),
    backlash: optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash),
    addCoeff: SPUR_DEFAULTS.addCoeff,
    dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
}

/** 在已有 Solid 上挖中心轴孔（沿 Z），bore_d 为正径时有效。 */
export function applyBore(
  ctx: OpContext,
  shape: BakeableShape,
  boreD: number,
  width: number,
): BakeableShape {
  if (boreD <= 0) return shape;
  const r = boreD * 0.5;
  const hole = ctx.replicad.makeCylinder(
    r, width + 0.01, [0, 0, -(width + 0.01) * 0.5], [0, 0, 1],
  ) as BakeableShape;
  return csgCut(shape, hole);
}

/** 把 spec + geom 转成 z=-w/2 起、沿 Z 的 spur/helical 齿轮 Solid。 */
export function buildSpurBodyClean(
  ctx: OpContext,
  spec: SpurGearSpec,
  geom: SpurGearGeom,
): BakeableShape {
  const pts = buildGearOutline(geom.toothOutline, spec.teethNumber, geom.tau);
  const drawing = pointsToDrawing(ctx, pts);
  return extrudeDrawing(ctx, drawing, spec.width, geom.twistAngle);
}
