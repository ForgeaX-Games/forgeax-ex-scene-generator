/**
 * g_bone_chain —— 在 Geometry DSL 末尾追加 count 行标准 `bone(...)`，等分展开成一条首尾相接的骨骼链。
 *
 * 用于一整根连续 part（尾巴/蛇身/长鞭/多节触手）想要多节平滑弯曲，而不必手算每段坐标：
 *   - origin  链起点 head 位置 [x,y,z]（模型根帧，米）——必填
 *   - tail    链终点位置 [x,y,z]（模型根帧，米）——必填
 *   - count   分几段骨骼（整数 ≥1，如尾巴 4~6 段）——必填
 *   - parent  链第一段的父骨 bone id（缺省=根骨）；第 2..N 段自动 parent=前一段
 *   - axis    可选弯曲铰链轴 [x,y,z]（模型根帧），应用到链上每一段
 *   - source_part  可选：该链对应的 part id，应用到链上每一段（仅记录 + 校验引用有效；
 *                  g_to_rig/自动蒙皮当前不读它，同 g_bone）
 *
 * 内部就是复用 g_bone 的逐段 emit 逻辑：在 origin→tail 上按 i/count 线性插值出每段的
 * head/tail，依次 emit 标准 `bone` 语句，第 2 段起自动 parent=上一段。生成的骨骼 id 形如
 * `<chainId>_0`、`<chainId>_1`……`<chainId>_{count-1}`（chainId=本语句的 DSL id），可直接被
 * animation 的关键帧通道按骨骼名单独驱动。本电池对外输出的 id 指向链的最后一段（tip），
 * 方便再挂一根末端 bone，或作为下一个 bone_chain 的 parent。
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
  type Geometry,
} from '../../../../vendor/dist/shared/types/index.js';

export function gBoneChain(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const origin = readVec3(input, 'origin', 'hx', 'hy', 'hz');
  if (!origin) return fail('bone_chain requires origin=[x,y,z] (chain head position, model-root frame)');
  const tail = readVec3(input, 'tail', 'tx', 'ty', 'tz');
  if (!tail) return fail('bone_chain requires tail=[x,y,z] (chain end position, model-root frame)');

  const count = Math.round(Number(input.count));
  if (!Number.isFinite(count) || count < 1) {
    return fail('bone_chain requires count>=1 (how many bone segments to split the chain into)');
  }

  const rawId = String(input.id ?? '').trim();
  const chainId = rawId !== '' ? rawId : freshId(incoming, 'bone_chain');
  if (!isValidId(chainId)) return fail(`invalid id "${chainId}" (must match [A-Za-z_][A-Za-z0-9_]*)`);

  const axis = readVec3(input, 'axis', 'ax', 'ay', 'az');
  const hasAxis = !!axis && axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2] > 1e-12;
  const sourcePart = readRef(input.source_part ?? input.source_part_id);
  const firstParent = readRef(input.parent ?? input.parent_id);

  let geom: Geometry = incoming;
  let prevSegId = '';
  for (let i = 0; i < count; i++) {
    const t0 = i / count;
    const t1 = (i + 1) / count;
    const head = lerp3(origin, tail, t0);
    const segTail = lerp3(origin, tail, t1);

    const segId = `${chainId}_${i}`;
    const args: Record<string, Arg> = { origin: numList(head), tail: numList(segTail) };

    const parent = i === 0 ? firstParent : prevSegId;
    if (parent) args.parent = ref(parent);
    if (sourcePart) args.source_part = ref(sourcePart);
    if (hasAxis && axis) args.axis = numList(axis);

    geom = emit(geom, segId, 'bone', args);
    prevSegId = segId;
  }

  // 对外暴露的 id 指向链尾（tip），供下游 ref（再挂一根末端 bone / 下一条链）使用。
  return { geometry: geom, id: prevSegId, error: '' };
}

function lerp3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
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

export default gBoneChain;
