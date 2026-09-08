/**
 * generator.ts — 多朝向组合棋盘格（Multi-Orientation Grid）
 *
 * 将掩码区域随机划分为若干子区（Voronoi 种子划分），每个子区随机选取
 * 一个旋转角度（从候选集中选），在各子区内绘制旋转后的规则网格道路。
 * 子区边界作为主路绘制，子区内部按旋转角度的主路/辅路规则绘制。
 *
 * 后处理：
 *   1. 面积 < minParcelSize 的地块单元格全部转为辅路（视觉上填满）
 *   2. 输出的 subRoad 中去除与 mainRoad 重叠的单元格，保证两层不重叠
 */

export interface NameEntry {
  id: number;
  name: string;
}

export interface ChessRoadResult {
  mainRoad: number[][];
  subRoad: number[][];
  parcels: number[][];
  nameList: NameEntry[];
}

export interface MultiOrientOptions {
  mainSpacing:    number;
  subSpacing:     number;
  mainRoadWidth:  number;
  subRoadWidth:   number;
  zoneCount:      number;
  minParcelSize:  number;
  seed:           number;
}

/** 辅路连通块面积阈值：小于此格数的连通块合并为主路 */
const MIN_SUB_ROAD_SIZE = 20;

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

const ANGLE_CANDIDATES = [0, 15, 30, 45, 60, 75, 90];

function rotatePt(c: number, r: number, cx: number, cy: number, angleDeg: number): [number, number] {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dc = c - cx, dr = r - cy;
  return [cx + dc * cos - dr * sin, cy + dc * sin + dr * cos];
}

function paintThickPixel(
  grid: number[][],
  mask: boolean[][],
  rows: number, cols: number,
  r: number, c: number,
  halfW: number,
) {
  for (let dr = -halfW; dr <= halfW; dr++) {
    for (let dc = -halfW; dc <= halfW; dc++) {
      const pr = r + dr, pc = c + dc;
      if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && mask[pr][pc]) {
        grid[pr][pc] = 1;
      }
    }
  }
}

/**
 * floodFillParcels: flood fill 非道路区域，返回地块网格 + 每个地块的单元格坐标列表。
 * 单元格坐标列表用于后续的小地块过滤。
 */
function floodFillParcels(
  mask: boolean[][],
  mainRoad: number[][],
  subRoad: number[][],
  rows: number, cols: number,
): {
  parcels: number[][];
  nameList: NameEntry[];
  parcelCells: Map<number, [number, number][]>;
} {
  const parcels: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const visited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const nameList: NameEntry[] = [];
  const parcelCells = new Map<number, [number, number][]>();
  let parcelId = 1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c] || mainRoad[r][c] || subRoad[r][c] || visited[r][c]) continue;
      const queue: [number, number][] = [[r, c]];
      visited[r][c] = true;
      const cells: [number, number][] = [];
      while (queue.length > 0) {
        const [cr, cc] = queue.shift()!;
        parcels[cr][cc] = parcelId;
        cells.push([cr, cc]);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = cr + dr, nc = cc + dc;
          if (
            nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
            mask[nr][nc] && !mainRoad[nr][nc] && !subRoad[nr][nc] && !visited[nr][nc]
          ) {
            visited[nr][nc] = true;
            queue.push([nr, nc]);
          }
        }
      }
      if (cells.length > 0) {
        parcelCells.set(parcelId, cells);
        nameList.push({ id: parcelId, name: `地块 ${parcelId}` });
      }
      parcelId++;
    }
  }

  return { parcels, nameList, parcelCells };
}

