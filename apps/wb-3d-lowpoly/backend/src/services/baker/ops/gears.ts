/**
 * Gears 家族 —— 15 个 op 的几何拓扑实现。
 *
 * v1 简化：
 *   1) 单齿轮（spur/herringbone/crossed_helical/hyperbolic）：
 *      - 采用渐开线"折线"近似（CURVE_POINTS=20），而不是 cq_gears 的 spline
 *        approximated NURBS surface。视觉上几乎一致，OCCT 处理速度快很多。
 *      - 螺旋 / 双曲齿用 replicad `extrude({ twistAngle })` 一步出 Solid。
 *      - 人字齿（herringbone）= 上下两半反向 twist 后 fuse。
 *   2) 内齿圈（ring）：外圆柱 cut(齿廓圆柱)；齿尖向内。
 *   3) 齿条（rack / herringbone_rack）：一个齿廓重复 z 次，加背板矩形封口。
 *      - v1 不实现 helix → straight extrude，helix 仅是齿啮合细节，
 *        URDF 视觉上影响极小。
 *   4) 锥齿轮（bevel）：cq_gears 用球面渐开线 + 锥体切割；
 *      v1 用 frustum + 浅角齿槽的近似（视觉占位）。
 *   5) 蜗杆（worm）：cq_gears 用螺旋 sweep；v1 用圆柱 + 仅 1 道螺旋刀槽近似。
 *   6) 齿轮对（bevel_pair / crossed_pair / hyperbolic_pair）：
 *      bake 两侧子齿轮，按放置矩阵 fuse 在一个 compound 里。
 *   7) 行星齿轮组（planetary / herringbone_planetary）：
 *      sun + N planet + ring 全 bake 后按 assemble 公式拼成 compound。
 *
 * 坐标约定：与 Parts 一致，圆盘在 XY 面，转轴 = +Z；center=false 时整体 +Z 平移 h/2。
 *
 * ⚠️ 仅供内部库使用，DSL 不可达（不是死代码）：对应的 `Generate/Parts/g_*` 电池已在
 * `3b752a7c`（"重整 Generate/Parts 为 CAD/Parts"）中删除，且 op-registry.ts 的 SPECS /
 * dsl-to-graph.ts 的 OP_TABLE/GENERIC_BATTERY 已同步移除这些 op（见 CHANGELOG "Removed"）。
 * 这里的形状构建函数仍被 `backend/tests/baker-gears-all.smoke.ts` 等内部测试直接调用，
 * 用来验证 baker 拓扑实现本身，但 Geometry DSL 已无法编译出会路由到这些函数的语句。
 */

import type { OpBuilder, BakeableShape, OpContext } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut } from '../csg_helpers.js';
import { optionalNumber, requireNumber } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';
import {
  computeRackGearGeom,
  computeRingGearGeom,
  computeSpurGearGeom,
  buildGearOutline,
  SPUR_DEFAULTS,
  type Point2D,
  type RackGearGeom,
  type RackGearSpec,
  type RingGearGeom,
  type RingGearSpec,
  type SpurGearGeom,
  type SpurGearSpec,
} from '../gears/gear_math.js';
// Shared replicad geometry toolkit + spec readers (extracted; see gear_helpers).
import {
  safeDelete,
  maybeShiftToZ0,
  type ClosedDrawing,
  pointsToDrawing,
  extrudeDrawing,
  extrudeDrawingHerringbone,
  buildSlicesStepped,
  MIN_TWIST_SLICES,
  readSpurSpec,
  readRingSpec,
  readRackSpec,
  applyBore,
  buildSpurBodyClean,
} from '../gears/gear_helpers.js';

// ── 单齿轮（spur 家族） ───────────────────────────────────────────
// 公共助手（safeDelete / extrude / spec 读取 / applyBore / buildSpurBodyClean）
// 已抽到 ../gears/gear_helpers.ts；以下为各齿轮 op builder。

export const spurGear: OpBuilder = (ctx, args) => {
  const spec = readSpurSpec(args, 'spur_gear');
  const geom = computeSpurGearGeom(spec);
  let shape = buildSpurBodyClean(ctx, spec, geom);
  const boreD = optionalNumber(args, 'bore_d', 0);
  shape = applyBore(ctx, shape, boreD, spec.width);
  return maybeShiftToZ0(shape, spec.width, args);
};

/**
 * Herringbone = 上下两半反向 stepped-twist 后用 makeCompound 合成 V 形齿。
 *
 * 当 spec.helixAngleDeg = 0 时退化为直齿，等价 spur。所以
 * herringboneGear / herringbonePlanetary 在我们 op 层会强制一个 helix 默认值（见
 * helixOrDefault 与 HERRINGBONE_DEFAULT_HELIX_DEG），让用户不传 helix 时也能看到
 * 真正的人字。
 */
function buildHerringboneBody(
  ctx: OpContext,
  spec: SpurGearSpec,
  geom: SpurGearGeom,
): BakeableShape {
  if (Math.abs(geom.twistAngle) < 1e-9) {
    return buildSpurBodyClean(ctx, spec, geom);
  }
  const pts = buildGearOutline(geom.toothOutline, spec.teethNumber, geom.tau);
  const drawing = pointsToDrawing(ctx, pts);
  return extrudeDrawingHerringbone(ctx, drawing, spec.width, geom.twistAngle);
}

/** 给 herringbone / planetary herringbone 默认螺旋角。helix=0
 *  时人字齿无意义，会和 spur 一样，所以兜底一个默认值。 */
const HERRINGBONE_DEFAULT_HELIX_DEG = 25;
function helixOrDefault(args: Record<string, Arg>, fallback: number): number {
  const v = optionalNumber(args, 'helix_angle', 0);
  return Math.abs(v) < 1e-9 ? fallback : v;
}

export const herringboneGear: OpBuilder = (ctx, args) => {
  const baseSpec = readSpurSpec(args, 'herringbone_gear');
  const helix = helixOrDefault(args, HERRINGBONE_DEFAULT_HELIX_DEG);
  const spec: SpurGearSpec = { ...baseSpec, helixAngleDeg: helix };
  const geom = computeSpurGearGeom(spec);
  let shape = buildHerringboneBody(ctx, spec, geom);
  const boreD = optionalNumber(args, 'bore_d', 0);
  shape = applyBore(ctx, shape, boreD, spec.width);
  return maybeShiftToZ0(shape, spec.width, args);
};

