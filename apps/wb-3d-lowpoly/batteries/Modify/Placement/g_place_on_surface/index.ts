/**
 * g_place_on_surface —— 基于 parent 的实际表面法线放置 child。
 *
 * 与 g_place_on_face 的轴对齐 AABB 面不同，本节点对 box / cylinder / sphere
 * 使用最近表面查询；复杂 shape 才退回 AABB。
 */

import {
  isGeometry,
  placePartOnSurface,
  resolveOrWrapPart,
  withPartPose,
  type Geometry,
  type Statement,
  type Vec3,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPlaceOnSurface(input: Record<string, unknown>): Record<string, unknown> {
  const geomIn = isGeometry(input.geometry) ? (input.geometry as Geometry) : null;
  if (!geomIn) return empty('geometry input is required');

  const parentRes = resolveOrWrapPart(geomIn, String(input.parent_id ?? ''), 'parent');
  if (parentRes.ok === false) return { ...empty(parentRes.error), geometry: geomIn };
  const childRes = resolveOrWrapPart(parentRes.geometry, String(input.child_id ?? ''), 'child');
  if (childRes.ok === false) return { ...empty(childRes.error), geometry: parentRes.geometry };

  const geom = childRes.geometry;
  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);
  const parent = byId.get(parentRes.partId);
  const child = byId.get(childRes.partId);
  if (!parent || !child) return { ...empty('resolved part not found'), geometry: geom };

  const clearance = Number(input.clearance ?? 0);
  const spin = Number(input.spin ?? 0);
  if (![clearance, spin].every(Number.isFinite)) {
    return { ...empty('clearance and spin must be finite numbers'), geometry: geom };
  }

  const mode = String(input.mode ?? 'direction').trim().toLowerCase();
  const query =
    mode === 'point'
      ? { pointHint: vec(input.px ?? 0, input.py ?? 0, input.pz ?? 0, 'point') }
      : { direction: vec(input.dx ?? 0, input.dy ?? 0, input.dz ?? 1, 'direction') };

  try {
    const placement = placePartOnSurface(child, parent, byId, {
      ...query,
      childAxis: String(input.child_axis ?? '+z'),
      clearance,
      spin,
      upHint: vec(input.upx ?? 0, input.upy ?? 0, input.upz ?? 1, 'up_hint'),
    });
    if (!placement) return { ...empty('cannot compute surface placement from the selected parts'), geometry: geom };

    const updated = withPartPose(geom, childRes.partId, placement.origin, placement.rpy);
    return {
      geometry: updated,
      ox: placement.origin[0],
      oy: placement.origin[1],
      oz: placement.origin[2],
      rr: placement.rpy[0],
      rp: placement.rpy[1],
      ry: placement.rpy[2],
      nx: placement.frame.normal[0],
      ny: placement.frame.normal[1],
      nz: placement.frame.normal[2],
      source: placement.frame.source,
    };
  } catch (err) {
    return { ...empty(err instanceof Error ? err.message : String(err)), geometry: geom };
  }
}

function vec(xRaw: unknown, yRaw: unknown, zRaw: unknown, name: string): Vec3 {
  const x = Number(xRaw);
  const y = Number(yRaw);
  const z = Number(zRaw);
  if (![x, y, z].every(Number.isFinite)) throw new Error(`${name} must be finite [x,y,z]`);
  return [x, y, z];
}

function empty(error: string): Record<string, unknown> {
  return {
    geometry: null,
    ox: 0,
    oy: 0,
    oz: 0,
    rr: 0,
    rp: 0,
    ry: 0,
    nx: 0,
    ny: 0,
    nz: 1,
    source: '',
    error,
  };
}

export default gPlaceOnSurface;
