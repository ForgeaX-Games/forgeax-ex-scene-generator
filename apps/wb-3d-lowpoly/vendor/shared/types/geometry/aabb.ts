/**
 * Geometry shape → AABB（局部坐标，相对 part 原点）的轻量推导。
 *
 * 用于 placement / inertia / 摆位类电池：
 *   - 给一个 shape 语句，返回它在自身局部坐标系里的轴对齐包围盒 half-extents
 *     （中心默认在原点）。
 *   - 复杂语义零件 / 齿轮：用分析式公式给出近似 AABB（不烘 mesh、不依赖 sidecar）；
 *     精度对 placement 足够，对惯性张量也可作"等效实心 box"退化用。
 *   - mesh 形状无法解析；返回 null，由调用方决定退化策略（手填或报错）。
 *
 * 纯几何推导：不读 mesh 文件、不走 trimesh。
 *
 * ── 坐标约定 ──────────────────────────────────────────────────────────
 *   panels (perforated/slot/vent_grille)  : panel_w→X, panel_h→Y, thickness→Z
 *   brackets (clevis/fork/yoke)           : overall_size = [w, d, h] → [X, Y, Z]
 *   fans (fan_rotor / blower_wheel)       : 圆盘在 XY，轴 = Z
 *   controls (knob / bezel)               : 主轴 = Z；knob 圆截面在 XY；bezel 面在 XY
 *   wheels (wheel / tire)                 : 圆面在 YZ，旋转轴 = X（width 沿 X）
 *   hinges (barrel / piano)               : pin 轴 = Z；leaves 沿 X 摊开（open=180°）
 *   gears (spur/herringbone/ring/...)     : 圆盘在 XY，轴 = Z（标准 cq_gears 约定）
 *   bevel_gear / bevel_pair               : 大端在 XY，轴 = Z
 *   rack / herringbone_rack               : length→X, width→Y, height(+addendum)→Z
 *
 * ── 已知简化（v1）─────────────────────────────────────────────────────
 *   - 忽略 `center: bool` 参数（始终返回 center=[0,0,0]，与既有 box/cyl/sphere 一致）。
 *     用户若用 center=false 把形状角点对到原点，AABB 中心位置会偏 half。
 *   - 铰链按 open_angle_deg=180° 平展时的最大投影计算（保守上界）。
 *   - 齿轮对 (bevel/crossed/hyperbolic_pair) 仅给出"两齿轮分别独立旋转后的包络"，
 *     不解算具体啮合中心距；偏保守，placement 不会撞穿但可能富余 ≤ 一倍模数。
 */

import type { Arg, Statement } from './types.js';
import { ARCH_DEFAULTS } from './arch-defaults.js';

export interface LocalAABB {
  /** 包围盒中心（在 shape 局部坐标，box/cyl/sphere 缺省都是原点 0） */
  readonly center: readonly [number, number, number];
  /** 半轴长度 [hx, hy, hz]；总尺寸 = 2 * halfExtent */
  readonly halfExtent: readonly [number, number, number];
}

// ── 默认值常量（仅用于 AABB 估算；与 sidecar 烘出来的真实 mesh 可能略不同）
// 这些值的存在仅是让"用户没在 DSL 里 emit 的可选参数"也能得到一个合理 AABB；
// sidecar 真正建模时会用自己的默认值。两边要尽量保持一致。
const DEFAULT_VENT_FACE_T   = 0.005;   // VentGrille face_thickness 默认 ≈ 5mm
const DEFAULT_HINGE_KNUCKLE = 1.6;     // knuckle_outer_diameter ≈ pin_d * 1.6（经验值）
const DEFAULT_HELIX_ANGLE_DEG    = 0;
const DEFAULT_BEVEL_AXIS_ANGLE_DEG = 90;
const DEFAULT_CROSSED_SHAFT_ANGLE_DEG = 90;
const DEFAULT_HYP_SHAFT_ANGLE_DEG = 30;