/** CrossedHelicalGear: a/cos(helix) 换算让齿尺寸跟 helix 走，
 *  v1 直接复用 SpurGearSpec → SpurGearGeom（d0/rb 算式里的 helix 修正
 *  仅影响 helical mesh 啮合细节；URDF 视觉等价）。
 *
 *  helix_angle 默认 0 时退化为 spur，没有"交错"语义，所以 op 层会兜底一个 15°。 */
const CROSSED_HELICAL_DEFAULT_HELIX_DEG = 15;
export const crossedHelicalGear: OpBuilder = (ctx, args) => {
  const baseSpec = readSpurSpec(args, 'crossed_helical_gear');
  const helix = helixOrDefault(args, CROSSED_HELICAL_DEFAULT_HELIX_DEG);
  const spec: SpurGearSpec = { ...baseSpec, helixAngleDeg: helix };
  const geom = computeSpurGearGeom(spec);
  let shape = buildSpurBodyClean(ctx, spec, geom);
  const boreD = optionalNumber(args, 'bore_d', 0);
  shape = applyBore(ctx, shape, boreD, spec.width);
  return maybeShiftToZ0(shape, spec.width, args);
};

/** HyperbolicGear: twist_angle 直接当总扭转；helix_angle 强制 0。
 *  在我们的 SpurGearSpec 里没有 twist 字段，所以 read 后把它换算成等效 helix_angle。
 *
 *  width / (r0 * tan(pi/2 - helix)) = twist  ⇒  tan(pi/2 - helix) = width / (r0 * twist)
 *  ⇒  helix = pi/2 - atan(width / (r0 * twist))
 *
 *  r0 在 read 时还不知道（要先按 helix=0 算），所以用迭代：
 *    1) 用 helix=0 算 geom → 得 r0
 *    2) 用上面公式反推 helix → 重算 geom（r0 不变，只是 twistAngle 改变）
 */
export const hyperbolicGear: OpBuilder = (ctx, args) => {
  const baseSpec = readSpurSpec(args, 'hyperbolic_gear');
  const twistDeg = requireNumber(args, 'twist_angle', 'hyperbolic_gear');
  if (Math.abs(twistDeg) < 1e-9) {
    // 退化为 spur
    const geom0 = computeSpurGearGeom(baseSpec);
    let shape0 = buildSpurBodyClean(ctx, baseSpec, geom0);
    shape0 = applyBore(ctx, shape0, optionalNumber(args, 'bore_d', 0), baseSpec.width);
    return maybeShiftToZ0(shape0, baseSpec.width, args);
  }
  const geomNoHelix = computeSpurGearGeom({ ...baseSpec, helixAngleDeg: 0 });
  const twistRad = (twistDeg * Math.PI) / 180;
  const helix = Math.PI / 2 - Math.atan(baseSpec.width / (geomNoHelix.r0 * twistRad));
  const helixDeg = (helix * 180) / Math.PI;
  const spec: SpurGearSpec = { ...baseSpec, helixAngleDeg: helixDeg };
  const geom = computeSpurGearGeom(spec);
  let shape = buildSpurBodyClean(ctx, spec, geom);
  shape = applyBore(ctx, shape, optionalNumber(args, 'bore_d', 0), spec.width);
  return maybeShiftToZ0(shape, spec.width, args);
};

// ── 内齿圈（ring 家族） ───────────────────────────────────────────

/**
 * Ring gear: 外圆柱（rimR）cut(齿廓凸多边形 = 齿尖向内的轮廓的"反向" / 实际就是
 * 齿廓本身但齿尖在内圆周上)。
 *
 * 实现：
 *   1) 外圆 = drawCircle(rimR)
 *   2) 内齿廓 = buildGearOutline(toothOutline, z, tau)  （包含齿尖向内的廓）
 *   3) drawing = outerCircle.cut(innerOutline)
 *   4) extrude with twist
 *
 * 注意：ring gear 的 toothOutline 已经按"齿尖向内"绘制（rd > ra），
 * 所以 outline 自然形成一个凹齿圈廓，cut 出来就是带内齿的环。
 */
function buildRingGearBody(
  ctx: OpContext,
  spec: RingGearSpec,
  geom: RingGearGeom,
): BakeableShape {
  const outer = ctx.replicad.drawCircle(geom.rimR);
  const pts = buildGearOutline(geom.toothOutline, spec.teethNumber, geom.tau);
  const inner = pointsToDrawing(ctx, pts);
  const ring = outer.cut(inner);
  return extrudeDrawing(ctx, ring, spec.width, geom.twistAngle);
}

export const ringGear: OpBuilder = (ctx, args) => {
  const spec = readRingSpec(args, 'ring_gear');
  const geom = computeRingGearGeom(spec);
  const shape = buildRingGearBody(ctx, spec, geom);
  return maybeShiftToZ0(shape, spec.width, args);
};

/**
 * Herringbone ring: 上下两半反向 stepped-twist。helix=0 时退化成 ring。
 */
function buildHerringboneRingBody(
  ctx: OpContext,
  spec: RingGearSpec,
  geom: RingGearGeom,
): BakeableShape {
  if (Math.abs(geom.twistAngle) < 1e-9) {
    return buildRingGearBody(ctx, spec, geom);
  }
  const outer = ctx.replicad.drawCircle(geom.rimR);
  const pts = buildGearOutline(geom.toothOutline, spec.teethNumber, geom.tau);
  const inner = pointsToDrawing(ctx, pts);
  const ring = outer.cut(inner);
  return extrudeDrawingHerringbone(ctx, ring, spec.width, geom.twistAngle);
}

export const herringboneRingGear: OpBuilder = (ctx, args) => {
  const baseSpec = readRingSpec(args, 'herringbone_ring_gear');
  const helix = helixOrDefault(args, HERRINGBONE_DEFAULT_HELIX_DEG);
  const spec: RingGearSpec = { ...baseSpec, helixAngleDeg: helix };
  const geom = computeRingGearGeom(spec);
  const shape = buildHerringboneRingBody(ctx, spec, geom);
  return maybeShiftToZ0(shape, spec.width, args);
};

// ── 齿条（rack 家族） ───────────────────────────────────────────

