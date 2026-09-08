import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
} from '../../../../vendor/dist/shared/types/index.js';

export function gProfilePolygon(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const points = parseFlatNumbers(input.points);
  if (!points || points.length < 6 || points.length % 2 !== 0) {
    return { geometry: incoming, id: '', error: 'points must be a flat [x1,y1,x2,y2,...] list with at least 3 points' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'profile');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'profile_polygon', { points: numList(points) }), id };
}

function parseFlatNumbers(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const flat = value.flat(Infinity);
    const nums = flat.map(Number);
    return nums.every(Number.isFinite) ? nums : null;
  }
  if (typeof value === 'string') {
    const nums = value.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean).map(Number);
    return nums.every(Number.isFinite) ? nums : null;
  }
  return null;
}

export default gProfilePolygon;
