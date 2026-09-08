/**
 * g_sdf_blob —— 在 Geometry DSL 末尾追加一行
 * `id = sdf_blob(primitives=[...], operations=[...], resolution=..., bounds=[...])`。
 *
 * 有机造型：多个 primitive（sphere/capsule/box/cone/ellipsoid）用 smooth-union/subtract/
 * intersect 组合成一个隐式标量场，再用真正的 Marching Cubes 提取等值面（见
 * `backend/src/services/baker/ops/organic.ts`）。用于怪物躯干/根须/融合肌肉块这类需要
 * 多个基础体平滑融合成一个连续有机体的场景——常规倒角继续用 g_fillet。
 *
 * `primitives`/`operations` 输入端口接受 JSON 字符串（或已解析的数组），每项是定长
 * position-encoded tuple（与 `dsl-to-graph.ts` 的 'json' 编码 / `organic.ts` 的
 * `readTuple` 一一对应，不是 `{type,id,...}` 对象——同 g_wall.openings/g_floor_slab.holes
 * 的既有约定，保证 DSL↔图↔电池的往返不需要额外转换）：
 *   primitive tuple  (11) = [type, id, cx, cy, cz, p0, p1, p2, rx, ry, rz]
 *   operation tuple  (5)  = [type, id, left, right, radius]
 */
import {
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const PRIMITIVE_TYPES = new Set(['sphere', 'capsule', 'box', 'cone', 'ellipsoid']);
const OPERATION_TYPES = new Set(['smooth-union', 'subtract', 'intersect']);
const PRIMITIVE_TUPLE_LEN = 11;
const OPERATION_TUPLE_LEN = 5;

function parseJsonOrArray(value: unknown): unknown[] | { error: string } {
  if (value === undefined || value === null || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      return { error: 'must be valid JSON' };
    }
  }
  if (!Array.isArray(parsed)) return { error: 'must be an array' };
  return parsed;
}

function primitiveTupleToArg(raw: unknown, index: number): Arg | { error: string } {
  if (!Array.isArray(raw) || raw.length !== PRIMITIVE_TUPLE_LEN) {
    return { error: `primitives[${index}] must be a ${PRIMITIVE_TUPLE_LEN}-element array [type,id,cx,cy,cz,p0,p1,p2,rx,ry,rz]` };
  }
  const [type, id, ...rest] = raw;
  if (typeof type !== 'string' || !PRIMITIVE_TYPES.has(type)) {
    return { error: `primitives[${index}]: type must be one of sphere/capsule/box/cone/ellipsoid (got "${type}")` };
  }
  if (typeof id !== 'string' || id.trim() === '') {
    return { error: `primitives[${index}]: id must be a non-empty string` };
  }
  const nums = rest.map(Number);
  if (!nums.every(Number.isFinite)) {
    return { error: `primitives[${index}] ("${id}"): cx/cy/cz/p0/p1/p2/rx/ry/rz must all be finite numbers` };
  }
  return list([str(type), str(id), ...nums.map((n) => num(n))]);
}

function operationTupleToArg(raw: unknown, index: number): Arg | { error: string } {
  if (!Array.isArray(raw) || raw.length !== OPERATION_TUPLE_LEN) {
    return { error: `operations[${index}] must be a ${OPERATION_TUPLE_LEN}-element array [type,id,left,right,radius]` };
  }
  const [type, id, left, right, radius] = raw;
  if (typeof type !== 'string' || !OPERATION_TYPES.has(type)) {
    return { error: `operations[${index}]: type must be one of smooth-union/subtract/intersect (got "${type}")` };
  }
  if (typeof id !== 'string' || id.trim() === '') return { error: `operations[${index}]: id must be a non-empty string` };
  if (typeof left !== 'string' || left.trim() === '' || typeof right !== 'string' || right.trim() === '') {
    return { error: `operations[${index}] ("${id}"): left/right must be non-empty strings` };
  }
  const radiusNum = Number(radius);
  if (!Number.isFinite(radiusNum)) return { error: `operations[${index}] ("${id}"): radius must be a finite number` };
  return list([str(type), str(id), str(left), str(right), num(radiusNum)]);
}

export function gSdfBlob(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const primitivesRaw = parseJsonOrArray(input.primitives);
  if (!Array.isArray(primitivesRaw)) return fail(`sdf_blob: primitives ${primitivesRaw.error}`);
  if (primitivesRaw.length === 0) return fail('sdf_blob: primitives must contain at least 1 primitive');
  if (primitivesRaw.length > 64) return fail(`sdf_blob: primitives.length=${primitivesRaw.length} exceeds limit 64`);

  const primitiveArgs: Arg[] = [];
  for (let i = 0; i < primitivesRaw.length; i += 1) {
    const converted = primitiveTupleToArg(primitivesRaw[i], i);
    if (!Array.isArray(converted) && 'error' in converted) return fail(`sdf_blob: ${converted.error}`);
    primitiveArgs.push(converted as Arg);
  }

  const operationsRaw = parseJsonOrArray(input.operations);
  if (!Array.isArray(operationsRaw)) return fail(`sdf_blob: operations ${operationsRaw.error}`);
  if (operationsRaw.length > 128) return fail(`sdf_blob: operations.length=${operationsRaw.length} exceeds limit 128`);

  const operationArgs: Arg[] = [];
  for (let i = 0; i < operationsRaw.length; i += 1) {
    const converted = operationTupleToArg(operationsRaw[i], i);
    if (!Array.isArray(converted) && 'error' in converted) return fail(`sdf_blob: ${converted.error}`);
    operationArgs.push(converted as Arg);
  }

  const resolution = Number(input.resolution ?? 32);
  if (!Number.isFinite(resolution) || resolution < 4 || resolution > 64) {
    return fail(`sdf_blob: resolution must be in [4, 64] (got ${input.resolution})`);
  }

  const args: Record<string, Arg> = {
    primitives: list(primitiveArgs),
    resolution: num(Math.round(resolution)),
  };
  if (operationArgs.length > 0) args.operations = list(operationArgs);

  const boundsRaw = parseJsonOrArray(input.bounds);
  if (Array.isArray(boundsRaw) && boundsRaw.length === 6) {
    const nums = boundsRaw.map(Number);
    if (nums.every(Number.isFinite)) args.bounds = numList(nums);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'blob');
  if (!isValidId(id)) return fail(`invalid id "${id}"`);

  const next = emit(incoming, id, 'sdf_blob', args);
  return { geometry: next, id, error: '' };
}

export default gSdfBlob;
