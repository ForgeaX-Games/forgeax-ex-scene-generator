/**
 * regionBlockyCarve: 对区域 bbox 做两层随机退缩雕刻，得到 blocky 不规则子区域。
 *
 * 输入：region (grid) — 0/1 区域；seed (number)
 * 输出：region (grid) — 雕刻后的 0/1 区域，与输入同形状
 *
 * 算法本体（getBoundingBox / weightedSample / splitSegments / applyLayer1 /
 * layer2Probs / applyLayer2 / scaleToFitBBox / carveOne）完整照搬自
 * components/interests/building_generator，单 region 输入由 autoIterate fanout 处理。
 */

type Grid = number[][];
type Rect = { minR: number; maxR: number; minC: number; maxC: number };

function makeMulberry32(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getBoundingBox(grid: Grid): Rect | null {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== 0) {
        if (r < minR) minR = r; if (r > maxR) maxR = r;
        if (c < minC) minC = c; if (c > maxC) maxC = c;
      }
  return maxR === -1 ? null : { minR, maxR, minC, maxC };
}

function weightedSample(rand: () => number, values: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < values.length; i++) { r -= weights[i]; if (r <= 0) return values[i]; }
  return values[values.length - 1];
}

function splitSegments(len: number, n: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  const base = Math.floor(len / n), extra = len % n;
  let pos = 0;
  for (let i = 0; i < n; i++) { const sl = base + (i < extra ? 1 : 0); segs.push([pos, pos + sl]); pos += sl; }
  return segs;
}

function applyLayer1(bbox: Rect, rand: () => number) {
  const vals = [1, 2, 3, 4], wts = [90, 70, 25, 15];
  const top = weightedSample(rand, vals, wts), bottom = weightedSample(rand, vals, wts);
  const left = weightedSample(rand, vals, wts), right = weightedSample(rand, vals, wts);
  const h = bbox.maxR - bbox.minR + 1, w = bbox.maxC - bbox.minC + 1;
  const sT = Math.min(top, Math.floor((h - 1) / 2));
  const sB = Math.min(bottom, h - 1 - sT);
  const sL = Math.min(left, Math.floor((w - 1) / 2));
  const sR = Math.min(right, w - 1 - sL);
  return {
    inner: { minR: bbox.minR + sT, maxR: bbox.maxR - sB, minC: bbox.minC + sL, maxC: bbox.maxC - sR },
    setbacks: { top: sT, bottom: sB, left: sL, right: sR },
  };
}

function layer2Probs(sb: number) {
  const t = (sb - 1) / 3;
  return { inwardProb: 0.80 - t * 0.60, outwardProb: 0.10 - t * 0.08 };
}

function applyLayer2(
  bbox: Rect,
  inner: Rect,
  setbacks: { top: number; bottom: number; left: number; right: number },
  rand: () => number,
  rows: number,
  cols: number,
): Grid {
  const iW = inner.maxC - inner.minC + 1, iH = inner.maxR - inner.minR + 1;
  const topOff = new Array(iW).fill(0), bottomOff = new Array(iW).fill(0);
  const leftOff = new Array(iH).fill(0), rightOff = new Array(iH).fill(0);
  for (const side of (['top', 'bottom', 'left', 'right'] as const)) {
    const isH = side === 'top' || side === 'bottom';
    const edgeLen = isH ? iW : iH;
    const edgeSB = setbacks[side];
    const { inwardProb, outwardProb } = layer2Probs(edgeSB);
    const nSeg = Math.min(6, Math.max(1, Math.ceil(edgeLen / 7)));
    const segs = splitSegments(edgeLen, nSeg);
    const offArr = side === 'top' ? topOff : side === 'bottom' ? bottomOff : side === 'left' ? leftOff : rightOff;
    for (const [ss, se] of segs) {
      const rv = rand(); let dir = 0;
      if (rv < inwardProb) dir = 1;
      else if (rv < inwardProb + outwardProb) dir = -1;
      if (dir === 0) continue;
      const rv2 = rand();
      const mag = dir > 0 ? (rv2 < 0.70 ? 1 : 2) : (rv2 < 0.80 || edgeSB < 2 ? 1 : 2);
      const delta = dir * mag;
      for (let i = ss; i < se; i++) offArr[i] = delta < 0 ? Math.max(-edgeSB, offArr[i] + delta) : offArr[i] + delta;
    }
  }
  const topA = topOff.map(o => inner.minR + o), botA = bottomOff.map(o => inner.maxR - o);
  const lefA = leftOff.map(o => inner.minC + o), rigA = rightOff.map(o => inner.maxC - o);
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    for (let c = bbox.minC; c <= bbox.maxC; c++) {
      const ci = c - inner.minC, ri = r - inner.minR;
      const inTB = ci >= 0 && ci < iW && r >= topA[ci] && r <= botA[ci];
      const inLR = ri >= 0 && ri < iH && c >= lefA[ri] && c <= rigA[ri];
      if (inTB && inLR) output[r][c] = 1;
    }
  }
  return output;
}

