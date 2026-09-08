/**
 * rule_indoor_corridor_connect
 * Picks random points on INNER corridor rings and extends connectors
 * outward through all intermediate rings until reaching the outermost
 * wall edge (value=0). Each connector has a random width (2-6).
 *
 * Input:  inputGrid (grid) — 0=wall, 1=corridor ring, 2=room zone
 * Output: outputGrid (grid) — same encoding, all rings connected to edge
 */

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

function computeDistFromWall(grid: number[][], rows: number, cols: number): number[][] {
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of DIRS) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && dist[nr][nc] < 0) {
        dist[nr][nc] = dist[r][c] + 1;
        queue.push([nr, nc]);
      }
    }
  }

  return dist;
}

interface BoundaryPoint {
  r: number;
  c: number;
  dr: number;
  dc: number;
  depth: number;
}

function findInnerCorridorBoundary(
  grid: number[][], dist: number[][], rows: number, cols: number
): BoundaryPoint[] {
  const points: BoundaryPoint[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 1) continue;

      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (grid[nr][nc] !== 2) continue;

        if (dist[nr][nc] < dist[r][c]) {
          points.push({ r, c, dr, dc, depth: dist[r][c] });
        }
      }
    }
  }

  points.sort((a, b) => b.depth - a.depth);
  return points;
}

function extendToWall(
  grid: number[][], rows: number, cols: number,
  startR: number, startC: number, dr: number, dc: number,
  halfWidth: number
): void {
  let r = startR + dr;
  let c = startC + dc;

  while (r >= 0 && r < rows && c >= 0 && c < cols) {
    if (grid[r][c] === 0) break;

    if (dr !== 0) {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        const nc = c + d;
        if (nc >= 0 && nc < cols && grid[r][nc] !== 0) {
          grid[r][nc] = 1;
        }
      }
    } else {
      for (let d = -halfWidth; d <= halfWidth; d++) {
        const nr = r + d;
        if (nr >= 0 && nr < rows && grid[nr][c] !== 0) {
          grid[nr][c] = 1;
        }
      }
    }

    r += dr;
    c += dc;
  }
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function ruleIndoorCorridorConnect(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0 || !inputGrid[0] || inputGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const minWidth = typeof input.minWidth === "number" ? Math.max(1, Math.floor(input.minWidth)) : 2;
  const maxWidth = typeof input.maxWidth === "number" ? Math.max(minWidth, Math.floor(input.maxWidth)) : 6;
  const connectorCount = typeof input.connectorCount === "number" ? Math.max(1, Math.floor(input.connectorCount)) : 16;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = mulberry32(baseSeed);

  const outputGrid: number[][] = inputGrid.map(row => [...row]);
  const dist = computeDistFromWall(outputGrid, rows, cols);

  const boundary = findInnerCorridorBoundary(outputGrid, dist, rows, cols);
  if (boundary.length === 0) return { outputGrid };

  const innerThreshold = boundary[0].depth * 0.3;
  const innerPoints = boundary.filter(p => p.depth >= innerThreshold);

  shuffle(innerPoints, rng);

  const minSpacing = maxWidth * 2 + 2;
  const placed: [number, number][] = [];
  let count = 0;

  for (const pt of innerPoints) {
    if (count >= connectorCount) break;

    let tooClose = false;
    for (const [pr, pc] of placed) {
      if (Math.abs(pt.r - pr) + Math.abs(pt.c - pc) < minSpacing) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    const w = randInt(rng, minWidth, maxWidth);
    const halfW = Math.floor(w / 2);

    extendToWall(outputGrid, rows, cols, pt.r, pt.c, pt.dr, pt.dc, halfW);

    placed.push([pt.r, pt.c]);
    count++;
  }

  return { outputGrid };
}
