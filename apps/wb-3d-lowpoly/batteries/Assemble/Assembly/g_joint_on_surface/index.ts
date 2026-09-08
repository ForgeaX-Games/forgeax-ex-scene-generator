/**
 * g_joint_on_surface —— 先计算表面贴合位姿，再追加 joint。
 */

import {
  emit,
  freshId,
  isGeometry,
  isValidId,
  num,
  numList,
  placePartOnSurface,
  ref,
  resolveOrWrapPart,
  str,
  type Arg,
  type Geometry,
  type Statement,
  type Vec3,
} from '../../../../vendor/dist/shared/types/index.js';

const JOINT_TYPES = new Set(['fixed', 'revolute', 'continuous', 'prismatic']);

export function gJointOnSurface(input: Record<string, unknown>): Record<string, unknown> {
  const geomIn = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geomIn) return { geometry: null, id: '', error: 'geometry input is required' };

  const parentRes = resolveOrWrapPart(geomIn, String(input.parent_id ?? ''), 'parent');
  if (parentRes.ok === false) return { geometry: geomIn, id: '', error: parentRes.error };
  const childRes = resolveOrWrapPart(parentRes.geometry, String(input.child_id ?? ''), 'child');
  if (childRes.ok === false) return { geometry: parentRes.geometry, id: '', error: childRes.error };

  const geom = childRes.geometry;
  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const parent = byId.get(parentRes.partId);
  const child = byId.get(childRes.partId);
  if (!parent || !child) return { geometry: geom, id: '', error: 'resolved part not found' };

  const type = String(input.type ?? 'fixed').trim().toLowerCase();
  if (!JOINT_TYPES.has(type)) {
    return { geometry: geom, id: '', error: `type must be one of ${Array.from(JOINT_TYPES).join('/')}` };
  }

  const clearance = Number(input.clearance ?? 0);
  const spin = Number(input.spin ?? 0);
  if (![clearance, spin].every(Number.isFinite)) {
    return { geometry: geom, id: '', error: 'clearance and spin must be finite numbers' };
  }

  const mode = String(input.mode ?? 'direction').trim().toLowerCase();
  const query =
    mode === 'point'
      ? { pointHint: vec(input.px ?? 0, input.py ?? 0, input.pz ?? 0, 'point') }
      : { direction: vec(input.dx ?? 0, input.dy ?? 0, input.dz ?? 1, 'direction') };

  let placement;
  try {
    placement = placePartOnSurface(child, parent, byId, {
      ...query,
      childAxis: String(input.child_axis ?? '+z'),
      clearance,
      spin,
      upHint: vec(input.upx ?? 0, input.upy ?? 0, input.upz ?? 1, 'up_hint'),
    });
  } catch (err) {
    return { geometry: geom, id: '', error: err instanceof Error ? err.message : String(err) };
  }
  if (!placement) return { geometry: geom, id: '', error: 'cannot compute surface placement from the selected parts' };

  const args: Record<string, Arg> = {
    type: str(type),
    parent: ref(parentRes.partId),
    child: ref(childRes.partId),
    origin: numList([placement.origin[0], placement.origin[1], placement.origin[2]]),
    rpy: numList([placement.rpy[0], placement.rpy[1], placement.rpy[2]]),
  };

  if (type !== 'fixed') {
    let ax = Number(input.ax ?? placement.frame.normal[0]);
    let ay = Number(input.ay ?? placement.frame.normal[1]);
    let az = Number(input.az ?? placement.frame.normal[2]);
    if (![ax, ay, az].every(Number.isFinite)) {
      return { geometry: geom, id: '', error: 'axis must be finite and non-zero' };
    }
    if (ax * ax + ay * ay + az * az === 0) {
      [ax, ay, az] = placement.frame.normal;
    }
    args.axis = numList([ax, ay, az]);
  }

  if (type === 'revolute' || type === 'prismatic') {
    const lower = Number(input.lower ?? (type === 'revolute' ? -Math.PI : -0.5));
    const upper = Number(input.upper ?? (type === 'revolute' ? Math.PI : 0.5));
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
      return { geometry: geom, id: '', error: 'lower must be <= upper and both finite' };
    }
    args.lower = num(lower);
    args.upper = num(upper);
  }

  const effort = Number(input.effort ?? 0);
  const velocity = Number(input.velocity ?? 0);
  if (effort > 0) args.effort = num(effort);
  if (velocity > 0) args.velocity = num(velocity);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(geom, 'jsurf');
  if (!isValidId(id)) return { geometry: geom, id: '', error: `invalid id "${id}"` };

  const next = emit(geom, id, 'joint', args);
  return {
    geometry: next,
    id,
    ox: placement.origin[0],
    oy: placement.origin[1],
    oz: placement.origin[2],
    rr: placement.rpy[0],
    rp: placement.rpy[1],
    ry: placement.rpy[2],
    source: placement.frame.source,
  };
}

function vec(xRaw: unknown, yRaw: unknown, zRaw: unknown, name: string): Vec3 {
  const x = Number(xRaw);
  const y = Number(yRaw);
  const z = Number(zRaw);
  if (![x, y, z].every(Number.isFinite)) throw new Error(`${name} must be finite [x,y,z]`);
  return [x, y, z];
}

export default gJointOnSurface;
