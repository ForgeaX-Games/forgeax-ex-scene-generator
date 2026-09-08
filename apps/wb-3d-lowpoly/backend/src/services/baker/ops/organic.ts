/**
 * sdf_blob —— 有机造型 op：多个 primitive（sphere/capsule/box/cone/ellipsoid）通过
 * smooth-union / subtract / intersect 组合成一个隐式标量场，再用真正的 Marching Cubes
 * （见 `../sdf/marching-cubes.ts`）提取等值面，产出单个连续三角网格。
 *
 * 与 `rock.ts` 一样直接产出 `MeshGeometry`（不走 OCCT 布尔管线）：该产物不能参与
 * union/difference/intersection/fillet/chamfer，继承 pipe/sweep/section_loft 的既有限制
 * （见 ARCHITECTURE 决策："不做/明确排除的范围"）。
 *
 * DSL 参数编码（`primitives`/`operations` 是嵌套 list，仿照 `architecture.ts` 的
 * `readQuadList` 风格——定长位置编码，不用 JSON 字符串）：
 *   primitives: list of 11-number/string tuples
 *     [type: str, id: str, cx, cy, cz, p0, p1, p2, rx, ry, rz]
 *     其中 p0..p2 按 type 解释：
 *       sphere    → [radius, _, _]
 *       capsule   → [radius, height, _]      （局部沿 Y 轴）
 *       box       → [sx, sy, sz]             （局部 AABB 全尺寸）
 *       cone      → [radius, height, _]      （局部沿 Y 轴，底大顶尖）
 *       ellipsoid → [rx, ry, rz]
 *     rx/ry/rz 是局部坐标系相对世界的 XYZ 欧拉旋转（弧度），未使用的分量填 0。
 *   operations: list of 5-number/string tuples
 *     [type: str, id: str, left: str, right: str, radius]
 *     left/right 引用一个更早声明的 primitive 或 operation id；radius 仅 smooth-union
 *     使用（subtract/intersect 忽略，但位置仍必须填一个有限数，约定填 0）。
 *   resolution: number，默认 32，范围 [4, 64]。
 *   bounds: 可选 [minx,miny,minz,maxx,maxy,maxz]；省略时按 primitives 的包围盒外扩推导。
 */
import type { MeshGeometry } from '../types.js';
import { BakerError } from '../errors.js';
import type { Arg } from '../shared-types.js';
import { optionalNumber, readNumList } from '../arg_readers.js';
import { compileSdf } from '../sdf/combine.js';
import { marchingCubes } from '../sdf/marching-cubes.js';
import {
  SDF_LIMITS,
  SDF_OPERATION_TYPES,
  SDF_PRIMITIVE_TYPES,
  type SdfBounds,
  type SdfDescriptor,
  type SdfOperationSpec,
  type SdfOperationType,
  type SdfPrimitiveSpec,
  type SdfPrimitiveType,
  type SdfVector,
} from '../sdf/types.js';

const PRIMITIVE_TUPLE_LEN = 11;
const OPERATION_TUPLE_LEN = 5;

export function sdfBlob(_ctx: unknown, args: Record<string, Arg>): MeshGeometry {
  const primitives = readPrimitiveList(args.primitives);
  if (primitives.length === 0) {
    throw new BakerError('sdf_blob: "primitives" is required and must contain at least 1 primitive');
  }
  if (primitives.length > SDF_LIMITS.maxPrimitives) {
    throw new BakerError(`sdf_blob: primitives.length=${primitives.length} exceeds limit ${SDF_LIMITS.maxPrimitives}`);
  }

  const operations = readOperationList(args.operations);
  if (operations.length > SDF_LIMITS.maxOperations) {
    throw new BakerError(`sdf_blob: operations.length=${operations.length} exceeds limit ${SDF_LIMITS.maxOperations}`);
  }

  const resolutionRaw = optionalNumber(args, 'resolution', 32);
  const resolution = Math.round(resolutionRaw);
  if (
    !Number.isFinite(resolution) ||
    resolution < SDF_LIMITS.minResolution ||
    resolution > SDF_LIMITS.maxResolution
  ) {
    throw new BakerError(
      `sdf_blob: resolution must be an integer in [${SDF_LIMITS.minResolution}, ${SDF_LIMITS.maxResolution}] (got ${resolutionRaw})`,
    );
  }

  const bounds = readBounds(args.bounds) ?? deriveBounds(primitives);

  const descriptor: SdfDescriptor = { primitives, operations, resolution, bounds };
  const sample = compileSdf(descriptor);
  return marchingCubes(sample, { bounds, resolution });
}

