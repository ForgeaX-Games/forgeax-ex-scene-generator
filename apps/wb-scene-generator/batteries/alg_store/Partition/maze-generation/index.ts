/**
 * 迷宫生成 (Maze Generation)
 * Generates a perfect maze using iterative randomized DFS (recursive backtracking).
 * Outputs a binary grid: passage = 1, wall = 0.
 * Self-contained — no external imports.
 */

export interface MazeGenerationInput {
  cols?: number;
  rows?: number;
  wallSize?: number;
  passageSize?: number;
  entrance?: boolean | number;
  seed?: number;
}

export interface MazeGenerationOutput {
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
  intn(n: number): number {
    if (n <= 0) return 0;
    return Number((this.next() >> 33n) % BigInt(n));
  }
}

function shuffle(arr: number[], rng: LCG): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.intn(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

// Direction offsets: right, down, left, up
const DC = [1, 0, -1, 0];
const DR = [0, 1, 0, -1];

export function generateMaze(input: MazeGenerationInput): MazeGenerationOutput {
  const cols = Math.max(2, Math.min(200, Math.floor(input.cols ?? 24)));
  const rows = Math.max(2, Math.min(200, Math.floor(input.rows ?? 24)));
  const ws = Math.max(1, Math.min(10, Math.floor(input.wallSize ?? 1)));
  const ps = Math.max(1, Math.min(20, Math.floor(input.passageSize ?? 1)));
  const entrance = input.entrance === undefined ? true : !!input.entrance;
  const rng = new LCG(input.seed ?? 0);

  // Output grid dimensions
  const gridW = cols * (ps + ws) + ws;
  const gridH = rows * (ps + ws) + ws;

  // Initialize grid: all walls (0)
  const grid: number[][] = Array.from({ length: gridH }, () =>
    new Array(gridW).fill(0),
  );

  // Carve a passage cell at maze coordinate (c, r) into the pixel grid
  function carveCell(c: number, r: number): void {
    const startX = ws + c * (ps + ws);
    const startY = ws + r * (ps + ws);
    for (let dy = 0; dy < ps; dy++) {
      for (let dx = 0; dx < ps; dx++) {
        grid[startY + dy][startX + dx] = 1;
      }
    }
  }

  // Carve the wall between two adjacent cells (c1,r1) and (c2,r2)
  function carveWall(c1: number, r1: number, c2: number, r2: number): void {
    const x1 = ws + c1 * (ps + ws);
    const y1 = ws + r1 * (ps + ws);
    const x2 = ws + c2 * (ps + ws);
    const y2 = ws + r2 * (ps + ws);

    if (r1 === r2) {
      // Horizontal neighbors: carve the wall columns between them
      const minX = Math.min(x1, x2) + ps;
      const startY = y1;
      for (let dy = 0; dy < ps; dy++) {
        for (let dx = 0; dx < ws; dx++) {
          grid[startY + dy][minX + dx] = 1;
        }
      }
    } else {
      // Vertical neighbors: carve the wall rows between them
      const startX = x1;
      const minY = Math.min(y1, y2) + ps;
      for (let dy = 0; dy < ws; dy++) {
        for (let dx = 0; dx < ps; dx++) {
          grid[minY + dy][startX + dx] = 1;
        }
      }
    }
  }

  // Iterative DFS maze generation (avoids stack overflow for large mazes)
  const visited: boolean[] = new Array(cols * rows).fill(false);
  const stack: number[] = [];
  const dirs = [0, 1, 2, 3];

  // Start from (0, 0)
  visited[0] = true;
  carveCell(0, 0);
  stack.push(0);

  while (stack.length > 0) {
    const idx = stack[stack.length - 1];
    const c = idx % cols;
    const r = (idx - c) / cols;

    shuffle(dirs, rng);

    let pushed = false;
    for (let i = 0; i < 4; i++) {
      const nc = c + DC[dirs[i]];
      const nr = r + DR[dirs[i]];
      if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
      const nIdx = nr * cols + nc;
      if (visited[nIdx]) continue;

      visited[nIdx] = true;
      carveCell(nc, nr);
      carveWall(c, r, nc, nr);
      stack.push(nIdx);
      pushed = true;
      break;
    }

    if (!pushed) {
      stack.pop();
    }
  }

  // Open entrance (top-left) and exit (bottom-right)
  if (entrance) {
    const entX = ws;
    for (let dx = 0; dx < ps; dx++) {
      for (let dy = 0; dy < ws; dy++) {
        grid[dy][entX + dx] = 1;
      }
    }

    const exitX = ws + (cols - 1) * (ps + ws);
    const exitYStart = gridH - ws;
    for (let dx = 0; dx < ps; dx++) {
      for (let dy = 0; dy < ws; dy++) {
        grid[exitYStart + dy][exitX + dx] = 1;
      }
    }
  }

  return { grid };
}