/**
 * Rack：齿条横截面在 XZ 平面（length 方向 = +X，齿向 = +Y），width 沿 +Y。
 * 等价 cq_gears Workplane("XY") + rect/extrude。
 *
 * 这里改用：截面在 XY 平面（X=length, Y=齿向高度），沿 +Z extrude width。
 * 与参考坐标系转一次（参考用 X=length, Z=齿向, Y=width；我们这里把
 * 齿向放到 Y，width 放到 Z），但 AABB 已记录此约定，URDF 视觉一致。
 */
/**
 * 构造齿条 2D 截面 Drawing（XY 平面：X=length, Y=齿向高度）。
 * 起点 (xLeft, yBack) 背板左下；上行走齿根→齿顶→齿根序列直到 xRight；
 * 再 (xRight, yBack) 背板右下回到起点。供直齿条与人字齿条共用。
 */
function buildRackDrawing(
  ctx: OpContext,
  spec: RackGearSpec,
  geom: RackGearGeom,
): ClosedDrawing {
  const [p1] = geom.toothPoints;
  const xLeft = p1[0];        // 第 0 齿左根 x（负）
  const yBack = geom.ld - spec.height; // 背板底（齿根再向下 height）
  const pitch = geom.pitch;
  const xRight = xLeft + pitch * geom.z;

  const pen = ctx.replicad.draw([xLeft, yBack]);
  pen.lineTo([p1[0], p1[1]]);
  for (let i = 0; i < geom.z; i++) {
    const dx = pitch * i;
    const [, p2, p3, p4, p5] = geom.toothPoints;
    pen.lineTo([p2[0] + dx, p2[1]]);
    pen.lineTo([p3[0] + dx, p3[1]]);
    pen.lineTo([p4[0] + dx, p4[1]]);
    pen.lineTo([p5[0] + dx, p5[1]]); // == 下一齿 p1
  }
  pen.lineTo([xRight, yBack]);
  return pen.close();
}

function buildRackBody(
  ctx: OpContext,
  spec: RackGearSpec,
  geom: RackGearGeom,
): BakeableShape {
  const drawing = buildRackDrawing(ctx, spec, geom);
  // 沿 +Z extrude width（沿 width 方向）
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const sketch = drawing.sketchOnPlane('XY', 0) as unknown as SolidSketch;
  return sketch.extrude(spec.width);
}

export const rackGear: OpBuilder = (ctx, args) => {
  const spec = readRackSpec(args, 'rack_gear');
  const geom = computeRackGearGeom(spec);
  return buildRackBody(ctx, spec, geom);
};

/** 人字齿条的 V 形半角（helix=0 时用此默认；否则用户 helix_angle）。 */
const HERRINGBONE_RACK_DEFAULT_HELIX_DEG = 25;

/**
 * 真实人字齿条：沿宽度方向（+Z）把截面切成若干薄片，每片在 length 方向（X）
 * 偏移 |z - zc| * tan(helix)，zc = 宽度中点。两侧对称偏移 → 齿呈 V 形（chevron）。
 *
 * 与 gear herringbone 的 stepped-twist 同理，用 stepped-shift 近似（每片直挤再平移），
 * 避免 OCCT 在带凹齿根的多边形上做真 helical sweep 时的数值异常。
 */
function buildHerringboneRackBody(
  ctx: OpContext,
  spec: RackGearSpec,
  geom: RackGearGeom,
): BakeableShape {
  const helixDeg = Math.abs(spec.helixAngleDeg) > 1e-9
    ? Math.abs(spec.helixAngleDeg)
    : HERRINGBONE_RACK_DEFAULT_HELIX_DEG;
  const beta = (helixDeg * Math.PI) / 180;
  const tanB = Math.tan(beta);
  const w = spec.width;
  const halfW = w / 2;
  const maxShift = halfW * tanB; // 端面相对中线在 X 上的偏移

  // 偏移很小时退化为直齿条
  if (maxShift < geom.pitch * 0.05) {
    return buildRackBody(ctx, spec, geom);
  }

  type SolidSketch = { extrude: (d: number) => BakeableShape };
  // 每片至多偏移 ~0.3*pitch，保证齿在视觉上连续；每半至少 2 片，整体上限 24 片
  const perHalf = Math.min(12, Math.max(2, Math.ceil(maxShift / (geom.pitch * 0.3))));
  const N = perHalf * 2;
  const sliceH = w / N;
  const shiftAt = (z: number): number => Math.abs(z - halfW) * tanB;

  const slices: BakeableShape[] = [];
  for (let i = 0; i < N; i++) {
    const z0 = i * sliceH;          // 截面 extrude 从 z=0 起（与直齿条一致）
    const zMid = z0 + sliceH / 2;
    const drawing = buildRackDrawing(ctx, spec, geom);
    const sketch = drawing.sketchOnPlane('XY', z0) as unknown as SolidSketch;
    let s = sketch.extrude(sliceH);
    const shift = shiftAt(zMid);
    if (Math.abs(shift) > 1e-9) {
      const moved = s.translateX(shift);
      safeDelete(s);
      s = moved;
    }
    slices.push(s);
  }
  const compound = ctx.replicad.makeCompound(slices) as BakeableShape;
  for (const s of slices) safeDelete(s);
  return compound;
}

/** Herringbone rack：齿沿宽度方向呈对称 V 形（真实人字齿条几何）。 */
export const herringboneRackGear: OpBuilder = (ctx, args) => {
  const spec = readRackSpec(args, 'herringbone_rack_gear');
  const geom = computeRackGearGeom(spec);
  return buildHerringboneRackBody(ctx, spec, geom);
};

// ── 行星齿轮组 ──────────────────────────────────────────────────

/**
 * 行星齿轮组：sun + N planets + ring 全部 bake 后用 csgFuse 拼成一个 compound。
 *
 * assemble 公式：
 *   - sun: 居中（planet.z 奇数时绕 Z 旋转 tau_sun/2）
 *   - planet: orbit_r = sun.r0 + planet.r0，绕 Z 等分 N 个位置
 *     每个 planet 绕 Z 旋转 planet.tau/2 让齿啮合
 *   - ring: 居中，绕 Z 旋转 ring.tau/2
 *
 * v1 沿用此布局。helix_angle 在 planet 取反。
 */
