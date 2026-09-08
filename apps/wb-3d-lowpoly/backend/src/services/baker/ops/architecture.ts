/**
 * Architecture 家族 —— 静态 low-poly 建筑元素的 baker builders。
 *
 * 设计与 panels.ts 同范式：薄板 / 盒体 + CSG 切孔，单位 = 米，Z 朝上。
 * 每个 op 产出单一 BakeableShape，由上层 part(shape=ref(...)) 消费，
 * 与 box/cylinder 在装配侧完全一致。
 *
 * 约定（让生成器拼装时可预测）：
 *   - 墙 / 楼板 / 窗 / 门扇：X、Y 居中，底面落在 Z=0（楼面），
 *     这样把元素放到某一层只需 translateZ(layerBase)。
 *   - 屋顶：footprint 关于原点居中，底面 Z=0。
 *   - 楼梯（stairs，直梯段）是上面这条的**例外**：局部原点是第一级踏步的起步点，
 *     不是几何中心——Y 方向仍居中（[-width/2, width/2]），但 X 方向从 0 起、沿 +X
 *     随每级 run 递增，底面落在 Z=0。调用方拼装时若照搬"X/Y 居中"公式会把楼梯在
 *     X 方向多偏移半个梯段长度（totalRunX/2）。
 *   - 开口列表 openings：嵌套 list，每项 [x, width, sill, head]
 *     —— x = 洞中心相对墙中点的 X 偏移，width = 洞宽，sill/head = 洞底/洞顶高度。
 */

import type { OpBuilder, BakeableShape } from '../types.js';
import { BakerError } from '../errors.js';
import { csgCut, csgFuse } from '../csg_helpers.js';
import { boxFloor, centeredBox as boxCentered, drawingFromPoints } from '../op_helpers.js';
import { optionalBool, optionalNumber, optionalString, requireNumber, requireNumList } from '../arg_readers.js';
import type { Arg } from '../shared-types.js';
import { ARCH_DEFAULTS } from '../../../../../vendor/dist/shared/types/index.js';

// ── 公共助手 ─────────────────────────────────────────────────────────

type SolidSketch = { extrude: (h: number) => BakeableShape };
type LoftSketch = { loftWith: (s: unknown[], cfg?: { ruled?: boolean }) => BakeableShape };
type RevolveSketch = { revolve: (axis?: [number, number, number]) => BakeableShape };

/** 把 shape 在 X/Y 居中、并把 Z 最小值落到 0（屋脊棱柱的拉伸方向因平面法向而异，统一兜底）。 */
function recenterXYToFloor(shape: BakeableShape): BakeableShape {
  // OCCT bbox 是手动管理内存的 WASM 对象 —— 读完即释放，避免泄漏。
  const bbox = shape.boundingBox;
  const [min, max] = bbox.bounds;
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const minZ = min[2];
  (bbox as { delete?: () => void }).delete?.();
  if (Math.abs(cx) < 1e-9 && Math.abs(cy) < 1e-9 && Math.abs(minZ) < 1e-9) return shape;
  return shape.translate(-cx, -cy, -minZ) as BakeableShape;
}

/**
 * 读取"四元组列表"参数（嵌套 list，每项恰好 4 个有限数）。
 *
 * openings（wall，每项 [x, width, sill, head]）与 holes（floor_slab，每项 [x, y, w, d]）
 * 的解析逐字重复，合并为这一个读取器；`key`/`singular`/`fields` 保留各自原有的错误文案。
 */
function readQuadList(
  args: Record<string, Arg>,
  key: string,
  op: string,
  singular: string,
  fields: string,
): Array<[number, number, number, number]> {
  const raw = args[key];
  if (!raw) return [];
  if (raw.kind !== 'list') throw new BakerError(`${op}: ${key} must be a list of ${fields}`);
  const out: Array<[number, number, number, number]> = [];
  for (const item of raw.items) {
    if (item.kind !== 'list') throw new BakerError(`${op}: each ${singular} must be a list ${fields}`);
    const nums: number[] = [];
    for (const n of item.items) {
      if (n.kind !== 'number' || !Number.isFinite(n.value)) {
        throw new BakerError(`${op}: ${singular} values must be finite numbers`);
      }
      nums.push(n.value);
    }
    if (nums.length !== 4) throw new BakerError(`${op}: each ${singular} must have exactly 4 numbers ${fields}`);
    out.push([nums[0], nums[1], nums[2], nums[3]]);
  }
  return out;
}

// ── wall ────────────────────────────────────────────────────────────
// 直墙段：length(X) × height(Z) × thickness(Y)，减去 openings 列出的门/窗洞。

