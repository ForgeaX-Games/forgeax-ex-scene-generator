/**
 * regionBsp: 用 BSP 递归切分 region，每个叶子输出一张 0/1 grid。
 *
 * 输入：region (grid)，density (number, 0-1)，seed (number)
 * 输出：partition (grid[], rank=1) — 每个 BSP 叶子一张 0/1 grid；count (number)
 *
 * BSP 算法核（makeLCG / pickSplit / bspSplit 的 split-decision 逻辑）完整照搬自
 * components/interests/building_generator 的 inner-wall BSP；唯一变化是收集叶子矩形而非
 * 切分线，wrapper 也不再做 1-cell 内缩——对全 bbox 做 BSP 以覆盖整个 region。
 *
 * 叶子之间留 1 行 / 列作为分隔，不属于任何子区域（这就是原 BSP 切分线的位置）。
 */

type Grid = number[][];
interface Room { r0: number; c0: number; r1: number; c1: number }

function makeLCG(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => { s = (Math.imul(1664525, s) + 1013904223) >>> 0; return s / 0x100000000; };
}

function pickSplit(lo: number, hi: number, rand: () => number): number {
  const minP = lo + 2, maxP = hi - 2;
  if (minP > maxP) return -1;
  const center = (minP + maxP) / 2;
  const half = Math.max(1, Math.floor((maxP - minP) * 0.4));
  const rMin = Math.max(minP, Math.floor(center - half)), rMax = Math.min(maxP, Math.ceil(center + half));
  return rMin + Math.floor(rand() * (rMax - rMin + 1));
}

function bspSplit(
  room: Room, depth: number, maxDepth: number,
  rand: () => number, leaves: Room[],
): void {
  if (depth >= maxDepth) { leaves.push(room); return; }
  const h = room.r1 - room.r0 + 1, w = room.c1 - room.c0 + 1;
  const canH = h >= 5, canV = w >= 5;
  if (!canH && !canV) { leaves.push(room); return; }
  let splitH: boolean;
  if (canH && !canV) splitH = true;
  else if (canV && !canH) splitH = false;
  else { const ratio = h / w; splitH = ratio > 1.2 ? true : ratio < 0.83 ? false : rand() < 0.5; }
  if (splitH) {
    const p = pickSplit(room.r0, room.r1, rand);
    if (p === -1) { leaves.push(room); return; }
    bspSplit({ r0: room.r0, c0: room.c0, r1: p - 1, c1: room.c1 }, depth + 1, maxDepth, rand, leaves);
    bspSplit({ r0: p + 1, c0: room.c0, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, leaves);
  } else {
    const p = pickSplit(room.c0, room.c1, rand);
    if (p === -1) { leaves.push(room); return; }
    bspSplit({ r0: room.r0, c0: room.c0, r1: room.r1, c1: p - 1 }, depth + 1, maxDepth, rand, leaves);
    bspSplit({ r0: room.r0, c0: p + 1, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, leaves);
  }
}

export function regionBsp(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { partition: [], count: 0 };
  }
  const density = typeof input.density === 'number' ? Math.max(0, Math.min(1, input.density)) : 0.5;
  const seedRaw = typeof input.seed === 'number' ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  const rows = region.length, cols = region[0].length;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
    if (region[r][c] !== 0) {
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (c < minC) minC = c; if (c > maxC) maxC = c;
    }
  if (maxR === -1) return { partition: [], count: 0 };

  const maxDepth = Math.round(density * 6);
  const rand = makeLCG(seed);
  const leaves: Room[] = [];
  bspSplit({ r0: minR, c0: minC, r1: maxR, c1: maxC }, 0, maxDepth, rand, leaves);

  const partition: Grid[] = leaves.map((leaf) => {
    const out: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
    for (let r = leaf.r0; r <= leaf.r1; r++) {
      for (let c = leaf.c0; c <= leaf.c1; c++) {
        if (region[r] && region[r][c] !== 0) out[r][c] = 1;
      }
    }
    return out;
  }).filter(g => {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (g[r][c] !== 0) return true;
    return false;
  });

  return { partition, count: partition.length };
}
