/**
 * buildingDoor: 在墙体网格中随机打开外门洞
 * 原电池: building_door
 */

import type { Grid } from "./buildingCarve.js";

function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return () => { s = Math.imul(1664525, s) + 1013904223; s = s >>> 0; return s / 0x100000000; };
}

function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

interface DoorCandidate { r: number; c: number; dir: "H" | "V"; width: number; }

function candidateCells(door: DoorCandidate, cols: number): number[] {
  if (door.dir === "H") return Array.from({ length: door.width }, (_, i) => door.r * cols + door.c + i);
  return Array.from({ length: door.width }, (_, i) => (door.r + i) * cols + door.c);
}

function collectPriority(grid: Grid, rows: number, cols: number, doorWidth: number): DoorCandidate[] {
  const SEG = 6, cands: DoorCandidate[] = [];
  for (let r = 0; r < rows; r++) {
    let s = -1;
    for (let c = 0; c <= cols; c++) {
      const isW = c < cols && grid[r][c] !== 0;
      if (isW && s === -1) { s = c; }
      else if (!isW && s !== -1) {
        const e = c - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - doorWidth + 1) / 2), de = ds + doorWidth - 1;
          if (ds >= s && de <= e && (r > 0 && grid[r-1][ds] === 0 || r < rows-1 && grid[r+1][ds] === 0))
            cands.push({ r, c: ds, dir: "H", width: doorWidth });
        }
        s = -1;
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    let s = -1;
    for (let r = 0; r <= rows; r++) {
      const isW = r < rows && grid[r][c] !== 0;
      if (isW && s === -1) { s = r; }
      else if (!isW && s !== -1) {
        const e = r - 1, len = e - s + 1;
        if (len >= SEG) {
          const ds = Math.floor((s + e - doorWidth + 1) / 2), de = ds + doorWidth - 1;
          if (ds >= s && de <= e && (c > 0 && grid[ds][c-1] === 0 || c < cols-1 && grid[ds][c+1] === 0))
            cands.push({ r: ds, c, dir: "V", width: doorWidth });
        }
        s = -1;
      }
    }
  }
  return cands;
}

function collectFallback(grid: Grid, rows: number, cols: number, doorWidth: number): DoorCandidate[] {
  const cands: DoorCandidate[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - doorWidth; c++) {
      if (Array.from({ length: doorWidth }, (_, i) => grid[r][c+i]).every(v => v !== 0)) {
        if (r > 0 && grid[r-1][c] === 0 || r < rows-1 && grid[r+1][c] === 0)
          cands.push({ r, c, dir: "H", width: doorWidth });
      }
    }
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - doorWidth; r++) {
      if (Array.from({ length: doorWidth }, (_, i) => grid[r+i][c]).every(v => v !== 0)) {
        if (c > 0 && grid[r][c-1] === 0 || c < cols-1 && grid[r][c+1] === 0)
          cands.push({ r, c, dir: "V", width: doorWidth });
      }
    }
  }
  return cands;
}

function placeDoors(cands: DoorCandidate[], need: number, opened: Set<number>, outG: Grid, doorG: Grid, cols: number): number {
  let placed = 0;
  for (const cand of cands) {
    if (placed >= need) break;
    const keys = candidateCells(cand, cols);
    if (keys.some(k => opened.has(k))) continue;
    for (const k of keys) { opened.add(k); outG[Math.floor(k/cols)][k%cols] = 0; doorG[Math.floor(k/cols)][k%cols] = 1; }
    placed++;
  }
  return placed;
}

export function doorOne(wallGrid: Grid, doorCount: number, doorWidth: number, seedRaw: number): { outputGrid: Grid; doorGrid: Grid } {
  const rows = wallGrid.length, cols = wallGrid[0].length;
  const rand = makeLCG(seedRaw);
  const outputGrid: Grid = wallGrid.map(row => [...row]);
  const doorGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));
  if (doorCount === 0) return { outputGrid, doorGrid };

  const priority = collectPriority(wallGrid, rows, cols, doorWidth);
  shuffle(priority, rand);
  const opened = new Set<number>();
  const placed = placeDoors(priority, doorCount, opened, outputGrid, doorGrid, cols);
  if (placed < doorCount) {
    const fallback = collectFallback(wallGrid, rows, cols, doorWidth).filter(c => !candidateCells(c, cols).some(k => opened.has(k)));
    shuffle(fallback, rand);
    placeDoors(fallback, doorCount - placed, opened, outputGrid, doorGrid, cols);
  }
  return { outputGrid, doorGrid };
}

/** 批量开外门（wallGrid 和 gridList 都是外墙减内墙后的结果，逐项对应）*/
export function buildingDoor(wallGridList: Grid[], doorCount: number, doorWidth: number, seedRaw: number): { outputGridList: Grid[]; doorGridList: Grid[] } {
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const outputGridList: Grid[] = [], doorGridList: Grid[] = [];
  wallGridList.forEach((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      outputGridList.push([]); doorGridList.push([]); return;
    }
    const res = doorOne(grid, doorCount, doorWidth, baseSeed + i * 999983);
    outputGridList.push(res.outputGrid);
    doorGridList.push(res.doorGrid);
  });
  return { outputGridList, doorGridList };
}