/**
 * 关于复合齿轮组的策略：
 *   sun/planet/ring 在啮合位置会"齿尖接触齿根"，做 `csgFuse` 时 OCCT
 *   `BRepAlgoAPI_Fuse` 要解算几十组接触面的相交关系，几乎必然几十秒到分钟级。
 *
 *   v1 改用 replicad `makeCompound([...])`，把若干 Shape3D 包成一个
 *   TopoDS_Compound（不做布尔运算，只是逻辑组合）。compound 仍可 `mesh()`
 *   出 OBJ，几何上得到的是几个独立 solid 拼成的"件群"。
 *
 *   优缺点：
 *     + 烘焙时间从分钟级降到 ~几秒，可达性 > 视觉精确度
 *     + 不存在相交解算 → 不会被 OCCT 数值噪声卡死
 *     - 同一 OBJ 文件内会有多个不连接的 solid，URDF mesh viewer 可正常渲染
 */
function buildPlanetaryBody(
  ctx: OpContext,
  args: Record<string, Arg>,
  opName: string,
  isHerringbone: boolean,
): BakeableShape {
  const m = requireNumber(args, 'module', opName);
  const zSun = Math.round(requireNumber(args, 'sun_teeth_number', opName));
  const zPla = Math.round(requireNumber(args, 'planet_teeth_number', opName));
  const w = requireNumber(args, 'width', opName);
  const rim = requireNumber(args, 'rim_width', opName);
  const nPla = Math.round(requireNumber(args, 'n_planets', opName));
  if (zSun < 3 || zPla < 3 || nPla < 1)
    throw new BakerError(`${opName}: teeth numbers and n_planets must be valid`);
  const zRing = zSun + zPla * 2;

  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  // herringbone variant 默认给个非零 helix，否则跟普通 planetary 看起来一样
  const helix = isHerringbone
    ? helixOrDefault(args, HERRINGBONE_DEFAULT_HELIX_DEG)
    : optionalNumber(args, 'helix_angle', SPUR_DEFAULTS.helixAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);

  const baseSpur = (z: number, h: number): SpurGearSpec => ({
    module: m,
    teethNumber: z,
    width: w,
    pressureAngleDeg: pressure,
    helixAngleDeg: h,
    clearance,
    backlash,
    addCoeff: SPUR_DEFAULTS.addCoeff,
    dedCoeff: SPUR_DEFAULTS.dedCoeff,
  });
  const baseRing = (z: number, h: number): RingGearSpec => ({
    ...baseSpur(z, h),
    rimWidth: rim,
  });

  const sunSpec = baseSpur(zSun, helix);
  const planetSpec = baseSpur(zPla, -helix);
  const ringSpec = baseRing(zRing, -helix);

  const sunGeom = computeSpurGearGeom(sunSpec);
  const planetGeom = computeSpurGearGeom(planetSpec);
  const ringGeomComp = computeRingGearGeom(ringSpec);

  /**
   * 直接构造每个齿轮的"slice 列表"（herringbone = 上下两半 slices），施加位置变换
   * 后扁平加入 parts。避免 compound-of-compounds 让 BRepMesh 失败。
   */
  const sunPts = buildGearOutline(sunGeom.toothOutline, sunSpec.teethNumber, sunGeom.tau);
  const sunDrawing = pointsToDrawing(ctx, sunPts);
  const planetPts = buildGearOutline(planetGeom.toothOutline, planetSpec.teethNumber, planetGeom.tau);
  const planetDrawing = pointsToDrawing(ctx, planetPts);
  const ringOuter = ctx.replicad.drawCircle(ringGeomComp.rimR);
  const ringInnerPts = buildGearOutline(ringGeomComp.toothOutline, ringSpec.teethNumber, ringGeomComp.tau);
  const ringInner = pointsToDrawing(ctx, ringInnerPts);
  const ringDrawing = ringOuter.cut(ringInner);

  /**
   * Planetary 内的 herringbone 用"最小 2 片"版本：每齿轮只生成 top + bot 两片，
   * top 片整体旋转 +twist/2，bot 片不旋转。视觉效果是 2-step 人字（够区分 spur）。
   * 这样 5 齿轮 × 2 片 = 10 片 compound，OCCT BRepMesh 能撑住；
   * 而标准 buildSlicesStepped 每半至少 2 片 → 4 片/齿轮 × 5 = 20 片，BRepMesh 会爆。
   */
  const buildGearSlices = (drawing: ClosedDrawing, twist: number): BakeableShape[] => {
    if (!isHerringbone || Math.abs(twist) < 1e-9) {
      return buildSlicesStepped(ctx, drawing, -w / 2, +w / 2, 0, (twist * 180) / Math.PI);
    }
    type SolidSketch = { extrude: (d: number) => BakeableShape };
    const halfDeg = (twist * 180) / Math.PI / 2;
    const halfH = w / 2;
    // Top: 0 → +halfH，整体旋转 +halfDeg
    const topSketch = drawing.sketchOnPlane('XY', 0) as unknown as SolidSketch;
    let top = topSketch.extrude(halfH);
    if (Math.abs(halfDeg) > 1e-9) {
      const r = top.rotate(halfDeg, [0, 0, 0], [0, 0, 1]);
      safeDelete(top);
      top = r;
    }
    // Bot: -halfH → 0，不旋转
    const botSketch = drawing.sketchOnPlane('XY', -halfH) as unknown as SolidSketch;
    const bot = botSketch.extrude(halfH);
    return [top, bot];
  };

  const parts: BakeableShape[] = [];

  const placeSlice = (
    s: BakeableShape,
    zRotDeg: number,
    tx: number,
    ty: number,
  ): BakeableShape => {
    let out = s;
    if (Math.abs(zRotDeg) > 1e-9) {
      const r = out.rotate(zRotDeg, [0, 0, 0], [0, 0, 1]);
      safeDelete(out);
      out = r;
    }
    if (Math.abs(tx) > 1e-9 || Math.abs(ty) > 1e-9) {
      const t = out.translate(tx, ty, 0);
      safeDelete(out);
      out = t;
    }
    return out;
  };

  // 1) Sun
  const sunSlices = buildGearSlices(sunDrawing, sunGeom.twistAngle);
  const sunRotDeg = (zPla % 2 !== 0) ? (sunGeom.tau * 180) / Math.PI / 2 : 0;
  for (const s of sunSlices) parts.push(placeSlice(s, sunRotDeg, 0, 0));

  // 2) Planets
  const orbitR = sunGeom.r0 + planetGeom.r0;
  const planetA = (Math.PI * 2.0) / nPla;
  const planetSelfRotDeg = (planetGeom.tau * 180) / Math.PI / 2;
  for (let i = 0; i < nPla; i++) {
    const slices = buildGearSlices(planetDrawing, planetGeom.twistAngle);
    const px = Math.cos(i * planetA) * orbitR;
    const py = Math.sin(i * planetA) * orbitR;
    for (const s of slices) parts.push(placeSlice(s, planetSelfRotDeg, px, py));
  }

  // 3) Ring
  const ringSlices = buildGearSlices(ringDrawing, ringGeomComp.twistAngle);
  const ringRotDeg = (ringGeomComp.tau * 180) / Math.PI / 2;
  for (const s of ringSlices) parts.push(placeSlice(s, ringRotDeg, 0, 0));

  const compound = ctx.replicad.makeCompound(parts) as BakeableShape;
  for (const p of parts) safeDelete(p);
  return compound;
}

