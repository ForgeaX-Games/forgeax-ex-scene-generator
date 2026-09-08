/**
 * g_place_local —— 按"相对父件的局部位姿"摆放 child，编译期就展平成绝对世界位姿。
 *
 * place_local(parent, child, offset=[x,y,z], rpy=[r,p,y]) → Geometry
 *
 * 复合公式与 joint 树的正向运动学逐字一致（见 vendor fk.ts 的 computeWorldTransforms）：
 *     child.origin = parent.origin + R(parent.rpy) · offset
 *     child.rpy    = mat3ToRpy( R(parent.rpy) · R(rpy) )
 * 区别只在**结果落在哪里**：joint 把这段关系留到运行时由 URDF 树累计，place_local 当场算完
 * 用 withPartPose 写回 child 的绝对 origin/rpy。产物仍是一堆绝对位姿的 part，静态路的
 * QC / bake / 导出一行都不用改 —— 也因此它不引入任何运行时新语义。
 *
 * 典型用法是建筑里那三类"位置只能相对父件表达"的构件：窗嵌墙洞、门框嵌墙洞、门扇挂门框。
 * 其余构件的 build-spec 本来就写绝对世界坐标，直接给 part 写 origin 即可，不必过这一步。
 *
 * 链式天然可用：DSL 是 SSA 前向可见，门框先 place_local 到墙、门扇再 place_local 到门框时，
 * 门框的 origin/rpy 已经是世界位姿了。
 *
 * 容错：不抛异常；失败路径写 error 字段返回并透传 geometry。
 */

import {
  addVec,
  isGeometry,
  mat3Mul,
  mat3ToRpy,
  mat3Vec3,
  readVec3,
  resolveOrWrapPart,
  rpyToMat3,
  withPartPose,
  type Geometry,
  type Statement,
  type Vec3,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPlaceLocal(input: Record<string, unknown>): Record<string, unknown> {
  const geomIn = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  const fail = (geometry: Geometry | null, error: string): Record<string, unknown> =>
    ({ geometry, origin: [], rpy: [], note: '', error });
  if (!geomIn) return fail(null, 'geometry input is required');

  // 宽容解析：parent_id / child_id 既可以是 part id，也可以是 shape id（没有 part 包它时
  // 隐式补一行）。与 g_align_centers / g_place_on_face 同一套规则，见 resolve.ts。
  // 解析可能扩展 Geometry，因此 child 必须基于 parent 解析后的 geom 继续。
  const parentRes = resolveOrWrapPart(geomIn, String(input.parent_id ?? ''), 'parent');
  if (parentRes.ok === false) return fail(geomIn, parentRes.error);
  const childRes = resolveOrWrapPart(parentRes.geometry, String(input.child_id ?? ''), 'child');
  if (childRes.ok === false) return fail(parentRes.geometry, childRes.error);

  const geom = childRes.geometry;
  const parentId = parentRes.partId;
  const childId = childRes.partId;
  if (parentId === childId) {
    return fail(geom, `place_local: parent and child both resolve to part "${childId}"; a part cannot be placed on itself`);
  }

  const offset = readTriple(input, ['ox', 'oy', 'oz']);
  if (!offset) return fail(geom, 'place_local: ox / oy / oz must be finite numbers');
  const localRpy = readTriple(input, ['rr', 'rp', 'ry']);
  if (!localRpy) return fail(geom, 'place_local: rr / rp / ry must be finite numbers');

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const parent = byId.get(parentId)!;

  const parentRot = rpyToMat3(readVec3(parent.args.rpy) ?? [0, 0, 0]);
  const worldOrigin = addVec(readVec3(parent.args.origin) ?? [0, 0, 0], mat3Vec3(parentRot, offset));
  const worldRpy = mat3ToRpy(mat3Mul(parentRot, rpyToMat3(localRpy)));

  const origin = roundVec(worldOrigin);
  const rpy = roundVec(worldRpy);
  const updated = withPartPose(geom, childId, origin, rpy);

  // 非致命提示：place_local 是静态路的编译期 op，joint 那条 URDF 路自己就会做同样的复合。
  // 两者混用不会算错（写回的仍是绝对位姿），但多半说明作者把两套装配写法混着用了。
  const note = geom.statements.some((s) => s.op === 'joint')
    ? `place_local flattened "${childId}" onto "${parentId}" at compile time, but this geometry also has joint() statements ` +
      'which put the whole model on the URDF path — there the same relative pose is already expressed by the joint. ' +
      'Pick one: place_local everywhere (static path), or joints everywhere (URDF path).'
    : '';

  return { geometry: updated, origin, rpy, note, error: '' };
}

export default gPlaceLocal;

/** 读三个标量端口成 Vec3；缺省 0，任一非有限数 → null（调用方报错，不静默当 0）。 */
function readTriple(input: Record<string, unknown>, keys: readonly [string, string, string]): Vec3 | null {
  const out: number[] = [];
  for (const k of keys) {
    const raw = input[k];
    const n = raw === undefined || raw === null || raw === '' ? 0 : Number(raw);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return [out[0]!, out[1]!, out[2]!];
}

/** 抹掉复合旋转带来的浮点噪声，让写回 DSL 的是 4.4 而不是 4.400000000000001。 */
function roundVec(v: Vec3): [number, number, number] {
  const r = (n: number): number => Math.round(n * 1e9) / 1e9 + 0; // + 0 把 -0 归一成 0
  return [r(v[0]), r(v[1]), r(v[2])];
}
