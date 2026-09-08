/**
 * g_joint_fixed —— 追加 `id = joint(type="fixed", parent=<ref>, child=<ref>, origin=[...]?, rpy=[...]?)`。
 *
 * 把两个 part 用 fixed joint 刚性连接。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  ref,
  str,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gJointFixed(input: Record<string, unknown>): Record<string, unknown> {
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

  const args: Record<string, Arg> = {
    type:   str('fixed'),
    parent: ref(parentId),
    child:  ref(childId),
  };

  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (ox !== 0 || oy !== 0 || oz !== 0) args.origin = numList([ox, oy, oz]);

  const rr = Number(input.rr ?? 0);
  const rp = Number(input.rp ?? 0);
  const ry = Number(input.ry ?? 0);
  if (rr !== 0 || rp !== 0 || ry !== 0) args.rpy = numList([rr, rp, ry]);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'jfix');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const next = emit(incoming, id, 'joint', args);
  return { geometry: next, id };
}

export default gJointFixed;
