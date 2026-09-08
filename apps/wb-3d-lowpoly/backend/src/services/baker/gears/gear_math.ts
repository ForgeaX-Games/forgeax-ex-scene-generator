/**
 * Gear math —— 渐开线齿廓的纯数学计算（不依赖 replicad/OCCT）。
 *
 * SpurGear / RingGear / RackGear 初始化部分的 TypeScript 实现。
 * 返回 2D 多边形点列，由上层用 replicad `draw(...)`
 * 拼成 Drawing，再 `sketchOnPlane('XY').extrude(width, { twistAngle })` 成 Shape3D。
 *
 * 设计要点：
 *   - 输入采用 SI 公制（米），注意 module=0.001 对应 1mm 模数
 *   - 渐开线用 20 个等距径向点近似
 *   - 齿根用 3 点圆弧近似（cq_gears 同款）
 *   - 单齿模板按 CCW 顺序：左齿面 → 齿顶 → 右齿面 → 齿根
 *     完整轮廓 = z 个齿模板按 tau 角度旋转拼接
 *   - 二维点用 [x, y] 元组（Point2D），与 replicad `draw` 一致
 */

export type Point2D = readonly [number, number];

/** 单齿 4 段轮廓：左齿面 → 齿顶 → 右齿面 → 齿根；CCW 顺序。 */
export interface ToothOutline {
  readonly lflank: Point2D[];
  readonly tip: Point2D[];
  readonly rflank: Point2D[];
  readonly root: Point2D[];
}

/** SpurGear / HerringboneGear / CrossedHelicalGear / HyperbolicGear 共用规格。 */
export interface SpurGearSpec {
  readonly module: number;
  readonly teethNumber: number;
  readonly width: number;
  readonly pressureAngleDeg: number;
  readonly helixAngleDeg: number;
  readonly clearance: number;
  readonly backlash: number;
  /** addendum 系数；默认 1.0 */
  readonly addCoeff: number;
  /** dedendum 系数；默认 1.25 */
  readonly dedCoeff: number;
}

export interface SpurGearGeom {
  /** 节圆半径 */
  readonly r0: number;
  /** 齿顶圆半径（外径） */
  readonly ra: number;
  /** 齿根圆半径 */
  readonly rd: number;
  /** 基圆半径 */
  readonly rb: number;
  /** 渐开线起始半径 = max(rb, rd) */
  readonly rr: number;
  /** 单个齿角度间距（弧度） */
  readonly tau: number;
  /** 从底面到顶面绕 Z 的扭转角度（弧度）；helix=0 时为 0 */
  readonly twistAngle: number;
  /** 单齿轮廓（CCW，z=0 平面，未旋转） */
  readonly toothOutline: ToothOutline;
}

export const SPUR_DEFAULTS = {
  pressureAngleDeg: 20.0,
  helixAngleDeg: 0.0,
  clearance: 0.0,
  backlash: 0.0,
  addCoeff: 1.0,
  dedCoeff: 1.25,
};

const CURVE_POINTS = 20; // 渐开线采样点数

// ── 内部数学助手 ────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * 给三点 p1,p2,p3（均在 XY 平面，z=0），找拟合圆的 (半径, 圆心)。
 * 用于齿根的圆弧拟合。1:1 复刻 `circle3d_by3points`（取 z 分量为 0）。
 */
function circle2dBy3Points(
  p1: Point2D, p2: Point2D, p3: Point2D,
): { radius: number; center: Point2D } {
  const ax = p1[0], ay = p1[1];
  const bx = p2[0], by = p2[1];
  const cx = p3[0], cy = p3[1];

  // 转 a 为原点：u = (b-a) 归一化为正 X；v 与 u 垂直、与 c-a 异号同侧
  const ux = bx - ax, uy = by - ay;
  const uLen = Math.hypot(ux, uy);
  const u: Point2D = [ux / uLen, uy / uLen];
  // 在 2D 中，v = 把 u 旋转 +90°（左侧）
  const v: Point2D = [-u[1], u[0]];

  const bX = (bx - ax) * u[0] + (by - ay) * u[1]; // = uLen
  const cX = (cx - ax) * u[0] + (cy - ay) * u[1];
  const cY = (cx - ax) * v[0] + (cy - ay) * v[1];

  // p3 与 ab 同侧时 cY != 0；为避免 div0 加 epsilon
  const sign = cY >= 0 ? 1 : -1;
  const denom = 2.0 * cY;
  const h = ((cX - bX / 2.0) ** 2 + cY ** 2 - (bX / 2.0) ** 2) / denom;
  void sign;

  const ccx = ax + u[0] * (bX / 2.0) + v[0] * h;
  const ccy = ay + u[1] * (bX / 2.0) + v[1] * h;
  const radius = Math.hypot(ax - ccx, ay - ccy);
  return { radius, center: [ccx, ccy] };
}

