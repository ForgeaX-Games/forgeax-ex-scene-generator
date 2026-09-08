/**
 * g_skeleton —— 在 Geometry DSL 末尾追加一行 `id = skeleton(root=<bone>)`。
 *
 * 声明骨架的根骨；其余骨骼通过各自 bone(parent=...) 链隐式挂到 root 上。
 * skeleton 出现即触发"角色路"编译（见 dsl-to-graph）。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  ref,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gSkeleton(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const rootId = readRef(input.root ?? input.root_id);
  if (!rootId) return fail('skeleton requires root=<bone id>');

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'skel');
  if (!isValidId(id)) return fail(`invalid id "${id}"`);

  const args: Record<string, Arg> = { root: ref(rootId) };
  const next = emit(incoming, id, 'skeleton', args);
  return { geometry: next, id, error: '' };
}

function readRef(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export default gSkeleton;
