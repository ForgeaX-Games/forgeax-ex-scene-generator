import {
  bool,
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gExtrude(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const profileId = String(input.profile_id ?? '').trim();
  const known = new Set(incoming.statements.map(s => s.id));
  if (profileId === '') return { geometry: incoming, id: '', error: 'profile_id is required' };
  if (!isValidId(profileId)) return { geometry: incoming, id: '', error: `invalid profile_id "${profileId}"` };
  if (!known.has(profileId)) return { geometry: incoming, id: '', error: `profile_id "${profileId}" not found in upstream Geometry` };

  const height = Number(input.height ?? 1);
  if (!Number.isFinite(height) || height <= 0) {
    return { geometry: incoming, id: '', error: 'height must be a positive finite number' };
  }

  const center = input.center === undefined ? true : Boolean(input.center);
  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'extrude');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return {
    geometry: emit(incoming, id, 'extrude', { profile: ref(profileId), height: num(height), center: bool(center) }),
    id,
  };
}

export default gExtrude;
