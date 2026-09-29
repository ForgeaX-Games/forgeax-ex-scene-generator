/**
 * Volume：节点自身体素内容的判别联合，原生匹配内容形态（见重构规格「三条组织
 * 原则②」）。同质大区域（rest/地形）原生是 uniform/dense；真正分散的内容才是
 * sparse；逐格对象只在消费者调用 iterCells 时按需产出——不再有"先枚举成对象数组、
 * 事后再压缩"这一步（对照旧 grid2node 的 O(H·W·|zRange|) 枚举 + upsertCells 全量
 * 冻结）。
 */

export interface BBox3 {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}

export type CellKey = string;

export interface CellValue {
  readonly token: string;
  readonly state?: Readonly<Record<string, unknown>>;
}

export interface Cell extends CellValue {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Volume =
  | { readonly kind: 'empty' }
  | { readonly kind: 'uniform'; readonly bbox: BBox3; readonly token: string }
  | {
      readonly kind: 'dense';
      readonly bbox: BBox3;
      /** token 字典；data 里的值是 dict 下标 + 1（0 = 该格为空）。 */
      readonly dict: readonly string[];
      readonly data: Uint16Array;
      /** 非空格数——构造时算好，cellCount() 对 dense 也是 O(1)，不逐格扫描。 */
      readonly count: number;
    }
  | { readonly kind: 'sparse'; readonly cells: ReadonlyMap<CellKey, CellValue> };

export const EMPTY_VOLUME: Volume = { kind: 'empty' };

export function emptyVolume(): Volume {
  return EMPTY_VOLUME;
}

/**
 * Accept a raw Volume or `{ schema:'voxel', volume }` (SceneContent). Other
 * schemas (mesh, leftover wire) yield undefined so voxel projection skips them.
 */
export function asVolume(v: unknown): Volume | undefined {
  if (!v || typeof v !== 'object') return undefined
  const rec = v as { kind?: unknown; schema?: unknown; volume?: unknown }
  if (rec.schema === 'voxel') return asVolume(rec.volume)
  if (rec.kind === 'empty' || rec.kind === 'uniform' || rec.kind === 'dense' || rec.kind === 'sparse') {
    return v as Volume
  }
  return undefined
}

/**
 * 从 JSON 线上形态复原 Volume：PersistentStringMap.toJSON() 的通用拍平（见
 * persistent-map.ts 的 deepToJSON）会把 dense.data 变成 number[]、sparse.cells
 * 变成 plain object——这里是唯一知道"该还原回 Uint16Array / Map"的地方（通用
 * 拍平做不到反向推断，必须由懂字段语义的这一层显式处理）。empty/uniform 没有
 * Map/TypedArray 字段，原样即可。
 */
export function reviveVolumeFromWire(w: unknown): Volume {
  if (!w || typeof w !== 'object') return EMPTY_VOLUME;
  const kind = (w as { kind?: unknown }).kind;
  if (kind === 'dense') {
    const d = w as { bbox: BBox3; dict: readonly string[]; data: ArrayLike<number>; count: number };
    return { kind: 'dense', bbox: d.bbox, dict: d.dict, data: Uint16Array.from(d.data), count: d.count };
  }
  if (kind === 'sparse') {
    const s = w as { cells: Record<CellKey, CellValue> };
    return { kind: 'sparse', cells: new Map(Object.entries(s.cells)) };
  }
  if (kind === 'uniform') return w as Volume;
  return EMPTY_VOLUME;
}

export function cellKey(x: number, y: number, z: number): CellKey {
  return `${x},${y},${z}`;
}

export function parseCellKey(key: CellKey): { x: number; y: number; z: number } {
  const [x, y, z] = key.split(',').map(Number);
  return { x: x!, y: y!, z: z! };
}

export function bboxOf(v: Volume | unknown): BBox3 | null {
  const vol = asVolume(v);
  if (!vol || vol.kind === 'empty') return null;
  if (vol.kind === 'uniform' || vol.kind === 'dense') return vol.bbox;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const key of vol.cells.keys()) {
    const { x, y, z } = parseCellKey(key);
    any = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return any ? { minX, minY, minZ, maxX, maxY, maxZ } : null;
}

function bboxVolume(b: BBox3): number {
  return (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1) * (b.maxZ - b.minZ + 1);
}

function bboxUnion(a: BBox3, b: BBox3): BBox3 {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    minZ: Math.min(a.minZ, b.minZ),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
    maxZ: Math.max(a.maxZ, b.maxZ),
  };
}