export const wall: OpBuilder = (ctx, args) => {
  const length = requireNumber(args, 'length', 'wall');
  const height = requireNumber(args, 'height', 'wall');
  const thickness = requireNumber(args, 'thickness', 'wall');
  if (length <= 0 || height <= 0 || thickness <= 0) {
    throw new BakerError('wall: length, height and thickness must be positive');
  }

  let shape = boxFloor(ctx, length, thickness, height);

  const openings = readQuadList(args, 'openings', 'wall', 'opening', '[x, width, sill, head]');
  const eps = Math.max(thickness * 0.5, 0.01);
  for (const [x, w, sill, head] of openings) {
    const oh = head - sill;
    if (w <= 0 || oh <= 0) throw new BakerError('wall: opening width and (head - sill) must be positive');
    if (Math.abs(x) + w / 2 > length / 2 + 1e-9) {
      throw new BakerError(`wall: opening at x=${x} (width ${w}) exceeds wall length ${length}`);
    }
    if (sill < -1e-9 || head > height + 1e-9) {
      throw new BakerError(`wall: opening [sill=${sill}, head=${head}] exceeds wall height ${height}`);
    }
    const cut = boxFloor(ctx, w, thickness + eps, oh).translate(x, 0, sill) as BakeableShape;
    shape = csgCut(shape, cut);
  }

  if (optionalBool(args, 'window_band', false)) {
    const bandSill = optionalNumber(args, 'band_sill', height * 0.33);
    const bandHead = optionalNumber(args, 'band_head', height * 0.75);
    const margin = optionalNumber(args, 'band_margin', Math.min(0.4, length * 0.15));
    const bandH = bandHead - bandSill;
    if (bandH <= 0) throw new BakerError('wall: band_head must be greater than band_sill');
    if (bandSill < -1e-9 || bandHead > height + 1e-9) {
      throw new BakerError('wall: window band exceeds wall height');
    }
    const bandLen = length - 2 * Math.max(0, margin);
    if (bandLen <= 0) throw new BakerError('wall: band_margin too large for wall length');
    const bandCut = boxFloor(ctx, bandLen, thickness + eps, bandH).translate(0, 0, bandSill) as BakeableShape;
    shape = csgCut(shape, bandCut);
    const paneWidth = optionalNumber(args, 'pane_width', 0);
    if (paneWidth > 0) {
      const mullion = Math.max(optionalNumber(args, 'mullion', 0.06), 1e-3);
      const divisions = Math.max(1, Math.round(bandLen / paneWidth));
      for (let i = 1; i < divisions; i++) {
        const bx = -bandLen / 2 + (bandLen * i) / divisions;
        const bar = boxFloor(ctx, mullion, thickness, bandH).translate(bx, 0, bandSill) as BakeableShape;
        shape = csgFuse(shape, bar);
      }
    }
  }

  const plinthH = Math.max(0, optionalNumber(args, 'plinth_height', 0));
  if (plinthH > 0) {
    if (plinthH >= height) throw new BakerError('wall: plinth_height must be < height');
    const proj = Math.max(0, optionalNumber(args, 'plinth_projection', ARCH_DEFAULTS.wall.plinthProjection));
    const plinth = boxFloor(ctx, length, thickness + 2 * proj, plinthH) as BakeableShape;
    shape = csgFuse(shape, plinth);
  }

  return shape;
};

// ── floor_slab ──────────────────────────────────────────────────────
// 矩形楼板：size=[w, d]，thickness(Z)，可选 holes（楼梯井 / 竖井）。

export const floorSlab: OpBuilder = (ctx, args) => {
  const [w, d] = requireNumList(args, 'size', 2, 'floor_slab');
  const thickness = requireNumber(args, 'thickness', 'floor_slab');
  if (w <= 0 || d <= 0 || thickness <= 0) {
    throw new BakerError('floor_slab: size and thickness must be positive');
  }

  let shape = boxFloor(ctx, w, d, thickness);

  const chamfer = Math.max(0, optionalNumber(args, 'edge_chamfer', 0));
  if (chamfer > 0) {
    const c = Math.min(chamfer, thickness * 0.49, Math.min(w, d) * 0.1);
    try {
      shape = (shape as unknown as { chamfer: (r: number, f: (e: { inPlane: (p: string, z: number) => unknown }) => unknown) => BakeableShape })
        .chamfer(c, (e) => e.inPlane('XY', thickness));
    } catch { /* keep un-chamfered slab if OCCT rejects the edge set */ }
  }

  const holes = readQuadList(args, 'holes', 'floor_slab', 'hole', '[x, y, w, d]');
  const eps = Math.max(thickness, 0.02);
  for (const [hx, hy, hw, hd] of holes) {
    if (hw <= 0 || hd <= 0) throw new BakerError('floor_slab: hole w and d must be positive');
    if (Math.abs(hx) + hw / 2 > w / 2 + 1e-9 ||
        Math.abs(hy) + hd / 2 > d / 2 + 1e-9) {
      throw new BakerError(
        `floor_slab: hole centered at [${hx}, ${hy}] with size [${hw}, ${hd}] exceeds slab [${w}, ${d}]`,
      );
    }
    const cut = boxFloor(ctx, hw, hd, thickness + 2 * eps).translate(hx, hy, -eps) as BakeableShape;
    shape = csgCut(shape, cut);
  }

  const beamDepth = Math.max(0, optionalNumber(args, 'beam_depth', 0));
  if (beamDepth > 0) {
    const beamW = Math.max(0, optionalNumber(args, 'beam_width', ARCH_DEFAULTS.floor.beamWidth));
    if (beamW <= 0) throw new BakerError('floor_slab: beam_width must be positive');
    if (2 * beamW >= Math.min(w, d)) throw new BakerError('floor_slab: beam_width too large for slab');
    const outer = boxFloor(ctx, w, d, beamDepth).translateZ(-beamDepth) as BakeableShape;
    const inner = boxFloor(ctx, w - 2 * beamW, d - 2 * beamW, beamDepth + 2 * eps).translateZ(-beamDepth - eps) as BakeableShape;
    const ring = csgCut(outer, inner);
    shape = csgFuse(shape, ring);
  }

  return shape;
};

// ── stairs ──────────────────────────────────────────────────────────
// type=straight（默认）：直梯段，逐级叠高盒体融合（low-poly 实心楼梯）。
//   total_rise(Z 总高) / run(每级踏步进深 X) / width(Y) / step_count。
// type=spiral：螺旋梯，踏步绕中柱(Z)旋转盘升。
//   radius(外半径) / inner_radius(中柱半径) / sweep_deg(总旋转角)。