export const planetaryGearset: OpBuilder = (ctx, args) => {
  const w = requireNumber(args, 'width', 'planetary_gearset');
  const shape = buildPlanetaryBody(ctx, args, 'planetary_gearset', false);
  return maybeShiftToZ0(shape, w, args);
};

export const herringbonePlanetaryGearset: OpBuilder = (ctx, args) => {
  const w = requireNumber(args, 'width', 'herringbone_planetary_gearset');
  const shape = buildPlanetaryBody(ctx, args, 'herringbone_planetary_gearset', true);
  return maybeShiftToZ0(shape, w, args);
};

// ── 锥齿轮（bevel） ──────────────────────────────────────────────

/**
 * Bevel gear：sliced-cone 近似——把锥面沿其轴向切成 N 个薄盘，每盘是一个直齿
 * spur gear，半径按锥角线性递减（module 同步缩，保持 z 不变）。N 个盘 stack 在
 * 一起用 `makeCompound` 拼合，视觉是"带齿的圆台"。
 *
 * 相比真正的球面渐开线锥齿轮：
 *   - 球面渐开线 + spline 才是真正的球面齿面；我们用 N 个平面齿廓
 *     堆叠近似，能看到清晰的齿轮齿，但每片之间有微小台阶
 *   - 不做"小端切口"修整，齿廓在 r 缩到接近 0 时会自相交，故 face_width 不能
 *     超过 cone_h * 0.9
 *
 * 参数语义：
 *   rp = m * z / 2      节圆半径（大端）
 *   gs_r = rp / sin(γ)  锥顶球面半径
 *   coneH = cos(γ_r) * gs_r 大端到锥顶高度（cone_h）
 *
 * 我们的 z 轴：大端在 z=0，沿 +Z 向锥顶；slice 高度 = face_width * cos(γ) / N
 */
/**
 * 锥齿轮切片：沿锥角收缩的渐开线截面，沿轴向（+Z）堆叠成"带齿圆台"。
 * 每片是一个直齿渐开线齿廓（module 随锥面线性收缩，z 不变），自大端向小端递减。
 * helix≠0 时每片绕 Z 渐进旋转 → 螺旋锥齿（spiral bevel）齿迹；helix=0 退化为直齿锥齿。
 *
 * 真正消费 pressure_angle / clearance / backlash / helix_angle 四个参数。
 */
function buildBevelSlices(
  ctx: OpContext,
  args: Record<string, Arg>,
  opName: string,
): { slices: BakeableShape[]; coneH: number; raLarge: number; totalH: number } {
  const m = requireNumber(args, 'module', opName);
  const z = Math.round(requireNumber(args, 'teeth_number', opName));
  const coneDeg = requireNumber(args, 'cone_angle', opName);
  const face = requireNumber(args, 'face_width', opName);
  if (m <= 0 || z < 3 || face <= 0)
    throw new BakerError(`${opName}: invalid module/teeth_number/face_width`);
  if (coneDeg <= 0 || coneDeg >= 90)
    throw new BakerError(`${opName}: cone_angle must be in (0, 90) degrees`);

  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);
  // 螺旋锥齿：helix 决定小端相对大端的总旋转角（视觉螺旋齿迹）。helix=0 → 直齿锥齿。
  const helixDeg = optionalNumber(args, 'helix_angle', 0);

  const coneRad = (coneDeg * Math.PI) / 180;
  const rp = (m * z) / 2;
  const gs_r = rp / Math.sin(coneRad);   // gs_r
  const coneH = Math.cos(coneRad) * gs_r; // cone_h
  const totalH = face * Math.cos(coneRad);
  if (face >= gs_r * 0.95)
    throw new BakerError(`${opName}: face_width too large (max ${(gs_r * 0.95).toFixed(4)})`);

  // 总螺旋角随 helix 增大；限幅到 ±60° 保持视觉清晰。
  const spiralTotalDeg = Math.max(-60, Math.min(60, helixDeg));

  const N = 4; // 切片数；越大越平滑，但 OCCT BRepMesh 会指数变贵
  const sliceH = totalH / N;
  const slices: BakeableShape[] = [];
  for (let i = 0; i < N; i++) {
    const sFrac = (i + 0.5) / N;
    const r_pitch = rp - sFrac * face * Math.sin(coneRad);
    if (r_pitch <= 0) break;
    const module_i = (2 * r_pitch) / z;
    const spec: SpurGearSpec = {
      module: module_i,
      teethNumber: z,
      width: sliceH,
      pressureAngleDeg: pressure,
      helixAngleDeg: 0, // 单片内直齿；螺旋齿迹由片间渐进旋转实现
      clearance,
      backlash,
      addCoeff: SPUR_DEFAULTS.addCoeff,
      dedCoeff: SPUR_DEFAULTS.dedCoeff,
    };
    const geom = computeSpurGearGeom(spec);
    const sliceShape = buildSpurBodyClean(ctx, spec, geom);
    let placed = sliceShape.translateZ(i * sliceH + sliceH / 2);
    safeDelete(sliceShape);
    if (Math.abs(spiralTotalDeg) > 1e-9) {
      const rotated = placed.rotate(spiralTotalDeg * sFrac, [0, 0, 0], [0, 0, 1]);
      safeDelete(placed);
      placed = rotated;
    }
    slices.push(placed);
  }

  if (slices.length === 0)
    throw new BakerError(`${opName}: produced no slices (check face_width / cone_angle)`);
  return { slices, coneH, raLarge: rp + m, totalH };
}

