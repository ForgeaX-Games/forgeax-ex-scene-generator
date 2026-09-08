/**
 * building_door: 在墙体网格中随机打开门洞
 * 输入：wallGrid   (grid)   — 墙体掩码，非零值为墙
 *       doorCount  (number) — 门的数量
 *       doorWidth  (number) — 门宽（格子数），沿墙方向连续清除
 *       seed       (number) — 随机种子，0 使用当前时间戳
 * 输出：outputGrid (grid)   — 打好门洞的墙体掩码，门洞处=0
 *
 * 算法思路（优先模式）：
 *   优先：在连续6格直线墙段的中间位置开门。
 *     - 找所有长度恰好 >= 6 的连续直线墙段（横线或竖线，不折弯）
 *     - 门洞开在该段的中间：起始列/行 = floor((段起点 + 段终点 - doorWidth + 1) / 2)
 *     - 同时要求门两侧（垂直方向）至少一侧有空格（贯通）
 *   退回：若无法从优先候选中满足 doorCount，从普通候选（任意满足贯通条件的墙段）中补足。
 */

/** 简单线性同余随机数生成器 */
function makeLCG(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = Date.now() >>> 0;
  return function () {
    s = Math.imul(1664525, s) + 1013904223;
    s = s >>> 0;
    return s / 0x100000000;
  };
}

/** Fisher-Yates 洗牌，原地打乱数组 */
function shuffle<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/**
 * 候选门洞：起点坐标(r,c)、方向(H=水平/V=垂直)、宽度
 * 水平门洞：固定行 r，列从 c 到 c+width-1
 * 垂直门洞：固定列 c，行从 r 到 r+width-1
 */
interface DoorCandidate {
  r: number;
  c: number;
  dir: "H" | "V";
  width: number;
}

/** 返回一个候选门洞占据的所有 grid key（r*cols+c） */
function candidateCells(door: DoorCandidate, cols: number): number[] {
  const keys: number[] = [];
  if (door.dir === "H") {
    for (let dc = 0; dc < door.width; dc++) keys.push(door.r * cols + door.c + dc);
  } else {
    for (let dr = 0; dr < door.width; dr++) keys.push((door.r + dr) * cols + door.c);
  }
  return keys;
}

/**
 * 优先候选：在连续6格直线墙段的中间开门。
 * 扫描每一行/列，找出所有长度 >= 6 的连续墙段，
 * 取其中点位置（偏向正中间）作为门的起始位置，
 * 并要求门两侧（垂直方向）至少一侧有空格。
 */
function collectPriorityCandidates(
  grid: number[][],
  rows: number,
  cols: number,
  doorWidth: number
): DoorCandidate[] {
  const SEGMENT_LEN = 6;
  const candidates: DoorCandidate[] = [];

  // 水平方向：扫描每行的连续墙段
  for (let r = 0; r < rows; r++) {
    let segStart = -1;
    for (let c = 0; c <= cols; c++) {
      const isWall = c < cols && grid[r][c] !== 0;
      if (isWall && segStart === -1) {
        segStart = c;
      } else if (!isWall && segStart !== -1) {
        const segEnd = c - 1;
        const segLen = segEnd - segStart + 1;
        if (segLen >= SEGMENT_LEN) {
          // 门放在段的正中间
          const doorStart = Math.floor((segStart + segEnd - doorWidth + 1) / 2);
          const doorEnd   = doorStart + doorWidth - 1;
          // 确保门在段内
          if (doorStart >= segStart && doorEnd <= segEnd) {
            // 要求门两侧（上/下）至少一侧贯通
            const hasTop    = r > 0       && grid[r - 1][doorStart] === 0;
            const hasBottom = r < rows - 1 && grid[r + 1][doorStart] === 0;
            if (hasTop || hasBottom) {
              candidates.push({ r, c: doorStart, dir: "H", width: doorWidth });
            }
          }
        }
        segStart = -1;
      }
    }
  }

  // 垂直方向：扫描每列的连续墙段
  for (let c = 0; c < cols; c++) {
    let segStart = -1;
    for (let r = 0; r <= rows; r++) {
      const isWall = r < rows && grid[r][c] !== 0;
      if (isWall && segStart === -1) {
        segStart = r;
      } else if (!isWall && segStart !== -1) {
        const segEnd = r - 1;
        const segLen = segEnd - segStart + 1;
        if (segLen >= SEGMENT_LEN) {
          const doorStart = Math.floor((segStart + segEnd - doorWidth + 1) / 2);
          const doorEnd   = doorStart + doorWidth - 1;
          if (doorStart >= segStart && doorEnd <= segEnd) {
            const hasLeft  = c > 0       && grid[doorStart][c - 1] === 0;
            const hasRight = c < cols - 1 && grid[doorStart][c + 1] === 0;
            if (hasLeft || hasRight) {
              candidates.push({ r: doorStart, c, dir: "V", width: doorWidth });
            }
          }
        }
        segStart = -1;
      }
    }
  }

  return candidates;
}