export const stairs: OpBuilder = (ctx, args) => {
  const totalRise = requireNumber(args, 'total_rise', 'stairs');
  const run = requireNumber(args, 'run', 'stairs');
  const width = requireNumber(args, 'width', 'stairs');
  const stepCount = Math.round(requireNumber(args, 'step_count', 'stairs'));
  const type = optionalString(args, 'type', 'straight');
  if (totalRise <= 0 || run <= 0 || width <= 0) {
    throw new BakerError('stairs: total_rise, run and width must be positive');
  }
  if (stepCount < 1) throw new BakerError('stairs: step_count must be >= 1');
  // `run` 是每一级踏步的进深（真实建筑 0.2~0.4m），不是整段楼梯的水平总长。高频误用是
  // 把总长直接填进来（例如想要 9 级共 2.52m 的梯段却填 run=2.52），会让每级踏步变成
  // 2.52m 深、整段楼梯长出 step_count 倍。> 1.2m 已经远超任何真实单级踏步，直接报错并
  // 提示大概率填反的等价 run，避免生成离谱几何。
  if (run > 1.2) {
    const perStep = run / stepCount;
    throw new BakerError(
      `stairs: run=${run} looks like a total flight length, not a per-step tread depth ` +
        `(real treads are ~0.2-0.4m). run × step_count is the total run — if you meant a ` +
        `total run of ${run}m over ${stepCount} steps, pass run=${perStep.toFixed(3)} instead.`,
    );
  }

  const riser = totalRise / stepCount;
  const openRiser = optionalBool(args, 'open_riser', false);
  const treadThickness = optionalNumber(args, 'tread_thickness', 0);
  const treadT = treadThickness > 0 ? Math.min(treadThickness, riser) : Math.min(riser * 0.5, 0.06);

  if (type === 'spiral') {
    const radius = optionalNumber(args, 'radius', Math.max(width, 1.0));
    const innerRadius = optionalNumber(args, 'inner_radius', Math.max(0.05, radius * 0.12));
    const sweepDeg = optionalNumber(args, 'sweep_deg', 270);
    if (radius <= 0 || innerRadius <= 0 || innerRadius >= radius) {
      throw new BakerError('stairs(spiral): need 0 < inner_radius < radius');
    }
    if (Math.abs(sweepDeg) < 1e-3) throw new BakerError('stairs(spiral): sweep_deg must be non-zero');
    const angStep = sweepDeg / stepCount;
    const sectorRad = (angStep * 1.05 * Math.PI) / 180;
    const wedge = (): Array<readonly [number, number]> => {
      const mid = sectorRad / 2;
      return [
        [innerRadius, 0],
        [radius, 0],
        [radius * Math.cos(mid), radius * Math.sin(mid)],
        [radius * Math.cos(sectorRad), radius * Math.sin(sectorRad)],
        [innerRadius * Math.cos(sectorRad), innerRadius * Math.sin(sectorRad)],
      ];
    };
    let shape = ctx.replicad.makeCylinder(innerRadius, totalRise, [0, 0, 0], [0, 0, 1]) as BakeableShape;
    for (let i = 0; i < stepCount; i++) {
      const zTop = riser * (i + 1);
      const th = openRiser ? treadT : riser;
      const zBase = openRiser ? zTop - th : i * riser;
      const tread = (drawingFromPoints(ctx, wedge()).sketchOnPlane('XY', zBase) as unknown as SolidSketch)
        .extrude(th)
        .rotate(i * angStep, [0, 0, 0], [0, 0, 1]) as BakeableShape;
      shape = csgFuse(shape, tread);
    }
    return shape;
  }

  const landingDepth = Math.max(0, optionalNumber(args, 'landing_depth', 0));
  const landingAfter = Math.round(optionalNumber(args, 'landing_after', Math.floor(stepCount / 2)));
  const depthAt = (i: number): number =>
    landingDepth > 0 && i + 1 === landingAfter ? landingDepth : run;

  if (openRiser) {
    let shape: BakeableShape | null = null;
    let x = 0;
    for (let i = 0; i < stepCount; i++) {
      const zTop = riser * (i + 1);
      const depth = depthAt(i);
      const tread = boxFloor(ctx, depth, width, treadT).translate(x + depth / 2, 0, zTop - treadT) as BakeableShape;
      shape = shape === null ? tread : csgFuse(shape, tread);
      x += depth;
    }
    if (shape === null) throw new BakerError('stairs: step_count must be >= 1');
    return shape;
  }

  const profile: Array<readonly [number, number]> = [[0, 0]];
  let x = 0;
  for (let i = 0; i < stepCount; i++) {
    const z = riser * (i + 1);
    profile.push([x, z]);
    x += depthAt(i);
    profile.push([x, z]);
  }
  profile.push([x, 0]);
  const sketch = drawingFromPoints(ctx, profile).sketchOnPlane('XZ', -width / 2) as unknown as SolidSketch;
  return sketch.extrude(width);
};

// ── roof ────────────────────────────────────────────────────────────
// footprint=[w, d] 上的 flat / shed / gable / hip / gambrel / mansard / pyramid 屋顶。
// pitch/height 用 height 表达（屋脊相对底面的高度）；flat 用 thickness。
// 屋脊朝向：gable/shed/gambrel/hip 的屋脊统一沿 footprint 的**较长边**（历史 bug：
// gable 类沿 Y、hip 沿 X，同一 footprint 换类型屋脊方向互相垂直；hip 在 bd>bw 时
// ridgeLen=bw-bd<0 退化）。实现：在"屋脊沿 Y"的规范朝向下构造，较长边是 X 时绕 Z 转 90°。