/** O(1)：uniform 靠公式，dense 靠构造时缓存的 count，sparse 靠 Map.size。绝不逐格扫描/物化数组。 */
export function cellCount(v: Volume | unknown): number {
  const vol = asVolume(v);
  if (!vol || vol.kind === 'empty') return 0;
  if (vol.kind === 'uniform') return bboxVolume(vol.bbox);
  if (vol.kind === 'dense') return vol.count;
  return vol.cells.size;
}

export function isEmpty(v: Volume | unknown): boolean {
  return cellCount(v) === 0;
}

/** 按需生成器；从不预物化整个数组（对照旧 grid2node 的"先枚举成 VoxelCell[] 再冻结"）。 */
export function* iterCells(v: Volume | unknown): IterableIterator<Cell> {
  const vol = asVolume(v);
  if (!vol || vol.kind === 'empty') return;
  if (vol.kind === 'uniform') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = vol.bbox;
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          yield { x, y, z, token: vol.token };
        }
      }
    }
    return;
  }
  if (vol.kind === 'dense') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = vol.bbox;
    const w = maxX - minX + 1;
    const h = maxY - minY + 1;
    const d = maxZ - minZ + 1;
    for (let ix = 0; ix < w; ix++) {
      for (let iy = 0; iy < h; iy++) {
        for (let iz = 0; iz < d; iz++) {
          const idx = (ix * h + iy) * d + iz;
          const code = vol.data[idx];
          if (code) {
            yield { x: minX + ix, y: minY + iy, z: minZ + iz, token: vol.dict[code - 1]! };
          }
        }
      }
    }
    return;
  }
  for (const [key, value] of vol.cells) {
    const { x, y, z } = parseCellKey(key);
    yield { x, y, z, ...value };
  }
}

export function getCell(v: Volume, x: number, y: number, z: number): CellValue | undefined {
  if (v.kind === 'empty') return undefined;
  if (v.kind === 'uniform') {
    const b = v.bbox;
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) return undefined;
    return { token: v.token };
  }
  if (v.kind === 'dense') {
    const b = v.bbox;
    if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY || z < b.minZ || z > b.maxZ) return undefined;
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const d = b.maxZ - b.minZ + 1;
    const idx = ((x - b.minX) * h + (y - b.minY)) * d + (z - b.minZ);
    void w;
    const code = v.data[idx];
    return code ? { token: v.dict[code - 1]! } : undefined;
  }
  return v.cells.get(cellKey(x, y, z));
}

export function uniformVolume(bbox: BBox3, token: string): Volume {
  if (bboxVolume(bbox) <= 0) return EMPTY_VOLUME;
  return { kind: 'uniform', bbox, token };
}

/** 从稀疏 cell 列表构造 dense（当 bbox 已知且填充率高时用这个,比 sparse 省内存)。 */
export function denseVolumeFromCells(bbox: BBox3, cells: Iterable<Cell>): Volume {
  if (bboxVolume(bbox) <= 0) return EMPTY_VOLUME;
  const w = bbox.maxX - bbox.minX + 1;
  const h = bbox.maxY - bbox.minY + 1;
  const d = bbox.maxZ - bbox.minZ + 1;
  const data = new Uint16Array(w * h * d);
  const dict: string[] = [];
  const dictIdx = new Map<string, number>();
  let count = 0;
  for (const c of cells) {
    if (c.x < bbox.minX || c.x > bbox.maxX || c.y < bbox.minY || c.y > bbox.maxY || c.z < bbox.minZ || c.z > bbox.maxZ) {
      throw new Error(`denseVolumeFromCells: cell (${c.x},${c.y},${c.z}) outside bbox`);
    }
    let code = dictIdx.get(c.token);
    if (code === undefined) {
      dict.push(c.token);
      code = dict.length;
      dictIdx.set(c.token, code);
    }
    const idx = ((c.x - bbox.minX) * h + (c.y - bbox.minY)) * d + (c.z - bbox.minZ);
    if (!data[idx]) count++;
    data[idx] = code;
  }
  if (count === 0) return EMPTY_VOLUME;
  return { kind: 'dense', bbox, dict, data, count };
}

