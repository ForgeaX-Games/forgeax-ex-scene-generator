/**
 * force_directed_graph: DST-style force-directed graph layout.
 * Uses spring-electric simulation (Coulomb repulsion + Hooke attraction)
 * with optional Fermat spiral initial placement.
 * Input: nodeCount, edges, positions (optional), grid size, physics params.
 * Output: grid (visualization), nodePositions (coordinate list).
 */

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
  range(min: number, max: number): number {
    return min + this.float01() * (max - min);
  }
}

/**
 * Fermat / sunflower spiral — from DST placement.lua genCircOffsetPositions.
 *   s = i / 32.0
 *   a = sqrt(s * 512.0)
 *   b = sqrt(s)
 *   position = (sin(a)*b, cos(a)*b)
 */
function fermatSpiralInit(n: number, rng: LCG): [number, number][] {
  const raw: [number, number][] = [];
  for (let i = 1; i <= n; i++) {
    const s = i / 32.0;
    const a = Math.sqrt(s * 512.0);
    const b = Math.sqrt(s);
    raw.push([Math.sin(a) * b, Math.cos(a) * b]);
  }
  for (let i = raw.length - 1; i > 0; i--) {
    const j = Math.floor(rng.float01() * (i + 1));
    [raw[i], raw[j]] = [raw[j], raw[i]];
  }
  const spread = Math.max(40.0, Math.sqrt(n) * 20.0);
  return raw.map(([x, y]) => [x * spread, y * spread]);
}

interface SimState {
  x: Float64Array;
  y: Float64Array;
  vx: Float64Array;
  vy: Float64Array;
}

/**
 * Force-directed simulation faithful to DST's ForceDirectedLayout.
 * - Coulomb repulsion between every pair of nodes
 * - Hooke attraction along edges
 * - Velocity damping per iteration
 */
function simulate(
  state: SimState,
  edges: [number, number][],
  repulsion: number,
  attraction: number,
  damping: number,
  iterations: number,
): void {
  const n = state.x.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    fx.fill(0);
    fy.fill(0);

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = state.x[i] - state.x[j];
        const dy = state.y[i] - state.y[j];
        const distSq = dx * dx + dy * dy + 0.01;
        const dist = Math.sqrt(distSq);
        const force = repulsion / distSq;
        const fnx = (force * dx) / dist;
        const fny = (force * dy) / dist;
        fx[i] += fnx;
        fy[i] += fny;
        fx[j] -= fnx;
        fy[j] -= fny;
      }
    }

    for (const [si, di] of edges) {
      if (si < 0 || si >= n || di < 0 || di >= n) continue;
      const dx = state.x[di] - state.x[si];
      const dy = state.y[di] - state.y[si];
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const force = attraction * dist;
      const fnx = (force * dx) / dist;
      const fny = (force * dy) / dist;
      fx[si] += fnx;
      fy[si] += fny;
      fx[di] -= fnx;
      fy[di] -= fny;
    }

    for (let i = 0; i < n; i++) {
      state.vx[i] = (state.vx[i] + fx[i]) * damping;
      state.vy[i] = (state.vy[i] + fy[i]) * damping;
      state.x[i] += state.vx[i];
      state.y[i] += state.vy[i];
    }
  }
}

/**
 * Map continuous positions into discrete grid coordinates.
 * Applies margin so nodes don't land on the border.
 */