export const roof: OpBuilder = (ctx, args) => {
  const [w, d] = requireNumList(args, 'footprint', 2, 'roof');
  const type = optionalString(args, 'type', 'gable');
  // 默认出檐来自 ARCH_DEFAULTS（SSOT，与 g_roof 电池一致），避免 DSL 省略 overhang 时行为漂移。
  const overhang = optionalNumber(args, 'overhang', ARCH_DEFAULTS.roof.overhang);
  if (w <= 0 || d <= 0) throw new BakerError('roof: footprint must be positive');
  if (overhang < 0) throw new BakerError('roof: overhang must be >= 0');

  const eave = Math.max(0, optionalNumber(args, 'eave_overhang', overhang));
  const verge = Math.max(0, optionalNumber(args, 'verge_overhang', overhang));
  const pitched = type === 'gable' || type === 'shed' || type === 'gambrel' || type === 'hip';

  let bw: number;
  let bd: number;
  if (pitched) {
    const longIsX = w >= d;
    const spanTotal = Math.min(w, d) + 2 * eave;
    const ridgeTotal = Math.max(w, d) + 2 * verge;
    bw = longIsX ? ridgeTotal : spanTotal;
    bd = longIsX ? spanTotal : ridgeTotal;
  } else {
    bw = w + 2 * overhang;
    bd = d + 2 * overhang;
  }

  if (type === 'flat') {
    const thickness = optionalNumber(args, 'thickness', ARCH_DEFAULTS.roof.flatThickness);
    if (thickness <= 0) throw new BakerError('roof: flat thickness must be positive');
    let shape = boxFloor(ctx, bw, bd, thickness);
    const parapetH = Math.max(0, optionalNumber(args, 'parapet_height', 0));
    if (parapetH > 0) {
      const pt = Math.max(0.01, optionalNumber(args, 'parapet_thickness', ARCH_DEFAULTS.roof.parapetThickness));
      if (2 * pt >= Math.min(bw, bd)) throw new BakerError('roof: parapet_thickness too large for footprint');
      const peps = 0.01;
      const outer = boxFloor(ctx, bw, bd, parapetH).translateZ(thickness) as BakeableShape;
      const inner = boxFloor(ctx, bw - 2 * pt, bd - 2 * pt, parapetH + 2 * peps).translateZ(thickness - peps) as BakeableShape;
      shape = csgFuse(shape, csgCut(outer, inner));
      const coping = Math.max(0, optionalNumber(args, 'coping_width', 0));
      if (coping > 0) {
        const ct = ARCH_DEFAULTS.roof.copingThickness;
        const capOuter = boxFloor(ctx, bw + 2 * coping, bd + 2 * coping, ct).translateZ(thickness + parapetH) as BakeableShape;
        const capInner = boxFloor(ctx, bw - 2 * pt, bd - 2 * pt, ct + 2 * peps).translateZ(thickness + parapetH - peps) as BakeableShape;
        shape = csgFuse(shape, csgCut(capOuter, capInner));
      }
    }
    return shape;
  }

  const height = optionalNumber(args, 'height', Math.min(bw, bd) * ARCH_DEFAULTS.roof.heightFactor);
  if (height <= 0) throw new BakerError('roof: height must be positive');

  const rectAt = (rw: number, rd: number, z: number) => {
    const r: Array<readonly [number, number]> = [
      [-rw / 2, -rd / 2], [rw / 2, -rd / 2], [rw / 2, rd / 2], [-rw / 2, rd / 2],
    ];
    return drawingFromPoints(ctx, r).sketchOnPlane('XY', z);
  };

  // pyramid / mansard 关于两轴按 footprint 比例对称，天然贴合朝向，无需统一屋脊朝向。
  if (type === 'pyramid') {
    // 四角攒尖：底面矩形 loft 到接近一点的极小矩形（顶点）。
    const apexEps = Math.min(bw, bd) * 0.01 + 1e-4;
    const base = rectAt(bw, bd, 0) as unknown as LoftSketch;
    const apex = rectAt(apexEps, apexEps, height);
    return recenterXYToFloor(base.loftWith([apex], { ruled: true }));
  }

  if (type === 'mansard') {
    // 法式四坡双折：底面 → 中部内收矩形（下段陡坡）→ 顶部更小矩形（上段缓坡）。
    const midH = height * 0.6;
    const base = rectAt(bw, bd, 0) as unknown as LoftSketch;
    const mid = rectAt(bw * 0.72, bd * 0.72, midH);
    const top = rectAt(bw * 0.5, bd * 0.5, height);
    return recenterXYToFloor(base.loftWith([mid, top], { ruled: true }));
  }

  // ── 屋脊沿较长边（gable/shed/gambrel/hip 共用规则）──
  // 规范朝向：屋脊沿 Y，截面基宽 span=较短边，屋脊长度 ridgeLen=较长边。
  // 较长边落在 X（bw>=bd）时最后绕 Z 旋转 90°，把屋脊转到 X。
  const alongX = bw >= bd;
  const span = Math.min(bw, bd);
  const ridgeLen = Math.max(bw, bd);

  let shape: BakeableShape;
  if (type === 'gable') {
    const pts: Array<readonly [number, number]> = [
      [-span / 2, 0], [span / 2, 0], [0, height],
    ];
    shape = (drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -ridgeLen / 2) as unknown as SolidSketch).extrude(ridgeLen);
  } else if (type === 'shed') {
    const pts: Array<readonly [number, number]> = [
      [-span / 2, 0], [span / 2, 0], [span / 2, height], [-span / 2, Math.max(height * 0.001, 0)],
    ];
    shape = (drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -ridgeLen / 2) as unknown as SolidSketch).extrude(ridgeLen);
  } else if (type === 'gambrel') {
    // 谷仓式：每侧两段坡（下陡上缓），对称 5 点截面，沿 Y 拉伸。
    const kneeH = height * 0.55;
    const kneeX = span * 0.32;
    const pts: Array<readonly [number, number]> = [
      [-span / 2, 0], [span / 2, 0], [kneeX, kneeH], [0, height], [-kneeX, kneeH],
    ];
    shape = (drawingFromPoints(ctx, pts).sketchOnPlane('XZ', -ridgeLen / 2) as unknown as SolidSketch).extrude(ridgeLen);
  } else if (type === 'hip') {
    // 底面矩形（span×ridgeLen）→ 屋脊短段（沿 Y）loft 四坡。
    // 屋脊长度 = 较长边 − 较短边（正确对称四坡）；近正方形退化时给一个 span*0.25 下限。
    const ridgeSeg = Math.max(ridgeLen - span, span * 0.25);
    const ridgeEps = span * 0.02 + 1e-4;
    const base = rectAt(span, ridgeLen, 0) as unknown as LoftSketch;
    const ridge = rectAt(2 * ridgeEps, ridgeSeg, height);
    shape = base.loftWith([ridge], { ruled: true });
  } else {
    throw new BakerError(`roof: unknown type "${type}" (expected flat/shed/gable/hip/gambrel/mansard/pyramid)`);
  }

  if (alongX) shape = shape.rotate(90, [0, 0, 0], [0, 0, 1]) as BakeableShape;
  return recenterXYToFloor(shape);
};