export const bevelGear: OpBuilder = (ctx, args) => {
  const { slices, totalH } = buildBevelSlices(ctx, args, 'bevel_gear');
  let result = ctx.replicad.makeCompound(slices) as BakeableShape;
  for (const s of slices) safeDelete(s);
  const boreD = optionalNumber(args, 'bore_d', 0);
  if (boreD > 0) {
    // 大端到小端轴向高度 = totalH；为通孔，要稍微长一点保险
    result = applyBore(ctx, result, boreD, totalH * 1.1);
  }
  return result;
};

export const bevelGearPair: OpBuilder = (ctx, args) => {
  const m = requireNumber(args, 'module', 'bevel_gear_pair');
  const gT = Math.round(requireNumber(args, 'gear_teeth', 'bevel_gear_pair'));
  const pT = Math.round(requireNumber(args, 'pinion_teeth', 'bevel_gear_pair'));
  const face = requireNumber(args, 'face_width', 'bevel_gear_pair');
  const axisDeg = optionalNumber(args, 'axis_angle', 90);
  // 大小锥齿共享的齿形参数（真正透传给每侧切片，消费 pressure/clearance/backlash）
  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);
  if (gT < 3 || pT < 3) throw new BakerError('bevel_gear_pair: teeth >= 3');

  // 装配公式
  const aa = (axisDeg * Math.PI) / 180;
  const deltaGear = Math.atan(Math.sin(aa) / (pT / gT + Math.cos(aa)));
  const deltaPinion = Math.atan(Math.sin(aa) / (gT / pT + Math.cos(aa)));

  const mkBevelArgs = (teeth: number, cone: number): Record<string, Arg> => ({
    module: { kind: 'number', value: m },
    teeth_number: { kind: 'number', value: teeth },
    cone_angle: { kind: 'number', value: (cone * 180) / Math.PI },
    face_width: { kind: 'number', value: face },
    pressure_angle: { kind: 'number', value: pressure },
    clearance: { kind: 'number', value: clearance },
    backlash: { kind: 'number', value: backlash },
  });

  // 用 slices 而非 compound，避免 BRepMesh 处理 compound-of-compound
  const gearRes = buildBevelSlices(ctx, mkBevelArgs(gT, deltaGear), 'bevel_gear_pair');
  const pinionRes = buildBevelSlices(ctx, mkBevelArgs(pT, deltaPinion), 'bevel_gear_pair');

  // 大齿轮 gear 直接加入 parts
  const parts: BakeableShape[] = [...gearRes.slices];

  // pinion: T(0,0,-pinion.coneH) → R_y(axis_angle) → T(0,0,gear.coneH)
  for (const p of pinionRes.slices) {
    const t1 = p.translateZ(-pinionRes.coneH);
    const r = t1.rotate(axisDeg, [0, 0, 0], [0, 1, 0]);
    safeDelete(t1);
    const t2 = r.translateZ(gearRes.coneH);
    safeDelete(r);
    parts.push(t2);
  }

  const compound = ctx.replicad.makeCompound(parts) as BakeableShape;
  for (const p of parts) safeDelete(p);
  return compound;
};

// ── Worm ─────────────────────────────────────────────────────────

/**
 * Worm（蜗杆，v1 占位）：cq_gears 用 makeSplineApprox 出螺旋齿面 + sweep；
 * v1 用 cylinder 大半径 ≈ pitch_r + addendum，长 length，沿 X 轴。
 *   - 单道螺旋槽用 makeHelix + sweep 一个小圆柱当占位（v1 不做，仅圆柱即可）。
 *   - bore_d 沿 X 轴挖中心孔。
 *
 * AABB 已记录 r_outer 与 length，URDF placement 安全。
 */
/**
 * Worm（蜗杆）：用 stepped-twist 的横截面是"齿数 = n_threads 的渐开线齿轮"，
 * 沿蜗杆轴线旋转出螺纹。
 *
 * 物理原理：
 *   d0 = n_threads * m / tan(lead_angle)    节圆直径
 *   pitch_axial = π * d0 * tan(lead_angle)  轴向螺距（一圈走多长）
 *   total_twist = 2π * length / pitch_axial = 2π * length * tan(lead) / (π*d0)
 *
 * 实现：
 *   1) 横截面在 XY 平面 = 一个 n_threads 齿的"伪 spur"（每齿就代表一道螺纹）
 *   2) 沿 +Z 方向 stepped-twist extrude，总扭转 = total_twist
 *   3) 最后绕 Y 轴 +90° 让蜗杆躺平到 X 轴
 *
 * 注意：n_threads=1 时单齿的渐开线退化，所以最少强制 z>=3 当模板，看上去是
 *   "3 道交替的螺纹"。如果想准确反映 n_threads=1，把齿数 ×3，把 lead 同步缩。
 */
