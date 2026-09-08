/**
 * cellularAutomata: 批量在蒙版列表内用元胞自动机规则生成自然洞穴地形
 * 输入：maskList (array) — 蒙版网格列表，每个网格独立演化；
 *       fillProbability (number) — 初始填充概率；birthLimit (number) — 出生阈值；
 *       deathLimit (number) — 死亡阈值；iterations (number) — 迭代次数；
 *       borderWall (number) — 边界是否为墙；seed (number) — 随机种子（每个蒙版独立偏移）
 * 输出：caveGrids (array) — 洞穴网格列表，每格 0=蒙版外, 1=洞穴墙, 2=洞穴空间；
 *       nameList (array) — 固定名称清单 [{id:1,name:洞穴墙}, {id:2,name:洞穴空间}]
 */

// ─── 类型定义 ─────────────────────────────────────────────────────────────────

interface NameEntry {
  id: number;
  name: string;
}

// ─── LCG 随机数生成器（与 Go 版完全一致）────────────────────────────────────

class LCG {
  private state: bigint;

  constructor(seed: number) {
    this.state = seed === 0 ? 12345n : BigInt(seed >>> 0);
  }

  next(): bigint {
    this.state =
      (this.state * 6364136223846793005n + 1442695040888963407n) &
      0xffffffffffffffffn;
    return this.state;
  }

  float64(): number {
    return Number(this.next() & 0xffffffffn) / 0xffffffff;
  }
}

// ─── 边界检测 ────────────────────────────────────────────────────────────────

function isMaskBoundary(
  mask: number[][],
  x: number,
  y: number,
  width: number,
  height: number
): boolean {
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  for (const [dx, dy] of dirs) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || nx >= width || ny < 0 || ny >= height) return true;
    if (mask[ny][nx] === 0) return true;
  }
  return false;
}

// ─── 邻居计数（8 连通）──────────────────────────────────────────────────────

function countNeighbors(
  grid: Int32Array,
  maskActive: Uint8Array,
  x: number,
  y: number,
  width: number,
  height: number,
  borderWall: boolean
): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
        if (borderWall) count++;
        continue;
      }
      const nidx = ny * width + nx;
      if (!maskActive[nidx]) {
        if (borderWall) count++;
        continue;
      }
      if (grid[nidx] === 1) count++;
    }
  }
  return count;
}

// ─── 单步模拟 ────────────────────────────────────────────────────────────────

function simulateStep(
  grid: Int32Array,
  maskActive: Uint8Array,
  width: number,
  height: number,
  birthLimit: number,
  deathLimit: number,
  borderWall: boolean,
  mask: number[][]
): Int32Array {
  const next = new Int32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      if (!maskActive[idx]) {
        next[idx] = 0;
        continue;
      }

      if (borderWall && isMaskBoundary(mask, x, y, width, height)) {
        next[idx] = 1;
        continue;
      }

      const neighbors = countNeighbors(
        grid,
        maskActive,
        x,
        y,
        width,
        height,
        borderWall
      );

      if (grid[idx] === 1) {
        next[idx] = neighbors < deathLimit ? 0 : 1;
      } else {
        next[idx] = neighbors >= birthLimit ? 1 : 0;
      }
    }
  }

  return next;
}

// ─── 单张蒙版演化 ─────────────────────────────────────────────────────────────

function generateCave(
  mask: number[][],
  fillProbability: number,
  birthLimit: number,
  deathLimit: number,
  iterations: number,
  borderWall: boolean,
  seed: number
): number[][] {
  const height = mask.length;
  const width = mask[0].length;
  const rng = new LCG(seed);

  const flatGrid = new Int32Array(width * height);
  const maskActive = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (mask[y][x] !== 0) {
        maskActive[idx] = 1;
        if (borderWall && isMaskBoundary(mask, x, y, width, height)) {
          flatGrid[idx] = 1;
        } else {
          flatGrid[idx] = rng.float64() < fillProbability ? 1 : 0;
        }
      }
    }
  }

  let current = flatGrid;
  for (let i = 0; i < iterations; i++) {
    current = simulateStep(
      current,
      maskActive,
      width,
      height,
      birthLimit,
      deathLimit,
      borderWall,
      mask
    );
  }

  // 合并输出：0=蒙版外, 1=洞穴墙, 2=洞穴空间
  const caveGrid: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!maskActive[idx]) {
        row.push(0);
      } else {
        row.push(current[idx] === 1 ? 1 : 2);
      }
    }
    caveGrid.push(row);
  }

  return caveGrid;
}

// ─── 固定名称清单 ─────────────────────────────────────────────────────────────

const CAVE_NAME_LIST: NameEntry[] = [
  { id: 1, name: "洞穴墙" },
  { id: 2, name: "洞穴空间" },
];

// ─── 输入解析辅助 ────────────────────────────────────────────────────────────

function isGrid(v: unknown): v is number[][] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    Array.isArray((v as unknown[][])[0])
  );
}

function isGridList(v: unknown): v is number[][][] {
  return Array.isArray(v) && v.length > 0 && isGrid((v as unknown[])[0]);
}

// ─── 导出入口 ────────────────────────────────────────────────────────────────

export function cellularAutomata(
  input: Record<string, unknown>
): Record<string, unknown> {
  // 解析 maskList：接受 grid[][][] 或单个 grid[][]（自动包装）
  const rawMask = input.maskList;
  let maskList: number[][][] = [];

  if (isGridList(rawMask)) {
    maskList = rawMask;
  } else if (isGrid(rawMask)) {
    maskList = [rawMask];
  } else {
    return { error: "maskList is required and must be a grid list (number[][][]) or a single grid (number[][])" };
  }

  const fillProbability =
    typeof input.fillProbability === "number" && input.fillProbability > 0
      ? input.fillProbability
      : 0.45;

  const birthLimit =
    typeof input.birthLimit === "number" && input.birthLimit > 0
      ? Math.round(input.birthLimit)
      : 4;

  const deathLimit =
    typeof input.deathLimit === "number" && input.deathLimit > 0
      ? Math.round(input.deathLimit)
      : 3;

  const iterations =
    typeof input.iterations === "number" && input.iterations > 0
      ? Math.round(input.iterations)
      : 5;

  const borderWall =
    typeof input.borderWall === "number" ? input.borderWall !== 0 : true;

  const baseSeed = typeof input.seed === "number" ? Math.round(input.seed) : 0;

  const caveGrids: number[][][] = [];

  for (let i = 0; i < maskList.length; i++) {
    const mask = maskList[i];
    if (!isGrid(mask) || mask[0].length === 0) continue;

    // 每个蒙版用独立偏移种子，保证批量各不相同但可复现
    const seed = baseSeed === 0 ? i * 1000 + 12345 : baseSeed + i * 1000;
    const caveGrid = generateCave(
      mask,
      fillProbability,
      birthLimit,
      deathLimit,
      iterations,
      borderWall,
      seed
    );

    caveGrids.push(caveGrid);
  }

  return { caveGrids, nameList: CAVE_NAME_LIST };
}
