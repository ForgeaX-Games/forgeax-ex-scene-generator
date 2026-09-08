/**
 * 随机行走 (Random Walk) Path Generator
 * Generates a random walk path within a grid mask.
 * Supports 8-directional weighted movement, variable path width with 5 decay modes,
 * configurable walk speed, direction bias, and deterministic seeded RNG.
 */

export interface RandomWalkInput {
  grid?: number[][];
  steps?: number;
  startX?: number;
  startY?: number;
  pathWidth?: number;
  widthDecay?: string;
  speed?: number;
  stopAtBoundary?: boolean;
  dirBias?: number[] | string;
  seed?: number;
}

export interface RandomWalkOutput {
  grid: number[][];
}

class LCG {
  private s: bigint;
  constructor(seed: number) {
    this.s = BigInt(seed > 0 ? seed : 12345);
  }
  next(): bigint {
    this.s =
      (this.s * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.s;
  }
  intn(n: number): number {
    if (n <= 0) return 0;
    // Use high bits (>> 33) to avoid LCG low-bit short-period problem
    return Number((this.next() >> 33n) % BigInt(n));
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1];
const DY = [0, -1, -1, -1, 0, 1, 1, 1];
const DEFAULT_BIAS = [1, 1, 1, 1, 1, 1, 1, 1];

function parseDirBias(raw: number[] | string | undefined): number[] {
  let arr: number[];
  if (Array.isArray(raw)) {
    arr = raw.map(Number);
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    arr = raw.split(",").map(s => Number(s.trim()));
  } else {
    return DEFAULT_BIAS;
  }
  if (arr.length !== 8 || arr.some(v => isNaN(v))) return DEFAULT_BIAS;
  return arr.map(v => Math.max(0, Math.min(1, v)));
}

function pickWeightedDir(
  cx: number, cy: number, w: number, h: number,
  mask: number[][], bias: number[], rng: LCG,
): number {
  let total = 0;
  const weights: number[] = new Array(8);
  for (let d = 0; d < 8; d++) {
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny][nx] !== 0) {
      weights[d] = bias[d];
      total += bias[d];
    } else {
      weights[d] = 0;
    }
  }
  if (total <= 0) return -1;

  let r = rng.float01() * total;
  for (let d = 0; d < 8; d++) {
    r -= weights[d];
    if (r <= 0) return d;
  }
  return -1;
}

function computeWidth(
  baseWidth: number,
  step: number,
  totalSteps: number,
  decay: string,
  rng: LCG,
): number {
  if (totalSteps <= 1) return baseWidth;
  const t = step / (totalSteps - 1);
  switch (decay) {
    case "linear":
      return Math.max(1, baseWidth * (1 - t));
    case "exponential":
      return Math.max(1, baseWidth * Math.exp(-3 * t));
    case "sine":
      return Math.max(1, baseWidth * (1 + 0.5 * Math.sin(t * Math.PI * 4)));
    case "random":
      return Math.max(1, baseWidth * (0.5 + rng.float01()));
    default:
      return baseWidth;
  }
}

function paintCircle(
  grid: number[][],
  w: number,
  h: number,
  cx: number,
  cy: number,
  diameter: number,
): void {
  const radius = diameter / 2;
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (px >= 0 && px < w && py >= 0 && py < h) {
        grid[py][px] = 1;
      }
    }
  }
}

export function generateRandomWalk(input: RandomWalkInput): RandomWalkOutput {
  const mask = input.grid;
  if (!mask || mask.length === 0 || mask[0].length === 0) {
    return { grid: [] };
  }

  const h = mask.length;
  const w = mask[0].length;
  const steps = Math.max(1, Math.floor(input.steps ?? 500));
  const pathWidth = Math.max(1, input.pathWidth ?? 2);
  const widthDecay = input.widthDecay ?? "none";
  const speed = Math.max(1, Math.floor(input.speed ?? 2));
  const stopAtBoundary = input.stopAtBoundary !== false;
  const dirBias = parseDirBias(input.dirBias);
  const seed = input.seed ?? 0;
  const rng = new LCG(seed);

  const result: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  // Collect walkable cells from mask
  const valid: [number, number][] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y][x] !== 0) valid.push([x, y]);
    }
  }
  if (valid.length === 0) return { grid: result };

  // Determine start position
  let cx = input.startX ?? -1;
  let cy = input.startY ?? -1;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h || mask[cy][cx] === 0) {
    const idx = rng.intn(valid.length);
    cx = valid[idx][0];
    cy = valid[idx][1];
  }

  for (let step = 0; step < steps; step++) {
    const currentWidth = computeWidth(pathWidth, step, steps, widthDecay, rng);
    paintCircle(result, w, h, cx, cy, currentWidth);

    const chosenDir = pickWeightedDir(cx, cy, w, h, mask, dirBias, rng);

    if (chosenDir < 0) {
      if (stopAtBoundary) break;
      continue;
    }

    let hitBoundary = false;
    for (let s = 0; s < speed; s++) {
      const nx = cx + DX[chosenDir];
      const ny = cy + DY[chosenDir];
      if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny][nx] !== 0) {
        cx = nx;
        cy = ny;
        paintCircle(result, w, h, cx, cy, currentWidth);
      } else {
        hitBoundary = true;
        break;
      }
    }
    if (hitBoundary && stopAtBoundary) break;
  }

  return { grid: result };
}
