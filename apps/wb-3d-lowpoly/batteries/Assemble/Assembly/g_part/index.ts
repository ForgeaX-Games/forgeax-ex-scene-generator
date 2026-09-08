/**
 * g_part —— 追加 `id = part(shape=<ref>, material=<ref>?, origin=[...]?, rpy=[...]?, mass=...?)`。
 *
 * 把一个 shape ref 包成 URDF link 等价的 part 概念。
 * shape_id 是字符串（来自上游 g_box/g_cylinder/... 的 id 输出端口），在 DSL 中作为 ref 写入。
 */

import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  num,
  numList,
  opProduces,
  ref,
  parseGeometryPort,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gPart(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();

  const shapeId = String(input.shape_id ?? '').trim();
  if (shapeId === '') {
    return { geometry: incoming, id: '', error: 'shape_id is required (connect from a primitive battery)' };
  }
  if (!isValidId(shapeId)) {
    return { geometry: incoming, id: '', error: `invalid shape_id "${shapeId}"` };
  }

  // 校验 shape_id 必须已存在于上游
  const byId = new Map(incoming.statements.map(s => [s.id, s]));
  const knownIds = new Set(byId.keys());
  if (!knownIds.has(shapeId)) {
    return { geometry: incoming, id: '', error: `shape_id "${shapeId}" not found in upstream Geometry` };
  }
  const shape = byId.get(shapeId);
  if (!shape || !opProduces(shape.op, 'shape')) {
    return { geometry: incoming, id: '', error: `shape_id "${shapeId}" must reference a shape op, got "${shape?.op ?? 'unknown'}"` };
  }

  const materialId = String(input.material_id ?? '').trim();
  if (materialId !== '' && !knownIds.has(materialId)) {
    return { geometry: incoming, id: '', error: `material_id "${materialId}" not found in upstream Geometry` };
  }
  const material = materialId !== '' ? byId.get(materialId) : undefined;
  if (material && !opProduces(material.op, 'material')) {
    return { geometry: incoming, id: '', error: `material_id "${materialId}" must reference a material op, got "${material.op}"` };
  }

  const args: Record<string, Arg> = { shape: ref(shapeId) };
  if (materialId !== '') args.material = ref(materialId);

  const ox = Number(input.ox ?? 0);
  const oy = Number(input.oy ?? 0);
  const oz = Number(input.oz ?? 0);
  if (ox !== 0 || oy !== 0 || oz !== 0) {
    args.origin = numList([ox, oy, oz]);
  }

  const rr = Number(input.rr ?? 0);
  const rp = Number(input.rp ?? 0);
  const ry = Number(input.ry ?? 0);
  if (rr !== 0 || rp !== 0 || ry !== 0) {
    args.rpy = numList([rr, rp, ry]);
  }

  const mass = Number(input.mass ?? 0);
  if (mass > 0) args.mass = num(mass);

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'part');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const next = emit(incoming, id, 'part', args);
  return { geometry: next, id };
}

export default gPart;
