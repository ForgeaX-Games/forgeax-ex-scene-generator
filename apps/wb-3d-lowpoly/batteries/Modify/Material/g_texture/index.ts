/**
 * g_texture —— 追加 `id = texture(image=.., repeat=[u,v], offset=[u,v], rotation=..)` 一行。
 *
 * `image` 是相对工程 `assets/textures/` 目录的路径字符串（不建上传/校验接口——文件由
 * 用户/agent 手动放进该目录）。本电池只负责把参数写进 DSL；真正的图片读取 + UV 计算
 * 发生在 g_bake_object → baker.service 那一侧（见 g_material 的 texture 输入）。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
} from '../../../../vendor/dist/shared/types/index.js';

export function gTexture(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const image = String(input.image ?? '').trim();
  if (image === '') {
    return { geometry: incoming, id: '', error: 'image is required (path relative to assets/textures/)' };
  }

  const repeatU = Number(input.repeat_u ?? 1);
  const repeatV = Number(input.repeat_v ?? 1);
  const offsetU = Number(input.offset_u ?? 0);
  const offsetV = Number(input.offset_v ?? 0);
  const rotation = Number(input.rotation ?? 0);
  if (![repeatU, repeatV, offsetU, offsetV, rotation].every((v) => Number.isFinite(v))) {
    return { geometry: incoming, id: '', error: 'repeat_u/repeat_v/offset_u/offset_v/rotation must be finite numbers' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'tex');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'texture', {
    image: str(image),
    repeat: numList([repeatU, repeatV]),
    offset: numList([offsetU, offsetV]),
    rotation: num(rotation),
  });
  return { geometry: next, id };
}

export default gTexture;
