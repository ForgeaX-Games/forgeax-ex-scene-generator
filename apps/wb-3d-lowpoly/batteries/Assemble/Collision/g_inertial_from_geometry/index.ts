/**
 * g_inertial_from_geometry —— 解析上游 part 引用的 shape，根据 mass 解析出
 * 惯性张量并追加 `id = inertial(link=<ref>, mass=..., ixx=..., iyy=..., izz=...)`。
 *
 * 解析公式（Inertial.from_geometry）：
 *   - box(size=[w, d, h])      → Ixx = m/12 * (d² + h²),  Iyy = m/12 * (w² + h²),  Izz = m/12 * (w² + d²)
 *   - cylinder(radius=r, length=l, axis=Z)
 *                              → Ixx = Iyy = m/12 * (3r² + l²),                    Izz = m*r²/2
 *   - sphere(radius=r)         → Ixx = Iyy = Izz = 2/5 * m * r²
 *   - capsule(radius=r, length=l)（轴 = Z；length = 圆柱段长度，不含两半球；总长 = l + 2r）
 *                              先按"圆柱 + 两半球"组合分别算然后用平行轴定理合并；
 *                              半球质心距胶囊中心 = l/2 + 3r/8 沿 Z
 *   - cone(radius=r, height=h)  实心圆锥（轴 = Z，底心位于 z=-h/2）
 *                              → Iz = (3/10) * m * r²,  Ix = Iy = (3/20) * m * (r² + h²/4)（绕过质心）
 *                              注意：按教科书公式来。
 *   - torus(R, r)               实心圆环（中线半径 R，截面半径 r，轴 = Z）
 *                              → Iz = m * (R² + 3/4 * r²),  Ix = Iy = m * (R²/2 + 5/8 * r²)
 *   - dome(radius=r, height=h)  视作半球（h ≈ r）：
 *                              → 全部三轴 = (2/5) m r² 的近似
 *
 * 复合 / 语义形状（clevis_bracket / spur_gear / union / array_radial / extrude / ...）：
 *   走 AABB 兜底——解析"形状 ref 链"后获得整体 AABB，等效为一块实心 box 套用 box 公式。
 *   关键修复：原版本只用 `localAabbFromShape`（叶子 AABB），对 `union(a,b) / extrude(profile,h)`
 *   这种组合 op 直接拿不到 size。现在改用 `localAabbFromShapeInGeometry`（递归解析），
 *   极大扩展自动惯量的覆盖面（CSG 链、阵列、profile→extrude/revolve 都能走通）。
 *
 * 用户也可以直接给完整 6 项；如果给了至少一项，自动模式被跳过、缺省项补 0。
 *
 * 注意：mesh 形状无法解析出张量（AABB 也拿不到尺寸）；只能由用户手填。
 */

import {
  emit,
  freshId,
  isValidId,
  localAabbFromShape,
  localAabbFromShapeInGeometry,
  makeGeometry,
  num,
  numList,
  ref,
  parseGeometryPort,
  type Arg,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

interface InertiaTensor {
  ixx: number;
  ixy: number;
  ixz: number;
  iyy: number;
  iyz: number;
  izz: number;
}

export function gInertialFromGeometry(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const partId = String(input.part_id ?? '').trim();
  if (!partId) return { geometry: incoming, id: '', error: 'part_id is required' };

  const byId = new Map<string, Statement>();
  for (const s of incoming.statements) byId.set(s.id, s);

  const part = byId.get(partId);
  if (!part) return { geometry: incoming, id: '', error: `part_id "${partId}" not in geometry` };
  if (part.op !== 'part') return { geometry: incoming, id: '', error: `id "${partId}" is op "${part.op}", expected "part"` };

  const mass = Number(input.mass ?? 0);
  if (!Number.isFinite(mass) || mass <= 0) {
    return { geometry: incoming, id: '', error: 'mass must be a positive finite number' };
  }

  const userTensor = readUserTensor(input);
  let tensor: InertiaTensor;
  let derivation = '';
  if (userTensor) {
    tensor = userTensor;
    derivation = 'manual';
  } else {
    const shapeRef = part.args.shape;
    if (!shapeRef || shapeRef.kind !== 'ref') {
      return { geometry: incoming, id: '', error: `part "${partId}" missing shape ref` };
    }
    const shape = byId.get(shapeRef.name);
    if (!shape) return { geometry: incoming, id: '', error: `shape "${shapeRef.name}" not in geometry` };
    const derived = inertiaFromShape(shape, mass, byId);
    if (!derived) {
      return {
        geometry: incoming, id: '',
        error: `cannot derive inertia from shape op "${shape.op}" (likely mesh or unknown op); provide ixx..izz manually`,
      };
    }
    tensor = derived.tensor;
    derivation = derived.method;
  }

  const args: Record<string, Arg> = {
    link: ref(partId),
    mass: num(mass),
    ixx:  num(tensor.ixx),
    ixy:  num(tensor.ixy),
    ixz:  num(tensor.ixz),
    iyy:  num(tensor.iyy),
    iyz:  num(tensor.iyz),
    izz:  num(tensor.izz),
  };

  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (ox !== 0 || oy !== 0 || oz !== 0) args.origin = numList([ox, oy, oz]);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'iner');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const next = emit(incoming, id, 'inertial', args);
  return { geometry: next, id, derivation };
}

