/**
 * g_facade_panel —— 追加 `id = facade_panel(panel_size=[w,h], thickness=..., groove_*=...)`。
 *
 * 外立面挂板 / siding：薄板 + 可选水平 reveal 板缝阵列。
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
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_ORIENTATION = new Set(['wall', 'slab']);

export function gFacadePanel(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.panel_w ?? 2.4);
  const h = Number(input.panel_h ?? 2.8);
  const thickness = Number(input.thickness ?? 0.03);
  const orientation = String(input.orientation ?? 'wall').trim().toLowerCase();
  if (![w, h, thickness].every(Number.isFinite) || w <= 0 || h <= 0 || thickness <= 0) {
    return { geometry: incoming, id: '', error: 'facade_panel: panel_w, panel_h, thickness must be positive finite numbers' };
  }
  if (!VALID_ORIENTATION.has(orientation)) {
    return { geometry: incoming, id: '', error: `facade_panel: orientation must be wall or slab, got "${orientation}"` };
  }

  const args: Record<string, Arg> = {
    panel_size: numList([w, h]),
    thickness: num(thickness),
  };
  // 默认竖直挂板（wall）；仅在平躺（slab）时显式发出，保持 DSL 简洁。
  if (orientation !== 'wall') args.orientation = str(orientation);

  const grooveSpacing = Number(input.groove_spacing ?? 0);
  const grooveCount = Math.round(Number(input.groove_count ?? 6));
  const hasSpacing = Number.isFinite(grooveSpacing) && grooveSpacing > 0;
  const hasCount = Number.isFinite(grooveCount) && grooveCount > 0;
  if (hasSpacing || hasCount) {
    if (hasSpacing) args.groove_spacing = num(grooveSpacing);
    else args.groove_count = num(grooveCount);
    const gd = Number(input.groove_depth ?? 0);
    if (Number.isFinite(gd) && gd > 0) args.groove_depth = num(gd);
    const gw = Number(input.groove_width ?? 0);
    if (Number.isFinite(gw) && gw > 0) args.groove_width = num(gw);
    const direction = String(input.groove_direction ?? 'horizontal').trim().toLowerCase();
    if (direction === 'vertical' || direction === 'both') args.groove_direction = str(direction);
    else if (direction !== 'horizontal') {
      return { geometry: incoming, id: '', error: 'facade_panel: groove_direction must be horizontal/vertical/both' };
    }
    const boardStyle = String(input.board_style ?? 'flush').trim().toLowerCase();
    if (boardStyle === 'lap' || boardStyle === 'shiplap') args.board_style = str(boardStyle);
    else if (boardStyle !== 'flush') {
      return { geometry: incoming, id: '', error: 'facade_panel: board_style must be flush/lap/shiplap' };
    }
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'facade');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'facade_panel', args), id };
}

export default gFacadePanel;
