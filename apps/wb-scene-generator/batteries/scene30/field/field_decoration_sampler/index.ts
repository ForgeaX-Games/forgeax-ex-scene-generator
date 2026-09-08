/**
 * field_decoration_sampler: 野外装饰物采样器
 *
 * 输出格式：decorationGrid (grid) — 与地形同尺寸的装饰物网格
 *   编号约定：
 *     0 — 空（无装饰物）
 *     1 — 树木，放置在草地，泊松盘采样确保自然间距
 *     2 — 灌木，放置在草地（树木空隙），泊松盘二次采样
 *     3 — 岩石，草地/沙滩均可，低概率随机散布
 *     4 — 小花，草地/沙滩均可，随机散布，密度较低
 *
 * 算法步骤：
 *   1. LCG SeededRandom 初始化
 *   2. 收集草地格坐标集合，作为泊松采样候选域
 *   3. Bridson 泊松盘采样放置树木（1），写入 decorationGrid
 *   4. 移除树木格后对剩余草地泊松采样放置灌木（2）
 *   5. 遍历草地+沙滩格，按 rockDensity 概率散布岩石（3）
 *   6. 遍历草地+沙滩空格，按 flowerDensity 概率散布小花（4）
 *   注：水格不放置任何装饰物（荷叶已归入地形渲染层）
 *
 * 输入：terrainGrid (grid)、seed (number)、treeRadius (number)、
 *       bushRadius (number)、rockDensity (number)、flowerDensity (number)
 * 输出：decorationGrid (grid) — 装饰物网格（0=空/1=树/2=灌木/3=岩石/4=小花）
 */

type Grid = number[][];

/** LCG 伪随机数生成器 */
class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed === 0 ? Date.now() : seed;
    for (let i = 0; i < 10; i++) this.next();
  }

  next(): number {
    this.state = (this.state * 1664525 + 1013904223) & 0xffffffff;
    return (this.state >>> 0) / 0x100000000;
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  nextFloat(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/**
 * Bridson 泊松盘采样（活跃列表法）
 * 在给定候选格子集合中，找出所有满足最小间距 radius 的采样点
 */
function poissonDiskSample(
  candidates: Set<string>,
  radius: number,
  rng: SeededRandom,
  maxAttempts: number = 30
): Array<{ x: number; y: number }> {
  if (candidates.size === 0) return [];

  const candidateList = Array.from(candidates).map(key => {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  });

  if (candidateList.length === 0) return [];

  const radiusSq = radius * radius;
  const placed: Array<{ x: number; y: number }> = [];
  const placedSet = new Set<string>();
  const blocked = new Set<string>();

  const startIdx = rng.nextInt(candidateList.length);
  const start = candidateList[startIdx];
  placed.push(start);
  placedSet.add(`${start.x},${start.y}`);
  blockNeighbors(start.x, start.y, radius, blocked);

  const active = [start];

  while (active.length > 0) {
    const activeIdx = rng.nextInt(active.length);
    const current = active[activeIdx];
    let found = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = rng.nextFloat(0, Math.PI * 2);
      const dist = rng.nextFloat(radius, radius * 2);
      const nx = Math.round(current.x + Math.cos(angle) * dist);
      const ny = Math.round(current.y + Math.sin(angle) * dist);
      const nKey = `${nx},${ny}`;

      if (!candidates.has(nKey)) continue;
      if (placedSet.has(nKey)) continue;
      if (blocked.has(nKey)) continue;

      let tooClose = false;
      for (const p of placed) {
        const dx = p.x - nx;
        const dy = p.y - ny;
        if (dx * dx + dy * dy < radiusSq) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;

      placed.push({ x: nx, y: ny });
      placedSet.add(nKey);
      blockNeighbors(nx, ny, radius, blocked);
      active.push({ x: nx, y: ny });
      found = true;
      break;
    }

    if (!found) {
      active.splice(activeIdx, 1);
    }
  }

  return placed;
}

/** 将 (cx, cy) 周围 radius 范围内的格子加入 blocked 集合（整数格近似） */
function blockNeighbors(cx: number, cy: number, radius: number, blocked: Set<string>): void {
  const r = Math.ceil(radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy < radius * radius) {
        blocked.add(`${cx + dx},${cy + dy}`);
      }
    }
  }
}

export function fieldDecorationSampler(input: Record<string, unknown>): Record<string, unknown> {
  const terrainGrid = input.terrainGrid as Grid | undefined;
  const seed = typeof input.seed === "number" ? input.seed : 0;
  const treeRadius = typeof input.treeRadius === "number" && input.treeRadius > 0 ? input.treeRadius : 2.5;
  const bushRadius = typeof input.bushRadius === "number" && input.bushRadius > 0 ? input.bushRadius : 1.5;
  const rockDensity = typeof input.rockDensity === "number" ? Math.max(0, Math.min(1, input.rockDensity)) : 0.03;
  const flowerDensity = typeof input.flowerDensity === "number" ? Math.max(0, Math.min(1, input.flowerDensity)) : 0.05;

  if (!terrainGrid || !Array.isArray(terrainGrid) || terrainGrid.length === 0) {
    return { error: "terrainGrid is required and must be a non-empty 2D array" };
  }

  const rows = terrainGrid.length;
  const cols = terrainGrid[0]?.length ?? 0;
  if (cols === 0) {
    return { error: "terrainGrid rows must not be empty" };
  }

  const rng = new SeededRandom(seed);

  // 初始化装饰物网格，全部为 0（空）
  const decorationGrid: Grid = Array.from({ length: rows }, () => new Array(cols).fill(0));

  // 收集各类格子坐标
  const grassCells = new Set<string>();
  const sandAndGrassCells: Array<{ x: number; y: number }> = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const t = terrainGrid[row][col];
      if (t === 3) {
        grassCells.add(`${col},${row}`);
        sandAndGrassCells.push({ x: col, y: row });
      } else if (t === 2) {
        sandAndGrassCells.push({ x: col, y: row });
      }
      // 水格（t === 1）不放置装饰物
    }
  }

  // 步骤 1：树木（1）— 泊松盘采样，仅在草地格
  const treeSamples = poissonDiskSample(grassCells, treeRadius, rng);
  for (const p of treeSamples) {
    decorationGrid[p.y][p.x] = 1;
  }

  // 步骤 2：灌木（2）— 从草地中排除已有树木，再泊松采样
  const grassForBush = new Set<string>();
  for (const key of grassCells) {
    const [cx, cy] = key.split(",").map(Number);
    if (decorationGrid[cy][cx] === 0) {
      grassForBush.add(key);
    }
  }

  const bushSamples = poissonDiskSample(grassForBush, bushRadius, rng);
  for (const p of bushSamples) {
    decorationGrid[p.y][p.x] = 2;
  }

  // 步骤 3：岩石（3）— 草地/沙滩空格按概率散布
  for (const cell of sandAndGrassCells) {
    if (decorationGrid[cell.y][cell.x] !== 0) continue;
    if (rng.next() < rockDensity) {
      decorationGrid[cell.y][cell.x] = 3;
    }
  }

  // 步骤 4：小花（4）— 草地/沙滩剩余空格按概率散布
  for (const cell of sandAndGrassCells) {
    if (decorationGrid[cell.y][cell.x] !== 0) continue;
    if (rng.next() < flowerDensity) {
      decorationGrid[cell.y][cell.x] = 4;
    }
  }

  return { decorationGrid };
}