function mapToGrid(
  state: SimState,
  gridW: number,
  gridH: number,
): { grid: number[][]; positions: number[][] } {
  const n = state.x.length;
  if (n === 0) {
    const grid = Array.from({ length: gridH }, () => new Array(gridW).fill(0));
    return { grid, positions: [] };
  }

  let minX = state.x[0],
    maxX = state.x[0];
  let minY = state.y[0],
    maxY = state.y[0];
  for (let i = 1; i < n; i++) {
    if (state.x[i] < minX) minX = state.x[i];
    if (state.x[i] > maxX) maxX = state.x[i];
    if (state.y[i] < minY) minY = state.y[i];
    if (state.y[i] > maxY) maxY = state.y[i];
  }

  const spanX = maxX - minX + 1e-9;
  const spanY = maxY - minY + 1e-9;
  const margin = 2;
  const usableW = gridW - 2 * margin;
  const usableH = gridH - 2 * margin;
  const scale = Math.min(
    usableW / spanX,
    usableH / spanY,
  );
  const offX = (gridW - spanX * scale) / 2;
  const offY = (gridH - spanY * scale) / 2;

  const grid = Array.from({ length: gridH }, () => new Array(gridW).fill(0));
  const positions: number[][] = [];
  const occupied = new Set<string>();

  for (let i = 0; i < n; i++) {
    let gx = Math.round((state.x[i] - minX) * scale + offX);
    let gy = Math.round((state.y[i] - minY) * scale + offY);
    gx = Math.max(0, Math.min(gridW - 1, gx));
    gy = Math.max(0, Math.min(gridH - 1, gy));

    const key = `${gx},${gy}`;
    if (occupied.has(key)) {
      const offsets = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [-1, 1], [1, -1], [-1, -1],
      ];
      for (const [dx, dy] of offsets) {
        const nx = gx + dx;
        const ny = gy + dy;
        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
          const nk = `${nx},${ny}`;
          if (!occupied.has(nk)) {
            gx = nx;
            gy = ny;
            break;
          }
        }
      }
    }

    occupied.add(`${gx},${gy}`);
    grid[gy][gx] = 1;
    positions.push([gx, gy]);
  }

  return { grid, positions };
}

function parseEdges(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  const result: [number, number][] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      const a = Number(item[0]);
      const b = Number(item[1]);
      if (!isNaN(a) && !isNaN(b)) {
        result.push([Math.floor(a), Math.floor(b)]);
      }
    }
  }
  return result;
}

function parsePositions(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const result: [number, number][] = [];
  for (const item of raw) {
    if (Array.isArray(item) && item.length >= 2) {
      const x = Number(item[0]);
      const y = Number(item[1]);
      if (!isNaN(x) && !isNaN(y)) {
        result.push([x, y]);
      }
    }
  }
  return result.length > 0 ? result : null;
}

export function forceDirectedGraph(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const nodeCount = Math.max(
    1,
    Math.min(500, Math.floor(Number(input.nodeCount) || 10)),
  );
  const edges = parseEdges(input.edges);
  const initPos = parsePositions(input.positions);
  const gridWidth = Math.max(
    8,
    Math.min(512, Math.floor(Number(input.gridWidth) || 50)),
  );
  const gridHeight = Math.max(
    8,
    Math.min(512, Math.floor(Number(input.gridHeight) || 50)),
  );
  const repulsion = Math.max(0, Number(input.repulsion) || 5000);
  const attraction = Math.max(0, Number(input.attraction) || 0.008);
  const damping = Math.max(0.01, Math.min(1, Number(input.damping) || 0.9));
  const iterations = Math.max(
    1,
    Math.min(2000, Math.floor(Number(input.iterations) || 300)),
  );
  const seed = Math.floor(Number(input.seed) || 0);
  const rng = new LCG(seed);

  const state: SimState = {
    x: new Float64Array(nodeCount),
    y: new Float64Array(nodeCount),
    vx: new Float64Array(nodeCount),
    vy: new Float64Array(nodeCount),
  };

  if (initPos && initPos.length >= nodeCount) {
    for (let i = 0; i < nodeCount; i++) {
      state.x[i] = initPos[i][0];
      state.y[i] = initPos[i][1];
    }
  } else {
    const spiral = fermatSpiralInit(nodeCount, rng);
    for (let i = 0; i < nodeCount; i++) {
      state.x[i] = spiral[i][0];
      state.y[i] = spiral[i][1];
    }
  }

  simulate(state, edges, repulsion, attraction, damping, iterations);

  const { grid, positions } = mapToGrid(state, gridWidth, gridHeight);

  return { grid, nodePositions: positions };
}