// ── facade_panel ────────────────────────────────────────────────────
// 外墙挂板 / siding：薄板 [w, h]，可选水平 reveal 凹槽阵列模拟板缝。
// orientation=wall（默认，竖直挂板，与墙一致）：w→X、h→Z（底面 Z=0）、thickness→Y（居中），
//   板缝为水平横槽，沿高度 Z 均布，切在 +Y 外表面。
// orientation=slab（平躺）：w→X、h→Y、thickness→Z（底面 Z=0），板缝切在 +Z 顶面。

export const facadePanel: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'panel_size', 2, 'facade_panel');
  const thickness = requireNumber(args, 'thickness', 'facade_panel');
  const orientation = optionalString(args, 'orientation', 'wall');
  const grooveCount = Math.max(0, Math.round(optionalNumber(args, 'groove_count', 0)));
  const grooveSpacing = Math.max(0, optionalNumber(args, 'groove_spacing', 0));
  const grooveDepth = optionalNumber(args, 'groove_depth', thickness * 0.4);
  const grooveWidth = optionalNumber(args, 'groove_width', Math.min(0.01, h * 0.05));
  const direction = optionalString(args, 'groove_direction', 'horizontal');
  const boardStyle = optionalString(args, 'board_style', 'flush');
  if (w <= 0 || h <= 0 || thickness <= 0) {
    throw new BakerError('facade_panel: panel_size and thickness must be positive');
  }
  if (orientation !== 'wall' && orientation !== 'slab') {
    throw new BakerError(`facade_panel: orientation must be wall or slab, got "${orientation}"`);
  }
  if (direction !== 'horizontal' && direction !== 'vertical' && direction !== 'both') {
    throw new BakerError(`facade_panel: groove_direction must be horizontal/vertical/both, got "${direction}"`);
  }
  if (boardStyle !== 'flush' && boardStyle !== 'lap' && boardStyle !== 'shiplap') {
    throw new BakerError(`facade_panel: board_style must be flush/lap/shiplap, got "${boardStyle}"`);
  }

  const gw = boardStyle === 'shiplap' ? grooveWidth * 1.8 : grooveWidth;
  const gd = boardStyle === 'lap' ? Math.min(grooveDepth * 1.5, thickness * 0.9) : grooveDepth;

  const validateGroove = (): void => {
    if (gd <= 0 || gd >= thickness) throw new BakerError('facade_panel: groove_depth must be in (0, thickness)');
    if (gw <= 0) throw new BakerError('facade_panel: groove_width must be positive');
  };

  const lines = (span: number, centered: boolean): number[] => {
    const out: number[] = [];
    if (grooveSpacing > 0) {
      const div = Math.max(1, Math.round(span / grooveSpacing));
      for (let i = 1; i < div; i++) out.push((centered ? -span / 2 : 0) + (span * i) / div);
      return out;
    }
    const usable = span - gw;
    for (let i = 1; i <= grooveCount; i++) {
      out.push((centered ? -usable / 2 : gw / 2) + (usable * i) / (grooveCount + 1));
    }
    return out;
  };

  const hasGrooves = grooveCount > 0 || grooveSpacing > 0;

  if (orientation === 'slab') {
    let shape = boxFloor(ctx, w, h, thickness);
    if (hasGrooves) {
      validateGroove();
      if (direction !== 'vertical') {
        for (const y of lines(h, true)) {
          const g = boxCentered(ctx, w + 0.002, gw, gd * 2).translate(0, y, thickness) as BakeableShape;
          shape = csgCut(shape, g);
        }
      }
      if (direction !== 'horizontal') {
        for (const x of lines(w, true)) {
          const g = boxCentered(ctx, gw, h + 0.002, gd * 2).translate(x, 0, thickness) as BakeableShape;
          shape = csgCut(shape, g);
        }
      }
    }
    return shape;
  }

  let shape = boxFloor(ctx, w, thickness, h);
  if (hasGrooves) {
    validateGroove();
    if (direction !== 'vertical') {
      for (const z of lines(h, false)) {
        const g = boxCentered(ctx, w + 0.002, gd * 2, gw).translate(0, thickness / 2, z) as BakeableShape;
        shape = csgCut(shape, g);
      }
    }
    if (direction !== 'horizontal') {
      for (const x of lines(w, true)) {
        const g = boxCentered(ctx, gw, gd * 2, h + 0.002).translate(x, thickness / 2, h / 2) as BakeableShape;
        shape = csgCut(shape, g);
      }
    }
  }
  return shape;
};

// ── window ──────────────────────────────────────────────────────────
// 框 + 十字中梃 + 可选玻璃嵌片，融合为单一 shape。
// X = 宽、Z = 高（底面 Z=0）、Y = 进深（对齐墙厚）。

