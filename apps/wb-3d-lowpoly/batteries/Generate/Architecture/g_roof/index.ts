/**
 * g_roof —— 追加 `id = roof(footprint=[w,d], type=..., height=..., thickness=..., overhang=...)`。
 *
 * footprint 之上的 flat / shed / gable / hip 屋顶。
 */

import {
  ARCH_DEFAULTS,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_TYPES = new Set(['flat', 'shed', 'gable', 'hip', 'gambrel', 'mansard', 'pyramid']);

export function gRoof(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const width = Number(input.width ?? 6);
  const depth = Number(input.depth ?? 4);
  const type = String(input.type ?? 'gable').trim().toLowerCase();
  if (![width, depth].every(Number.isFinite) || width <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'roof: width and depth must be positive finite numbers' };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `roof: type must be one of flat/shed/gable/hip/gambrel/mansard/pyramid, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    footprint: numList([width, depth]),
    type: str(type),
  };

  // overhang=0（女儿墙与外墙齐平）是有效值，必须原样下发：过去这里写 `> 0`，
  // 把显式的 0 当成"没给"丢掉，baker 于是回落到 ARCH_DEFAULTS 的 0.3。
  const overhang = Number(input.overhang ?? NaN);
  if (Number.isFinite(overhang) && overhang >= 0) args.overhang = num(overhang);

  const eave = Number(input.eave_overhang ?? NaN);
  if (Number.isFinite(eave) && eave >= 0) args.eave_overhang = num(eave);
  const verge = Number(input.verge_overhang ?? NaN);
  if (Number.isFinite(verge) && verge >= 0) args.verge_overhang = num(verge);

  if (type === 'flat') {
    const thickness = Number(input.thickness ?? ARCH_DEFAULTS.roof.flatThickness);
    if (Number.isFinite(thickness) && thickness > 0) args.thickness = num(thickness);
    const parapetH = Number(input.parapet_height ?? 0);
    if (Number.isFinite(parapetH) && parapetH > 0) {
      args.parapet_height = num(parapetH);
      const pt = Number(input.parapet_thickness ?? 0);
      if (Number.isFinite(pt) && pt > 0) args.parapet_thickness = num(pt);
      const coping = Number(input.coping_width ?? 0);
      if (Number.isFinite(coping) && coping > 0) args.coping_width = num(coping);
    }
  } else {
    const height = Number(input.height ?? ARCH_DEFAULTS.roof.height);
    if (!Number.isFinite(height) || height <= 0) {
      return { geometry: incoming, id: '', error: 'roof: height must be positive for non-flat roofs' };
    }
    args.height = num(height);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'roof');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'roof', args), id };
}

export default gRoof;