// ── primitives / operations 读取 ──────────────────────────────────────

function isPrimitiveType(s: string): s is SdfPrimitiveType {
  return (SDF_PRIMITIVE_TYPES as readonly string[]).includes(s);
}

function isOperationType(s: string): s is SdfOperationType {
  return (SDF_OPERATION_TYPES as readonly string[]).includes(s);
}

/**
 * 读取单个定长 tuple（list of Arg）：`stringSlots` 指定哪些位置必须是 string
 * （primitives 是 [0,1]=type/id；operations 是 [0,1,2,3]=type/id/left/right），
 * 其余位置必须是 finite number。
 */
function readTuple(item: Arg, len: number, stringSlots: readonly number[], what: string): (string | number)[] {
  if (item.kind !== 'list' || item.items.length !== len) {
    throw new BakerError(`sdf_blob: each ${what} must be a list of exactly ${len} values`);
  }
  const isStringSlot = new Set(stringSlots);
  return item.items.map((v, i) => {
    if (isStringSlot.has(i)) {
      if (v.kind !== 'string') throw new BakerError(`sdf_blob: ${what}[${i}] must be a string`);
      return v.value;
    }
    if (v.kind !== 'number' || !Number.isFinite(v.value)) {
      throw new BakerError(`sdf_blob: ${what}[${i}] must be a finite number`);
    }
    return v.value;
  });
}

function readPrimitiveList(arg: Arg | undefined): SdfPrimitiveSpec[] {
  if (!arg) return [];
  if (arg.kind !== 'list') throw new BakerError('sdf_blob: "primitives" must be a list');
  const seenIds = new Set<string>();
  return arg.items.map((item) => {
    const tuple = readTuple(item, PRIMITIVE_TUPLE_LEN, [0, 1], 'primitive');
    const type = tuple[0] as string;
    const id = tuple[1] as string;
    if (!isPrimitiveType(type)) {
      throw new BakerError(`sdf_blob: unknown primitive type "${type}" (expected one of ${SDF_PRIMITIVE_TYPES.join('/')})`);
    }
    if (!id) throw new BakerError('sdf_blob: primitive id must be a non-empty string');
    if (seenIds.has(id)) throw new BakerError(`sdf_blob: duplicate primitive id "${id}"`);
    seenIds.add(id);
    const center: SdfVector = [tuple[2] as number, tuple[3] as number, tuple[4] as number];
    const params: SdfVector = [tuple[5] as number, tuple[6] as number, tuple[7] as number];
    const rotation: SdfVector = [tuple[8] as number, tuple[9] as number, tuple[10] as number];
    validatePrimitiveParams(type, id, params);
    return { id, type, center, params, rotation };
  });
}

function validatePrimitiveParams(type: SdfPrimitiveType, id: string, params: SdfVector): void {
  switch (type) {
    case 'sphere':
      if (!(params[0] > 0)) throw new BakerError(`sdf_blob: primitive "${id}" (sphere) radius must be positive`);
      break;
    case 'capsule':
      if (!(params[0] > 0) || !(params[1] >= 0)) {
        throw new BakerError(`sdf_blob: primitive "${id}" (capsule) needs radius > 0 and height ≥ 0`);
      }
      break;
    case 'box':
      if (!params.every((p) => p > 0)) throw new BakerError(`sdf_blob: primitive "${id}" (box) size components must be positive`);
      break;
    case 'cone':
      if (!(params[0] > 0) || !(params[1] > 0)) {
        throw new BakerError(`sdf_blob: primitive "${id}" (cone) needs radius > 0 and height > 0`);
      }
      break;
    case 'ellipsoid':
      if (!params.every((p) => p > 0)) throw new BakerError(`sdf_blob: primitive "${id}" (ellipsoid) radii must be positive`);
      break;
  }
}

