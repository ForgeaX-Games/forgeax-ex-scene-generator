import {
  emit,
  freshId,
  isValidId,
  makeGeometry,
  numList,
  parseGeometryPort,
  str,
  type Arg,
} from '../../../../vendor/dist/shared/types/index.js';

export function gMesh(input: Record<string, unknown>): Record<string, unknown> {
  const incoming = parseGeometryPort(input.geometry) ?? makeGeometry();
  const filename = String(input.filename ?? '').trim();
  const sx = Number(input.sx ?? 1);
  const sy = Number(input.sy ?? 1);
  const sz = Number(input.sz ?? 1);

  if (filename === '') {
    return { geometry: incoming, id: '', error: 'filename is required' };
  }
  if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(sz) || sx <= 0 || sy <= 0 || sz <= 0) {
    return { geometry: incoming, id: '', error: 'sx/sy/sz must be positive finite numbers' };
  }

  // 可选 bbox_min/bbox_max（米，未缩放局部 AABB）——通常接 g_bake_part 的同名输出。
  // 填上后，阶段2 场景里这个 mesh 才能解出 AABB（按 scale 缩放），让 QC 的
  // overlap 检测在场景组装时生效（否则 mesh 永远 missing_aabb、整段 overlap 被跳过）。
  const bboxMin = readVec3(input.bbox_min);
  const bboxMax = readVec3(input.bbox_max);
  if ((bboxMin && !bboxMax) || (!bboxMin && bboxMax)) {
    return { geometry: incoming, id: '', error: 'bbox_min and bbox_max must be provided together' };
  }
  if (bboxMin && bboxMax) {
    for (let i = 0; i < 3; i++) {
      if (bboxMax[i] < bboxMin[i]) {
        return { geometry: incoming, id: '', error: 'each bbox_max component must be >= bbox_min' };
      }
    }
  }

  const rawId = String(input.id ?? '').trim();
  const id = rawId !== '' ? rawId : freshId(incoming, 'mesh');
  if (!isValidId(id)) {
    return { geometry: incoming, id: '', error: `invalid id "${id}"` };
  }

  const args: Record<string, Arg> = {
    filename: str(filename),
    scale: numList([sx, sy, sz]),
  };
  if (bboxMin && bboxMax) {
    args.bbox_min = numList(bboxMin);
    args.bbox_max = numList(bboxMax);
  }

  const next = emit(incoming, id, 'mesh', args);
  return { geometry: next, id };
}

/** 把 array / "x,y,z" 字符串 / [n,n,n] 解析成长度 3 的有限数组；非法返回 null。 */
function readVec3(raw: unknown): [number, number, number] | null {
  if (raw === undefined || raw === null || raw === '') return null;
  let parts: unknown[];
  if (Array.isArray(raw)) {
    parts = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '' || trimmed === '[]') return null;
    parts = trimmed.replace(/^\[|\]$/g, '').split(/[,\s]+/).filter(s => s !== '');
  } else {
    return null;
  }
  if (parts.length !== 3) return null;
  const out: number[] = [];
  for (const p of parts) {
    const n = Number(p);
    if (!Number.isFinite(n)) return null;
    out.push(n);
  }
  return [out[0], out[1], out[2]];
}

export default gMesh;