export function generateMultiOrientRoad(
  grid: number[][],
  opts: MultiOrientOptions,
): ChessRoadResult {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const empty = (): number[][] =>
    Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (rows === 0 || cols === 0) {
    return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };
  }

  const mask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let minX = cols, minY = rows, maxX = -1, maxY = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        mask[r][c] = true;
        if (c < minX) minX = c; if (c > maxX) maxX = c;
        if (r < minY) minY = r; if (r > maxY) maxY = r;
      }
    }
  }
  if (maxX < 0) return { mainRoad: empty(), subRoad: empty(), parcels: empty(), nameList: [] };

  const rng = makeRng(opts.seed);
  const { mainSpacing, subSpacing, mainRoadWidth, subRoadWidth, zoneCount, minParcelSize } = opts;
  const mainHalfW = Math.max(0, Math.floor((mainRoadWidth - 1) / 2));
  const subHalfW  = Math.max(0, Math.floor((subRoadWidth  - 1) / 2));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  // --- Generate Voronoi seeds ---
  const count = Math.max(1, zoneCount);
  const seeds: { r: number; c: number; angle: number }[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      c: minX + rng() * (maxX - minX),
      r: minY + rng() * (maxY - minY),
      angle: ANGLE_CANDIDATES[Math.floor(rng() * ANGLE_CANDIDATES.length)],
    });
  }

  // --- Assign each mask cell to nearest Voronoi zone ---
  const zoneOf: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      let bestDist = Infinity, bestZ = 0;
      for (let z = 0; z < seeds.length; z++) {
        const dr = r - seeds[z].r, dc = c - seeds[z].c;
        const d = dr * dr + dc * dc;
        if (d < bestDist) { bestDist = d; bestZ = z; }
      }
      zoneOf[r][c] = bestZ;
    }
  }

  const mainRoad = empty();
  const subRoad  = empty();

  // --- Paint rotated grid lines per zone ---
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      const z = zoneOf[r][c];
      if (z < 0) continue;
      const angle = seeds[z].angle;

      const [rc, rr] = rotatePt(c, r, cx, cy, -angle);
      const localC = rc - minX;
      const localR = rr - minY;

      const posC = ((localC % mainSpacing) + mainSpacing) % mainSpacing;
      const posR = ((localR % mainSpacing) + mainSpacing) % mainSpacing;

      const onMainH = posR < mainRoadWidth || posR > mainSpacing - mainRoadWidth;
      const onMainV = posC < mainRoadWidth || posC > mainSpacing - mainRoadWidth;

      if (onMainH || onMainV) {
        paintThickPixel(mainRoad, mask, rows, cols, r, c, mainHalfW);
        continue;
      }

      if (subSpacing > 0) {
        const sC = ((localC % subSpacing) + subSpacing) % subSpacing;
        const sR = ((localR % subSpacing) + subSpacing) % subSpacing;
        const onSubH = sR < subRoadWidth || sR > subSpacing - subRoadWidth;
        const onSubV = sC < subRoadWidth || sC > subSpacing - subRoadWidth;
        if (onSubH || onSubV) {
          paintThickPixel(subRoad, mask, rows, cols, r, c, subHalfW);
        }
      }
    }
  }

  // --- Paint zone boundaries as main roads ---
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r][c]) continue;
      const z = zoneOf[r][c];
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (
          nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
          mask[nr][nc] && zoneOf[nr][nc] !== z
        ) {
          paintThickPixel(mainRoad, mask, rows, cols, r, c, mainHalfW);
          break;
        }
      }
    }
  }

  // --- Flood fill parcels (with cell lists for size filtering) ---
  const { parcels, nameList, parcelCells } = floodFillParcels(mask, mainRoad, subRoad, rows, cols);

  // --- Post-process 1: remove undersized parcels → convert to subRoad ---
  const threshold = Math.max(0, minParcelSize);
  const removedIds = new Set<number>();
  if (threshold > 0) {
    for (const [id, cells] of parcelCells) {
      if (cells.length < threshold) {
        removedIds.add(id);
        for (const [cr, cc] of cells) {
          parcels[cr][cc] = 0;
          subRoad[cr][cc] = 1;
        }
      }
    }
  }

  // Remove filtered parcels from nameList
  const filteredNameList = nameList.filter(e => !removedIds.has(e.id));

  // --- Post-process 2: merge undersized subRoad connected components into mainRoad ---
  const subThreshold = MIN_SUB_ROAD_SIZE;
  if (subThreshold > 0) {
    const subVisited: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!subRoad[r][c] || subVisited[r][c]) continue;
        // BFS to find the connected component of this subRoad region
        const queue: [number, number][] = [[r, c]];
        subVisited[r][c] = true;
        const component: [number, number][] = [];
        while (queue.length > 0) {
          const [cr, cc] = queue.shift()!;
          component.push([cr, cc]);
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nr = cr + dr, nc = cc + dc;
            if (
              nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
              subRoad[nr][nc] && !subVisited[nr][nc]
            ) {
              subVisited[nr][nc] = true;
              queue.push([nr, nc]);
            }
          }
        }
        if (component.length < subThreshold) {
          for (const [cr, cc] of component) {
            subRoad[cr][cc] = 0;
            mainRoad[cr][cc] = 1;
          }
        }
      }
    }
  }

  // --- Post-process 3: subRoad minus mainRoad (no overlap) ---
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (subRoad[r][c] && mainRoad[r][c]) {
        subRoad[r][c] = 0;
      }
    }
  }

  return { mainRoad, subRoad, parcels, nameList: filteredNameList };
}