/**
 * 通用智能构造：给一批 (可能是数组、也可能是生成器的) Cell，自动选出最省内存的
 * 形态——不要求调用方（grid2node / voxels2scene / json2voxels 等 bridge 电池）
 * 自己判断该走 uniform / dense / sparse 哪条路。
 *   - 空输入 → empty
 *   - 整个 bbox 满填、单一 token、都没有 state → uniform（O(1)，不分配任何数组；
 *     这是"矩形整块地形/rest"这类最常见输入的最优解）
 *   - 填充率 ≥ DENSE_FILL_THRESHOLD → dense（typed array）
 *   - 否则 → sparse（Map）
 * 只把输入物化一次到一个临时数组里判断 bbox/满填/token 一致性，不会走两遍生成器。
 */
export function volumeFromCells(cells: Iterable<Cell>): Volume {
  const list = Array.isArray(cells) ? cells : Array.from(cells);
  if (list.length === 0) return EMPTY_VOLUME;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let uniformToken: string | null = list[0]!.token;
  let allNoState = true;
  for (const c of list) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.z < minZ) minZ = c.z;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
    if (c.z > maxZ) maxZ = c.z;
    if (c.token !== uniformToken) uniformToken = null;
    if (c.state !== undefined) allNoState = false;
  }
  const bbox: BBox3 = { minX, minY, minZ, maxX, maxY, maxZ };
  const capacity = bboxVolume(bbox);
  if (uniformToken !== null && allNoState && list.length === capacity) {
    return uniformVolume(bbox, uniformToken);
  }
  // Dense volumes encode token ids only; state-bearing cells must stay sparse or
  // instance/anchor metadata is silently lost during scene projection.
  if (allNoState && list.length / capacity >= DENSE_FILL_THRESHOLD) {
    return denseVolumeFromCells(bbox, list);
  }
  return sparseVolumeFromCells(list);
}

export function sparseVolumeFromCells(cells: Iterable<Cell>): Volume {
  const map = new Map<CellKey, CellValue>();
  for (const c of cells) {
    map.set(cellKey(c.x, c.y, c.z), c.state !== undefined ? { token: c.token, state: c.state } : { token: c.token });
  }
  if (map.size === 0) return EMPTY_VOLUME;
  return { kind: 'sparse', cells: map };
}

/** 填充率超过该阈值时倾向物化成 dense（typed array 更省内存也更快 iterCells），否则用 sparse。 */
const DENSE_FILL_THRESHOLD = 0.2;

function materialize(bbox: BBox3 | null, cells: Map<CellKey, CellValue>): Volume {
  if (cells.size === 0) return EMPTY_VOLUME;
  // 同 volumeFromCells：dense 存不下 per-cell state，带标签就必须留在 sparse。
  if (hasAnyState({ kind: 'sparse', cells })) return { kind: 'sparse', cells };
  if (bbox && cellCount({ kind: 'sparse', cells }) / bboxVolume(bbox) >= DENSE_FILL_THRESHOLD) {
    const asCells: Cell[] = [];
    for (const [key, v] of cells) {
      const { x, y, z } = parseCellKey(key);
      asCells.push({ x, y, z, ...v });
    }
    return denseVolumeFromCells(bbox, asCells);
  }
  return { kind: 'sparse', cells };
}

function dims(b: BBox3): { w: number; h: number; d: number } {
  return { w: b.maxX - b.minX + 1, h: b.maxY - b.minY + 1, d: b.maxZ - b.minZ + 1 };
}