/** linspace 等价 */
function linspace(start: number, stop: number, n: number): number[] {
  if (n <= 1) return [start];
  const step = (stop - start) / (n - 1);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = start + i * step;
  return out;
}

// ── SpurGear 几何计算 ────────────────────────────────────────────────

/**
 * 1:1 移植 cq_gears `SpurGear.__init__` 的渐开线 + 齿根计算。
 * 返回单齿轮廓与关键半径；不创建任何 OCCT 对象。
 */
export function computeSpurGearGeom(spec: SpurGearSpec): SpurGearGeom {
  const m = spec.module;
  const z = spec.teethNumber;
  const a0 = (spec.pressureAngleDeg * Math.PI) / 180;
  const helixRad = (spec.helixAngleDeg * Math.PI) / 180;

  const d0 = m * z;
  const adn = spec.addCoeff * m;       // = ka / (z/d0) = ka * m
  const ddn = spec.dedCoeff * m;       // = kd * m
  if (2.0 * ddn + 2.0 * spec.clearance >= d0) {
    throw new Error(
      `gear: dedendum + clearance >= pitch radius (m=${m}, z=${z}, clearance=${spec.clearance})`,
    );
  }

  const da = d0 + 2.0 * adn;
  const dd = d0 - 2.0 * ddn - 2.0 * spec.clearance;
  const s0 = m * (Math.PI / 2.0 - spec.backlash * Math.tan(a0));
  const invA0 = Math.tan(a0) - a0;

  const r0 = d0 / 2.0;
  const ra = da / 2.0;
  const rd = dd / 2.0;
  const rb = Math.cos(a0) * d0 / 2.0;
  const rr = Math.max(rb, rd);
  const tau = (Math.PI * 2.0) / z;

  // 扭转角：helix=0 时 0；否则按 cq_gears 公式
  let twistAngle = 0;
  if (Math.abs(spec.helixAngleDeg) > 1e-9) {
    twistAngle = spec.width / (r0 * Math.tan(Math.PI / 2.0 - helixRad));
  }

  // ── 单齿 4 段曲线 ──
  // 左齿面（lflank）：渐开线，从 rr 到 ra
  const rArr = linspace(rr, ra, CURVE_POINTS);
  const phiArr: number[] = new Array(CURVE_POINTS);
  const lflank: Point2D[] = new Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const r = rArr[i];
    const cosA = clamp(r0 / r * Math.cos(a0), -1.0, 1.0);
    const a = Math.acos(cosA);
    const invA = Math.tan(a) - a;
    const s = r * (s0 / d0 + invA0 - invA);
    const phi = s / r;
    phiArr[i] = phi;
    lflank[i] = [Math.cos(phi) * r, Math.sin(phi) * r];
  }

  // 齿顶（tip）：从 phi[-1] 到 -phi[-1] 的圆弧（在 ra 上）
  const phiTip = phiArr[CURVE_POINTS - 1];
  const bArr = linspace(phiTip, -phiTip, CURVE_POINTS);
  const tip: Point2D[] = bArr.map((b) => [Math.cos(b) * ra, Math.sin(b) * ra]);

  // 右齿面（rflank）：lflank 镜像（绕 X 轴），并反向（CCW 闭合）
  const rflank: Point2D[] = new Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const idx = CURVE_POINTS - 1 - i;
    const phi = phiArr[idx];
    const r = rArr[idx];
    rflank[i] = [Math.cos(-phi) * r, Math.sin(-phi) * r];
  }

  // 齿根（root）：从右齿面末点到下一齿左齿面起点的 3 点圆弧
  const rho = tau - phiArr[0] * 2.0;
  const p1: Point2D = [rflank[CURVE_POINTS - 1][0], rflank[CURVE_POINTS - 1][1]];
  const p2: Point2D = [
    Math.cos(-phiArr[0] - rho / 2.0) * rd,
    Math.sin(-phiArr[0] - rho / 2.0) * rd,
  ];
  const p3: Point2D = [
    Math.cos(-phiArr[0] - rho) * rr,
    Math.sin(-phiArr[0] - rho) * rr,
  ];

  const { radius: bcr, center: bcxy } = circle2dBy3Points(p1, p2, p3);
  // 用 atan2 找两端点对应圆弧角度，并沿 CCW 方向取插值
  let t1 = Math.atan2(p1[1] - bcxy[1], p1[0] - bcxy[0]);
  let t2 = Math.atan2(p3[1] - bcxy[1], p3[0] - bcxy[0]);
  if (t1 < 0) t1 += Math.PI * 2;
  if (t2 < 0) t2 += Math.PI * 2;
  const tMin = Math.min(t1, t2);
  const tMax = Math.max(t1, t2);
  // 选 (t1+2pi, t2+2pi)，方向保证圆弧"凹向中心"
  const tArr = linspace(tMin + Math.PI * 2.0, tMax + Math.PI * 2.0, CURVE_POINTS);
  const root: Point2D[] = tArr.map((t) => [
    bcxy[0] + bcr * Math.cos(t),
    bcxy[1] + bcr * Math.sin(t),
  ]);

  return {
    r0, ra, rd, rb, rr, tau, twistAngle,
    toothOutline: { lflank, tip, rflank, root },
  };
}

