/**
 * g_door_frame —— append exactly one door_frame(...) shape.
 *
 * This intentionally differs from the legacy composite g_door battery. DSL
 * `door_frame` statements must remain one statement/one shape so references,
 * round-tripping, and subsequent door_leaf placement stay deterministic.
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gDoorFrame(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const width = Number(input.width);
  const height = Number(input.height);
  const depth = Number(input.depth);
  if (![width, height, depth].every(Number.isFinite) || width <= 0 || height <= 0 || depth <= 0) {
    return { geometry: incoming, id: '', error: 'door_frame: width, height and depth must be positive finite numbers' };
  }

  const frame = Number(input.frame ?? Math.min(width * 0.1, 0.08));
  if (!Number.isFinite(frame) || frame <= 0 || frame * 2 >= width || frame >= height) {
    return { geometry: incoming, id: '', error: 'door_frame: frame must be positive, < width/2, and < height' };
  }

  const transom = Number(input.transom ?? 0);
  if (!Number.isFinite(transom) || transom < 0 || transom >= height - frame) {
    return { geometry: incoming, id: '', error: 'door_frame: transom must be >= 0 and < height - frame' };
  }
  const sidelight = Number(input.sidelight ?? 0);
  if (!Number.isFinite(sidelight) || sidelight < 0 || (sidelight > 0 && 2 * (frame + sidelight) >= width)) {
    return { geometry: incoming, id: '', error: 'door_frame: sidelight must fit inside the opening' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId || freshId(incoming, 'door_frame');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, Arg> = {
    size: numList([width, height]),
    depth: num(depth),
    frame: num(frame),
  };
  if (transom > 0) args.transom = num(transom);
  if (sidelight > 0) args.sidelight = num(sidelight);
  return { geometry: emit(incoming, id, 'door_frame', args), id };
}

export default gDoorFrame;