/**
 * true 仅当 v 是 sparse 且至少一个 cell 带 state——uniform/dense/empty 结构上不可能带 state，
 * 一律 false。O(sparse 基数)：sparse 按构造（DENSE_FILL_THRESHOLD）本身就是低基数，这个检查的
 * 代价永远可忽略，用它来判断"能不能安全走下面的 typed-array 快速路径而不丢 state"。
 */
function hasAnyState(v: Volume): boolean {
  if (v.kind !== 'sparse') return false;
  for (const cv of v.cells.values()) {
    if (cv.state !== undefined) return true;
  }
  return false;
}

/**
 * 把 uniform/dense/sparse 的 token 编码写进（叠加进）一个已按 bbox 分配好的 Uint16Array——
 * 全程只有下标运算 + dict 查找，不经过 Map<string,object> 中转。uniform/dense 分支是纯数值
 * 嵌套循环，对"体积很大的那一侧"（典型是整块地形 base）代价是 O(cells) 的数组写入，不是
 * O(cells) 次字符串键 + 对象分配（这正是旧实现"画一个 10×10 小块也要给百万格地形逐格建
 * Map"的真正开销来源）。sparse 分支走 Map 迭代，但 sparse 本身低基数，代价始终可忽略。
 */
function fillDense(
  bbox: BBox3,
  v: Volume,
  data: Uint16Array,
  dict: string[],
  dictIdx: Map<string, number>,
  h: number,
  d: number,
): void {
  if (v.kind === 'empty') return;
  const codeOf = (token: string): number => {
    let c = dictIdx.get(token);
    if (c === undefined) {
      dict.push(token);
      c = dict.length;
      dictIdx.set(token, c);
    }
    return c;
  };
  if (v.kind === 'uniform') {
    const code = codeOf(v.token);
    const { minX, minY, minZ, maxX, maxY, maxZ } = v.bbox;
    for (let x = minX; x <= maxX; x++) {
      const bx = (x - bbox.minX) * h * d;
      for (let y = minY; y <= maxY; y++) {
        const by = bx + (y - bbox.minY) * d;
        for (let z = minZ; z <= maxZ; z++) data[by + (z - bbox.minZ)] = code;
      }
    }
    return;
  }
  if (v.kind === 'dense') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = v.bbox;
    const sw = maxX - minX + 1;
    const sh = maxY - minY + 1;
    const sd = maxZ - minZ + 1;
    const remap = v.dict.map((t) => codeOf(t));
    for (let ix = 0; ix < sw; ix++) {
      for (let iy = 0; iy < sh; iy++) {
        const srcBase = (ix * sh + iy) * sd;
        const dstBase = ((minX + ix - bbox.minX) * h + (minY + iy - bbox.minY)) * d + (minZ - bbox.minZ);
        for (let iz = 0; iz < sd; iz++) {
          const code = v.data[srcBase + iz];
          if (code) data[dstBase + iz] = remap[code - 1]!;
        }
      }
    }
    return;
  }
  for (const [key, cv] of v.cells) {
    const { x, y, z } = parseCellKey(key);
    if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY || z < bbox.minZ || z > bbox.maxZ) continue;
    data[((x - bbox.minX) * h + (y - bbox.minY)) * d + (z - bbox.minZ)] = codeOf(cv.token);
  }
}

/**
 * 只关心"这一格有没有被 v 覆盖"，完全不看 v 自己的 token/state——paint 的 region 参数、
 * subtract 的 b 参数都是这个"形状遮罩"语义。跟 fillDense 同款 O(cells) 纯数组写入。
 */
