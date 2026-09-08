/**
 * Geometry id 解析辅助 —— 把"shape id"宽容地解析成"part id"，必要时隐式补一行 part。
 *
 * articraft.placement 语义：align_centers / place_on_face 这类操作的对象是 URDF link
 * （DSL 里的 `part(...)`），而不是裸的 shape。但用户在编辑器里手填 id 时，往往把
 * primitive battery 的 `id` 输出（box1 / cyl1 / ...）直接接到 placement 电池的
 * parent_id / child_id —— 这种语义错误后端会 throw、整节点没有输出，前端只能看到
 * "暂无计算结果"，相当难定位。
 *
 * 解析顺序（与 g_to_urdf 对孤立 shape 的隐式包裹行为对齐）：
 *   1. 传入 id 本身是 part                → 直接返回该 id
 *   2. 传入 id 是 shape，且 Geometry 里
 *      **唯一一条** part 把它包了        → 自动改用那条 part 的 id
 *   3. 传入 id 是 shape，但没有任何 part
 *      包它                              → 隐式追加 `part{n} = part(shape=ref(id))`
 *                                          返回新的 Geometry + 新 part id
 *   4. 多条 part 都引用同一 shape         → 返回 error，让用户显式选一个
 *   5. 不存在 / 既非 part 也非 shape    → error
 *
 * 第 3 步用 freshId('part') 起名，确保和已有 part{n} 编号不冲突。
 */

import type { Arg, Geometry, Statement } from './types.js';
import { emit, freshId, ref } from './make.js';
import { getOpSpec } from './op-registry.js';

export interface ResolveOrWrapOk {
  readonly ok: true;
  readonly partId: string;
  /** 可能在解析过程中被追加了隐式 part —— 调用方必须用这个新 Geometry 继续 */
  readonly geometry: Geometry;
  /** 'direct'：原本就是 part；'reuse'：复用已有包裹；'wrapped'：隐式追加了一条 */
  readonly resolution: 'direct' | 'reuse' | 'wrapped';
}
export interface ResolveOrWrapErr {
  readonly ok: false;
  readonly error: string;
}
export type ResolveOrWrapResult = ResolveOrWrapOk | ResolveOrWrapErr;

/**
 * 把外部传入的 id 解析成 Geometry 中的 part id；shape id 时按需自动包裹。
 *
 * @param geom    包含全部语句的 Geometry（不变性：本函数返回 ok 时若需要追加 part，
 *                geometry 字段是新建的对象；调用方必须切换到它）
 * @param rawId   用户填入的 id（可能是 part / shape）
 * @param role    'parent' | 'child' 仅用于错误信息更清晰
 */
export function resolveOrWrapPart(
  geom: Geometry,
  rawId: string,
  role: 'parent' | 'child',
): ResolveOrWrapResult {
  const id = rawId.trim();
  if (!id) return { ok: false, error: `${role}_id is required` };

  const byId = new Map<string, Statement>();
  for (const s of geom.statements) byId.set(s.id, s);

  const target = byId.get(id);
  if (!target) return { ok: false, error: `${role}_id "${id}" not in geometry` };

  if (target.op === 'part') {
    return { ok: true, partId: id, geometry: geom, resolution: 'direct' };
  }

  // 非 part：必须是 shape op，否则报清晰错误（避免 material/joint id 被错当成 shape）。
  // 这里走 op-registry，而不是只认 primitive，让 CSG/语义件也能被 placement/assembly 自动包裹。
  const spec = getOpSpec(target.op);
  if (spec?.produces !== 'shape') {
    return {
      ok: false,
      error: `${role}_id "${id}" is op "${target.op}"; expected part or shape`,
    };
  }

  // shape：找已有的 part(shape=ref(id))。Arg 的 ref kind 字段是 `name`（参考 serialize.ts）。
  const wrappingParts = geom.statements.filter(
    (s): s is Statement & { op: 'part' } => {
      if (s.op !== 'part') return false;
      const shapeArg = s.args.shape;
      return shapeArg?.kind === 'ref' && shapeArg.name === id;
    },
  );

  if (wrappingParts.length === 1) {
    return { ok: true, partId: wrappingParts[0].id, geometry: geom, resolution: 'reuse' };
  }
  if (wrappingParts.length > 1) {
    return {
      ok: false,
      error: `${role}_id "${id}" is wrapped by ${wrappingParts.length} parts (${wrappingParts.map(p => p.id).join(', ')}); pass the desired part id explicitly`,
    };
  }

  // 没人包它 → 自动追加 `part{n} = part(shape=ref(id))`
  const newId = freshId(geom, 'part');
  const args: Record<string, Arg> = { shape: ref(id) };
  const nextGeom = emit(geom, newId, 'part', args);
  return { ok: true, partId: newId, geometry: nextGeom, resolution: 'wrapped' };
}