function archOutline(
  halfW: number,
  baseZ: number,
  springZ: number,
  segments: number,
): Array<readonly [number, number]> {
  const pts: Array<readonly [number, number]> = [[-halfW, baseZ], [halfW, baseZ], [halfW, springZ]];
  for (let i = 1; i <= segments; i++) {
    const a = (Math.PI * i) / segments;
    pts.push([halfW * Math.cos(a), springZ + halfW * Math.sin(a)]);
  }
  return pts;
}

export const windowUnit: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'window');
  const depth = requireNumber(args, 'depth', 'window');
  const frame = optionalNumber(args, 'frame', Math.min(w, h) * 0.08);
  const mullion = optionalNumber(args, 'mullion', frame * 0.6);
  const glassV = optionalNumber(args, 'glass', 0);
  const glass = glassV > 0 ? glassV : 0;
  const type = optionalString(args, 'type', 'cross');
  const archTop = optionalBool(args, 'arch_top', false);
  if (w <= 0 || h <= 0 || depth <= 0) throw new BakerError('window: size and depth must be positive');
  if (frame <= 0 || frame * 2 >= Math.min(w, h)) {
    throw new BakerError('window: frame must be >0 and < half of min(size)');
  }

  const eps = depth * 0.5 + 0.01;
  const iw = w - 2 * frame;
  const ih = h - 2 * frame;

  let shape: BakeableShape;
  let springZ = h;
  if (archTop) {
    springZ = h - w / 2;
    if (springZ < frame + 1e-6) throw new BakerError('window: arch_top needs height > width/2 + frame');
    const seg = 12;
    const outer = (drawingFromPoints(ctx, archOutline(w / 2, 0, springZ, seg)).sketchOnPlane('XZ', -depth / 2) as unknown as SolidSketch).extrude(depth);
    const inner = (drawingFromPoints(ctx, archOutline(iw / 2, frame, springZ, seg)).sketchOnPlane('XZ', -(depth + eps) / 2) as unknown as SolidSketch).extrude(depth + eps);
    shape = csgCut(outer, inner);
  } else {
    shape = boxFloor(ctx, w, depth, h);
    const innerCut = boxFloor(ctx, iw, depth + eps, ih).translate(0, 0, frame) as BakeableShape;
    shape = csgCut(shape, innerCut);
  }

  const bar = Math.max(mullion, 1e-3);
  if (type === 'louver' && !archTop) {
    const slatCount = Math.max(2, Math.round(optionalNumber(args, 'rows', 5)));
    const slatT = Math.min(ih / (slatCount + 1) * 0.8, ih / slatCount);
    for (let i = 0; i < slatCount; i++) {
      const cz = frame + (ih * (i + 0.5)) / slatCount;
      const slat = boxFloor(ctx, iw, depth * 0.7, slatT).translate(0, 0, cz - slatT / 2) as BakeableShape;
      shape = csgFuse(shape, slat);
    }
    return shape;
  }

  if (mullion > 0 && type !== 'louver') {
    const paneWidth = optionalNumber(args, 'pane_width', 0);
    let cols = type === 'grid' ? Math.max(1, Math.round(optionalNumber(args, 'cols', 3))) : 2;
    const rows = type === 'grid' ? Math.max(1, Math.round(optionalNumber(args, 'rows', 3))) : 2;
    if (paneWidth > 0) cols = Math.max(1, Math.round(iw / paneWidth));
    const vBottom = frame;
    const vTop = archTop ? springZ : frame + ih;
    const vH = Math.max(vTop - vBottom, 1e-3);
    for (let c = 1; c < cols; c++) {
      const x = -iw / 2 + (iw * c) / cols;
      const vbar = boxFloor(ctx, bar, depth, vH).translate(x, 0, vBottom) as BakeableShape;
      shape = csgFuse(shape, vbar);
    }
    if (!archTop) {
      for (let r = 1; r < rows; r++) {
        const z = frame + (ih * r) / rows;
        const hbar = boxFloor(ctx, iw, depth, bar).translate(0, 0, z - bar / 2) as BakeableShape;
        shape = csgFuse(shape, hbar);
      }
    }
  }

  if (glass > 0) {
    if (glass >= depth) throw new BakerError('window: glass thickness must be < depth');
    const paneH = archTop ? springZ - frame : ih;
    if (paneH > 0) {
      const pane = boxFloor(ctx, iw, glass, paneH).translate(0, 0, frame) as BakeableShape;
      shape = csgFuse(shape, pane);
    }
  }

  const sill = Math.max(0, optionalNumber(args, 'sill', 0));
  if (sill > 0) {
    const ext = 0.03;
    const sillH = Math.min(frame, 0.06);
    const ledge = boxFloor(ctx, w + 2 * ext, depth + sill, sillH).translate(0, sill / 2, 0) as BakeableShape;
    shape = csgFuse(shape, ledge);
  }

  return shape;
};

// ── door_frame ──────────────────────────────────────────────────────
// 三面门框（两侧门挺 + 上槛，底部开口），单一 shape。

