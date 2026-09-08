/**
 * buildingInnerWall: BSP内墙生成
 * 原电池: building_inner_wall
 */

import type { Grid } from "./buildingCarve.js";

interface Room { r0: number; c0: number; r1: number; c1: number; }

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return () => {
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

function pickSplit(lo: number, hi: number, rand: () => number): number {
  const minP = lo + 2, maxP = hi - 2;
  if (minP > maxP) return -1;
  const center = (minP + maxP) / 2;
  const halfRange = Math.max(1, Math.floor((maxP - minP) * 0.4));
  const rangeMin = Math.max(minP, Math.floor(center - halfRange));
  const rangeMax = Math.min(maxP, Math.ceil(center + halfRange));
  return rangeMin + Math.floor(rand() * (rangeMax - rangeMin + 1));
}

function bspSplit(room: Room, depth: number, maxDepth: number, rand: () => number, walls: Set<number>, cols: number, inputGrid: Grid): void {
  if (depth >= maxDepth) return;
  const h = room.r1 - room.r0 + 1, w = room.c1 - room.c0 + 1;
  const canH = h >= 5, canV = w >= 5;
  if (!canH && !canV) return;

  let splitH: boolean;
  if (canH && !canV) splitH = true;
  else if (canV && !canH) splitH = false;
  else { const ratio = h / w; splitH = ratio > 1.2 ? true : ratio < 0.83 ? false : rand() < 0.5; }

  if (splitH) {
    const p = pickSplit(room.r0, room.r1, rand);
    if (p === -1) return;
    for (let c = room.c0 - 1; c <= room.c1 + 1; c++) {
      if (inputGrid[p] && inputGrid[p][c] !== 0) walls.add(p * cols + c);
    }
    bspSplit({ r0: room.r0, c0: room.c0, r1: p - 1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
    bspSplit({ r0: p + 1, c0: room.c0, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
  } else {
    const p = pickSplit(room.c0, room.c1, rand);
    if (p === -1) return;
    for (let r = room.r0 - 1; r <= room.r1 + 1; r++) {
      if (inputGrid[r] && inputGrid[r][p] !== 0) walls.add(r * cols + p);
    }
    bspSplit({ r0: room.r0, c0: room.c0, r1: room.r1, c1: p - 1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
    bspSplit({ r0: room.r0, c0: p + 1, r1: room.r1, c1: room.c1 }, depth + 1, maxDepth, rand, walls, cols, inputGrid);
  }
}

function computeInnerBounds(grid: Grid, rows: number, cols: number): Room | null {
  let minR = rows, maxR = -1, minC = cols, maxC = -1;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (grid[r][c] !== 0) { minR = Math.min(minR, r); maxR = Math.max(maxR, r); minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  if (maxR === -1) return null;
  const r0 = minR + 1, r1 = maxR - 1, c0 = minC + 1, c1 = maxC - 1;
  return r0 > r1 || c0 > c1 ? null : { r0, r1, c0, c1 };
}

export function innerWallOne(inputGrid: Grid, density: number, seedRaw: number): Grid {
  const rows = inputGrid.length, cols = inputGrid[0].length;
  const rand = makeLCG(seedRaw);
  const output: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const innerBounds = computeInnerBounds(inputGrid, rows, cols);
  if (!innerBounds) return output;
  const maxDepth = Math.round(Math.max(0, Math.min(1, density)) * 6);
  if (maxDepth === 0) return output;
  const walls = new Set<number>();
  bspSplit(innerBounds, 0, maxDepth, rand, walls, cols, inputGrid);
  for (const key of walls) {
    const r = Math.floor(key / cols), c = key % cols;
    if (r >= 0 && r < rows && c >= 0 && c < cols && inputGrid[r][c] !== 0) output[r][c] = 1;
  }
  return output;
}

/** 对列表批量生成内墙 */
export function buildingInnerWall(gridList: Grid[], density: number, seedRaw: number): Grid[] {
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  return gridList.map((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) return [];
    return innerWallOne(grid, density, baseSeed + i * 999983);
  });
}
