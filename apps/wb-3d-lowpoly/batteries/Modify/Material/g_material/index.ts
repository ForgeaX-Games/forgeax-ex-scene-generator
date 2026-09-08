/**
 * g_material —— 追加 `id = material(rgba=[r,g,b,a], texture=tex_ref?, metalness=.., roughness=..)` 一行。
 *
 * texture 是可选 ref，指向一条上游 `g_texture` 语句；metalness/roughness 是
 * 0..1 数值滑块，默认值与前端 materials.ts 的 defaultSpec 保持一致。
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
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gMaterial(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const r = Number(input.r ?? 0.5);
  const g = Number(input.g ?? 0.5);
  const b = Number(input.b ?? 0.5);
  const a = Number(input.a ?? 1);
  if (![r, g, b, a].every((v) => Number.isFinite(v))) {
    return { geometry: incoming, id: '', error: 'rgba components must be finite numbers' };
  }
  const clamped = [r, g, b, a].map((v) => Math.max(0, Math.min(1, v)));

  const metalness = Number(input.metalness ?? 0.05);
  const roughness = Number(input.roughness ?? 0.48);
  if (![metalness, roughness].every((v) => Number.isFinite(v))) {
    return { geometry: incoming, id: '', error: 'metalness/roughness must be finite numbers' };
  }

  const args: Record<string, Arg> = {
    rgba: numList(clamped),
    metalness: num(Math.max(0, Math.min(1, metalness))),
    roughness: num(Math.max(0, Math.min(1, roughness))),
  };

  const textureId = String(input.texture_id ?? '').trim();
  if (textureId !== '') {
    if (!isValidId(textureId)) {
      return { geometry: incoming, id: '', error: `invalid texture_id "${textureId}"` };
    }
    const byId = new Map(incoming.statements.map((s) => [s.id, s]));
    const tex = byId.get(textureId);
    if (!tex) {
      return { geometry: incoming, id: '', error: `texture_id "${textureId}" not found in upstream Geometry` };
    }
    if (tex.op !== 'texture') {
      return { geometry: incoming, id: '', error: `texture_id "${textureId}" must reference a texture op, got "${tex.op}"` };
    }
    args.texture = ref(textureId);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'mat');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'material', args);
  return { geometry: next, id };
}

export default gMaterial;