function scaleToFitBBox(carved: Grid, carvedBBox: Rect, targetBBox: Rect, rows: number, cols: number): Grid {
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const cH = carvedBBox.maxR - carvedBBox.minR + 1, cW = carvedBBox.maxC - carvedBBox.minC + 1;
  const tH = targetBBox.maxR - targetBBox.minR + 1, tW = targetBBox.maxC - targetBBox.minC + 1;
  if (cH <= 0 || cW <= 0 || tH <= 0 || tW <= 0) return output;
  const scale = Math.min(tH / cH, tW / cW);
  const tCR = (targetBBox.minR + targetBBox.maxR) / 2, tCC = (targetBBox.minC + targetBBox.maxC) / 2;
  const cCR = (carvedBBox.minR + carvedBBox.maxR) / 2, cCC = (carvedBBox.minC + carvedBBox.maxC) / 2;
  const drawMinR = Math.round(tCR - (cH * scale - 1) / 2), drawMaxR = Math.round(tCR + (cH * scale - 1) / 2);
  const drawMinC = Math.round(tCC - (cW * scale - 1) / 2), drawMaxC = Math.round(tCC + (cW * scale - 1) / 2);
  for (let r = drawMinR; r <= drawMaxR; r++) {
    for (let c = drawMinC; c <= drawMaxC; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const srcR = Math.round(cCR + (r - tCR) / scale), srcC = Math.round(cCC + (c - tCC) / scale);
      if (srcR >= 0 && srcR < rows && srcC >= 0 && srcC < cols && carved[srcR][srcC] === 1) output[r][c] = 1;
    }
  }
  return output;
}

function carveOne(inputGrid: Grid, seedRaw: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const bbox = getBoundingBox(inputGrid);
  if (!bbox) return Array.from({ length: rows }, () => new Array(cols).fill(0));
  const rand = makeMulberry32(seedRaw);
  const { inner, setbacks } = applyLayer1(bbox, rand);
  if (inner.maxR - inner.minR < 2 || inner.maxC - inner.minC < 2) {
    const fb: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = bbox.minR; r <= bbox.maxR; r++) for (let c = bbox.minC; c <= bbox.maxC; c++) fb[r][c] = 1;
    return fb;
  }
  const carved = applyLayer2(bbox, inner, setbacks, rand, rows, cols);
  const cBBox = getBoundingBox(carved);
  if (!cBBox) return Array.from({ length: rows }, () => new Array(cols).fill(0));
  return scaleToFitBBox(carved, cBBox, bbox, rows, cols);
}

export function regionBlockyCarve(input: Record<string, unknown>): Record<string, unknown> {
  const region = input.region as Grid | undefined;
  if (!region || region.length === 0 || (region[0]?.length ?? 0) === 0) {
    return { error: 'region is required' };
  }
  const seedRaw = typeof input.seed === 'number' ? input.seed : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;
  return { region: carveOne(region, seed) };
}
