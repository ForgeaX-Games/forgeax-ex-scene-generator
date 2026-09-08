/**
 * g_window —— 追加 `id = window(size=[w,h], depth=..., frame=..., mullion=..., glass=...)`。
 *
 * 窗框 + 十字中梃 + 可选玻璃，融合为单一 shape。
 */

import {
  bool,
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

const VALID_TYPES = new Set(['cross', 'grid', 'louver']);

/**
 * Read a "thickness in meters" param that agents often mistake for a toggle.
 * `true` (or "true") → `whenTrue` (a small enabled default); `false`/absent →
 * 0 (disabled); anything else is parsed as a number. This stops `Number(true)`
 * from becoming a nonsensical 1-metre value that fails downstream constraints.
 */
function coerceThickness(raw: unknown, whenTrue: number): number {
  if (raw === true) return whenTrue;
  if (raw === false || raw === null || raw === undefined) return 0;
  if (typeof raw === 'string') {
    const s = raw.trim().toLowerCase();
    if (s === 'true') return whenTrue;
    if (s === '' || s === 'false') return 0;
  }
  return Number(raw);
}

export function gWindow(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const w = Number(input.width ?? 1.2);
  const h = Number(input.height ?? 1.4);
  const depth = Number(input.depth ?? 0.2);
  const type = String(input.type ?? 'cross').trim().toLowerCase();
  if (![w, h, depth].every(Number.isFinite) || w <= 0 || h <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'window: width, height, depth must be positive finite numbers' };
  }
  if (!VALID_TYPES.has(type)) {
    return { geometry: incoming, id: '', error: `window: type must be cross/grid/louver, got "${type}"` };
  }

  const args: Record<string, Arg> = {
    size: numList([w, h]),
    depth: num(depth),
  };
  const frame = Number(input.frame ?? 0.06);
  // 与 baker 对齐：frame 必须 > 0 且 < min(size)/2（否则内洞退化，baker 抛错）。
  if (Number.isFinite(frame) && frame > 0) {
    if (frame * 2 >= Math.min(w, h)) {
      return { geometry: incoming, id: '', error: 'window: frame must be >0 and < half of min(size)' };
    }
    args.frame = num(frame);
  }
  const mullion = Number(input.mullion ?? 0.04);
  if (Number.isFinite(mullion) && mullion > 0) args.mullion = num(mullion);
  // `glass` is a THICKNESS in meters, but its "optional glass / >0 embeds a pane"
  // wording reads like a toggle, so agents routinely pass `glass: true` — which
  // `Number(true)` would silently turn into a 1-METRE-thick pane (>= any sane
  // depth → hard fail). Accept the boolean intent: true → a thin auto pane kept
  // under the depth, false/absent → no glass; a real number is taken verbatim.
  const glass = coerceThickness(input.glass, Math.min(0.02, depth * 0.5));
  // 与 baker 对齐：玻璃片厚必须 < 进深。
  if (Number.isFinite(glass) && glass > 0) {
    if (glass >= depth) {
      return {
        geometry: incoming,
        id: '',
        error: `window: glass thickness (${glass}m) must be < depth (${depth}m) — pass a thin value like 0.02, or true for an auto pane`,
      };
    }
    args.glass = num(glass);
  }
  if (type !== 'cross') args.type = str(type);
  if (type === 'grid' || type === 'louver') {
    const rows = Math.round(Number(input.rows ?? (type === 'louver' ? 5 : 3)));
    if (Number.isFinite(rows) && rows >= 1) args.rows = num(rows);
  }
  if (type === 'grid') {
    const cols = Math.round(Number(input.cols ?? 3));
    if (Number.isFinite(cols) && cols >= 1) args.cols = num(cols);
  }

  const paneWidth = Number(input.pane_width ?? 0);
  if (Number.isFinite(paneWidth) && paneWidth > 0 && type !== 'louver') args.pane_width = num(paneWidth);
  const sill = Number(input.sill ?? 0);
  if (Number.isFinite(sill) && sill > 0) args.sill = num(sill);
  if (input.arch_top === true || String(input.arch_top ?? '').toLowerCase() === 'true') {
    const frameForArch = Number.isFinite(frame) && frame > 0 ? frame : Math.min(w, h) * 0.08;
    if (h - w / 2 <= frameForArch) {
      return { geometry: incoming, id: '', error: 'window: arch_top needs height > width/2 + frame' };
    }
    args.arch_top = bool(true);
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'win');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'window', args), id };
}

export default gWindow;
