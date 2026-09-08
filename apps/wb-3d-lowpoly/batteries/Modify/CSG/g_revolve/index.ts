import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  parseGeometryPort,
  ref,
} from '../../../../vendor/dist/shared/types/index.js';

export function gRevolve(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const profileId = String(input.profile_id ?? '').trim();
  const known = new Set(incoming.statements.map(s => s.id));
  if (profileId === '') return { geometry: incoming, id: '', error: 'profile_id is required' };
  if (!isValidId(profileId)) return { geometry: incoming, id: '', error: `invalid profile_id "${profileId}"` };
  if (!known.has(profileId)) return { geometry: incoming, id: '', error: `profile_id "${profileId}" not found in upstream Geometry` };

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'revolve');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  return { geometry: emit(incoming, id, 'revolve', { profile: ref(profileId) }), id };
}

export default gRevolve;