/** 解析一个 shape statement 的局部 AABB；mesh 或未知 op 返回 null。 */
export function localAabbFromShape(shape: Statement): LocalAABB | null {
  switch (shape.op) {
    // ════════════════════════════════════════════════════════════════════
    // 基础原语
    // ════════════════════════════════════════════════════════════════════
    case 'box': {
      const size = readNumList(shape.args.size, 3);
      if (!size) return null;
      return centered([size[0] / 2, size[1] / 2, size[2] / 2]);
    }
    case 'cylinder': {
      const r = readNumber(shape.args.radius);
      const l = readNumber(shape.args.length);
      if (r === undefined || l === undefined) return null;
      return centered([r, r, l / 2]);
    }
    case 'sphere': {
      const r = readNumber(shape.args.radius);
      if (r === undefined) return null;
      return centered([r, r, r]);
    }
    case 'cone': {
      const r = readNumber(shape.args.radius);
      const h = readNumber(shape.args.height);
      if (r === undefined || h === undefined) return null;
      return centered([r, r, h / 2]);
    }
    case 'capsule': {
      const r = readNumber(shape.args.radius);
      const l = readNumber(shape.args.length);
      if (r === undefined || l === undefined) return null;
      return centered([r, r, l / 2]);
    }
    case 'torus': {
      const majorR = readNumber(shape.args.major_radius);
      const minorR = readNumber(shape.args.minor_radius);
      if (majorR === undefined || minorR === undefined) return null;
      return centered([majorR + minorR, majorR + minorR, minorR]);
    }
    case 'dome': {
      const r = readNumber(shape.args.radius);
      const h = readNumber(shape.args.height);
      if (r === undefined || h === undefined) return null;
      return centered([r, r, h / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Mesh-backed 三角网格 op（rock/boulder/sdf_blob）：无 OCCT 实体，但局部坐标系
    // 约定明确（居中于原点的 icosphere / primitives 的显式坐标），可以给出分析式估算。
    // ════════════════════════════════════════════════════════════════════
    case 'rock':
    case 'boulder': {
      // rock.ts：radius 基准半径的 icosphere，居中于原点，stretch=[sx,sy,sz] 非等比拉伸。
      const r = readNumber(shape.args.radius);
      if (r === undefined) return null;
      const stretch = readNumList(shape.args.stretch, 3) ?? [1, 1, 1];
      return centered([r * stretch[0], r * stretch[1], r * stretch[2]]);
    }
    case 'sdf_blob': {
      const bounds = readNumList(shape.args.bounds, 6);
      if (bounds) {
        return fromMinMax(
          [bounds[0], bounds[1], bounds[2]],
          [bounds[3], bounds[4], bounds[5]],
        );
      }
      // 没写 bounds：从 primitives 各自的局部包围球（旋转不变半径，忽略 rx/ry/rz——
      // 精确算旋转后的 AABB需要矩阵运算,这里只要一个不会偏小的保守估计)外扩推导,
      // 再按最大的 smooth-union 融合半径做一点外扩边际。估不出（primitives 编码异常/
      // 未知 type）时返回 null，与其它无法解析的复杂形状一致。
      return estimateSdfBlobAabb(shape.args.primitives, shape.args.operations);
    }

    // ════════════════════════════════════════════════════════════════════
    // Mesh —— 外部 mesh 引用。只有显式带 bbox_min/bbox_max（未缩放局部 AABB，
    // 通常由 g_bake_part 透传）时才可解；按 scale=[sx,sy,sz] 缩放后给 AABB。
    // 无 bbox 参数时返回 null（向后兼容：mesh 仍判 missing_aabb）。
    // ════════════════════════════════════════════════════════════════════
    case 'mesh': {
      const bmin = readNumList(shape.args.bbox_min, 3);
      const bmax = readNumList(shape.args.bbox_max, 3);
      if (!bmin || !bmax) return null;
      const scale = readNumList(shape.args.scale, 3) ?? [1, 1, 1];
      const lo: [number, number, number] = [0, 0, 0];
      const hi: [number, number, number] = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        // scale 理论恒正，但仍稳健地取缩放后两端的 min/max。
        const a = bmin[i] * scale[i];
        const b = bmax[i] * scale[i];
        lo[i] = Math.min(a, b);
        hi[i] = Math.max(a, b);
      }
      return fromMinMax(lo, hi);
    }

    // ════════════════════════════════════════════════════════════════════
    // Brackets / Forks / Yokes —— overall_size = [w, d, h]，直接对应 [X, Y, Z]
    // ════════════════════════════════════════════════════════════════════
    case 'clevis_bracket':
    case 'pivot_fork':
    case 'trunnion_yoke': {
      const s = readNumList(shape.args.overall_size, 3);
      if (!s) return null;
      return centered([s[0] / 2, s[1] / 2, s[2] / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Panels —— panel_size = [w, h]，thickness 沿 Z
    // ════════════════════════════════════════════════════════════════════
    case 'perforated_panel':
    case 'slot_panel': {
      const ps = readNumList(shape.args.panel_size, 2);
      const t  = readNumber(shape.args.thickness);
      if (!ps || t === undefined) return null;
      return centered([ps[0] / 2, ps[1] / 2, t / 2]);
    }
    case 'vent_grille': {
      const ps = readNumList(shape.args.panel_size, 2);
      if (!ps) return null;
      const faceT = readNumber(shape.args.face_thickness) ?? DEFAULT_VENT_FACE_T;
      const duct  = readNumber(shape.args.duct_depth) ?? 0;
      const totalZ = Math.max(faceT + duct, 1e-4);
      return centered([ps[0] / 2, ps[1] / 2, totalZ / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Fans —— 圆盘在 XY，轴 = Z
    // ════════════════════════════════════════════════════════════════════
    case 'fan_rotor': {
      const r = readNumber(shape.args.outer_radius);
      const t = readNumber(shape.args.thickness);
      if (r === undefined || t === undefined) return null;
      return centered([r, r, t / 2]);
    }
    case 'blower_wheel': {
      const r = readNumber(shape.args.outer_radius);
      const w = readNumber(shape.args.width);
      if (r === undefined || w === undefined) return null;
      return centered([r, r, w / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Controls —— 轴 = Z
    // ════════════════════════════════════════════════════════════════════
    case 'knob': {
      const d = readNumber(shape.args.diameter);
      const h = readNumber(shape.args.height);
      if (d === undefined || h === undefined) return null;
      // 取 base/top/diameter 三者最大，以涵盖 skirted/mushroom/tapered 几种形态
      const dTop  = readNumber(shape.args.top_diameter) ?? 0;
      const dBase = readNumber(shape.args.base_diameter) ?? 0;
      const dMax = Math.max(d, dTop, dBase);
      return centered([dMax / 2, dMax / 2, h / 2]);
    }
    case 'bezel': {
      const outer = readNumList(shape.args.outer_size, 2);
      const dep   = readNumber(shape.args.depth);
      if (!outer || dep === undefined) return null;
      return centered([outer[0] / 2, outer[1] / 2, dep / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Wheels & Tires —— 旋转轴 = X，圆面在 YZ
    // ════════════════════════════════════════════════════════════════════
    case 'wheel': {
      const r = readNumber(shape.args.radius);
      const w = readNumber(shape.args.width);
      if (r === undefined || w === undefined) return null;
      return centered([w / 2, r, r]);
    }
    case 'tire': {
      const r = readNumber(shape.args.outer_radius);
      const w = readNumber(shape.args.width);
      if (r === undefined || w === undefined) return null;
      return centered([w / 2, r, r]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Hinges —— pin 轴 = Z，leaves 沿 X 摊开（open=180° 上界）
    // ════════════════════════════════════════════════════════════════════
    case 'barrel_hinge':
    case 'piano_hinge': {
      const len = readNumber(shape.args.length);
      const lwA = readNumber(shape.args.leaf_width_a);
      const lt  = readNumber(shape.args.leaf_thickness);
      const pin = readNumber(shape.args.pin_diameter);
      if (len === undefined || lwA === undefined || lt === undefined || pin === undefined) return null;
      const lwB = readNumber(shape.args.leaf_width_b) ?? lwA;
      const knuckle = readNumber(shape.args.knuckle_outer_diameter) ?? pin * DEFAULT_HINGE_KNUCKLE;
      // X = 两叶平摊宽度；Y = 叶厚 vs knuckle 突出的较大者；Z = 沿 pin 总长
      return centered([(lwA + lwB) / 2, Math.max(lt, knuckle) / 2, len / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Single gears (cq_gears) —— 圆盘在 XY，轴 = Z
    // ════════════════════════════════════════════════════════════════════
    case 'spur_gear':
    case 'herringbone_gear':
    case 'crossed_helical_gear':
    case 'hyperbolic_gear': {
      const m  = readNumber(shape.args.module);
      const z  = readNumber(shape.args.teeth_number);
      const w  = readNumber(shape.args.width);
      if (m === undefined || z === undefined || w === undefined) return null;
      const helix = readNumber(shape.args.helix_angle) ?? DEFAULT_HELIX_ANGLE_DEG;
      // 齿顶圆半径 ≈ m * (z + 2) / 2；斜齿 helix → 圆周面径向不变（轴向投影宽度变长由 width 已涵盖）
      void helix; // helix 不影响圆截面 AABB，仅作可读
      const rOuter = (m * (z + 2)) / 2;
      return centered([rOuter, rOuter, w / 2]);
    }
    case 'ring_gear':
    case 'herringbone_ring_gear': {
      const m   = readNumber(shape.args.module);
      const z   = readNumber(shape.args.teeth_number);
      const w   = readNumber(shape.args.width);
      const rim = readNumber(shape.args.rim_width);
      if (m === undefined || z === undefined || w === undefined || rim === undefined) return null;
      // 内齿圈：齿在内壁，外壁 = 节圆半径 + rim_width（RingGear 约定）
      const rOuter = (m * z) / 2 + rim;
      return centered([rOuter, rOuter, w / 2]);
    }
    case 'bevel_gear': {
      const m    = readNumber(shape.args.module);
      const z    = readNumber(shape.args.teeth_number);
      const cone = readNumber(shape.args.cone_angle);
      const face = readNumber(shape.args.face_width);
      if (m === undefined || z === undefined || cone === undefined || face === undefined) return null;
      // 大端齿顶圆半径 ≈ m*z/2 + m（加一个 addendum）
      const rOuter = (m * z) / 2 + m;
      // 锥体高度沿 Z（轴向）≈ face_width + 一定锥体投影
      const halfZ = face / 2 + rOuter * Math.sin((cone * Math.PI) / 180) / 2;
      return centered([rOuter, rOuter, halfZ]);
    }
    case 'rack_gear':
    case 'herringbone_rack_gear': {
      const m   = readNumber(shape.args.module);
      const len = readNumber(shape.args.length);
      const w   = readNumber(shape.args.width);
      const h   = readNumber(shape.args.height);
      if (m === undefined || len === undefined || w === undefined || h === undefined) return null;
      // 齿条：长沿 X，宽沿 Y，背高 h + 齿顶 m 沿 Z
      return centered([len / 2, w / 2, (h + m) / 2]);
    }
    case 'worm': {
      const m   = readNumber(shape.args.module);
      const len = readNumber(shape.args.length);
      const lead = readNumber(shape.args.lead_angle);
      const nT   = readNumber(shape.args.n_threads);
      if (m === undefined || len === undefined || lead === undefined || nT === undefined) return null;
      // Worm: d0 = n_threads * module / abs(tan(lead_angle)); 齿顶半径 = d0/2 + module
      const leadRad = (lead * Math.PI) / 180;
      const tanLead = Math.max(Math.abs(Math.tan(leadRad)), 0.01);  // 0° 兜底
      const rOuter = (m * nT) / (2 * tanLead) + m;
      return centered([rOuter, rOuter, len / 2]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Gear assemblies —— 复合形状，给保守上界，不解空间夹角细节
    // ════════════════════════════════════════════════════════════════════
    case 'planetary_gearset':
    case 'herringbone_planetary_gearset': {
      const m    = readNumber(shape.args.module);
      const zSun = readNumber(shape.args.sun_teeth_number);
      const zPla = readNumber(shape.args.planet_teeth_number);
      const w    = readNumber(shape.args.width);
      const rim  = readNumber(shape.args.rim_width);
      if (m === undefined || zSun === undefined || zPla === undefined || w === undefined || rim === undefined) return null;
      // 环齿圈外径 = m*(sun + 2*planet)/2 + rim_width
      const rOuter = (m * (zSun + 2 * zPla)) / 2 + rim;
      return centered([rOuter, rOuter, w / 2]);
    }
    case 'bevel_gear_pair': {
      const m  = readNumber(shape.args.module);
      const zG = readNumber(shape.args.gear_teeth);
      const zP = readNumber(shape.args.pinion_teeth);
      const face = readNumber(shape.args.face_width);
      if (m === undefined || zG === undefined || zP === undefined || face === undefined) return null;
      // 90° 夹角：大齿轮平放（XY），小齿轮沿 Z 立起
      const rG = (m * zG) / 2 + m;
      const rP = (m * zP) / 2 + m;
      const axisAng = readNumber(shape.args.axis_angle) ?? DEFAULT_BEVEL_AXIS_ANGLE_DEG;
      void axisAng; // v1 不细化非 90° 夹角，保守用平方区域包络
      return centered([
        Math.max(rG, rP),
        Math.max(rG, rP),
        rG + rP + face / 2,
      ]);
    }
    case 'crossed_gear_pair': {
      const m   = readNumber(shape.args.module);
      const z1  = readNumber(shape.args.gear1_teeth_number);
      const z2  = readNumber(shape.args.gear2_teeth_number);
      const w1  = readNumber(shape.args.gear1_width);
      const w2  = readNumber(shape.args.gear2_width);
      if (m === undefined || z1 === undefined || z2 === undefined || w1 === undefined || w2 === undefined) return null;
      const shaft = readNumber(shape.args.shaft_angle) ?? DEFAULT_CROSSED_SHAFT_ANGLE_DEG;
      void shaft;
      const r1 = (m * (z1 + 2)) / 2;
      const r2 = (m * (z2 + 2)) / 2;
      // 两齿轮中心距 ≈ r1 + r2；保守用 (r1+r2) 作为两个水平方向半轴
      return centered([r1 + r2, r1 + r2, Math.max(w1, w2) / 2 + Math.max(r1, r2)]);
    }
    case 'hyperbolic_gear_pair': {
      const m  = readNumber(shape.args.module);
      const z1 = readNumber(shape.args.gear1_teeth_number);
      const w  = readNumber(shape.args.width);
      if (m === undefined || z1 === undefined || w === undefined) return null;
      const z2 = readNumber(shape.args.gear2_teeth_number) ?? z1;
      const shaft = readNumber(shape.args.shaft_angle) ?? DEFAULT_HYP_SHAFT_ANGLE_DEG;
      void shaft;
      const r1 = (m * (z1 + 2)) / 2;
      const r2 = (m * (z2 + 2)) / 2;
      return centered([r1 + r2, r1 + r2, w / 2 + Math.max(r1, r2)]);
    }

    // ════════════════════════════════════════════════════════════════════
    // Architecture —— 墙/楼板/楼梯/屋顶/挂板/门窗（baker ops/architecture.ts）
    // 约定（与 builder 一致）：wall/slab/stairs/window/door 底面落在 Z=0、X/Y 居中；
    // facade_panel 全轴居中；roof footprint 关于原点居中、底面 Z=0。
    // ════════════════════════════════════════════════════════════════════
    case 'wall': {
      const length = readNumber(shape.args.length);
      const height = readNumber(shape.args.height);
      const thickness = readNumber(shape.args.thickness);
      if (length === undefined || height === undefined || thickness === undefined) return null;
      const plinthH = readNumber(shape.args.plinth_height) ?? 0;
      const proj = plinthH > 0
        ? (readNumber(shape.args.plinth_projection) ?? ARCH_DEFAULTS.wall.plinthProjection)
        : 0;
      return { center: [0, 0, height / 2], halfExtent: [length / 2, thickness / 2 + Math.max(0, proj), height / 2] };
    }
    case 'floor_slab': {
      const size = readNumList(shape.args.size, 2);
      const t = readNumber(shape.args.thickness);
      if (!size || t === undefined) return null;
      const beamDepth = Math.max(0, readNumber(shape.args.beam_depth) ?? 0);
      const zLo = -beamDepth;
      const zHi = t;
      return {
        center: [0, 0, (zLo + zHi) / 2],
        halfExtent: [size[0] / 2, size[1] / 2, (zHi - zLo) / 2],
      };
    }
    case 'stairs': {
      const totalRise = readNumber(shape.args.total_rise);
      const run = readNumber(shape.args.run);
      const width = readNumber(shape.args.width);
      const steps = readNumber(shape.args.step_count);
      if (totalRise === undefined || run === undefined || width === undefined || steps === undefined) return null;
      const type = readString(shape.args.type) ?? 'straight';
      if (type === 'spiral') {
        // 螺旋梯：踏步绕 Z 盘升，外半径包络在 XY；中心在原点。
        const radius = readNumber(shape.args.radius) ?? Math.max(width, 1.0);
        return { center: [0, 0, totalRise / 2], halfExtent: [radius, radius, totalRise / 2] };
      }
      const stepCount = Math.max(1, Math.round(steps));
      const landingDepth = Math.max(0, readNumber(shape.args.landing_depth) ?? 0);
      // builder（architecture.ts stairs）里 landing 是"替换"某一级的 run，不是叠加：
      // 有效级数只剩 stepCount-1 级正常 run + 1 级 landingDepth。之前按 stepCount 级 run
      // 全额再加 landingDepth 算，多算了一个 run 的长度。
      const lenX = landingDepth > 0
        ? run * Math.max(0, stepCount - 1) + landingDepth
        : run * stepCount;
      return { center: [lenX / 2, 0, totalRise / 2], halfExtent: [lenX / 2, width / 2, totalRise / 2] };
    }
    case 'roof': {
      const fp = readNumList(shape.args.footprint, 2);
      if (!fp) return null;
      const type = readString(shape.args.type) ?? 'gable';
      const overhang = readNumber(shape.args.overhang) ?? 0;
      const eave = readNumber(shape.args.eave_overhang) ?? overhang;
      const verge = readNumber(shape.args.verge_overhang) ?? overhang;
      const pitched = type === 'gable' || type === 'shed' || type === 'gambrel' || type === 'hip';
      let bw: number;
      let bd: number;
      if (pitched) {
        const longIsX = fp[0] >= fp[1];
        const spanTotal = Math.min(fp[0], fp[1]) + 2 * Math.max(0, eave);
        const ridgeTotal = Math.max(fp[0], fp[1]) + 2 * Math.max(0, verge);
        bw = longIsX ? ridgeTotal : spanTotal;
        bd = longIsX ? spanTotal : ridgeTotal;
      } else {
        bw = fp[0] + 2 * overhang;
        bd = fp[1] + 2 * overhang;
      }
      if (type === 'flat') {
        const thickness = readNumber(shape.args.thickness) ?? ARCH_DEFAULTS.roof.flatThickness;
        const parapetH = Math.max(0, readNumber(shape.args.parapet_height) ?? 0);
        const coping = Math.max(0, readNumber(shape.args.coping_width) ?? 0);
        const zSpan = thickness + parapetH + (coping > 0 ? ARCH_DEFAULTS.roof.copingThickness : 0);
        const hx = bw / 2 + coping;
        const hy = bd / 2 + coping;
        return { center: [0, 0, zSpan / 2], halfExtent: [hx, hy, zSpan / 2] };
      }
      const zSpan = readNumber(shape.args.height) ?? Math.min(bw, bd) * ARCH_DEFAULTS.roof.heightFactor;
      return { center: [0, 0, zSpan / 2], halfExtent: [bw / 2, bd / 2, zSpan / 2] };
    }
    case 'facade_panel': {
      const ps = readNumList(shape.args.panel_size, 2);
      const t = readNumber(shape.args.thickness);
      if (!ps || t === undefined) return null;
      // orientation=wall（默认，竖直挂板）：w→X、h→Z（底面 Z=0）、thickness→Y（居中）；
      // orientation=slab（平躺）：w→X、h→Y、thickness→Z（底面 Z=0）。
      const orientation = readString(shape.args.orientation) ?? 'wall';
      if (orientation === 'slab') {
        return { center: [0, 0, t / 2], halfExtent: [ps[0] / 2, ps[1] / 2, t / 2] };
      }
      return { center: [0, 0, ps[1] / 2], halfExtent: [ps[0] / 2, t / 2, ps[1] / 2] };
    }
    case 'window': {
      const size = readNumList(shape.args.size, 2);
      const depth = readNumber(shape.args.depth);
      if (!size || depth === undefined) return null;
      const sill = Math.max(0, readNumber(shape.args.sill) ?? 0);
      const ext = sill > 0 ? 0.03 : 0;
      return {
        center: [0, 0, size[1] / 2],
        halfExtent: [size[0] / 2 + ext, depth / 2 + sill, size[1] / 2],
      };
    }
    case 'door_frame': {
      const size = readNumList(shape.args.size, 2);
      const depth = readNumber(shape.args.depth);
      if (!size || depth === undefined) return null;
      return { center: [0, 0, size[1] / 2], halfExtent: [size[0] / 2, depth / 2, size[1] / 2] };
    }
    case 'door_leaf': {
      const size = readNumList(shape.args.size, 2);
      const t = readNumber(shape.args.thickness);
      if (!size || t === undefined) return null;
      const hinge = readString(shape.args.hinge) ?? 'center';
      const cx = hinge === 'left' ? size[0] / 2 : hinge === 'right' ? -size[0] / 2 : 0;
      return { center: [cx, 0, size[1] / 2], halfExtent: [size[0] / 2, t / 2, size[1] / 2] };
    }
    case 'railing': {
      const length = readNumber(shape.args.length);
      const height = readNumber(shape.args.height);
      if (length === undefined || height === undefined) return null;
      const thickness = readNumber(shape.args.thickness) ?? 0.04;
      const postSize = readNumber(shape.args.post_size) ?? Math.max(thickness * 2.2, 0.08);
      const postShape = readString(shape.args.post_shape) ?? 'square';
      const postRadius = readNumber(shape.args.post_radius) ?? postSize / 2;
      const railDepth = readNumber(shape.args.top_rail_width) ?? Math.max(thickness, postSize);
      const postY = postShape === 'round' ? 2 * postRadius : postSize;
      const yHalf = Math.max(railDepth, postY, thickness) / 2;
      return { center: [0, 0, height / 2], halfExtent: [length / 2, yHalf, height / 2] };
    }
    case 'column': {
      const height = readNumber(shape.args.height);
      const radius = readNumber(shape.args.radius) ?? 0.2;
      if (height === undefined) return null;
      const baseH = readNumber(shape.args.base_height) ?? 0;
      const capH = readNumber(shape.args.capital_height) ?? 0;
      // 有础/头时方板更宽（slabSize = radius*2.6），用它作 XY 半轴上界。
      const half = (baseH > 0 || capH > 0) ? radius * 1.3 : radius;
      return { center: [0, 0, height / 2], halfExtent: [half, half, height / 2] };
    }

    default:
      return null;
  }
}

/** 解析可引用上游 shape/profile 的 shape AABB（CSG / extrude / revolve）。 */
export function localAabbFromShapeInGeometry(
  shape: Statement,
  byId: ReadonlyMap<string, Statement>,
): LocalAABB | null {
  return localAabbFromShapeRecursive(shape, byId, new Set());
}

/** 给一个 part 语句，沿 shape ref 解出它的局部 AABB；shape 不存在或不可解返回 null。 */
export function localAabbFromPart(
  part: Statement,
  byId: ReadonlyMap<string, Statement>,
): LocalAABB | null {
  if (part.op !== 'part') return null;
  const shapeRef = part.args.shape;
  if (!shapeRef || shapeRef.kind !== 'ref') return null;
  const shape = byId.get(shapeRef.name);
  if (!shape) return null;
  return localAabbFromShapeInGeometry(shape, byId);
}

/** AABB of the part visual after applying part.origin / part.rpy in link-local coordinates. */
export function visualAabbFromPart(
  part: Statement,
  byId: ReadonlyMap<string, Statement>,
): LocalAABB | null {
  const local = localAabbFromPart(part, byId);
  if (!local) return null;
  const origin = readNumList(part.args.origin, 3) ?? [0, 0, 0];
  const rpy = readNumList(part.args.rpy, 3) ?? [0, 0, 0];
  return transformAabb(local, point => transformByOriginRpy(point, origin, rpy));
}

// ── 内部工具 ────────────────────────────────────────────────────────────

function localAabbFromShapeRecursive(
  shape: Statement,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): LocalAABB | null {
  if (visiting.has(shape.id)) return null;
  visiting.add(shape.id);
  try {
    switch (shape.op) {
      case 'profile_polygon':
      case 'profile_rect':
      case 'profile_circle':
      case 'profile_rounded_rect':
      case 'profile_regular_polygon': {
        const bounds = profileBounds(shape);
        if (!bounds) return null;
        return fromMinMax([bounds.minX, bounds.minY, -0.001], [bounds.maxX, bounds.maxY, 0.001]);
      }
      case 'extrude': {
        const profile = readRefStatement(shape.args.profile, byId);
        const bounds = profile ? profileBounds(profile) : null;
        const h = readNumber(shape.args.height);
        if (!bounds || h === undefined) return null;
        const center = readBool(shape.args.center) ?? true;
        const zMin = center ? -h / 2 : 0;
        const zMax = zMin + h;
        return fromMinMax([bounds.minX, bounds.minY, zMin], [bounds.maxX, bounds.maxY, zMax]);
      }
      case 'extrude_with_holes': {
        const outer = readRefStatement(shape.args.outer, byId);
        const bounds = outer ? profileBounds(outer) : null;
        const h = readNumber(shape.args.height);
        if (!bounds || h === undefined) return null;
        const center = readBool(shape.args.center) ?? true;
        const zMin = center ? -h / 2 : 0;
        const zMax = zMin + h;
        return fromMinMax([bounds.minX, bounds.minY, zMin], [bounds.maxX, bounds.maxY, zMax]);
      }
      case 'loft': {
        const profiles = readProfileRefs(shape.args.profiles, byId);
        if (!profiles || profiles.length < 2) return null;
        const bounds = mergeProfileBounds(profiles);
        if (!bounds) return null;
        const zValues = readAnyNumList(shape.args.z_values);
        const height = readNumber(shape.args.height) ?? 1;
        const zs = zValues && zValues.length === profiles.length
          ? zValues
          : profiles.map((_, i) => -height / 2 + (height * i) / (profiles.length - 1));
        return fromMinMax(
          [bounds.minX, bounds.minY, Math.min(...zs)],
          [bounds.maxX, bounds.maxY, Math.max(...zs)],
        );
      }
      case 'section_loft': {
        const sections = readSectionPoints(shape.args.sections);
        if (!sections || sections.length < 2) return null;
        const pts = sections.flat();
        return fromMinMax(
          [
            Math.min(...pts.map(p => p[0])),
            Math.min(...pts.map(p => p[1])),
            Math.min(...pts.map(p => p[2])),
          ],
          [
            Math.max(...pts.map(p => p[0])),
            Math.max(...pts.map(p => p[1])),
            Math.max(...pts.map(p => p[2])),
          ],
        );
      }
      case 'sweep': {
        const profile = readRefStatement(shape.args.profile, byId);
        const bounds = profile ? profileBounds(profile) : null;
        const path = readPathPoints(shape.args.path);
        if (!bounds || !path) return null;
        return fromMinMax(
          [
            Math.min(...path.map(p => p[0])) + bounds.minX,
            Math.min(...path.map(p => p[1])) + bounds.minY,
            Math.min(...path.map(p => p[2])),
          ],
          [
            Math.max(...path.map(p => p[0])) + bounds.maxX,
            Math.max(...path.map(p => p[1])) + bounds.maxY,
            Math.max(...path.map(p => p[2])),
          ],
        );
      }
      case 'pipe': {
        const path = readPathPoints(shape.args.path);
        const r = readNumber(shape.args.radius);
        if (!path || r === undefined) return null;
        return fromMinMax(
          [
            Math.min(...path.map(p => p[0])) - r,
            Math.min(...path.map(p => p[1])) - r,
            Math.min(...path.map(p => p[2])) - r,
          ],
          [
            Math.max(...path.map(p => p[0])) + r,
            Math.max(...path.map(p => p[1])) + r,
            Math.max(...path.map(p => p[2])) + r,
          ],
        );
      }
      case 'revolve': {
        const profile = readRefStatement(shape.args.profile, byId);
        const pts = profile ? profilePoints(profile) : null;
        if (!pts) return null;
        let maxR = 0;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const [r, z] of pts) {
          if (r < 0) return null;
          maxR = Math.max(maxR, r);
          minZ = Math.min(minZ, z);
          maxZ = Math.max(maxZ, z);
        }
        if (!Number.isFinite(minZ) || !Number.isFinite(maxZ)) return null;
        return fromMinMax([-maxR, -maxR, minZ], [maxR, maxR, maxZ]);
      }
      case 'union': {
        const a = refAabb(shape.args.a, byId, visiting);
        const b = refAabb(shape.args.b, byId, visiting);
        return a && b ? unionAabb(a, b) : null;
      }
      case 'difference': {
        return refAabb(shape.args.base, byId, visiting);
      }
      case 'fillet':
      case 'chamfer': {
        // 圆角/斜角只会略微收缩实体的边角，引用实体的 AABB 是安全的保守上界。
        return refAabb(shape.args.shape, byId, visiting);
      }
      case 'intersection': {
        const a = refAabb(shape.args.a, byId, visiting);
        const b = refAabb(shape.args.b, byId, visiting);
        if (!a || !b) return null;
        // Non-overlapping operand AABBs can still represent an intentional empty
        // intersection. Return a conservative envelope instead of "missing AABB"
        // so QC does not misclassify supported CSG as an unregistered shape.
        return intersectAabb(a, b) ?? unionAabb(a, b);
      }
      case 'translate': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const offset = readNumList(shape.args.offset, 3);
        if (!base || !offset) return null;
        return {
          center: [base.center[0] + offset[0], base.center[1] + offset[1], base.center[2] + offset[2]],
          halfExtent: base.halfExtent,
        };
      }
      case 'scale': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const factor = readNumber(shape.args.factor);
        const center = readNumList(shape.args.center, 3) ?? [0, 0, 0];
        if (!base || factor === undefined || factor <= 0) return null;
        return transformAabb(base, point => [
          center[0] + (point[0] - center[0]) * factor,
          center[1] + (point[1] - center[1]) * factor,
          center[2] + (point[2] - center[2]) * factor,
        ]);
      }
      case 'rotate': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const angle = readNumber(shape.args.angle_deg);
        const axis = readNumList(shape.args.axis, 3) ?? [0, 0, 1];
        const origin = readNumList(shape.args.origin, 3) ?? [0, 0, 0];
        if (!base || angle === undefined || Math.hypot(axis[0], axis[1], axis[2]) <= 1e-9) return null;
        return transformAabb(base, point => rotatePoint(point, angle, origin, axis));
      }
      case 'mirror': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const plane = readString(shape.args.plane)?.toUpperCase() ?? 'YZ';
        const origin = readNumList(shape.args.origin, 3) ?? [0, 0, 0];
        if (!base || !['XY', 'YZ', 'XZ'].includes(plane)) return null;
        return transformAabb(base, point => mirrorPoint(point, plane, origin));
      }
      case 'array_linear': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const count = readCount(shape.args.count);
        const step = readNumList(shape.args.step, 3);
        if (!base || count === null || !step) return null;
        const [min, max] = minMaxFromAabb(base);
        for (let i = 1; i < count; i++) {
          const moved: LocalAABB = {
            center: [
              base.center[0] + step[0] * i,
              base.center[1] + step[1] * i,
              base.center[2] + step[2] * i,
            ],
            halfExtent: base.halfExtent,
          };
          expandMinMax(min, max, moved);
        }
        return fromMinMax(min, max);
      }
      case 'array_radial': {
        const base = refAabb(shape.args.shape, byId, visiting);
        const count = readCount(shape.args.count);
        const total = readNumber(shape.args.angle_deg) ?? 360;
        const axis = readNumList(shape.args.axis, 3) ?? [0, 0, 1];
        const origin = readNumList(shape.args.origin, 3) ?? [0, 0, 0];
        if (!base || count === null || Math.hypot(axis[0], axis[1], axis[2]) <= 1e-9) return null;
        const denom = Math.abs(total) >= 360 - 1e-9 ? count : Math.max(count - 1, 1);
        const [min, max] = minMaxFromAabb(base);
        for (let i = 1; i < count; i++) {
          expandMinMax(min, max, transformAabb(base, point => rotatePoint(point, (total * i) / denom, origin, axis)));
        }
        return fromMinMax(min, max);
      }
      default:
        return localAabbFromShape(shape);
    }
  } finally {
    visiting.delete(shape.id);
  }
}

function refAabb(
  arg: Arg | undefined,
  byId: ReadonlyMap<string, Statement>,
  visiting: Set<string>,
): LocalAABB | null {
  if (!arg || arg.kind !== 'ref') return null;
  const target = byId.get(arg.name);
  return target ? localAabbFromShapeRecursive(target, byId, visiting) : null;
}

function readRefStatement(arg: Arg | undefined, byId: ReadonlyMap<string, Statement>): Statement | null {
  return arg?.kind === 'ref' ? byId.get(arg.name) ?? null : null;
}

function readProfileRefs(arg: Arg | undefined, byId: ReadonlyMap<string, Statement>): Statement[] | null {
  if (!arg || arg.kind !== 'list') return null;
  const out: Statement[] = [];
  for (const item of arg.items) {
    if (item.kind !== 'ref') return null;
    const stmt = byId.get(item.name);
    if (!stmt) return null;
    out.push(stmt);
  }
  return out;
}

function profileBounds(profile: Statement): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts = profilePoints(profile);
  if (!pts) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function mergeProfileBounds(profiles: readonly Statement[]): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bounds = profiles.map(profileBounds);
  if (bounds.some(b => !b)) return null;
  const valid = bounds as Array<{ minX: number; minY: number; maxX: number; maxY: number }>;
  return {
    minX: Math.min(...valid.map(b => b.minX)),
    minY: Math.min(...valid.map(b => b.minY)),
    maxX: Math.max(...valid.map(b => b.maxX)),
    maxY: Math.max(...valid.map(b => b.maxY)),
  };
}

function profilePoints(profile: Statement): Array<readonly [number, number]> | null {
  switch (profile.op) {
    case 'profile_polygon': {
      const raw = readAnyNumList(profile.args.points);
      if (!raw || raw.length < 6 || raw.length % 2 !== 0) return null;
      const out: Array<readonly [number, number]> = [];
      for (let i = 0; i < raw.length; i += 2) out.push([raw[i], raw[i + 1]]);
      return out;
    }
    case 'profile_rect': {
      const w = readNumber(profile.args.w);
      const d = readNumber(profile.args.d);
      if (w === undefined || d === undefined) return null;
      return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    }
    case 'profile_circle': {
      const r = readNumber(profile.args.radius);
      if (r === undefined) return null;
      return [[-r, -r], [r, -r], [r, r], [-r, r]];
    }
    case 'profile_rounded_rect': {
      const w = readNumber(profile.args.w);
      const d = readNumber(profile.args.d);
      if (w === undefined || d === undefined) return null;
      return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
    }
    case 'profile_regular_polygon': {
      const r = readNumber(profile.args.radius);
      if (r === undefined) return null;
      return [[-r, -r], [r, -r], [r, r], [-r, r]];
    }
    default:
      return null;
  }
}

function centered(half: [number, number, number]): LocalAABB {
  return { center: [0, 0, 0], halfExtent: half };
}

function fromMinMax(min: [number, number, number], max: [number, number, number]): LocalAABB {
  return {
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    halfExtent: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
  };
}

/**
 * sdf_blob 无显式 `bounds` 时的粗略估算：每个 primitive 用它自身局部包围球的半径
 * （旋转不变，见 organic.ts 对 primitives tuple 的编码文档）在世界坐标 (cx,cy,cz) 处
 * 展开成一个轴对齐盒，再取所有 primitive 盒子的并集；最后按 operations 里最大的
 * smooth-union 融合半径做一点外扩（融合会让轮廓略微膨胀，融合半径是这个膨胀量的
 * 上界）。tuple 编码/未知 type 解析失败时返回 null。
 */
function estimateSdfBlobAabb(
  primitivesArg: Arg | undefined,
  operationsArg: Arg | undefined,
): LocalAABB | null {
  if (!primitivesArg || primitivesArg.kind !== 'list' || primitivesArg.items.length === 0) return null;
  let min: [number, number, number] | null = null;
  let max: [number, number, number] | null = null;
  for (const item of primitivesArg.items) {
    if (item.kind !== 'list' || item.items.length !== 11) return null;
    const [typeArg, , cxArg, cyArg, czArg, p0Arg, p1Arg, p2Arg] = item.items;
    if (typeArg.kind !== 'string') return null;
    if ([cxArg, cyArg, czArg, p0Arg, p1Arg, p2Arg].some((a) => a.kind !== 'number')) return null;
    const cx = (cxArg as { value: number }).value;
    const cy = (cyArg as { value: number }).value;
    const cz = (czArg as { value: number }).value;
    const p0 = (p0Arg as { value: number }).value;
    const p1 = (p1Arg as { value: number }).value;
    const p2 = (p2Arg as { value: number }).value;
    let r: number;
    switch (typeArg.value) {
      case 'sphere':    r = p0; break;
      case 'capsule':   r = Math.hypot(p0, p1 / 2 + p0); break; // 半径 + 沿轴半高，取斜边保守上界
      case 'cone':      r = Math.hypot(p0, p1 / 2); break;
      case 'box':       r = Math.hypot(p0, p1, p2) / 2; break;  // p0..p2 是全尺寸
      case 'ellipsoid': r = Math.hypot(p0, p1, p2); break;
      default: return null;
    }
    if (!Number.isFinite(r) || r < 0) return null;
    const lo: [number, number, number] = [cx - r, cy - r, cz - r];
    const hi: [number, number, number] = [cx + r, cy + r, cz + r];
    min = min ? [Math.min(min[0], lo[0]), Math.min(min[1], lo[1]), Math.min(min[2], lo[2])] : lo;
    max = max ? [Math.max(max[0], hi[0]), Math.max(max[1], hi[1]), Math.max(max[2], hi[2])] : hi;
  }
  if (!min || !max) return null;
  const margin = maxSmoothUnionRadius(operationsArg);
  if (margin > 0) {
    min = [min[0] - margin, min[1] - margin, min[2] - margin];
    max = [max[0] + margin, max[1] + margin, max[2] + margin];
  }
  return fromMinMax(min, max);
}

function maxSmoothUnionRadius(operationsArg: Arg | undefined): number {
  if (!operationsArg || operationsArg.kind !== 'list') return 0;
  let m = 0;
  for (const item of operationsArg.items) {
    if (item.kind !== 'list' || item.items.length !== 5) continue;
    const r = item.items[4];
    if (r.kind === 'number' && r.value > m) m = r.value;
  }
  return m;
}

function unionAabb(a: LocalAABB, b: LocalAABB): LocalAABB {
  const [aMin, aMax] = minMaxFromAabb(a);
  const [bMin, bMax] = minMaxFromAabb(b);
  return fromMinMax(
    [Math.min(aMin[0], bMin[0]), Math.min(aMin[1], bMin[1]), Math.min(aMin[2], bMin[2])],
    [Math.max(aMax[0], bMax[0]), Math.max(aMax[1], bMax[1]), Math.max(aMax[2], bMax[2])],
  );
}

function expandMinMax(
  min: [number, number, number],
  max: [number, number, number],
  aabb: LocalAABB,
): void {
  const [bMin, bMax] = minMaxFromAabb(aabb);
  min[0] = Math.min(min[0], bMin[0]);
  min[1] = Math.min(min[1], bMin[1]);
  min[2] = Math.min(min[2], bMin[2]);
  max[0] = Math.max(max[0], bMax[0]);
  max[1] = Math.max(max[1], bMax[1]);
  max[2] = Math.max(max[2], bMax[2]);
}

function intersectAabb(a: LocalAABB, b: LocalAABB): LocalAABB | null {
  const [aMin, aMax] = minMaxFromAabb(a);
  const [bMin, bMax] = minMaxFromAabb(b);
  const min: [number, number, number] = [
    Math.max(aMin[0], bMin[0]),
    Math.max(aMin[1], bMin[1]),
    Math.max(aMin[2], bMin[2]),
  ];
  const max: [number, number, number] = [
    Math.min(aMax[0], bMax[0]),
    Math.min(aMax[1], bMax[1]),
    Math.min(aMax[2], bMax[2]),
  ];
  if (min[0] > max[0] || min[1] > max[1] || min[2] > max[2]) return null;
  return fromMinMax(min, max);
}

function minMaxFromAabb(aabb: LocalAABB): [[number, number, number], [number, number, number]] {
  const c = aabb.center;
  const h = aabb.halfExtent;
  return [
    [c[0] - h[0], c[1] - h[1], c[2] - h[2]],
    [c[0] + h[0], c[1] + h[1], c[2] + h[2]],
  ];
}

function transformAabb(
  aabb: LocalAABB,
  transform: (point: [number, number, number]) => [number, number, number],
): LocalAABB {
  const [min, max] = minMaxFromAabb(aabb);
  const corners: Array<[number, number, number]> = [
    [min[0], min[1], min[2]], [min[0], min[1], max[2]],
    [min[0], max[1], min[2]], [min[0], max[1], max[2]],
    [max[0], min[1], min[2]], [max[0], min[1], max[2]],
    [max[0], max[1], min[2]], [max[0], max[1], max[2]],
  ];
  const pts = corners.map(transform);
  return fromMinMax(
    [
      Math.min(...pts.map(p => p[0])),
      Math.min(...pts.map(p => p[1])),
      Math.min(...pts.map(p => p[2])),
    ],
    [
      Math.max(...pts.map(p => p[0])),
      Math.max(...pts.map(p => p[1])),
      Math.max(...pts.map(p => p[2])),
    ],
  );
}

function rotatePoint(
  point: [number, number, number],
  angleDeg: number,
  origin: number[],
  axis: number[],
): [number, number, number] {
  const len = Math.hypot(axis[0], axis[1], axis[2]);
  const [ux, uy, uz] = [axis[0] / len, axis[1] / len, axis[2] / len];
  const a = (angleDeg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = point[0] - origin[0];
  const y = point[1] - origin[1];
  const z = point[2] - origin[2];
  const dot = ux * x + uy * y + uz * z;
  return [
    origin[0] + x * c + (uy * z - uz * y) * s + ux * dot * (1 - c),
    origin[1] + y * c + (uz * x - ux * z) * s + uy * dot * (1 - c),
    origin[2] + z * c + (ux * y - uy * x) * s + uz * dot * (1 - c),
  ];
}

function transformByOriginRpy(point: [number, number, number], origin: number[], rpy: number[]): [number, number, number] {
  const [r, p, y] = rpy;
  const cr = Math.cos(r); const sr = Math.sin(r);
  const cp = Math.cos(p); const sp = Math.sin(p);
  const cy = Math.cos(y); const sy = Math.sin(y);
  const [x, yy, z] = point;

  const rx = x;
  const ry = yy * cr - z * sr;
  const rz = yy * sr + z * cr;
  const px = rx * cp + rz * sp;
  const py = ry;
  const pz = -rx * sp + rz * cp;
  return [
    origin[0] + px * cy - py * sy,
    origin[1] + px * sy + py * cy,
    origin[2] + pz,
  ];
}

function mirrorPoint(point: [number, number, number], plane: string, origin: number[]): [number, number, number] {
  if (plane === 'XY') return [point[0], point[1], origin[2] * 2 - point[2]];
  if (plane === 'YZ') return [origin[0] * 2 - point[0], point[1], point[2]];
  return [point[0], origin[1] * 2 - point[1], point[2]];
}

function readCount(a: Arg | undefined): number | null {
  const raw = readNumber(a);
  if (raw === undefined) return null;
  const count = Math.round(raw);
  return Number.isFinite(count) && count >= 1 && count <= 128 ? count : null;
}

function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
  return a.value;
}
function readBool(a: Arg | undefined): boolean | undefined {
  if (!a || a.kind !== 'bool') return undefined;
  return a.value;
}
function readString(a: Arg | undefined): string | undefined {
  if (!a || a.kind !== 'string') return undefined;
  return a.value;
}
function readNumList(a: Arg | undefined, n: number): number[] | undefined {
  if (!a || a.kind !== 'list' || a.items.length !== n) return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return out;
}
function readAnyNumList(a: Arg | undefined): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  return out;
}

function readPathPoints(a: Arg | undefined): Array<readonly [number, number, number]> | null {
  const raw = readAnyNumList(a);
  if (!raw || raw.length < 6 || raw.length % 3 !== 0) return null;
  const out: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < raw.length; i += 3) out.push([raw[i], raw[i + 1], raw[i + 2]]);
  return out;
}

function readSectionPoints(a: Arg | undefined): Array<Array<readonly [number, number, number]>> | null {
  if (!a || a.kind !== 'list') return null;
  const sections: Array<Array<readonly [number, number, number]>> = [];
  for (const section of a.items) {
    const raw = readAnyNumList(section);
    if (!raw || raw.length < 9 || raw.length % 3 !== 0) return null;
    const pts: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < raw.length; i += 3) pts.push([raw[i], raw[i + 1], raw[i + 2]]);
    sections.push(pts);
  }
  return sections;
}
