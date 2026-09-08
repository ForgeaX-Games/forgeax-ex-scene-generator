/**
 * g_bone —— 在 Geometry DSL 末尾追加一行 `id = bone(origin=[x,y,z], ...)`。
 *
 * 角色骨架的一根骨（自由变换，不带 URDF 轴/限位）：
 *   - origin  head 位置 [x,y,z]（模型根帧，米）——必填
 *   - tail    末端位置 [x,y,z]（缺省由骨架生成器/前端推导）
 *   - axis    可选弯曲铰链轴 [x,y,z]（模型根帧；动画绕此轴转）。**作者显式声明优先**；
 *             缺省时前端按 head→tail 启发式推（竖直腿→±Y 前后摆）。行走腿骨应写 axis=[0,1,0]。
 *   - parent  父骨 bone id（缺省=根骨）
 *   - source_part  可选：该骨对应的 part id（仅记录 + 校验引用有效；g_to_rig/自动蒙皮当前不读它）
 *   - rpy     可选骨骼朝向 [r,p,y]（仅记录；g_to_rig 当前不读它，不影响 rest 朝向/蒙皮）
 *
 * 角色骨架由 agent 在组装阶段逐根显式声明（父子按解剖：四肢各自挂中轴骨，绝不腿挂腿）。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  ref,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBone(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const origin = readVec3(input, 'origin', 'hx', 'hy', 'hz');
  if (!origin) return fail('bone requires origin=[x,y,z] (head position, model-root frame)');

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'bone');
  if (!isValidId(id)) return fail(`invalid id "${id}" (must match [A-Za-z_][A-Za-z0-9_]*)`);

  const args: Record<string, Arg> = { origin: numList(origin) };

  const parent = readRef(input.parent ?? input.parent_id);
  if (parent) args.parent = ref(parent);
  const sourcePart = readRef(input.source_part ?? input.source_part_id);
  if (sourcePart) args.source_part = ref(sourcePart);

  const tail = readVec3(input, 'tail', 'tx', 'ty', 'tz');
  if (tail) args.tail = numList(tail);
  const axis = readVec3(input, 'axis', 'ax', 'ay', 'az');
  if (axis) {
    // 零向量无意义——忽略，让前端走启发式。
    if (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2] > 1e-12) {
      args.axis = numList(axis);
    }
  }
  const rpy = readVec3(input, 'rpy', 'rr', 'rp', 'ry');
  if (rpy) args.rpy = numList(rpy);

  const next = emit(incoming, id, 'bone', args);
  return { geometry: next, id, error: '' };
}

/** 读一个三元向量：优先 arrayKey（数组），否则三个标量字段 s0/s1/s2。 */
function readVec3(
  input: Record<string, unknown>,
  arrayKey: string,
  s0: string,
  s1: string,
  s2: string,
): [number, number, number] | null {
  const arr = input[arrayKey];
  if (Array.isArray(arr) && arr.length >= 3) {
    const v = arr.slice(0, 3).map((x) => Number(x));
    if (v.every((n) => Number.isFinite(n))) return v as [number, number, number];
  }
  const a = Number(input[s0]);
  const b = Number(input[s1]);
  const c = Number(input[s2]);
  if ([a, b, c].every((n) => Number.isFinite(n))) return [a, b, c];
  return null;
}

function readRef(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export default gBone;