export const worm: OpBuilder = (ctx, args) => {
  const m = requireNumber(args, 'module', 'worm');
  const leadDeg = requireNumber(args, 'lead_angle', 'worm');
  const nT = Math.round(requireNumber(args, 'n_threads', 'worm'));
  const length = requireNumber(args, 'length', 'worm');
  if (m <= 0 || length <= 0 || nT < 1)
    throw new BakerError('worm: invalid module/length/n_threads');
  if (Math.abs(leadDeg) < 1 || Math.abs(leadDeg) >= 89)
    throw new BakerError('worm: lead_angle must be in [1, 89) degrees');

  const leadRad = (Math.abs(leadDeg) * Math.PI) / 180;
  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);
  const boreD = optionalNumber(args, 'bore_d', 0);

  // 蜗杆螺纹几何（自洽推导，全部以导程 L 为单一真源）：
  //   轴向螺距 p_a = π·module
  //   导程     L   = n_threads · p_a          （螺纹每转一圈的轴向前进）
  //   导程角 γ 与节圆直径关系： tan(γ) = L / (π·d0)
  //              ⇒ d0 = L / (π·tan(γ)) = n_threads·module / tan(γ)
  const axialPitch = Math.PI * m;
  const lead = nT * axialPitch;
  const realD0 = lead / (Math.PI * Math.abs(Math.tan(leadRad)));
  const r0 = realD0 / 2;
  const addendum = SPUR_DEFAULTS.addCoeff * m;
  const dedendum = SPUR_DEFAULTS.dedCoeff * m + clearance;
  const ra = r0 + addendum;
  const rd = Math.max(r0 - dedendum, r0 * 0.15);

  // 当前实现是 visual mesh：用 n_threads 个径向凸起作为横截面，再沿轴向 stepped twist。
  // 之前错误地用 spur gear 截面，并把 n_threads=1 强行渲染成 3 齿，导致单头蜗杆看起来
  // 像三头蜗杆。这里直接按 n_threads 生成极坐标齿形，单头就是一个螺旋凸脊。
  const samplesPerThread = 40;
  const totalSamples = Math.max(48, samplesPerThread * nT);
  const pressureSkew = Math.tan((pressure * Math.PI) / 180) * 0.04;
  const backlashFrac = Math.max(0, Math.min(0.35, backlash / Math.max(m, 1e-9)));
  const pts: Point2D[] = [];
  for (let i = 0; i < totalSamples; i++) {
    const theta = (Math.PI * 2 * i) / totalSamples;
    const u = ((theta * nT) / (Math.PI * 2)) % 1;
    // 梯形齿：root -> flank -> crest -> flank -> root。crest 越宽，螺纹越"平顶"。
    const crestStart = 0.36 + backlashFrac * 0.05;
    const crestEnd = 0.64 - backlashFrac * 0.05;
    let t: number;
    if (u < 0.18) t = 0;
    else if (u < crestStart) t = (u - 0.18) / (crestStart - 0.18);
    else if (u < crestEnd) t = 1;
    else if (u < 0.82) t = 1 - (u - crestEnd) / (0.82 - crestEnd);
    else t = 0;
    // smoothstep，避免硬折角过多影响 tessellation
    t = t * t * (3 - 2 * t);
    const flankBias = Math.sin(Math.PI * 2 * u) * pressureSkew;
    const r = rd + (ra - rd) * Math.max(0, Math.min(1, t + flankBias));
    pts.push([Math.cos(theta) * r, Math.sin(theta) * r]);
  }
  const drawing = pointsToDrawing(ctx, pts);

  // 总扭转角 = 2π · (蜗杆长度 / 导程 L)，直接由导程推出，和 r0/d0 的 tan(γ) 同源。
  //   = 2π·length / (n_threads·π·module) = 2·length / (module·n_threads)
  // 注意：在该参数化下导程 L 只取决于 module 与 n_threads，与 lead_angle 无关（lead_angle
  // 仅经 d0 影响半径），所以扭转角不再像旧实现那样误乘 tan(lead)。
  const leadSign = leadDeg >= 0 ? 1 : -1;
  const totalTwistRad = leadSign * 2 * Math.PI * (length / lead);
  const totalTwistDeg = (totalTwistRad * 180) / Math.PI;
  // 蜗杆 twist 通常很大（几百度甚至上千度），用更粗的 step 控制 slice 数
  // 否则 1700° 会切 100+ 片，又慢又超 OBJ 上限
  const WORM_STEP_DEG = 45;
  const N = Math.max(MIN_TWIST_SLICES, Math.ceil(Math.abs(totalTwistDeg) / WORM_STEP_DEG));
  const sliceH = length / N;
  type SolidSketch = { extrude: (d: number) => BakeableShape };
  const slices: BakeableShape[] = [];
  for (let i = 0; i < N; i++) {
    const sketch = drawing.sketchOnPlane('XY', -length / 2 + i * sliceH) as unknown as SolidSketch;
    let s = sketch.extrude(sliceH);
    const ang = N === 1 ? 0 : (totalTwistDeg * i) / (N - 1);
    if (Math.abs(ang) > 1e-9) {
      const rotated = s.rotate(ang, [0, 0, 0], [0, 0, 1]);
      safeDelete(s);
      s = rotated;
    }
    slices.push(s);
  }
  let shape: BakeableShape;
  if (slices.length === 1) {
    shape = slices[0];
  } else {
    shape = ctx.replicad.makeCompound(slices) as BakeableShape;
    for (const s of slices) safeDelete(s);
  }

  // 躺平到 X 轴（worm 沿 X）
  const rotated = shape.rotate(90, [0, 0, 0], [0, 1, 0]);
  safeDelete(shape);
  shape = rotated;

  if (boreD > 0) {
    const bore = ctx.replicad.makeCylinder(
      boreD * 0.5, length + 0.01, [-(length + 0.01) / 2, 0, 0], [1, 0, 0],
    ) as BakeableShape;
    shape = csgCut(shape, bore);
  }
  return shape;
};

// ── 交错斜齿轮对 / 双曲齿轮对 ──────────────────────────────────────

/**
 * Crossed gear pair：两个 crossed_helical_gear 在 shaft_angle 上对置。
 * transform_gear2:
 *   gear1 居中放置
 *   gear2 平移 (gear1.r0+gear2.r0, 0, gear1.width/2)
 *        再绕 X 轴旋转 shaft_angle
 *        再平移 (0, 0, -gear2.width/2)
 *        再绕 Z 轴 align_angle
 */
