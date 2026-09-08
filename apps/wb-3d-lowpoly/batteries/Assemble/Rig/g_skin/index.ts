/**
 * g_skin —— 在 Geometry DSL 末尾追加一行 `id = skin(skeleton=<ref>, ...)`。
 *
 * 把可蒙皮网格绑定到骨架。权重不在 DSL / 后端存储——由前端测地体素绑定（auto）
 * 或最近单骨（rigid）按需求解。出现 skin 即触发"角色路"编译。
 */

import {
  bool as _bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  str,
  ref,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';
void _bool;

export function gSkin(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const fail = (error: string): Record<string, unknown> => ({ geometry: incoming, id: '', error });

  const skeletonId = readRef(input.skeleton ?? input.skeleton_id);
  if (!skeletonId) return fail('skin requires skeleton=<skeleton id>');

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'skin');
  if (!isValidId(id)) return fail(`invalid id "${id}"`);

  const args: Record<string, Arg> = { skeleton: ref(skeletonId) };

  const meshId = readRef(input.mesh ?? input.mesh_id);
  if (meshId) args.mesh = ref(meshId);

  const method = String(input.method ?? '').trim().toLowerCase();
  if (method === 'auto' || method === 'rigid') args.method = str(method);

  const resolution = readNum(input.resolution);
  if (resolution !== undefined) args.resolution = num(resolution);
  const maxInfluences = readNum(input.max_influences);
  if (maxInfluences !== undefined) args.max_influences = num(maxInfluences);
  const falloff = readNum(input.falloff);
  if (falloff !== undefined) args.falloff = num(falloff);

  const next = emit(incoming, id, 'skin', args);
  return { geometry: next, id, error: '' };
}

function readRef(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function readNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export default gSkin;