// ── RingGear 几何计算 ───────────────────────────────────────────────

export interface RingGearSpec extends SpurGearSpec {
  /** 齿根圆外的额外径向壁厚 */
  readonly rimWidth: number;
}

export interface RingGearGeom extends Omit<SpurGearGeom, 'ra' | 'rd'> {
  /** 内齿圈：齿顶圆是内径（小） */
  readonly ra: number;
  /** 内齿圈：齿根圆是外径（大） */
  readonly rd: number;
  /** 外壳半径（齿根外加 rim_width） */
  readonly rimR: number;
}

/** 1:1 移植 cq_gears `RingGear.__init__` 渐开线 + 齿根。 */
export function computeRingGearGeom(spec: RingGearSpec): RingGearGeom {
  const m = spec.module;
  const z = spec.teethNumber;
  const a0 = (spec.pressureAngleDeg * Math.PI) / 180;
  const helixRad = (spec.helixAngleDeg * Math.PI) / 180;

  const d0 = m * z;
  const adn = spec.addCoeff * m;
  const ddn = spec.dedCoeff * m;
  const da = d0 - 2.0 * adn;
  const dd = d0 + 2.0 * ddn + 2.0 * spec.clearance;
  const s0 = m * (Math.PI / 2.0 + spec.backlash * Math.tan(a0));
  const invA0 = Math.tan(a0) - a0;

  const r0 = d0 / 2.0;
  const ra = da / 2.0;
  const rd = dd / 2.0;
  const rb = Math.cos(a0) * d0 / 2.0;
  const rr = Math.max(rb, rd);
  const tau = (Math.PI * 2.0) / z;

  let twistAngle = 0;
  if (Math.abs(spec.helixAngleDeg) > 1e-9) {
    twistAngle = spec.width / (r0 * Math.tan(Math.PI / 2.0 - helixRad));
  }

  const rimR = rd + spec.rimWidth;

  // 渐开线：r 从 ra → rr（反向，因为内齿圈齿尖向内）
  const rArr = linspace(ra, rr, CURVE_POINTS);
  const phiArr: number[] = new Array(CURVE_POINTS);
  const lflank: Point2D[] = new Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const r = rArr[i];
    const cosA = clamp(r0 / r * Math.cos(a0), -1.0, 1.0);
    const a = Math.acos(cosA);
    const invA = Math.tan(a) - a;
    const s = r * (s0 / d0 + invA0 - invA);
    const phi = s / r;
    phiArr[i] = phi;
    lflank[i] = [Math.cos(phi) * r, Math.sin(phi) * r];
  }

  // 齿顶（tip 这里其实是齿尖 ring 内侧）：phi[-1] → -phi[-1] 圆弧，半径 rd（内齿圈）
  const phiTip = phiArr[CURVE_POINTS - 1];
  const bArr = linspace(phiTip, -phiTip, CURVE_POINTS);
  const tip: Point2D[] = bArr.map((b) => [Math.cos(b) * rd, Math.sin(b) * rd]);

  // 右齿面（rflank）：lflank 镜像反向
  const rflank: Point2D[] = new Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const idx = CURVE_POINTS - 1 - i;
    const phi = phiArr[idx];
    const r = rArr[idx];
    rflank[i] = [Math.cos(-phi) * r, Math.sin(-phi) * r];
  }

  // 齿根（root）：cq_gears 用 t2→t1 反向插值（CCW 反向）
  const rho = tau - phiArr[0] * 2.0;
  const p1: Point2D = [rflank[CURVE_POINTS - 1][0], rflank[CURVE_POINTS - 1][1]];
  const p2: Point2D = [
    Math.cos(-phiArr[0] - rho / 2.0) * ra,
    Math.sin(-phiArr[0] - rho / 2.0) * ra,
  ];
  const p3: Point2D = [
    Math.cos(-phiArr[0] - rho) * ra,
    Math.sin(-phiArr[0] - rho) * ra,
  ];
  const { radius: bcr, center: bcxy } = circle2dBy3Points(p1, p2, p3);
  let t1 = Math.atan2(p1[1] - bcxy[1], p1[0] - bcxy[0]);
  let t2 = Math.atan2(p3[1] - bcxy[1], p3[0] - bcxy[0]);
  if (t1 < 0) t1 += Math.PI * 2;
  if (t2 < 0) t2 += Math.PI * 2;
  const tMin = Math.min(t1, t2);
  const tMax = Math.max(t1, t2);
  // ring 用 (t2+2pi → t1+2pi)（注意是 max → min，与 spur 反向）
  const tArr = linspace(tMax + Math.PI * 2.0, tMin + Math.PI * 2.0, CURVE_POINTS);
  const root: Point2D[] = tArr.map((t) => [
    bcxy[0] + bcr * Math.cos(t),
    bcxy[1] + bcr * Math.sin(t),
  ]);

  return {
    r0, ra, rd, rb, rr, tau, twistAngle, rimR,
    toothOutline: { lflank, tip, rflank, root },
  };
}

