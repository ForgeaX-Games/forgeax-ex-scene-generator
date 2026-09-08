/**
 * g_joint_continuous —— 追加 `id = joint(type="continuous", parent, child, axis=[...])`。
 *
 * 无限位旋转关节（如轮子轴）。URDF 规范要求 continuous joint 仍带 effort/velocity，
 * 不写时由 g_to_urdf 渲染阶段补 1。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  ref,
  str,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gJointContinuous(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const parentId = String(input.parent_id ?? '').trim();
  const childId  = String(input.child_id  ?? '').trim();
  if (!parentId || !childId) {
    return { geometry: incoming, id: '', error: 'parent_id and child_id are required' };
  }
  const byId = new Map(incoming.statements.map(s => [s.id, s]));
  const parent = byId.get(parentId);
  const child = byId.get(childId);
  if (!parent) return { geometry: incoming, id: '', error: `parent_id "${parentId}" not in geometry` };
  if (!child)  return { geometry: incoming, id: '', error: `child_id  "${childId}" not in geometry` };
  if (parent.op !== 'part') return { geometry: incoming, id: '', error: `parent_id "${parentId}" must reference a part, got "${parent.op}"` };
  if (child.op !== 'part')  return { geometry: incoming, id: '', error: `child_id "${childId}" must reference a part, got "${child.op}"` };
  if (parentId === childId) return { geometry: incoming, id: '', error: 'parent and child must differ' };

  const ax = Number(input.ax ?? 0);
  const ay = Number(input.ay ?? 0);
  const az = Number(input.az ?? 1);
  if (![ax, ay, az].every(v => Number.isFinite(v))) {
    return { geometry: incoming, id: '', error: 'axis components must be finite numbers' };
  }
  if (ax * ax + ay * ay + az * az === 0) {
    return { geometry: incoming, id: '', error: 'axis must be non-zero' };
  }

  const args: Record<string, Arg> = {
    type:   str('continuous'),
    parent: ref(parentId),
    child:  ref(childId),
    axis:   numList([ax, ay, az]),
  };

  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (ox !== 0 || oy !== 0 || oz !== 0) args.origin = numList([ox, oy, oz]);

  const rr = Number(input.rr ?? 0);
  const rp = Number(input.rp ?? 0);
  const ry = Number(input.ry ?? 0);
  if (rr !== 0 || rp !== 0 || ry !== 0) args.rpy = numList([rr, rp, ry]);

  const effort   = Number(input.effort   ?? 0);
  const velocity = Number(input.velocity ?? 0);
  if (effort   > 0) args.effort   = num(effort);
  if (velocity > 0) args.velocity = num(velocity);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'jcon');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const next = emit(incoming, id, 'joint', args);
  return { geometry: next, id };
}

export default gJointContinuous;
