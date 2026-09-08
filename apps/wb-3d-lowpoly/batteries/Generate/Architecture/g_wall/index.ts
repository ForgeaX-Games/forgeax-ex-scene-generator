/**
 * g_wall —— 追加 `id = wall(length=..., height=..., thickness=..., openings=[[x,w,sill,head],...])`。
 *
 * 直墙段：拉伸盒减去 openings 列出的门/窗洞。openings 以 JSON 字符串传入
 * （每项 [x, width, sill, head]，单位米；x = 洞心相对墙中点的 X 偏移）。
 */

import {
  bool,
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  parseQuadList,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

/**
 * 解析 openings 输入（JSON 字符串或已是数组）为 number[4][]。
 * 复用共享的 parseQuadList（与 g_floor_slab 的 holes 同一实现），仅传入本电池的错误文案。
 */
function parseOpenings(value: unknown): number[][] | { error: string } {
  // List-valued ports can arrive from the runtime wrapped in their node
  // parameter envelope. Accept both that form and the direct JSON/array forms.
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'openings' in value) {
    value = (value as { openings?: unknown }).openings;
  }
  return parseQuadList(value, {
    json: 'openings must be valid JSON, e.g. [[1,0.9,0,2.1]]',
    notArray: 'openings must be an array of [x, width, sill, head]',
    badRow: 'each opening must be [x, width, sill, head] of 4 finite numbers',
  });
}

export function gWall(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const length = Number(input.length ?? 4);
  const height = Number(input.height ?? 2.8);
  const thickness = Number(input.thickness ?? 0.2);
  if (![length, height, thickness].every(Number.isFinite) || length <= 0 || height <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'wall: length, height, thickness must be positive finite numbers' };
  }

  const openings = parseOpenings(input.openings);
  if (!Array.isArray(openings)) return { geometry: incoming, id: '', error: openings.error };

  const args: Record<string, Arg> = {
    length: num(length),
    height: num(height),
    thickness: num(thickness),
  };
  if (openings.length > 0) {
    args.openings = list(openings.map(o => numList(o)));
  }

  if (input.window_band === true || String(input.window_band ?? '').toLowerCase() === 'true') {
    args.window_band = bool(true);
    const bandSill = Number(input.band_sill ?? NaN);
    // UI/meta use 0 as "auto"; omit it so the baker can apply height-relative defaults.
    if (Number.isFinite(bandSill) && bandSill > 0) args.band_sill = num(bandSill);
    const bandHead = Number(input.band_head ?? NaN);
    if (Number.isFinite(bandHead) && bandHead > 0) args.band_head = num(bandHead);
    const bandMargin = Number(input.band_margin ?? NaN);
    if (Number.isFinite(bandMargin) && bandMargin > 0) args.band_margin = num(bandMargin);
    const paneWidth = Number(input.pane_width ?? 0);
    if (Number.isFinite(paneWidth) && paneWidth > 0) {
      args.pane_width = num(paneWidth);
      const mullion = Number(input.mullion ?? 0);
      if (Number.isFinite(mullion) && mullion > 0) args.mullion = num(mullion);
    }
  }

  const plinthHeight = Number(input.plinth_height ?? 0);
  if (Number.isFinite(plinthHeight) && plinthHeight > 0) {
    if (plinthHeight >= height) {
      return { geometry: incoming, id: '', error: 'wall: plinth_height must be < height' };
    }
    args.plinth_height = num(plinthHeight);
    const proj = Number(input.plinth_projection ?? 0);
    if (Number.isFinite(proj) && proj > 0) args.plinth_projection = num(proj);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'wall');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  // 每个洞口的建议窗/门摆放（相对墙局部坐标系：X 沿墙长、Z 底面为 0、Y 居中）。
  // 墙 shape X/Y 居中、底面 Z=0；窗/门扇同样 X/Y 居中、底面 Z=0，所以要让窗恰好
  // 填满洞口 [x,width,sill,head]，配套 g_window/g_door 应取 width=width、
  // height=head-sill、depth=thickness，并**以本墙 part 为父**关节 origin=[x,0,sill]。
  // 以墙为父是关键：这样洞口 x/sill 直接就是关节 origin；若改以根 slab 为父，就得
  // 自己把墙的平移+旋转套进去（沿 Y 的墙 rpy=[0,0,π/2] 尤其易错、导致洞窗错位）。
  const openingPlacements = openings.map(([x, w, sill, head]) => ({
    origin: [x, 0, sill],
    width: w,
    height: head - sill,
    depth: thickness,
  }));

  return {
    geometry: emit(incoming, id, 'wall', args),
    id,
    opening_placements: JSON.stringify(openingPlacements),
  };
}

export default gWall;
