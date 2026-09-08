import {
  bool,
  emit,
  freshId,
  isValidId,
  list,
  makeGeometry,
  numList,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gSectionLoft(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const sections = parseSections(input.sections);
  if (sections.length < 2) {
    return { geometry: incoming, id: '', error: 'sections must contain at least two 3D section point lists' };
  }
  const n = sections[0].length;
  if (n < 9 || n % 3 !== 0) {
    return { geometry: incoming, id: '', error: 'each section must be [x1,y1,z1,...] with at least 3 points' };
  }
  if (sections.some(section => section.length !== n || section.length % 3 !== 0)) {
    return { geometry: incoming, id: '', error: 'all sections must have the same 3D point count' };
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'section_loft');
  if (!isValidId(id)) return { geometry: incoming, id: '', error: `invalid id "${id}"` };

  const args: Record<string, Arg> = {
    sections: list(sections.map(section => numList(section))),
  };
  if (input.cap !== undefined) args.cap = bool(Boolean(input.cap));
  if (input.closed !== undefined) args.closed = bool(Boolean(input.closed));

  return { geometry: emit(incoming, id, 'section_loft', args), id };
}

function parseSections(value: unknown): number[][] {
  if (Array.isArray(value)) {
    if (value.every(Array.isArray)) {
      return value.map(section => section.flat(Infinity).map(Number)).filter(section => section.every(Number.isFinite));
    }
    return [];
  }
  if (typeof value === 'string') {
    return value
      .split('|')
      .map(section => section.split(/[,\s;]+/).map(s => s.trim()).filter(Boolean).map(Number))
      .filter(section => section.length > 0 && section.every(Number.isFinite));
  }
  return [];
}

export default gSectionLoft;