/**
 * 普通候选（退回方式）：任意满足 doorWidth 格连续墙且两侧有贯通空格的段落。
 */
function collectFallbackCandidates(
  grid: number[][],
  rows: number,
  cols: number,
  doorWidth: number
): DoorCandidate[] {
  const candidates: DoorCandidate[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols - doorWidth; c++) {
      let allWall = true;
      for (let dc = 0; dc < doorWidth; dc++) {
        if (grid[r][c + dc] === 0) { allWall = false; break; }
      }
      if (!allWall) continue;
      const hasTop    = r > 0       && grid[r - 1][c] === 0;
      const hasBottom = r < rows - 1 && grid[r + 1][c] === 0;
      if (hasTop || hasBottom) {
        candidates.push({ r, c, dir: "H", width: doorWidth });
      }
    }
  }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r <= rows - doorWidth; r++) {
      let allWall = true;
      for (let dr = 0; dr < doorWidth; dr++) {
        if (grid[r + dr][c] === 0) { allWall = false; break; }
      }
      if (!allWall) continue;
      const hasLeft  = c > 0       && grid[r][c - 1] === 0;
      const hasRight = c < cols - 1 && grid[r][c + 1] === 0;
      if (hasLeft || hasRight) {
        candidates.push({ r, c, dir: "V", width: doorWidth });
      }
    }
  }

  return candidates;
}

/** 从候选列表中依次挑选不与已开门重叠的门，直到达到 need 个或候选耗尽 */
function placeDoors(
  candidates: DoorCandidate[],
  need: number,
  openedCells: Set<number>,
  outputGrid: number[][],
  doorGrid: number[][],
  cols: number
): number {
  let placed = 0;
  for (const cand of candidates) {
    if (placed >= need) break;
    const keys = candidateCells(cand, cols);
    if (keys.some(k => openedCells.has(k))) continue;
    for (const k of keys) {
      openedCells.add(k);
      outputGrid[Math.floor(k / cols)][k % cols] = 0;
      doorGrid[Math.floor(k / cols)][k % cols] = 1;
    }
    placed++;
  }
  return placed;
}

function processOneGrid(
  wallGrid: number[][],
  doorCount: number,
  doorWidth: number,
  seedRaw: number
): { outputGrid: number[][]; doorGrid: number[][] } {
  const rows = wallGrid.length;
  const cols = wallGrid[0].length;
  const rand = makeLCG(seedRaw);
  const outputGrid: number[][] = wallGrid.map(row => [...row]);
  const doorGrid: number[][] = wallGrid.map(row => row.map(() => 0));

  if (doorCount === 0) return { outputGrid, doorGrid };

  const priorityCandidates = collectPriorityCandidates(wallGrid, rows, cols, doorWidth);
  shuffle(priorityCandidates, rand);
  const openedCells = new Set<number>();
  const placedPriority = placeDoors(priorityCandidates, doorCount, openedCells, outputGrid, doorGrid, cols);

  const remaining = doorCount - placedPriority;
  if (remaining > 0) {
    const fallbackCandidates = collectFallbackCandidates(wallGrid, rows, cols, doorWidth);
    const fallbackFiltered = fallbackCandidates.filter(
      cand => !candidateCells(cand, cols).some(k => openedCells.has(k))
    );
    shuffle(fallbackFiltered, rand);
    placeDoors(fallbackFiltered, remaining, openedCells, outputGrid, doorGrid, cols);
  }
  return { outputGrid, doorGrid };
}

export function buildingDoor(input: Record<string, unknown>): Record<string, unknown> {
  const rawList   = input.gridList ?? input.wallGrid;
  const doorCount = typeof input.doorCount === "number" ? Math.max(0, Math.round(input.doorCount)) : 1;
  const doorWidth = typeof input.doorWidth === "number" ? Math.max(1, Math.round(input.doorWidth)) : 1;
  const seedRaw   = typeof input.seed      === "number" ? input.seed : 0;

  const gridList: number[][][] = Array.isArray(rawList)
    ? (Array.isArray(rawList[0]) && Array.isArray((rawList[0] as unknown[])[0])
        ? rawList as number[][][]
        : [rawList as number[][]])
    : [];

  if (gridList.length === 0) {
    return { error: "gridList is required and must be non-empty" };
  }

  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const outputGridList: number[][][] = [];
  const doorGridList: number[][][] = [];

  gridList.forEach((grid, i) => {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) {
      outputGridList.push([]);
      doorGridList.push([]);
      return;
    }
    const effectiveSeed = baseSeed + i * 999983;
    const result = processOneGrid(grid, doorCount, doorWidth, effectiveSeed);
    outputGridList.push(result.outputGrid);
    doorGridList.push(result.doorGrid);
  });

  return { outputGridList, doorGridList };
}
