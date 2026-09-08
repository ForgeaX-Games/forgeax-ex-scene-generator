/**
 * g_joint_mimic —— 追加带 URDF <mimic> 的从动 joint。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  ref,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const TYPES = new Set(['revolute', 'continuous', 'prismatic']);

export function gJointMimic(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const parentId = String(input.parent_id ?? '').trim();
  const childId = String(input.child_id ?? '').trim();
  const sourceJointId = String(input.source_joint_id ?? '').trim();
  if (!parentId || !childId || !sourceJointId) {
    return { geometry: incoming, id: '', error: 'parent_id, child_id and source_joint_id are required' };
  }

  const byId = new Map(incoming.statements.map(s => [s.id, s]));
  const parent = byId.get(parentId);
  const child = byId.get(childId);
  if (!parent) return { geometry: incoming, id: '', error: `parent_id "${parentId}" not in geometry` };
  if (!child) return { geometry: incoming, id: '', error: `child_id "${childId}" not in geometry` };
  if (parent.op !== 'part') return { geometry: incoming, id: '', error: `parent_id "${parentId}" must reference a part, got "${parent.op}"` };
  if (child.op !== 'part') return { geometry: incoming, id: '', error: `child_id "${childId}" must reference a part, got "${child.op}"` };
  const source = byId.get(sourceJointId);
  if (!source || source.op !== 'joint') return { geometry: incoming, id: '', error: `source_joint_id "${sourceJointId}" must reference an existing joint` };
  // <mimic> 只能跟随被驱动的关节（有一个自由度）。fixed/floating/planar 没有单一可镜像的 DOF。
  const srcTypeArg = (source.args as Record<string, Arg> | undefined)?.type;
  const srcType = srcTypeArg && srcTypeArg.kind === 'string' ? String(srcTypeArg.value).toLowerCase() : '';
  if (!TYPES.has(srcType)) {
    return { geometry: incoming, id: '', error: `source_joint_id "${sourceJointId}" must be a driven joint (revolute/continuous/prismatic), got "${srcType || 'unknown'}"` };
  }
  if (parentId === childId) return { geometry: incoming, id: '', error: 'parent and child must differ' };

  const type = String(input.type ?? 'revolute').trim().toLowerCase();
  if (!TYPES.has(type)) return { geometry: incoming, id: '', error: 'type must be revolute, continuous, or prismatic' };

  const ax = Number(input.ax ?? 0);
  const ay = Number(input.ay ?? 0);
  const az = Number(input.az ?? 1);
  if (![ax, ay, az].every(Number.isFinite) || ax * ax + ay * ay + az * az === 0) {
    return { geometry: incoming, id: '', error: 'axis components must be finite and non-zero' };
  }

  const multiplier = Number(input.multiplier ?? 1);
  const offset = Number(input.offset ?? 0);
  if (!Number.isFinite(multiplier) || !Number.isFinite(offset)) {
    return { geometry: incoming, id: '', error: 'multiplier and offset must be finite numbers' };
  }

  const args: Record<string, Arg> = {
    type: str(type),
    parent: ref(parentId),
    child: ref(childId),
    axis: numList([ax, ay, az]),
    mimic_joint: ref(sourceJointId),
    mimic_multiplier: num(multiplier),
    mimic_offset: num(offset),
  };

  if (type === 'revolute' || type === 'prismatic') {
    const lower = Number(input.lower ?? (type === 'revolute' ? -Math.PI : -0.5));
    const upper = Number(input.upper ?? (type === 'revolute' ? Math.PI : 0.5));
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      return { geometry: incoming, id: '', error: 'lower must be <= upper and both finite' };
    }
    args.lower = num(lower);
    args.upper = num(upper);
  }

  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (ox !== 0 || oy !== 0 || oz !== 0) args.origin = numList([ox, oy, oz]);

  const rr = Number(input.rr ?? 0);
  const rp = Number(input.rp ?? 0);
  const ry = Number(input.ry ?? 0);
  if (rr !== 0 || rp !== 0 || ry !== 0) args.rpy = numList([rr, rp, ry]);

  const effort = Number(input.effort ?? 0);
  const velocity = Number(input.velocity ?? 0);
  if (effort > 0) args.effort = num(effort);
  if (velocity > 0) args.velocity = num(velocity);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'jmim');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'joint', args), id };
}

export default gJointMimic;