// ── RackGear 几何计算 ───────────────────────────────────────────────

export interface RackGearSpec {
  readonly module: number;
  readonly length: number;
  readonly width: number;
  readonly height: number;
  readonly pressureAngleDeg: number;
  readonly helixAngleDeg: number;
  readonly clearance: number;
  readonly backlash: number;
  readonly addCoeff: number;
  readonly dedCoeff: number;
}

export interface RackGearGeom {
  /** 单齿 5 点：p1=左根, p2=左齿顶, p3=右齿顶, p4=右根, p5=下个齿左根（== p1 + pi*m, 0） */
  readonly toothPoints: readonly [Point2D, Point2D, Point2D, Point2D, Point2D];
  /** 齿数（length 能容下的最大整数齿数） */
  readonly z: number;
  /** 齿廓周期长度 = pi * module */
  readonly pitch: number;
  /** 齿根负向偏移 = ld */
  readonly ld: number;
  /** 齿顶正向偏移 = la */
  readonly la: number;
}

/** 1:1 移植 cq_gears `RackGear.__init__`。 */
export function computeRackGearGeom(spec: RackGearSpec): RackGearGeom {
  const m = spec.module;
  const a0 = (spec.pressureAngleDeg * Math.PI) / 180;

  const adn = spec.addCoeff * m;
  const ddn = spec.dedCoeff * m;
  const la = adn;
  const ld = -(ddn + spec.clearance);
  const s0 = (m * (Math.PI / 2.0 - spec.backlash * Math.tan(a0))) / 2.0;

  const p1x = Math.tan(a0) * Math.abs(ld);
  const p1p2 = (Math.abs(la) + Math.abs(ld)) / Math.cos(a0);
  const p1: Point2D = [-s0 - p1x, ld];
  const p2: Point2D = [Math.sin(a0) * p1p2 + p1[0], Math.cos(a0) * p1p2 + p1[1]];
  const p3: Point2D = [-p2[0], p2[1]];
  const p4: Point2D = [-p1[0], p1[1]];
  const pitch = Math.PI * m;
  const p5: Point2D = [p4[0] + (pitch - p4[0] * 2.0), p4[1]];

  const z = Math.max(1, Math.ceil(spec.length / pitch));

  return {
    toothPoints: [p1, p2, p3, p4, p5],
    z,
    pitch,
    ld,
    la,
  };
}

// ── 通用：把单齿轮廓拼成完整齿轮轮廓 ───────────────────────────────

/**
 * 把 1 个齿的轮廓按 tau 角度复制 z 份并旋转拼成完整轮廓多边形。
 * 返回的点列已经是闭合多边形（首尾会被 replicad `.close()` 自动连）。
 */
export function buildGearOutline(
  tooth: ToothOutline,
  z: number,
  tau: number,
): Point2D[] {
  const single: Point2D[] = [
    ...tooth.lflank,
    ...tooth.tip,
    ...tooth.rflank,
    ...tooth.root,
  ];
  const out: Point2D[] = [];
  for (let i = 0; i < z; i++) {
    const angle = tau * i;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    for (const [x, y] of single) {
      out.push([ca * x - sa * y, sa * x + ca * y]);
    }
  }
  return out;
}

/**
 * 渐开线起始有限点列里去重相邻"近重合"点，避免 replicad polyline 出现 0 长度 edge。
 * 容差用 1e-9（米），远小于一般 mesh 精度。
 */
export function dedupAdjacent(points: Point2D[], tol = 1e-9): Point2D[] {
  if (points.length === 0) return points;
  const out: Point2D[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const last = out[out.length - 1];
    const dx = points[i][0] - last[0];
    const dy = points[i][1] - last[1];
    if (Math.hypot(dx, dy) > tol) out.push(points[i]);
  }
  return out;
}