function paintFootprint(bbox: BBox3, v: Volume, code: number, data: Uint16Array, h: number, d: number): void {
  if (v.kind === 'empty') return;
  if (v.kind === 'uniform') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = v.bbox;
    for (let x = minX; x <= maxX; x++) {
      const bx = (x - bbox.minX) * h * d;
      for (let y = minY; y <= maxY; y++) {
        const by = bx + (y - bbox.minY) * d;
        for (let z = minZ; z <= maxZ; z++) data[by + (z - bbox.minZ)] = code;
      }
    }
    return;
  }
  if (v.kind === 'dense') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = v.bbox;
    const sw = maxX - minX + 1;
    const sh = maxY - minY + 1;
    const sd = maxZ - minZ + 1;
    for (let ix = 0; ix < sw; ix++) {
      for (let iy = 0; iy < sh; iy++) {
        const srcBase = (ix * sh + iy) * sd;
        const dstBase = ((minX + ix - bbox.minX) * h + (minY + iy - bbox.minY)) * d + (minZ - bbox.minZ);
        for (let iz = 0; iz < sd; iz++) {
          if (v.data[srcBase + iz]) data[dstBase + iz] = code;
        }
      }
    }
    return;
  }
  for (const key of v.cells.keys()) {
    const { x, y, z } = parseCellKey(key);
    if (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY || z < bbox.minZ || z > bbox.maxZ) continue;
    data[((x - bbox.minX) * h + (y - bbox.minY)) * d + (z - bbox.minZ)] = code;
  }
}

function finishDense(bbox: BBox3, data: Uint16Array, dict: string[]): Volume {
  let count = 0;
  for (let i = 0; i < data.length; i++) if (data[i]) count++;
  if (count === 0) return EMPTY_VOLUME;
  return { kind: 'dense', bbox, dict, data, count };
}

/**
 * union(a,b)：叠加，重叠格 b 的 token 赢（"后画的盖住先画的"）。
 *
 * dense+dense 同 bbox 仍走最省的 unionDenseFastPath。其余情况下，只要 a、b 都不是"带 state
 * 的 sparse"（uniform/dense 结构上不可能带 state；sparse 也常常不带），就走 typed-array 通用
 * 路径——这覆盖了最常见也最容易被忽视的场景："大块 uniform/dense 地形 ∪ 一小块新绘区域"，
 * 不再需要为了叠一小块区域而把整块地形逐格拆成 Map<string,object>。只有当某一侧确实是带
 * state 的 sparse（低基数，天然便宜）时才退回旧的 Map 路径，保证 state 不丢。
 */
export function union(a: Volume, b: Volume): Volume {
  if (a.kind === 'empty') return b;
  if (b.kind === 'empty') return a;
  if (a.kind === 'dense' && b.kind === 'dense' && bboxEqual(a.bbox, b.bbox)) {
    return unionDenseFastPath(a, b);
  }
  if (!hasAnyState(a) && !hasAnyState(b)) {
    const bbox = bboxUnion(bboxOf(a)!, bboxOf(b)!);
    const { w, h, d } = dims(bbox);
    const data = new Uint16Array(w * h * d);
    const dict: string[] = [];
    const dictIdx = new Map<string, number>();
    fillDense(bbox, a, data, dict, dictIdx, h, d);
    fillDense(bbox, b, data, dict, dictIdx, h, d);
    return finishDense(bbox, data, dict);
  }
  const bbox = bboxUnion(bboxOf(a)!, bboxOf(b)!);
  const merged = new Map<CellKey, CellValue>();
  for (const c of iterCells(a)) merged.set(cellKey(c.x, c.y, c.z), { token: c.token, ...(c.state ? { state: c.state } : {}) });
  for (const c of iterCells(b)) merged.set(cellKey(c.x, c.y, c.z), { token: c.token, ...(c.state ? { state: c.state } : {}) });
  return materialize(bbox, merged);
}

function bboxEqual(a: BBox3, b: BBox3): boolean {
  return a.minX === b.minX && a.minY === b.minY && a.minZ === b.minZ && a.maxX === b.maxX && a.maxY === b.maxY && a.maxZ === b.maxZ;
}

function unionDenseFastPath(a: Volume & { kind: 'dense' }, b: Volume & { kind: 'dense' }): Volume {
  const data = new Uint16Array(a.data.length);
  const dict: string[] = [];
  const dictIdx = new Map<string, number>();
  const remapA = a.dict.map((t) => {
    let code = dictIdx.get(t);
    if (code === undefined) {
      dict.push(t);
      code = dict.length;
      dictIdx.set(t, code);
    }
    return code;
  });
  const remapB = b.dict.map((t) => {
    let code = dictIdx.get(t);
    if (code === undefined) {
      dict.push(t);
      code = dict.length;
      dictIdx.set(t, code);
    }
    return code;
  });
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const bv = b.data[i];
    const av = a.data[i];
    const code = bv ? remapB[bv - 1]! : av ? remapA[av - 1]! : 0;
    data[i] = code;
    if (code) count++;
  }
  if (count === 0) return EMPTY_VOLUME;
  return { kind: 'dense', bbox: a.bbox, dict, data, count };
}