function readOperationList(arg: Arg | undefined): SdfOperationSpec[] {
  if (!arg) return [];
  if (arg.kind !== 'list') throw new BakerError('sdf_blob: "operations" must be a list');
  const seenIds = new Set<string>();
  return arg.items.map((item) => {
    const tuple = readTuple(item, OPERATION_TUPLE_LEN, [0, 1, 2, 3], 'operation');
    const type = tuple[0] as string;
    const id = tuple[1] as string;
    const left = tuple[2] as string;
    const right = tuple[3] as string;
    const radius = tuple[4] as number;
    if (!isOperationType(type)) {
      throw new BakerError(`sdf_blob: unknown operation type "${type}" (expected one of ${SDF_OPERATION_TYPES.join('/')})`);
    }
    if (!id) throw new BakerError('sdf_blob: operation id must be a non-empty string');
    if (seenIds.has(id)) throw new BakerError(`sdf_blob: duplicate operation id "${id}"`);
    seenIds.add(id);
    if (!left || !right) throw new BakerError(`sdf_blob: operation "${id}" needs non-empty left/right ids`);
    if (type === 'smooth-union' && !(radius >= 0)) {
      throw new BakerError(`sdf_blob: operation "${id}" (smooth-union) radius must be ≥ 0`);
    }
    return { id, type, left, right, radius };
  });
}

function readBounds(arg: Arg | undefined): SdfBounds | undefined {
  const vals = readNumList(arg, 6);
  if (!vals) return undefined;
  const [minx, miny, minz, maxx, maxy, maxz] = vals;
  if (maxx <= minx || maxy <= miny || maxz <= minz) {
    throw new BakerError('sdf_blob: bounds max must be strictly greater than min on every axis');
  }
  return { min: [minx, miny, minz], max: [maxx, maxy, maxz] };
}

/** 未显式给 bounds 时：按每个 primitive 的局部外接半径外扩其中心点，取并集再加 10% padding。 */
function deriveBounds(primitives: readonly SdfPrimitiveSpec[]): SdfBounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of primitives) {
    const r = primitiveOuterRadius(p);
    minX = Math.min(minX, p.center[0] - r);
    minY = Math.min(minY, p.center[1] - r);
    minZ = Math.min(minZ, p.center[2] - r);
    maxX = Math.max(maxX, p.center[0] + r);
    maxY = Math.max(maxY, p.center[1] + r);
    maxZ = Math.max(maxZ, p.center[2] + r);
  }
  const pad = (v: number) => v * 0.1;
  const padX = Math.max(pad(maxX - minX), 1e-3);
  const padY = Math.max(pad(maxY - minY), 1e-3);
  const padZ = Math.max(pad(maxZ - minZ), 1e-3);
  return {
    min: [minX - padX, minY - padY, minZ - padZ],
    max: [maxX + padX, maxY + padY, maxZ + padZ],
  };
}

/** primitive 局部外接球半径的保守估计（旋转不改变外接球半径，只需局部尺寸）。 */
function primitiveOuterRadius(p: SdfPrimitiveSpec): number {
  switch (p.type) {
    case 'sphere':
      return p.params[0];
    case 'capsule':
      return p.params[0] + p.params[1] * 0.5;
    case 'box':
      return Math.sqrt(p.params[0] ** 2 + p.params[1] ** 2 + p.params[2] ** 2) * 0.5;
    case 'cone':
      return Math.max(p.params[0], p.params[1] * 0.5);
    case 'ellipsoid':
      return Math.max(p.params[0], p.params[1], p.params[2]);
  }
}
