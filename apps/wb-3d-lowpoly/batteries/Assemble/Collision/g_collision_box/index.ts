/**
 * g_collision_box —— 为 part 自动派生一个 AABB box 形 <collision>。
 *
 * autocollide_part(mode="single") 的简化实现：
 *   - 沿 part.shape ref 链解析出该 part 的局部 AABB（不烘焙、纯几何）
 *   - 套上可选 padding / min_size 后 emit 一条
 *       `collision(link=part, box=[w,d,h], origin=[cx,cy,cz])`
 *   - 编译时 g_to_urdf 会优先消费 collision 语句而不是再复制 visual
 *
 * 设计要点：
 *   - 完全独立于 g_inertial_from_geometry：那一行用 box/cyl/sphere 解析公式算惯量，
 *     但 URDF <collision> 必须是个具体几何元素，最稳妥就是 box。
 *   - 复杂 visual（CSG / array_radial / spur_gear ...）走 AABB 时单 box 会很保守 →
 *     用户嫌不准时改用 g_collision_clustered（"clustered" 模式，多 box 簇）。
 *   - 不要尝试自动调用：用户主动放这个电池 = 显式选择"快但保守"，否则旧的 visual=collision
 *     行为继续保留。
 */

import {
  emit,
  freshId,
  isGeometry,
  isValidId,
  geometryFromStatements,
  localAabbFromPart,
  makeGeometry,
  num,
  numList,
  ref,
  str,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

export function gCollisionBox(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = isGeometry(input.geometry) ? (input.geometry as Geometry) : makeGeometry();

  const partId = String(input.part_id ?? '').trim();
  if (!partId) return empty(incoming, 'part_id is required');

  const byId = new Map<string, Statement>();
  for (const s of incoming.statements) byId.set(s.id, s);

  const part = byId.get(partId);
  if (!part) return empty(incoming, `part_id "${partId}" not in geometry`);
  if (part.op !== 'part') {
    return empty(incoming, `id "${partId}" is op "${part.op}", expected "part"`);
  }

  const padding = readNonNeg(input.padding, 0);
  const minSize = readNonNeg(input.min_size, 1e-4);
  const replace = input.replace === true || input.replace === 'true';

  const aabb = localAabbFromPart(part, byId);
  if (!aabb) {
    return empty(
      incoming,
      `cannot derive AABB from part "${partId}" (likely a mesh or unregistered op)`,
    );
  }

  const sx = Math.max(minSize, aabb.halfExtent[0] * 2 + 2 * padding);
  const sy = Math.max(minSize, aabb.halfExtent[1] * 2 + 2 * padding);
  const sz = Math.max(minSize, aabb.halfExtent[2] * 2 + 2 * padding);
  const cx = aabb.center[0];
  const cy = aabb.center[1];
  const cz = aabb.center[2];

  let baseGeom: Geometry = incoming;
  if (replace) {
    baseGeom = removeCollisionsFor(incoming, partId);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(baseGeom, 'col');
  if (!isValidId(id)) return empty(baseGeom, `invalid id "${id}"`);

  const args: Record<string, Arg> = {
    link: ref(partId),
    box: numList([sx, sy, sz]),
  };
  if (cx !== 0 || cy !== 0 || cz !== 0) args.origin = numList([cx, cy, cz]);
  args.name = str(`${partId}_aabb`);

  const next = emit(baseGeom, id, 'collision', args);
  return {
    geometry: next,
    id,
    size_x: sx,
    size_y: sy,
    size_z: sz,
  };
}

function empty(geom: Geometry, error: string): Record<string, unknown> {
  return {
    geometry: geom,
    id: '',
    size_x: 0,
    size_y: 0,
    size_z: 0,
    error,
  };
}

function readNonNeg(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * 按 autocollide_part(replace=True) 的语义：先把同 link 的现有 collision
 * 全部清掉再加新的。仅删除"显式 collision 语句"，不动 part 本身。
 */
function removeCollisionsFor(geom: Geometry, linkId: string): Geometry {
  const keep = geom.statements.filter(s => {
    if (s.op !== 'collision') return true;
    const r = s.args.link;
    return !(r && r.kind === 'ref' && r.name === linkId);
  });
  if (keep.length === geom.statements.length) return geom;

  return geometryFromStatements(keep, { previous: geom, focus: geom.focus });
}

// 复用 'string' 构造的 helper（shared 没有 named-export 'str' 之外的简化形式 —— 这里直接重用）
void num; // 占位：保留对 num 的导入，方便日后扩展（cylinder/sphere mode）

export default gCollisionBox;