export const crossedGearPair: OpBuilder = (ctx, args) => {
  const m = requireNumber(args, 'module', 'crossed_gear_pair');
  const z1 = Math.round(requireNumber(args, 'gear1_teeth_number', 'crossed_gear_pair'));
  const z2 = Math.round(requireNumber(args, 'gear2_teeth_number', 'crossed_gear_pair'));
  const w1 = requireNumber(args, 'gear1_width', 'crossed_gear_pair');
  const w2 = requireNumber(args, 'gear2_width', 'crossed_gear_pair');
  const shaftDeg = optionalNumber(args, 'shaft_angle', 90);
  const g1HelixOpt = optionalNumber(args, 'gear1_helix_angle', NaN);
  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);
  if ([z1, z2].some((v) => v < 3))
    throw new BakerError('crossed_gear_pair: teeth >= 3');

  const g1HelixDeg = Number.isFinite(g1HelixOpt) ? g1HelixOpt : shaftDeg / 2;
  const g2HelixDeg = Number.isFinite(g1HelixOpt) ? shaftDeg - g1HelixOpt : shaftDeg / 2;

  const spec1: SpurGearSpec = {
    module: m, teethNumber: z1, width: w1,
    pressureAngleDeg: pressure, helixAngleDeg: g1HelixDeg,
    clearance, backlash,
    addCoeff: SPUR_DEFAULTS.addCoeff, dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
  const spec2: SpurGearSpec = {
    module: m, teethNumber: z2, width: w2,
    pressureAngleDeg: pressure, helixAngleDeg: g2HelixDeg,
    clearance, backlash,
    addCoeff: SPUR_DEFAULTS.addCoeff, dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
  const geom1 = computeSpurGearGeom(spec1);
  const geom2 = computeSpurGearGeom(spec2);

  const ratio = z1 / z2;
  const baseAlign = z2 % 2 === 0 ? 180.0 / z2 : 0;
  const alignDeg = baseAlign + ((geom2.twistAngle + geom1.twistAngle * ratio) * 180) / Math.PI / 2;

  const gear1 = buildSpurBodyClean(ctx, spec1, geom1);
  let gear2 = buildSpurBodyClean(ctx, spec2, geom2);

  // 变换链：T(r1+r2, 0, w1/2) * R_x(shaft) * T(0, 0, -w2/2) * R_z(align)
  // 在 OCCT 里依次右乘，等价于：先对 gear2 做 align (R_z)，再 T(-w2/2),再 R_x，再 T(r1+r2, 0, w1/2)
  const r1 = geom1.r0, r2 = geom2.r0;
  const a1 = gear2.rotate(alignDeg, [0, 0, 0], [0, 0, 1]);
  safeDelete(gear2);
  const a2 = a1.translateZ(-w2 / 2);
  safeDelete(a1);
  const a3 = a2.rotate(shaftDeg, [0, 0, 0], [1, 0, 0]);
  safeDelete(a2);
  const a4 = a3.translate(r1 + r2, 0, w1 / 2);
  safeDelete(a3);
  gear2 = a4;

  const compound = ctx.replicad.makeCompound([gear1, gear2]) as BakeableShape;
  safeDelete(gear1);
  safeDelete(gear2);
  return compound;
};

/** Hyperbolic pair: 同 crossed_pair，但 helix→twist 换算每齿独立。 */
export const hyperbolicGearPair: OpBuilder = (ctx, args) => {
  const m = requireNumber(args, 'module', 'hyperbolic_gear_pair');
  const z1 = Math.round(requireNumber(args, 'gear1_teeth_number', 'hyperbolic_gear_pair'));
  const w = requireNumber(args, 'width', 'hyperbolic_gear_pair');
  const shaftDeg = requireNumber(args, 'shaft_angle', 'hyperbolic_gear_pair');
  const z2Opt = optionalNumber(args, 'gear2_teeth_number', 0);
  const z2 = Math.round(z2Opt > 0 ? z2Opt : z1);
  const pressure = optionalNumber(args, 'pressure_angle', SPUR_DEFAULTS.pressureAngleDeg);
  const clearance = optionalNumber(args, 'clearance', SPUR_DEFAULTS.clearance);
  const backlash = optionalNumber(args, 'backlash', SPUR_DEFAULTS.backlash);
  if (z1 < 3 || z2 < 3) throw new BakerError('hyperbolic_gear_pair: teeth >= 3');

  // helix→twist 换算
  const g1R0 = (m * z1) / 2;
  const g2R0 = (m * z2) / 2;
  const alpha = ((shaftDeg / 2) * Math.PI) / 180;
  const hh = (w / 2) * Math.tan(alpha);
  const g1Twist = Math.asin(hh / g1R0) * 2;
  const g2Twist = Math.asin(hh / g2R0) * 2;
  if (Number.isNaN(g1Twist) || Number.isNaN(g2Twist))
    throw new BakerError('hyperbolic_gear_pair: impossible twist for given shaft/teeth/width');

  // 把 twist → helix（同 hyperbolicGear）
  const twistToHelix = (twist: number, r0: number): number => {
    if (Math.abs(twist) < 1e-9) return 0;
    return ((Math.PI / 2 - Math.atan(w / (r0 * twist))) * 180) / Math.PI;
  };
  const h1 = twistToHelix(g1Twist, g1R0);
  const h2 = twistToHelix(g2Twist, g2R0);

  const spec1: SpurGearSpec = {
    module: m, teethNumber: z1, width: w,
    pressureAngleDeg: pressure, helixAngleDeg: h1,
    clearance, backlash,
    addCoeff: SPUR_DEFAULTS.addCoeff, dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
  const spec2: SpurGearSpec = {
    module: m, teethNumber: z2, width: w,
    pressureAngleDeg: pressure, helixAngleDeg: h2,
    clearance, backlash,
    addCoeff: SPUR_DEFAULTS.addCoeff, dedCoeff: SPUR_DEFAULTS.dedCoeff,
  };
  const geom1 = computeSpurGearGeom(spec1);
  const geom2 = computeSpurGearGeom(spec2);

  // 精确实现用 throat_r 替代 r0；v1 取 r0 近似（差异 < 1 模数）
  const r1 = geom1.r0, r2 = geom2.r0;
  const ratio = z1 / z2;
  const baseAlign = z2 % 2 === 0 ? 180.0 / z2 : 0;
  const alignDeg = baseAlign + ((geom2.twistAngle + geom1.twistAngle * ratio) * 180) / Math.PI / 2;

  const gear1 = buildSpurBodyClean(ctx, spec1, geom1);
  let gear2 = buildSpurBodyClean(ctx, spec2, geom2);

  const a1 = gear2.rotate(alignDeg, [0, 0, 0], [0, 0, 1]);
  safeDelete(gear2);
  const a2 = a1.translateZ(-w / 2);
  safeDelete(a1);
  const a3 = a2.rotate(shaftDeg, [0, 0, 0], [1, 0, 0]);
  safeDelete(a2);
  const a4 = a3.translate(r1 + r2, 0, w / 2);
  safeDelete(a3);
  gear2 = a4;

  const compound = ctx.replicad.makeCompound([gear1, gear2]) as BakeableShape;
  safeDelete(gear1);
  safeDelete(gear2);
  return compound;
};