function readUserTensor(input: Record<string, unknown>): InertiaTensor | null {
  const keys = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;
  const present = keys.some(k => input[k] !== undefined && input[k] !== '' && input[k] !== null);
  if (!present) return null;
  const out: InertiaTensor = { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 };
  for (const k of keys) {
    const raw = input[k];
    if (raw === undefined || raw === '' || raw === null) continue;
    const v = Number(raw);
    if (!Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

interface InertiaDerivation {
  tensor: InertiaTensor;
  /** 派生方式标签：'box' / 'cylinder' / 'sphere' / 'capsule' / 'cone' / 'torus' / 'dome' / 'aabb_fallback' */
  method: string;
}

function inertiaFromShape(
  shape: Statement,
  mass: number,
  byId: ReadonlyMap<string, Statement>,
): InertiaDerivation | null {
  switch (shape.op) {
    case 'box': {
      const size = readNumList(shape.args.size, 3);
      if (!size) return null;
      const [w, d, h] = size;
      return {
        tensor: boxTensor(mass, w, d, h),
        method: 'box',
      };
    }
    case 'cylinder': {
      const r = readNumber(shape.args.radius);
      const l = readNumber(shape.args.length);
      if (r === undefined || l === undefined) return null;
      const radial = (mass / 12) * (3 * r * r + l * l);
      const axial = (mass * r * r) / 2;
      return {
        tensor: { ixx: radial, ixy: 0, ixz: 0, iyy: radial, iyz: 0, izz: axial },
        method: 'cylinder',
      };
    }
    case 'sphere': {
      const r = readNumber(shape.args.radius);
      if (r === undefined) return null;
      const v = (2 / 5) * mass * r * r;
      return { tensor: diag(v), method: 'sphere' };
    }
    case 'capsule': {
      // g_capsule.length 与 baker/meta 保持一致：表示胶囊总长。
      // 圆柱段长 = max(0, totalLength - 2r)，两半球合体体积 = 一个球。
      const r = readNumber(shape.args.radius);
      const totalLength = readNumber(shape.args.length);
      if (r === undefined || totalLength === undefined || totalLength < 2 * r) return null;
      const bodyLength = Math.max(0, totalLength - 2 * r);
      const cylVol = Math.PI * r * r * bodyLength;
      const sphVol = (4 / 3) * Math.PI * r * r * r;
      const total = cylVol + sphVol;
      if (total <= 0) return null;
      const mCyl = mass * (cylVol / total);
      const mSph = mass * (sphVol / total);

      // 圆柱部分（绕中心，轴 = Z）
      const cylRadial = (mCyl / 12) * (3 * r * r + bodyLength * bodyLength);
      const cylAxial = (mCyl * r * r) / 2;

      // 两半球合并 = 一个实心球（绕球心）；两球心在 ±(bodyLength/2 + 3r/8) 沿 Z
      // 整球的中心惯量 = 2/5 m_sph r²；两个半球绕胶囊中心使用平行轴：
      //   每个半球质量 = mSph/2，单个半球绕"半球质心"的张量 ≈ 视作半球教科书值；
      //   工程上的简化是直接把"两半球"合在一起当作一个球放在中心，
      //   但更精确的 capsule（mujoco / pinocchio）做法：把两半球看作"位于 ±d 处的点质量 + 球壳"。
      // 这里取简化：两半球合并 = 一个实心球绕胶囊中心。
      const sphereTensor = (2 / 5) * mSph * r * r;

      return {
        tensor: {
          ixx: cylRadial + sphereTensor,
          ixy: 0,
          ixz: 0,
          iyy: cylRadial + sphereTensor,
          iyz: 0,
          izz: cylAxial + sphereTensor,
        },
        method: 'capsule',
      };
    }
    case 'cone': {
      // 实心圆锥，轴 = Z，公式取自标准刚体动力学：
      // 绕过质心：Iz = 3/10 m r²；Ix = Iy = m * (3 r² / 20 + 3 h² / 80)（轴向与底径耦合）
      const r = readNumber(shape.args.radius);
      const h = readNumber(shape.args.height);
      if (r === undefined || h === undefined) return null;
      const iz = (3 / 10) * mass * r * r;
      const radial = mass * ((3 * r * r) / 20 + (3 * h * h) / 80);
      return {
        tensor: { ixx: radial, ixy: 0, ixz: 0, iyy: radial, iyz: 0, izz: iz },
        method: 'cone',
      };
    }
    case 'torus': {
      // 实心圆环（圆截面），中线半径 R，截面半径 r，环面在 XY，轴 = Z。
      // 绕轴 Z：Iz = m (R² + 3/4 r²)
      // 绕径向（X 或 Y）：Ix = Iy = m (R²/2 + 5/8 r²)
      const R = readNumber(shape.args.major_radius);
      const r = readNumber(shape.args.minor_radius);
      if (R === undefined || r === undefined) return null;
      const iz = mass * (R * R + 0.75 * r * r);
      const radial = mass * (R * R * 0.5 + 0.625 * r * r);
      return {
        tensor: { ixx: radial, ixy: 0, ixz: 0, iyy: radial, iyz: 0, izz: iz },
        method: 'torus',
      };
    }
    case 'dome': {
      // 球冠；当 height ≈ radius 时是半球。
      // 简化：按 AABB 等效 box 兜底已经接近了，这里给个"实心半球"近似（绕过质心，轴 = Z）：
      //   Iz = 2/5 m r²；Ix = Iy = (83/320) m r²（半球绕过质心轴）
      // h < r 时退化到 AABB box（兜底），保持既有保守行为。
      const r = readNumber(shape.args.radius);
      const h = readNumber(shape.args.height);
      if (r === undefined || h === undefined) return null;
      if (Math.abs(h - r) <= r * 0.05) {
        const iz = (2 / 5) * mass * r * r;
        const ix = (83 / 320) * mass * r * r;
        return {
          tensor: { ixx: ix, ixy: 0, ixz: 0, iyy: ix, iyz: 0, izz: iz },
          method: 'dome',
        };
      }
      // 显著偏离半球 → 走 AABB 兜底
      return aabbFallback(shape, mass, byId);
    }
    default:
      return aabbFallback(shape, mass, byId);
  }
}

/**
 * 复合 / 语义形状（CSG / array / extrude / spur_gear / clevis_bracket / ...）：
 * 解析整体 AABB，套 box 公式当等效实心。先尝试递归 AABB（识别 union / array_radial /
 * extrude→profile 等组合 op），失败再退到叶子 AABB。
 */
function aabbFallback(
  shape: Statement,
  mass: number,
  byId: ReadonlyMap<string, Statement>,
): InertiaDerivation | null {
  const aabb = localAabbFromShapeInGeometry(shape, byId) ?? localAabbFromShape(shape);
  if (!aabb) return null;
  const w = aabb.halfExtent[0] * 2;
  const d = aabb.halfExtent[1] * 2;
  const h = aabb.halfExtent[2] * 2;
  return {
    tensor: boxTensor(mass, w, d, h),
    method: 'aabb_fallback',
  };
}

function boxTensor(mass: number, w: number, d: number, h: number): InertiaTensor {
  return {
    ixx: (mass / 12) * (d * d + h * h),
    ixy: 0,
    ixz: 0,
    iyy: (mass / 12) * (w * w + h * h),
    iyz: 0,
    izz: (mass / 12) * (w * w + d * d),
  };
}

function diag(v: number): InertiaTensor {
  return { ixx: v, ixy: 0, ixz: 0, iyy: v, iyz: 0, izz: v };
}

function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
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

export default gInertialFromGeometry;
