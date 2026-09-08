/**
 * g_floor_slab —— 追加 `id = floor_slab(size=[w,d], thickness=..., holes=[[x,y,w,d],...])`。
 *
 * 矩形楼板，可选矩形洞（楼梯井 / 竖井）。holes 以 JSON 字符串传入。
 */

import {
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
 * 解析 holes 输入为 number[4][]。
 * 复用共享的 parseQuadList（与 g_wall 的 openings 同一实现），仅传入本电池的错误文案。
 */
function parseHoles(value: unknown): number[][] | { error: string } {
  // The runtime may preserve a list-valued port as its parameter envelope
  // (`{ ..., holes: [...] }`) instead of handing the nested list through
  // directly. Unwrap that representation defensively; direct/UI calls still
  // pass either JSON text or the array itself.
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && 'holes' in value) {
    value = (value as { holes?: unknown }).holes;
  }
  return parseQuadList(value, {
    json: 'holes must be valid JSON, e.g. [[1,1,1.2,2.8]]',
    notArray: 'holes must be an array of [x, y, w, d]',
    badRow: 'each hole must be [x, y, w, d] of 4 finite numbers',
  });
}

export function gFloorSlab(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const width = Number(input.width ?? 6);
  const depth = Number(input.depth ?? 4);
  const thickness = Number(input.thickness ?? 0.2);
  if (![width, depth, thickness].every(Number.isFinite) || width <= 0 || depth <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'floor_slab: width, depth, thickness must be positive finite numbers' };
  }

  const holes = parseHoles(input.holes);
  if (!Array.isArray(holes)) return { geometry: incoming, id: '', error: holes.error };
  for (const [x, y, holeWidth, holeDepth] of holes) {
    if (holeWidth <= 0 || holeDepth <= 0) {
      return { geometry: incoming, id: '', error: 'floor_slab: hole width and depth must be positive' };
    }
    if (Math.abs(x) + holeWidth / 2 > width / 2 + 1e-9 ||
        Math.abs(y) + holeDepth / 2 > depth / 2 + 1e-9) {
      return {
        geometry: incoming,
        id: '',
        error: `floor_slab: hole centered at [${x}, ${y}] with size [${holeWidth}, ${holeDepth}] exceeds slab [${width}, ${depth}]`,
      };
    }
  }

  const args: Record<string, Arg> = {
    size: numList([width, depth]),
    thickness: num(thickness),
  };
  if (holes.length > 0) args.holes = list(holes.map(h => numList(h)));

  const beamDepth = Number(input.beam_depth ?? 0);
  if (Number.isFinite(beamDepth) && beamDepth > 0) {
    args.beam_depth = num(beamDepth);
    const beamWidth = Number(input.beam_width ?? 0);
    if (Number.isFinite(beamWidth) && beamWidth > 0) {
      if (2 * beamWidth >= Math.min(width, depth)) {
        return { geometry: incoming, id: '', error: 'floor_slab: beam_width too large for slab' };
      }
      args.beam_width = num(beamWidth);
    }
  }
  const chamfer = Number(input.edge_chamfer ?? 0);
  if (Number.isFinite(chamfer) && chamfer > 0) args.edge_chamfer = num(chamfer);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'slab');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'floor_slab', args), id };
}

export default gFloorSlab;
