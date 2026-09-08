/**
 * g_align_centers —— 计算把 child 的 AABB 中心对齐到 parent AABB 中心所需的 [ox, oy, oz] 偏移。
 *
 * align_centers(child_aabb, parent_aabb, axes=...) → Origin
 *
 * 输出：
 *   - ox / oy / oz：建议的偏移量；可手动接到 g_joint 的 origin
 *   - geometry：把上述偏移直接写回 child part 的 origin 后的新 Geometry —— 通常你想要的
 *     就是这条线，可以无缝接到 g_to_urdf / g_preview / g_geometry_qc。
 *
 * axes 用一个三个布尔位的串 "xyz" / "xy" / "z" / 等控制哪些轴参与对齐；
 * 缺省 "xyz" → 全对齐。
 */

import {
  isGeometry,
  resolveOrWrapPart,
  visualAabbFromPart,
  withPartOrigin,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

export function gAlignCenters(input: Record<string, unknown>): Record<string, unknown> {
  const geomIn = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geomIn) {
    return { geometry: null, ox: 0, oy: 0, oz: 0, error: 'geometry input is required' };
  }

  // 宽容解析：parent_id / child_id 可以是 part id，也可以是 shape id；
  // shape id 时优先复用已有 `part(shape=ref(id))`，没有就隐式追加一条新的
  // `part{n} = part(shape=ref(id))`，让"立方体→圆柱→贴面摆放"这种零 g_part 接法也能跑通。
  // 解析过程中可能会扩展 Geometry，要按 parent → child 顺序串联，child 解析时基于 parent 解析后的 geom。
  const parentRes = resolveOrWrapPart(geomIn, String(input.parent_id ?? ''), 'parent');
  if (parentRes.ok === false) return { geometry: geomIn, ox: 0, oy: 0, oz: 0, error: parentRes.error };
  const childRes  = resolveOrWrapPart(parentRes.geometry, String(input.child_id ?? ''), 'child');
  if (childRes.ok === false)  return { geometry: parentRes.geometry, ox: 0, oy: 0, oz: 0, error: childRes.error };

  const geom = childRes.geometry;
  const parentId = parentRes.partId;
  const childId  = childRes.partId;

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const parent = byId.get(parentId)!;
  const child  = byId.get(childId)!;

  const parentBox = visualAabbFromPart(parent, byId);
  const childBox  = visualAabbFromPart(child,  byId);
  if (!parentBox) return { geometry: geom, ox: 0, oy: 0, oz: 0, error: `cannot derive AABB from parent "${parentId}"` };
  if (!childBox)  return { geometry: geom, ox: 0, oy: 0, oz: 0, error: `cannot derive AABB from child "${childId}"` };

  const axesRaw = String(input.axes ?? 'xyz').toLowerCase();
  const useX = axesRaw.includes('x');
  const useY = axesRaw.includes('y');
  const useZ = axesRaw.includes('z');

  const dx = parentBox.center[0] - childBox.center[0];
  const dy = parentBox.center[1] - childBox.center[1];
  const dz = parentBox.center[2] - childBox.center[2];

  const origin = readOrigin(child);
  const ox = origin[0] + (useX ? dx : 0);
  const oy = origin[1] + (useY ? dy : 0);
  const oz = origin[2] + (useZ ? dz : 0);

  // 写回 child part 的 origin —— 让"对齐"这一步本身就产出可视化用的 Geometry。
  // child 必然是 part（前面已经从 byId 取到），withPartOrigin 内部会再做一次校验。
  const updated = withPartOrigin(geom, childId, [ox, oy, oz]);

  return {
    geometry: updated,
    ox,
    oy,
    oz,
  };
}

export default gAlignCenters;

function readOrigin(part: Statement): [number, number, number] {
  const arg = part.args.origin;
  if (!arg || arg.kind !== 'list' || arg.items.length !== 3) return [0, 0, 0];
  const out = arg.items.map(item => item.kind === 'number' ? item.value : 0);
  return [out[0], out[1], out[2]];
}