export const doorFrame: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'door_frame');
  const depth = requireNumber(args, 'depth', 'door_frame');
  const frame = optionalNumber(args, 'frame', Math.min(w * 0.1, 0.08));
  if (w <= 0 || h <= 0 || depth <= 0) throw new BakerError('door_frame: size and depth must be positive');
  if (frame <= 0 || frame * 2 >= w) throw new BakerError('door_frame: frame must be >0 and < half of width');
  if (frame >= h) throw new BakerError('door_frame: frame must be < height');

  let shape = boxFloor(ctx, w, depth, h);
  const eps = depth * 0.5 + 0.01;
  // 切到底（含底面以下），留下两挺 + 上槛
  const innerCut = boxFloor(ctx, w - 2 * frame, depth + eps, h)
    .translate(0, 0, -eps) as BakeableShape;
  shape = csgCut(shape, innerCut);

  const transom = Math.max(0, optionalNumber(args, 'transom', 0));
  if (transom > 0) {
    if (transom >= h - frame) throw new BakerError('door_frame: transom must be < height - frame');
    const railZ = h - transom - frame;
    if (railZ <= 0) throw new BakerError('door_frame: transom too tall');
    const rail = boxFloor(ctx, w - 2 * frame, depth, frame).translate(0, 0, railZ) as BakeableShape;
    shape = csgFuse(shape, rail);
  }

  const sidelight = Math.max(0, optionalNumber(args, 'sidelight', 0));
  if (sidelight > 0) {
    if (2 * (frame + sidelight) >= w) throw new BakerError('door_frame: sidelight too wide for opening');
    for (const sign of [-1, 1]) {
      const x = sign * (w / 2 - frame - sidelight);
      const bar = boxFloor(ctx, frame, depth, h).translate(x, 0, 0) as BakeableShape;
      shape = csgFuse(shape, bar);
    }
  }
  return shape;
};

// ── door_leaf ───────────────────────────────────────────────────────
// 门扇：单块板（独立 shape，便于生成器选 revolute 或 fixed 连接）。
// 局部坐标系把铰接边放在 X=0（hinge 侧），便于以 X 轴为转轴在生成器侧旋转。

export const doorLeaf: OpBuilder = (ctx, args) => {
  const [w, h] = requireNumList(args, 'size', 2, 'door_leaf');
  const thickness = requireNumber(args, 'thickness', 'door_leaf');
  const hinge = optionalString(args, 'hinge', 'center');
  const style = optionalString(args, 'style', 'flush');
  if (w <= 0 || h <= 0 || thickness <= 0) throw new BakerError('door_leaf: size and thickness must be positive');

  // 默认 X、Y 居中、Z∈[0, h]
  let shape = boxFloor(ctx, w, thickness, h);

  if (style === 'panel') {
    const rows = Math.max(1, Math.round(optionalNumber(args, 'panel_rows', 2)));
    const cols = Math.max(1, Math.round(optionalNumber(args, 'panel_cols', 1)));
    const mx = w * 0.14;
    const mz = h * 0.07;
    const gapX = w * 0.05;
    const gapZ = h * 0.05;
    const panelW = Math.max((w - 2 * mx - gapX * (cols - 1)) / cols, w * 0.06);
    const panelH = Math.max((h - 2 * mz - gapZ * (rows - 1)) / rows, h * 0.06);
    const cutD = thickness * 0.3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cx = -w / 2 + mx + panelW / 2 + c * (panelW + gapX);
        const cz = mz + panelH / 2 + r * (panelH + gapZ);
        for (const sign of [1, -1]) {
          const recess = boxFloor(ctx, panelW, cutD * 2, panelH)
            .translate(cx, sign * (thickness / 2), cz - panelH / 2) as BakeableShape;
          shape = csgCut(shape, recess);
        }
      }
    }
  } else if (style === 'glazed') {
    // 上半玻璃窗：在门扇上部挖通透洞口。
    const mx = w * 0.16;
    const holeW = Math.max(w - 2 * mx, w * 0.2);
    const holeBottom = h * 0.5;
    const holeH = h * 0.4;
    const eps = thickness * 0.5 + 0.01;
    const cut = boxFloor(ctx, holeW, thickness + eps, holeH)
      .translate(0, 0, holeBottom) as BakeableShape;
    shape = csgCut(shape, cut);
  }

  if (hinge === 'left') shape = shape.translate(w / 2, 0, 0) as BakeableShape;
  else if (hinge === 'right') shape = shape.translate(-w / 2, 0, 0) as BakeableShape;
  return shape;
};

// ── railing ─────────────────────────────────────────────────────────
// 栏杆 / 护栏：沿 X 的一段，两端方立柱 + 顶扶手 + 均布竖向栏杆条。
// length(X) × height(Z)，Y 居中（厚度由 post_size 决定）。可用于阳台、走廊、楼梯侧。

export const railing: OpBuilder = (ctx, args) => {
  const length = requireNumber(args, 'length', 'railing');
  const height = requireNumber(args, 'height', 'railing');
  if (length <= 0 || height <= 0) throw new BakerError('railing: length and height must be positive');
  const thickness = optionalNumber(args, 'thickness', 0.04);
  const postShape = optionalString(args, 'post_shape', 'square');
  const postSize = optionalNumber(args, 'post_size', Math.max(thickness * 2.2, 0.08));
  const postRadius = optionalNumber(args, 'post_radius', postSize / 2);
  const railH = optionalNumber(args, 'rail_height', optionalNumber(args, 'top_rail_height', Math.max(thickness * 1.5, 0.06)));
  if (thickness <= 0 || postSize <= 0 || railH <= 0 || postRadius <= 0) {
    throw new BakerError('railing: thickness / post_size / post_radius / rail_height must be positive');
  }
  if (postShape !== 'round' && postShape !== 'square') {
    throw new BakerError('railing: post_shape must be round or square');
  }
  if (postSize >= length) throw new BakerError('railing: post_size must be < length');
  if (railH >= height) throw new BakerError('railing: rail_height must be < height');

  const round = postShape === 'round';
  const postFull = round ? 2 * postRadius : postSize;
  const railDepth = optionalNumber(args, 'top_rail_width', Math.max(thickness, postFull));
  let shape = boxFloor(ctx, length, railDepth, railH).translateZ(height - railH) as BakeableShape;

  for (const sign of [-1, 1]) {
    const px = sign * (length / 2 - postFull / 2);
    const post = round
      ? ctx.replicad.makeCylinder(postRadius, height, [px, 0, 0], [0, 0, 1]) as BakeableShape
      : boxFloor(ctx, postSize, postSize, height).translate(px, 0, 0) as BakeableShape;
    shape = csgFuse(shape, post);
  }

  const innerL = length - 2 * postFull;
  const spacing = optionalNumber(args, 'post_spacing', 0);
  const balusters = spacing > 0
    ? Math.max(0, Math.floor(innerL / spacing))
    : Math.max(0, Math.round(optionalNumber(args, 'baluster_count', Math.max(2, Math.floor(length / 0.12)))));
  const balH = Math.max(height - railH, height * 0.1);
  if (balusters > 0 && innerL > 0) {
    for (let i = 0; i < balusters; i++) {
      const x = -innerL / 2 + (innerL * (i + 0.5)) / balusters;
      const bal = round
        ? ctx.replicad.makeCylinder(thickness / 2, balH, [x, 0, 0], [0, 0, 1]) as BakeableShape
        : boxFloor(ctx, thickness, thickness, balH).translate(x, 0, 0) as BakeableShape;
      shape = csgFuse(shape, bal);
    }
  }

  const railThk = Math.min(thickness * 1.5, railH);
  if (innerL > 0 && optionalBool(args, 'bottom_rail', false)) {
    const br = boxFloor(ctx, innerL, railDepth, railThk).translateZ(Math.min(0.02, height * 0.02)) as BakeableShape;
    shape = csgFuse(shape, br);
  }
  if (innerL > 0 && optionalBool(args, 'mid_rail', false)) {
    const mz = Math.max(0, (height - railH) / 2 - railThk / 2);
    const mr = boxFloor(ctx, innerL, railDepth, railThk).translateZ(mz) as BakeableShape;
    shape = csgFuse(shape, mr);
  }

  return shape;
};

