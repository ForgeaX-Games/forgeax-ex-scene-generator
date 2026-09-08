/**
 * g_auto_collision —— 从每个 part 的 visual 自动派生 <collision>：
 * 原生 primitive 精确复制，其余用 AABB box 兜底。
 *
 * 规则（逐 part 处理整张 Geometry）：
 *   - 已有显式 collision 语句的 part：默认跳过（除非 replace=true 先清掉旧的）
 *   - visual shape 是 box      → collision box（同尺寸，精确）
 *   - visual shape 是 cylinder → collision cylinder（同 radius/length，沿 Z）
 *   - visual shape 是 sphere   → collision sphere（同 radius）
 *   - 其它（CSG / Parts / mesh / transform）→ AABB box 兜底
 *   - 无法解析 AABB（mesh / 未注册 op）→ 跳过 + 计入 skipped
 *
 * 与 g_collision_box（单 part、永远 AABB box）/ g_collision_clustered（多 box 簇）
 * 的区别：本电池一次处理全部 part，且对 primitive 保留精确碰撞体（更准 + broadphase 友好）。
 */

import {
  emit,
  freshId,
  geometryFromStatements,
  isGeometry,
  isValidId,
  localAabbFromPart,
  makeGeometry,
  numList,
  num,
  ref,
  str,
  type Arg,
  type Geometry,
  type Statement,
} from '../../../../vendor/dist/shared/types/index.js';

export function gAutoCollision(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = isGeometry(input.geometry) ? (input.geometry as Geometry) : makeGeometry();

  const padding = readNonNeg(input.padding, 0);
  const minSize = readNonNeg(input.min_size, 1e-4);
  const replace = input.replace === true || input.replace === 'true';
  const primitiveExact = input.primitive_exact !== false && input.primitive_exact !== 'false';

  const byId = new Map<string, Statement>();
  for (const s of incoming.statements) byId.set(s.id, s);

  const parts = incoming.statements.filter(s => s.op === 'part');
  if (parts.length === 0) {
    // 裸 shape 预览（如 g_stairs → g_to_urdf 直连，靠 auto-wrap 出 link）没有显式 part，
    // 这不是错误：本电池无事可做，原样透传几何，不污染节点状态。
    return { geometry: incoming, added: 0, skipped: 0, report: 'no part statements; nothing to derive (passthrough)' };
  }

  // 已有显式 collision 的 link 集合
  const haveCollision = new Set<string>();
  for (const s of incoming.statements) {
    if (s.op !== 'collision') continue;
    const r = s.args.link;
    if (r && r.kind === 'ref') haveCollision.add(r.name);
  }

  let baseGeom: Geometry = incoming;
  if (replace) {
    baseGeom = removeAllCollisions(incoming);
    haveCollision.clear();
  }

  let added = 0;
  let skipped = 0;
  const notes: string[] = [];

  for (const part of parts) {
    if (haveCollision.has(part.id)) { skipped++; continue; }

    const shapeRef = part.args.shape;
    const shape = shapeRef && shapeRef.kind === 'ref' ? byId.get(shapeRef.name) : undefined;

    const args: Record<string, Arg> = { link: ref(part.id) };
    let derived = false;

    if (primitiveExact && shape) {
      if (shape.op === 'box') {
        const size = readNumList(shape.args.size, 3);
        if (size) {
          args.box = numList([
            Math.max(minSize, size[0] + 2 * padding),
            Math.max(minSize, size[1] + 2 * padding),
            Math.max(minSize, size[2] + 2 * padding),
          ]);
          args.name = str(`${part.id}_box`);
          derived = true;
        }
      } else if (shape.op === 'cylinder') {
        const r = readNumber(shape.args.radius);
        const l = readNumber(shape.args.length);
        if (r !== undefined && l !== undefined && r > 0 && l > 0) {
          args.cylinder = numList([r + padding, Math.max(minSize, l + 2 * padding)]);
          args.name = str(`${part.id}_cyl`);
          derived = true;
        }
      } else if (shape.op === 'sphere') {
        const r = readNumber(shape.args.radius);
        if (r !== undefined && r > 0) {
          args.sphere_radius = num(r + padding);
          args.name = str(`${part.id}_sph`);
          derived = true;
        }
      }
    }

    if (!derived) {
      // AABB box 兜底
      const aabb = localAabbFromPart(part, byId);
      if (!aabb) {
        skipped++;
        notes.push(`skip "${part.id}": cannot derive AABB (mesh / unregistered op)`);
        continue;
      }
      const sx = Math.max(minSize, aabb.halfExtent[0] * 2 + 2 * padding);
      const sy = Math.max(minSize, aabb.halfExtent[1] * 2 + 2 * padding);
      const sz = Math.max(minSize, aabb.halfExtent[2] * 2 + 2 * padding);
      args.box = numList([sx, sy, sz]);
      if (aabb.center[0] !== 0 || aabb.center[1] !== 0 || aabb.center[2] !== 0) {
        args.origin = numList([aabb.center[0], aabb.center[1], aabb.center[2]]);
      }
      args.name = str(`${part.id}_aabb`);
    }

    const id = freshId(baseGeom, 'col');
    if (!isValidId(id)) { skipped++; continue; }
    baseGeom = emit(baseGeom, id, 'collision', args);
    added++;
  }

  return {
    geometry: baseGeom,
    added,
    skipped,
    report: notes.join('\n'),
  };
}

function readNonNeg(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function readNumber(a: Arg | undefined): number | undefined {
  if (!a || a.kind !== 'number') return undefined;
  return a.value;
}

function readNumList(a: Arg | undefined, n: number): number[] | undefined {
  if (!a || a.kind !== 'list') return undefined;
  const out: number[] = [];
  for (const item of a.items) {
    if (item.kind !== 'number') return undefined;
    out.push(item.value);
  }
  if (out.length !== n) return undefined;
  return out;
}

function removeAllCollisions(geom: Geometry): Geometry {
  const keep = geom.statements.filter(s => s.op !== 'collision');
  if (keep.length === geom.statements.length) return geom;
  return geometryFromStatements(keep, { previous: geom, focus: geom.focus });
}

export default gAutoCollision;
