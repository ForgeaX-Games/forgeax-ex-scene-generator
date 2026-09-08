/**
 * g_railing —— 追加 `id = railing(length=..., height=..., ...)`。
 *
 * 栏杆 / 护栏：沿 X 一段，两端方立柱 + 顶扶手 + 均布竖向栏杆条。可用于阳台、
 * 走廊、平台、楼梯侧。
 */

import {
  bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gRailing(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const length = Number(input.length ?? 3);
  const height = Number(input.height ?? 1.0);
  if (![length, height].every(Number.isFinite) || length <= 0 || height <= 0) {
    return { geometry: incoming, id: '', error: 'railing: length and height must be positive finite numbers' };
  }

  const args: Record<string, Arg> = {
    length: num(length),
    height: num(height),
  };
  const thickness = Number(input.thickness ?? 0.04);
  if (Number.isFinite(thickness) && thickness > 0) args.thickness = num(thickness);
  const postSize = Number(input.post_size ?? 0);
  // 与 baker 对齐：端立柱方截面必须 < 总长（否则两端立柱吃满整段，baker 抛错）。
  if (Number.isFinite(postSize) && postSize > 0) {
    if (postSize >= length) {
      return { geometry: incoming, id: '', error: 'railing: post_size must be < length' };
    }
    args.post_size = num(postSize);
  }
  const railHeight = Number(input.rail_height ?? 0);
  // 与 baker 对齐：顶扶手高必须 < 总高。
  if (Number.isFinite(railHeight) && railHeight > 0) {
    if (railHeight >= height) {
      return { geometry: incoming, id: '', error: 'railing: rail_height must be < height' };
    }
    args.rail_height = num(railHeight);
  }
  const balusterCount = Math.round(Number(input.baluster_count ?? -1));
  if (Number.isFinite(balusterCount) && balusterCount >= 0) args.baluster_count = num(balusterCount);

  const postShape = String(input.post_shape ?? 'square').trim().toLowerCase();
  if (postShape !== 'square' && postShape !== 'round') {
    return { geometry: incoming, id: '', error: 'railing: post_shape must be round or square' };
  }
  if (postShape === 'round') {
    args.post_shape = str('round');
    const postRadius = Number(input.post_radius ?? 0);
    if (Number.isFinite(postRadius) && postRadius > 0) args.post_radius = num(postRadius);
  }
  const postSpacing = Number(input.post_spacing ?? 0);
  if (Number.isFinite(postSpacing) && postSpacing > 0) args.post_spacing = num(postSpacing);
  const topRailWidth = Number(input.top_rail_width ?? 0);
  if (Number.isFinite(topRailWidth) && topRailWidth > 0) args.top_rail_width = num(topRailWidth);
  if (input.bottom_rail === true || String(input.bottom_rail ?? '').toLowerCase() === 'true') {
    args.bottom_rail = bool(true);
  }
  if (input.mid_rail === true || String(input.mid_rail ?? '').toLowerCase() === 'true') {
    args.mid_rail = bool(true);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'rail');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'railing', args), id };
}

export default gRailing;