// ── column ──────────────────────────────────────────────────────────
// 柱子 / 立柱：圆柱或方柱柱身 + 可选柱础(base)、柱头(capital) 方板。
// height(Z 总高)，X/Y 居中、底面 Z=0。base_height / capital_height = 0 表示无。

export const column: OpBuilder = (ctx, args) => {
  const height = requireNumber(args, 'height', 'column');
  const radius = optionalNumber(args, 'radius', 0.2);
  const shapeType = optionalString(args, 'shape', 'round');
  const baseH = Math.max(0, optionalNumber(args, 'base_height', 0));
  const capH = Math.max(0, optionalNumber(args, 'capital_height', 0));
  const taper = Math.min(1, Math.max(0.05, optionalNumber(args, 'taper', 1)));
  const baseStyle = optionalString(args, 'base_style', 'plain');
  const capStyle = optionalString(args, 'capital_style', 'plain');
  const flutes = Math.max(0, Math.round(optionalNumber(args, 'flutes', 0)));
  if (height <= 0 || radius <= 0) throw new BakerError('column: height and radius must be positive');
  const shaftH = height - baseH - capH;
  if (shaftH <= 0) throw new BakerError('column: base_height + capital_height must be < height');

  const rTop = radius * taper;
  const straight = taper >= 0.999;

  let shape: BakeableShape;
  if (shapeType === 'square') {
    if (straight) {
      shape = boxFloor(ctx, 2 * radius, 2 * radius, shaftH).translateZ(baseH) as BakeableShape;
    } else {
      const rectXY = (s: number, z: number) =>
        drawingFromPoints(ctx, [[-s, -s], [s, -s], [s, s], [-s, s]]).sketchOnPlane('XY', z);
      const base = rectXY(radius, baseH) as unknown as LoftSketch;
      const top = rectXY(rTop, baseH + shaftH);
      shape = base.loftWith([top], { ruled: true });
    }
  } else if (straight) {
    shape = ctx.replicad.makeCylinder(radius, shaftH, [0, 0, baseH], [0, 0, 1]) as BakeableShape;
  } else {
    const profile: Array<readonly [number, number]> = [[0, 0], [radius, 0], [rTop, shaftH], [0, shaftH]];
    const sketch = drawingFromPoints(ctx, profile).sketchOnPlane('XZ', 0) as unknown as RevolveSketch;
    shape = sketch.revolve([0, 0, 1]).translateZ(baseH) as BakeableShape;
  }

  if (flutes > 0 && shapeType !== 'square') {
    const fr = radius * 0.12;
    for (let i = 0; i < flutes; i++) {
      const a = (2 * Math.PI * i) / flutes;
      const fx = Math.cos(a) * radius;
      const fy = Math.sin(a) * radius;
      const groove = ctx.replicad.makeCylinder(fr, shaftH + 0.02, [fx, fy, baseH - 0.01], [0, 0, 1]) as BakeableShape;
      shape = csgCut(shape, groove);
    }
  }

  const slabSize = radius * 2.6;
  if (baseH > 0) {
    if (baseStyle === 'stepped') {
      shape = csgFuse(shape, boxFloor(ctx, slabSize, slabSize, baseH * 0.5) as BakeableShape);
      shape = csgFuse(shape, boxFloor(ctx, slabSize * 0.82, slabSize * 0.82, baseH * 0.5).translateZ(baseH * 0.5) as BakeableShape);
    } else {
      shape = csgFuse(shape, boxFloor(ctx, slabSize, slabSize, baseH) as BakeableShape);
    }
  }
  if (capH > 0) {
    const z0 = height - capH;
    if (capStyle === 'stepped') {
      shape = csgFuse(shape, boxFloor(ctx, slabSize * 0.82, slabSize * 0.82, capH * 0.5).translateZ(z0) as BakeableShape);
      shape = csgFuse(shape, boxFloor(ctx, slabSize, slabSize, capH * 0.5).translateZ(z0 + capH * 0.5) as BakeableShape);
    } else {
      shape = csgFuse(shape, boxFloor(ctx, slabSize, slabSize, capH).translateZ(z0) as BakeableShape);
    }
  }
  return shape;
};
