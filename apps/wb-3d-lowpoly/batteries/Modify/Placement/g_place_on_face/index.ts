/**
 * g_place_on_face —— 把 child part 摆到 parent 的某个轴对齐外表面上。
 *
 * place_on_face(parent_link, face, ...) → Origin
 *
 * 思路：
 *   1) parent / child 都视为局部 AABB（来自其 shape 的 size/radius）
 *   2) face = '+x' / '-x' / '+y' / '-y' / '+z' / '-z'
 *   3) 沿 face 法向把 child 的对应面贴到 parent 的目标面
 *   4) face_u / face_v 是面内偏移（按右手坐标系 RHS 选切线方向）
 *   5) proud > 0 让 child 沿法向额外突出 proud 米；< 0 嵌入
 *
 * 输出：
 *   - geometry：把上述偏移直接写回 child part 的 origin 后的新 Geometry —— 通常你想要的
 *     就是这条线，可以无缝接到 g_to_urdf / g_preview / g_geometry_qc。
 *   - ox / oy / oz：原始三个数；如果你要单独把它接到 g_joint 的 origin 仍然可用。
 */

import {
  isGeometry,
  resolveOrWrapPart,
  visualAabbFromPart,
  withPartOrigin,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_FACES = new Set(['+x', '-x', '+y', '-y', '+z', '-z']);

export function gPlaceOnFace(input: Record<string, unknown>): Record<string, unknown> {
  const geomIn = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geomIn) return { geometry: null, ox: 0, oy: 0, oz: 0, error: 'geometry input is required' };

  // 宽容解析：见 g_align_centers 的同名分支注释。
  const parentRes = resolveOrWrapPart(geomIn, String(input.parent_id ?? ''), 'parent');
  if (parentRes.ok === false) return { geometry: geomIn, ox: 0, oy: 0, oz: 0, error: parentRes.error };
  const childRes  = resolveOrWrapPart(parentRes.geometry, String(input.child_id ?? ''), 'child');
  if (childRes.ok === false)  return { geometry: parentRes.geometry, ox: 0, oy: 0, oz: 0, error: childRes.error };

  const geom = childRes.geometry;
  const parentId = parentRes.partId;
  const childId  = childRes.partId;

  const face = String(input.face ?? '+z').trim().toLowerCase();
  if (!VALID_FACES.has(face)) {
    return { geometry: geom, ox: 0, oy: 0, oz: 0, error: `face must be one of +x/-x/+y/-y/+z/-z, got "${face}"` };
  }

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const parent = byId.get(parentId)!;
  const child  = byId.get(childId)!;

  const parentBox = visualAabbFromPart(parent, byId);
  const childBox  = visualAabbFromPart(child,  byId);
  if (!parentBox) return { geometry: geom, ox: 0, oy: 0, oz: 0, error: `cannot derive AABB from parent "${parentId}"` };
  if (!childBox)  return { geometry: geom, ox: 0, oy: 0, oz: 0, error: `cannot derive AABB from child "${childId}"` };

  const proud = Number(input.proud ?? 0);
  const u = Number(input.face_u ?? 0);
  const v = Number(input.face_v ?? 0);
  if (![proud, u, v].every(Number.isFinite)) {
    return { geometry: geom, ox: 0, oy: 0, oz: 0, error: 'proud / face_u / face_v must be finite numbers' };
  }

  const sign  = face[0] === '+' ? 1 : -1;
  const axis  = face[1] as 'x' | 'y' | 'z';
  const axisIdx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;

  // parent 面中心（局部坐标）
  const faceCenter: [number, number, number] = [
    parentBox.center[0],
    parentBox.center[1],
    parentBox.center[2],
  ];
  faceCenter[axisIdx] += sign * parentBox.halfExtent[axisIdx];

  // child 沿法向的半厚（要把它"贴"到面上需要顶出半厚 + proud）
  const childOffsetAlongNormal = childBox.halfExtent[axisIdx] + proud;

  // 法向 → 偏移；切线方向用一个右手系约定：
  //   +x: u→+y, v→+z      -x: u→-y, v→+z
  //   +y: u→+z, v→+x      -y: u→-z, v→+x
  //   +z: u→+x, v→+y      -z: u→-x, v→+y
  // （只是一种合理的约定；用户感觉别扭时可在两个 u/v 上对调正负）
  const desiredCenter: [number, number, number] = [faceCenter[0], faceCenter[1], faceCenter[2]];
  desiredCenter[axisIdx] += sign * childOffsetAlongNormal;

  switch (face) {
    case '+x': { desiredCenter[1] += u; desiredCenter[2] += v; break; }
    case '-x': { desiredCenter[1] -= u; desiredCenter[2] += v; break; }
    case '+y': { desiredCenter[2] += u; desiredCenter[0] += v; break; }
    case '-y': { desiredCenter[2] -= u; desiredCenter[0] += v; break; }
    case '+z': { desiredCenter[0] += u; desiredCenter[1] += v; break; }
    case '-z': { desiredCenter[0] -= u; desiredCenter[1] += v; break; }
  }
  const origin = readOrigin(child);
  const result: [number, number, number] = [
    origin[0] + desiredCenter[0] - childBox.center[0],
    origin[1] + desiredCenter[1] - childBox.center[1],
    origin[2] + desiredCenter[2] - childBox.center[2],
  ];

  // 写回 child part 的 origin —— 让"贴面摆放"这一步本身就产出可视化用的 Geometry。
  const updated = withPartOrigin(geom, childId, [result[0], result[1], result[2]]);

  return { geometry: updated, ox: result[0], oy: result[1], oz: result[2] };
}

export default gPlaceOnFace;

function readOrigin(part: Statement): [number, number, number] {
  const arg = part.args.origin;
  if (!arg || arg.kind !== 'list' || arg.items.length !== 3) return [0, 0, 0];
  const out = arg.items.map(item => item.kind === 'number' ? item.value : 0);
  return [out[0], out[1], out[2]];
}