/**
 * subtract(a,b)：从 a 中去掉 b 覆盖的格子（不管 b 的 token 是什么）——"rest = 矩形减去一块子区域"
 * 的直接表达。b 的实际内容从不进入结果，只当形状遮罩用，所以只要 a 不是"带 state 的 sparse"就
 * 能安全走 typed-array 路径（b 是 uniform/dense/sparse 都无所谓，paintFootprint 统一处理）。
 */
export function subtract(a: Volume, b: Volume): Volume {
  if (a.kind === 'empty' || b.kind === 'empty') return a;
  if (a.kind === 'dense' && b.kind === 'dense' && bboxEqual(a.bbox, b.bbox)) {
    const data = new Uint16Array(a.data.length);
    let count = 0;
    for (let i = 0; i < data.length; i++) {
      const v = b.data[i] ? 0 : a.data[i]!;
      data[i] = v;
      if (v) count++;
    }
    if (count === 0) return EMPTY_VOLUME;
    return { kind: 'dense', bbox: a.bbox, dict: a.dict, data, count };
  }
  if (!hasAnyState(a)) {
    const bbox = bboxOf(a)!;
    const { w, h, d } = dims(bbox);
    const data = new Uint16Array(w * h * d);
    const dict: string[] = [];
    const dictIdx = new Map<string, number>();
    fillDense(bbox, a, data, dict, dictIdx, h, d);
    paintFootprint(bbox, b, 0, data, h, d);
    return finishDense(bbox, data, dict);
  }
  const bCells = new Set<CellKey>();
  for (const c of iterCells(b)) bCells.add(cellKey(c.x, c.y, c.z));
  const result = new Map<CellKey, CellValue>();
  for (const c of iterCells(a)) {
    const key = cellKey(c.x, c.y, c.z);
    if (!bCells.has(key)) result.set(key, { token: c.token, ...(c.state ? { state: c.state } : {}) });
  }
  return materialize(bboxOf(a), result);
}

/**
 * paint(base, region, token)：region 覆盖的每个格子在 base 上设为 token（region 自身的
 * token/state 被完全忽略，只用作形状/掩码）。因此结果里除了"被 region 覆盖的格子"（固定
 * 变成 `{token}`，从不带 state）之外，其余格子原样保留 base 的值——只要 base 不是"带 state
 * 的 sparse"，就能安全走 typed-array 路径，region 是任何形态都无所谓。
 */
export function paint(base: Volume, region: Volume, token: string): Volume {
  if (region.kind === 'empty') return base;
  if (!hasAnyState(base)) {
    const baseBbox = bboxOf(base);
    const regionBbox = bboxOf(region)!;
    const bbox = baseBbox ? bboxUnion(baseBbox, regionBbox) : regionBbox;
    const { w, h, d } = dims(bbox);
    const data = new Uint16Array(w * h * d);
    const dict: string[] = [];
    const dictIdx = new Map<string, number>();
    if (base.kind !== 'empty') fillDense(bbox, base, data, dict, dictIdx, h, d);
    let code = dictIdx.get(token);
    if (code === undefined) {
      dict.push(token);
      code = dict.length;
      dictIdx.set(token, code);
    }
    paintFootprint(bbox, region, code, data, h, d);
    return finishDense(bbox, data, dict);
  }
  const merged = new Map<CellKey, CellValue>();
  for (const c of iterCells(base)) merged.set(cellKey(c.x, c.y, c.z), { token: c.token, ...(c.state ? { state: c.state } : {}) });
  for (const c of iterCells(region)) merged.set(cellKey(c.x, c.y, c.z), { token });
  const bbox = base.kind === 'empty' ? bboxOf(region) : bboxUnion(bboxOf(base)!, bboxOf(region)!);
  return materialize(bbox, merged);
}
