/**
 * buildingCarve: 对建筑地块执行两层退线雕刻，生成自然轮廓的建筑实体。
 * 原电池: building_carve
 */

type Grid = number[][];
type Rect = { minR: number; maxR: number; minC: number; maxC: number };

export type { Grid, Rect };

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedSample(rand: () => number, values: number[], weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < values.length; i++) {
    r -= weights[i];
    if (r <= 0) return values[i];
  }
  return values[values.length - 1];
}

export function getBoundingBox(grid: Grid): Rect | null {
  const rows = grid.length, cols = grid[0]?.length ?? 0;
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
    }
  }
  return maxR === -1 ? null : { minR, maxR, minC, maxC };
}

function applyLayer1(bbox: Rect, rand: () => number) {
  const values = [1, 2, 3, 4], weights = [90, 70, 25, 15];
  const top = weightedSample(rand, values, weights);
  const bottom = weightedSample(rand, values, weights);
  const left = weightedSample(rand, values, weights);
  const right = weightedSample(rand, values, weights);
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

function layer2Probs(setback: number) {
  const t = (setback - 1) / 3;
  return { inwardProb: 0.80 - t * 0.60, outwardProb: 0.10 - t * 0.08 };
}

function splitSegments(len: number, n: number): Array<[number, number]> {
  const segs: Array<[number, number]> = [];
  const base = Math.floor(len / n), extra = len % n;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    const segLen = base + (i < extra ? 1 : 0);
    segs.push([pos, pos + segLen]);
    pos += segLen;
  }
  return segs;
}

function applyLayer2(
  bbox: Rect,
  inner: Rect,
  setbacks: { top: number; bottom: number; left: number; right: number },
  rand: () => number,
  rows: number,
  cols: number
): Grid {
  const iW = inner.maxC - inner.minC + 1, iH = inner.maxR - inner.minR + 1;
  const topOff = new Array(iW).fill(0);
  const bottomOff = new Array(iW).fill(0);
  const leftOff = new Array(iH).fill(0);
  const rightOff = new Array(iH).fill(0);

  for (const side of (["top", "bottom", "left", "right"] as const)) {
    const isH = side === "top" || side === "bottom";
    const edgeLen = isH ? iW : iH;
    const edgeSetback = setbacks[side];
    const { inwardProb, outwardProb } = layer2Probs(edgeSetback);
    const nSeg = Math.min(6, Math.max(1, Math.ceil(edgeLen / 7)));
    const segs = splitSegments(edgeLen, nSeg);
    const offsetArr = side === "top" ? topOff : side === "bottom" ? bottomOff : side === "left" ? leftOff : rightOff;

    for (const [segStart, segEnd] of segs) {
      const rv = rand();
      let dir = 0;
      if (rv < inwardProb) dir = 1;
      else if (rv < inwardProb + outwardProb) dir = -1;
      if (dir === 0) continue;
      const rv2 = rand();
      const mag = dir > 0 ? (rv2 < 0.70 ? 1 : 2) : (rv2 < 0.80 || edgeSetback < 2 ? 1 : 2);
      const delta = dir * mag;
      for (let i = segStart; i < segEnd; i++) {
        offsetArr[i] = delta < 0 ? Math.max(-edgeSetback, offsetArr[i] + delta) : offsetArr[i] + delta;
      }
    }
  }

  const topActual = topOff.map(off => inner.minR + off);
  const bottomActual = bottomOff.map(off => inner.maxR - off);
  const leftActual = leftOff.map(off => inner.minC + off);
  const rightActual = rightOff.map(off => inner.maxC - off);

  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let r = bbox.minR; r <= bbox.maxR; r++) {
    for (let c = bbox.minC; c <= bbox.maxC; c++) {
      const ci = c - inner.minC, ri = r - inner.minR;
      const inTB = ci >= 0 && ci < iW && r >= topActual[ci] && r <= bottomActual[ci];
      const inLR = ri >= 0 && ri < iH && c >= leftActual[ri] && c <= rightActual[ri];
      if (inTB && inLR) output[r][c] = 1;
    }
  }
  return output;
}

function scaleToFitBBox(carved: Grid, carvedBBox: Rect, targetBBox: Rect, rows: number, cols: number): Grid {
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const cH = carvedBBox.maxR - carvedBBox.minR + 1;
  const cW = carvedBBox.maxC - carvedBBox.minC + 1;
  const tH = targetBBox.maxR - targetBBox.minR + 1;
  const tW = targetBBox.maxC - targetBBox.minC + 1;
  if (cH <= 0 || cW <= 0 || tH <= 0 || tW <= 0) return output;

  const scale = Math.min(tH / cH, tW / cW);
  const tCR = (targetBBox.minR + targetBBox.maxR) / 2;
  const tCC = (targetBBox.minC + targetBBox.maxC) / 2;
  const cCR = (carvedBBox.minR + carvedBBox.maxR) / 2;
  const cCC = (carvedBBox.minC + carvedBBox.maxC) / 2;

  const drawMinR = Math.round(tCR - (cH * scale - 1) / 2);
  const drawMaxR = Math.round(tCR + (cH * scale - 1) / 2);
  const drawMinC = Math.round(tCC - (cW * scale - 1) / 2);
  const drawMaxC = Math.round(tCC + (cW * scale - 1) / 2);

  for (let r = drawMinR; r <= drawMaxR; r++) {
    for (let c = drawMinC; c <= drawMaxC; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
      const srcR = Math.round(cCR + (r - tCR) / scale);
      const srcC = Math.round(cCC + (c - tCC) / scale);
      if (srcR >= 0 && srcR < rows && srcC >= 0 && srcC < cols && carved[srcR][srcC] === 1) {
        output[r][c] = 1;
      }
    }
  }
  return output;
}

export function carveOne(inputGrid: Grid, seedRaw: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const bbox = getBoundingBox(inputGrid);
  if (!bbox) return Array.from({ length: rows }, () => new Array(cols).fill(0));

  const rand = mulberry32(seedRaw === 0 ? Date.now() : seedRaw);
  const { inner, setbacks } = applyLayer1(bbox, rand);

  if (inner.maxR - inner.minR < 2 || inner.maxC - inner.minC < 2) {
    const fallback: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
    for (let r = bbox.minR; r <= bbox.maxR; r++)
      for (let c = bbox.minC; c <= bbox.maxC; c++) fallback[r][c] = 1;
    return fallback;
  }

  const carved = applyLayer2(bbox, inner, setbacks, rand, rows, cols);
  const carvedBBox = getBoundingBox(carved);
  if (!carvedBBox) return Array.from({ length: rows }, () => new Array(cols).fill(0));
  return scaleToFitBBox(carved, carvedBBox, bbox, rows, cols);
}

/** 对网格列表批量执行 carve */
export function buildingCarve(gridList: Grid[], seedRaw: number): Grid[] {
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  return gridList.map((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) return [];
    return carveOne(grid, baseSeed + i * 999983);
  });
}
