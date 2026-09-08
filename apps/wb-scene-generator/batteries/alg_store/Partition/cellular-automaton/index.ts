/**
 * 细胞自动机 (Cellular Automaton)
 * Evolves a binary grid using birth/survival thresholds on the Moore neighborhood (8 neighbors).
 * Commonly used for procedural cave/island generation.
 * Self-contained — no external imports.
 */

export interface CellularAutomatonInput {
  grid?: number[][];
  initMode?: string;
  initProb?: number;
  birthThreshold?: number;
  survivalThreshold?: number;
  iterations?: number;
  edgeAlive?: boolean | number;
  seed?: number;
}

export interface CellularAutomatonOutput {
  grid: number[][];
}

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 48271);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

function countAliveNeighbors(
  grid: number[][],
  h: number,
  w: number,
  y: number,
  x: number,
  edgeAlive: boolean,
): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dy === 0 && dx === 0) continue;
      const ny = y + dy;
      const nx = x + dx;
      if (ny < 0 || ny >= h || nx < 0 || nx >= w) {
        if (edgeAlive) count++;
      } else if (grid[ny][nx] === 1) {
        count++;
      }
    }
  }
  return count;
}

function isBinaryGrid(grid: number[][], h: number, w: number): boolean {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = grid[y][x];
      if (v !== 0 && v !== 1) return false;
    }
  }
  return true;
}

function initThreshold(
  src: number[][],
  h: number,
  w: number,
  initProb: number,
): number[][] {
  const cutoff = 1 - initProb;
  return Array.from({ length: h }, (_, y) => {
    const out = new Array<number>(w);
    for (let x = 0; x < w; x++) {
      out[x] = src[y][x] >= cutoff ? 1 : 0;
    }
    return out;
  });
}

export function generateCellularAutomaton(
  input: CellularAutomatonInput,
): CellularAutomatonOutput {
  const src = input.grid;
  if (!src || src.length === 0 || !src[0] || src[0].length === 0) {
    return { grid: [] };
  }

  const h = src.length;
  const w = src[0].length;
  const modeRaw = (input.initMode ?? "random").toLowerCase();
  const initProb = Math.max(0, Math.min(1, input.initProb ?? 0.45));
  const birthThreshold = Math.max(0, Math.min(8, Math.floor(input.birthThreshold ?? 5)));
  const survivalThreshold = Math.max(0, Math.min(8, Math.floor(input.survivalThreshold ?? 4)));
  const iterations = Math.max(1, Math.min(100, Math.floor(input.iterations ?? 5)));
  const edgeAlive = input.edgeAlive === undefined ? true : !!input.edgeAlive;
  const rng = new LCG(input.seed ?? 0);

  let current: number[][];

  if (modeRaw === "binary") {
    if (isBinaryGrid(src, h, w)) {
      // Binary grid detected — use directly
      current = Array.from({ length: h }, (_, y) => [...src[y]]);
    } else {
      // Not binary — fall back to threshold mode
      current = initThreshold(src, h, w, initProb);
    }
  } else if (modeRaw === "threshold") {
    current = initThreshold(src, h, w, initProb);
  } else {
    // Random mode: only use grid dimensions, all cells randomly initialized
    current = Array.from({ length: h }, () => {
      const row = new Array<number>(w);
      for (let x = 0; x < w; x++) {
        row[x] = rng.float01() < initProb ? 1 : 0;
      }
      return row;
    });
  }

  // Run CA iterations — all cells participate
  for (let iter = 0; iter < iterations; iter++) {
    const next: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const neighbors = countAliveNeighbors(current, h, w, y, x, edgeAlive);

        if (current[y][x] === 1) {
          next[y][x] = neighbors >= survivalThreshold ? 1 : 0;
        } else {
          next[y][x] = neighbors >= birthThreshold ? 1 : 0;
        }
      }
    }

    current = next;
  }

  return { grid: current };
}
