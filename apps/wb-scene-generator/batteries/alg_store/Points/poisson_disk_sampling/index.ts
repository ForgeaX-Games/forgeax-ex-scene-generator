/**
 * 泊松盘采样 (poisson_disk_sampling)
 * Bridson's fast Poisson disk sampling on a 2D grid.
 * Outputs a binary grid: sample point = 1, empty = 0.
 * Self-contained — no external imports.
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
  intn(n: number): number {
    if (n <= 0) return 0;
    return Number((this.next() >> 33n) % BigInt(n));
  }
  float01(): number {
    return Number((this.next() >> 33n) % 1000000n) / 1000000;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Bridson's algorithm produces points with guaranteed minimum distance `r`.
 * Uses a background grid with cell size r/sqrt(2) for O(1) neighbor lookup.
 */
function bridsonSample(
  width: number,
  height: number,
  radius: number,
  maxAttempts: number,
  rng: LCG,
): { x: number; y: number }[] {
  const cellSize = radius / Math.SQRT2;
  const gridW = Math.ceil(width / cellSize);
  const gridH = Math.ceil(height / cellSize);

  // 每个 cell 存一个 index 列表（而非单 index），避免极端浮点情况下后到的点
  // 把先到的点索引覆盖掉，导致后续 isValid 漏检、破坏最小距离保证。
  const bgGrid: number[][] = Array.from({ length: gridW * gridH }, () => []);
  const points: { x: number; y: number }[] = [];
  const active: number[] = [];

  const toCell = (v: number) => Math.floor(v / cellSize);

  function addPoint(px: number, py: number): void {
    const idx = points.length;
    points.push({ x: px, y: py });
    active.push(idx);
    bgGrid[toCell(py) * gridW + toCell(px)].push(idx);
  }

  function isValid(px: number, py: number): boolean {
    if (px < 0 || px >= width || py < 0 || py >= height) return false;

    const cx = toCell(px);
    const cy = toCell(py);
    const r2 = radius * radius;

    for (let dy = -2; dy <= 2; dy++) {
      const ny = cy + dy;
      if (ny < 0 || ny >= gridH) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = cx + dx;
        if (nx < 0 || nx >= gridW) continue;
        const cell = bgGrid[ny * gridW + nx];
        for (let i = 0; i < cell.length; i++) {
          const p = points[cell[i]];
          const ddx = px - p.x;
          const ddy = py - p.y;
          if (ddx * ddx + ddy * ddy < r2) return false;
        }
      }
    }
    return true;
  }

  const startX = rng.float01() * width;
  const startY = rng.float01() * height;
  addPoint(startX, startY);

  while (active.length > 0) {
    const activeIdx = rng.intn(active.length);
    const pointIdx = active[activeIdx];
    const origin = points[pointIdx];

    let found = false;
    for (let i = 0; i < maxAttempts; i++) {
      const angle = rng.float01() * Math.PI * 2;
      const dist = radius + rng.float01() * radius;
      const nx = origin.x + Math.cos(angle) * dist;
      const ny = origin.y + Math.sin(angle) * dist;

      if (isValid(nx, ny)) {
        addPoint(nx, ny);
        found = true;
        break;
      }
    }

    if (!found) {
      active[activeIdx] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}

export function poissonDiskSampling(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const width = clamp(Math.floor(Number(input.width) || 64), 4, 512);
  const height = clamp(Math.floor(Number(input.height) || 64), 4, 512);
  const radius = clamp(Number(input.radius) || 5, 1, 50);
  const maxAttempts = clamp(Math.floor(Number(input.maxAttempts) || 30), 1, 100);
  const seed = Math.floor(Number(input.seed) || 0);

  const rng = new LCG(seed);
  const rawPoints = bridsonSample(width, height, radius, maxAttempts, rng);

  const grid: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0),
  );

  const points: number[][] = [];
  for (const p of rawPoints) {
    const px = Math.floor(p.x);
    const py = Math.floor(p.y);
    if (px >= 0 && px < width && py >= 0 && py < height) {
      grid[py][px] = 1;
      points.push([px, py]);
    }
  }

  return { grid, points, count: points.length };
}
