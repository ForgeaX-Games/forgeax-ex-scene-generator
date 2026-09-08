/**
 * g_column —— 追加 `id = column(height=..., radius=..., shape=..., ...)`。
 *
 * 柱子 / 立柱：圆柱或方柱柱身 + 可选柱础(base)、柱头(capital) 方板。底面落在 Z=0。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

const VALID_SHAPES = new Set(['round', 'square']);

export function gColumn(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const height = Number(input.height ?? 3);
  const radius = Number(input.radius ?? 0.2);
  const shape = String(input.shape ?? 'round').trim().toLowerCase();
  if (![height, radius].every(Number.isFinite) || height <= 0 || radius <= 0) {
    return { geometry: incoming, id: '', error: 'column: height and radius must be positive finite numbers' };
  }
  if (!VALID_SHAPES.has(shape)) {
    return { geometry: incoming, id: '', error: `column: shape must be round or square, got "${shape}"` };
  }

  const baseH = Number(input.base_height ?? 0);
  const capH = Number(input.capital_height ?? 0);
  const base = Number.isFinite(baseH) && baseH > 0 ? baseH : 0;
  const cap = Number.isFinite(capH) && capH > 0 ? capH : 0;
  if (base + cap >= height) {
    return { geometry: incoming, id: '', error: 'column: base_height + capital_height must be < height' };
  }

  const args: Record<string, Arg> = {
    height: num(height),
    radius: num(radius),
  };
  if (shape !== 'round') args.shape = str(shape);
  if (base > 0) args.base_height = num(base);
  if (cap > 0) args.capital_height = num(cap);

  const taper = Number(input.taper ?? 1);
  if (Number.isFinite(taper) && taper > 0 && taper < 1) args.taper = num(taper);
  if (base > 0 && String(input.base_style ?? '').trim().toLowerCase() === 'stepped') {
    args.base_style = str('stepped');
  }
  if (cap > 0 && String(input.capital_style ?? '').trim().toLowerCase() === 'stepped') {
    args.capital_style = str('stepped');
  }
  const flutes = Math.round(Number(input.flutes ?? 0));
  if (Number.isFinite(flutes) && flutes > 0 && shape === 'round') args.flutes = num(flutes);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'col');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'column', args), id };
}

export default gColumn;
