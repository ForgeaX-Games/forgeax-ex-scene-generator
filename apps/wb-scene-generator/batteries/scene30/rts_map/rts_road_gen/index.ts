/**
 * rtsRoadGen: 折线走廊 + 树状分叉 v5
 *
 * 核心设计：从 baseGrid 掩码中自动识别各独立区域，
 * 每个区域提取两个锚点：
 *   entry   — 距地图中心最近的边界格（主干入口）
 *   centroid — 区域质心（分叉支路终点，保证末端到达区域内部）
 * 从地图中心出发，每个区域都保证有一条分叉末端可达。
 *
 * 节点树（enableBranch=true）：
 *   中心(出发点)
 *     +--[拐点]-- J1 --[拐点]-- entry1（近中心侧入口）
 *     |           └──[拐点]-- centroid1（区域质心）
 *     +--[拐点]-- J2 --[拐点]-- entry2
 *     |           └──[拐点]-- centroid2
 *     ...
 *
 * 输入：baseGrid, roadWidth, centerRadius, maxRegions,
 *       enableBranch, waypointsPerLeg, waypointOffset,
 *       junctionDist, diagFirst, seed
 * 输出：roadGrid, centerGrid
 */

// --- LCG 随机数 ---------------------------------------------------------------

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
  float(): number {
    return Number(this.next() & 0xffffffffn) / 0xffffffff;
  }
}

// --- 圆形膨胀 -----------------------------------------------------------------

function dilateCircle(
  grid: number[][],
  cx: number, cy: number,
  radius: number,
  w: number, h: number
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) {
        const nx = cx + dx, ny = cy + dy;
        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
          grid[ny][nx] = 1;
        }
      }
    }
  }
}

// --- 八方向折线段绘制（仅水平、垂直、45° 三种方向）-------------------------

function drawOctagonalLine(
  grid: number[][],
  ax: number, ay: number,
  bx: number, by: number,
  roadWidth: number,
  w: number, h: number,
  diagFirst: boolean
): void {
  const dx = bx - ax, dy = by - ay;
  const adx = Math.abs(dx), ady = Math.abs(dy);
  const sx = Math.sign(dx), sy = Math.sign(dy);
  const diagSteps = Math.min(adx, ady);
  const straightSteps = Math.max(adx, ady) - diagSteps;
  const ssx = adx >= ady ? sx : 0;
  const ssy = ady >  adx ? sy : 0;

  let px = ax, py = ay;

  if (diagFirst) {
    for (let i = 0; i <= diagSteps; i++)
      dilateCircle(grid, px + i * sx, py + i * sy, roadWidth, w, h);
    px += diagSteps * sx;
    py += diagSteps * sy;
    for (let i = 1; i <= straightSteps; i++)
      dilateCircle(grid, px + i * ssx, py + i * ssy, roadWidth, w, h);
  } else {
    for (let i = 0; i <= straightSteps; i++)
      dilateCircle(grid, px + i * ssx, py + i * ssy, roadWidth, w, h);
    px += straightSteps * ssx;
    py += straightSteps * ssy;
    for (let i = 1; i <= diagSteps; i++)
      dilateCircle(grid, px + i * sx, py + i * sy, roadWidth, w, h);
  }
}

// --- 接口定义 -----------------------------------------------------------------

interface Point { x: number; y: number; }

// --- 从掩码中提取各区域的入口点和质心 ----------------------------------------
//
// 算法：
//   1. BFS 连通分量标记，识别所有独立区域
//   2. 每个区域收集"边界格子"（至少一个邻居是0或越界）
//   3. entry    = 距 (cx,cy) 最近的边界格（主干入口，靠近中心侧）
//   4. centroid = 区域所有格子的平均坐标（分叉支路终点，自然落于区域内部）
//   5. 按区域大小降序排列，取前 maxPoints 个

interface RegionAnchors {
  entry: Point;
  centroid: Point;
}

function findRegionAnchors(
  grid: number[][],
  w: number, h: number,
  cx: number, cy: number,
  maxPoints: number
): RegionAnchors[] {
  const label = new Int32Array(w * h);

  interface Region {
    size: number;
    sumX: number;
    sumY: number;
    entry: Point | null;
    entryDist2: number;
  }
  const regions: Region[] = [];

  const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] === 0 || label[y * w + x] !== 0) continue;

      const id = regions.length + 1;
      const reg: Region = {
        size: 0, sumX: 0, sumY: 0,
        entry: null, entryDist2: Infinity,
      };
      regions.push(reg);

      const queue: number[] = [y * w + x];
      label[y * w + x] = id;
      let head = 0;

      while (head < queue.length) {
        const idx = queue[head++];
        const px = idx % w, py = (idx / w) | 0;
        reg.size++;
        reg.sumX += px;
        reg.sumY += py;

        let isBoundary = false;
        for (const [ddx, ddy] of DIRS4) {
          const nx = px + ddx, ny = py + ddy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h || grid[ny][nx] === 0) {
            isBoundary = true;
          } else if (label[ny * w + nx] === 0 && grid[ny][nx] !== 0) {
            label[ny * w + nx] = id;
            queue.push(ny * w + nx);
          }
        }

        if (isBoundary) {
          const d2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
          if (d2 < reg.entryDist2) {
            reg.entryDist2 = d2;
            reg.entry = { x: px, y: py };
          }
        }
      }
    }
  }

  return regions
    .filter(r => r.entry !== null)
    .sort((a, b) => b.size - a.size)
    .slice(0, maxPoints)
    .map(r => ({
      entry: r.entry!,
      centroid: { x: Math.round(r.sumX / r.size), y: Math.round(r.sumY / r.size) },
    }));
}

// --- 拐点生成 -----------------------------------------------------------------

function generateWaypoints(
  ax: number, ay: number,
  bx: number, by: number,
  count: number,
  waypointOffset: number,
  rng: LCG
): Point[] {
  if (count <= 0) return [];
  const dx = bx - ax, dy = by - ay;
  const segLen = Math.sqrt(dx * dx + dy * dy);
  if (segLen < 1) return [];

  const perpX = -dy / segLen;
  const perpY =  dx / segLen;
  const maxOffsetPx = waypointOffset * segLen;

  const pts: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const mx = ax + dx * t;
    const my = ay + dy * t;
    const offset = (rng.float() - 0.5) * 2 * maxOffsetPx;
    pts.push({
      x: Math.round(mx + perpX * offset),
      y: Math.round(my + perpY * offset),
    });
  }
  return pts;
}

// --- 路径连接 -----------------------------------------------------------------

function connectPath(
  grid: number[][],
  points: Point[],
  roadWidth: number,
  w: number, h: number,
  diagFirst: boolean
): void {
  for (let i = 0; i + 1 < points.length; i++) {
    drawOctagonalLine(
      grid,
      points[i].x, points[i].y,
      points[i + 1].x, points[i + 1].y,
      roadWidth, w, h, diagFirst
    );
  }
}

// --- 主导出函数 ---------------------------------------------------------------

export function rtsRoadGen(
  input: Record<string, unknown>
): Record<string, unknown> {
  const rawBase = input.baseGrid;
  if (
    !Array.isArray(rawBase) ||
    rawBase.length === 0 ||
    !Array.isArray((rawBase as unknown[][])[0])
  ) {
    return { error: "baseGrid is required (number[][])" };
  }
  const baseGrid = rawBase as number[][];

  const mapH = baseGrid.length;
  const mapW = baseGrid[0].length;
  const mapCX = Math.floor(mapW / 2);
  const mapCY = Math.floor(mapH / 2);

  // 参数解析
  const roadWidth =
    typeof input.roadWidth === "number" ? Math.max(1, Math.round(input.roadWidth)) : 5;
  const centerRadius =
    typeof input.centerRadius === "number" ? Math.max(1, Math.round(input.centerRadius)) : 8;
  const maxRegions =
    typeof input.maxRegions === "number" ? Math.max(1, Math.round(input.maxRegions)) : 8;
  const enableBranch =
    typeof input.enableBranch === "boolean" ? input.enableBranch : true;
  const waypointsPerLeg =
    typeof input.waypointsPerLeg === "number"
      ? Math.max(0, Math.min(3, Math.round(input.waypointsPerLeg)))
      : 1;
  const waypointOffset =
    typeof input.waypointOffset === "number"
      ? Math.max(0, Math.min(0.5, input.waypointOffset))
      : 0.3;
  const junctionDist =
    typeof input.junctionDist === "number"
      ? Math.max(0.1, Math.min(0.9, input.junctionDist))
      : 0.6;
  const diagFirst =
    typeof input.diagFirst === "boolean" ? input.diagFirst : true;
  const seedRaw = typeof input.seed === "number" ? Math.round(input.seed) : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = new LCG(baseSeed);

  // 初始化输出网格
  const roadGrid: number[][] = Array.from({ length: mapH }, () => new Array(mapW).fill(0));
  const centerGrid: number[][] = Array.from({ length: mapH }, () => new Array(mapW).fill(0));

  // 中心枢纽
  dilateCircle(centerGrid, mapCX, mapCY, centerRadius, mapW, mapH);
  dilateCircle(roadGrid, mapCX, mapCY, centerRadius, mapW, mapH);

  // 从掩码中提取各区域的入口点（近中心）和深入点（远中心）
  const anchors = findRegionAnchors(baseGrid, mapW, mapH, mapCX, mapCY, maxRegions);
  if (anchors.length === 0) return { roadGrid, centerGrid };

  const center: Point = { x: mapCX, y: mapCY };

  // 辅助：带拐点的路径连接
  const connect = (from: Point, to: Point) => {
    const waypts = generateWaypoints(
      from.x, from.y, to.x, to.y,
      waypointsPerLeg, waypointOffset, rng
    );
    connectPath(roadGrid, [from, ...waypts, to], roadWidth, mapW, mapH, diagFirst);
  };

  // 按 entry 点角度排序（使分叉时相邻区域在角度上也相邻）
  const sorted = [...anchors].sort((a, b) =>
    Math.atan2(a.entry.y - mapCY, a.entry.x - mapCX) -
    Math.atan2(b.entry.y - mapCY, b.entry.x - mapCX)
  );

  if (!enableBranch) {
    // ── 星形模式：中心直连每个区域入口点，无分叉
    for (const { entry } of sorted) {
      connect(center, entry);
    }
  } else {
    // ── 每臂分叉模式：
    //   center --[拐点]-- J --[拐点]-- entry    (支路A：近中心侧入口)
    //                    └──[拐点]-- centroid  (支路B：区域质心，保证末端落于区域内)
    for (const { entry, centroid } of sorted) {
      // 分叉节点 J：沿中心→入口点方向走 junctionDist 比例
      const jx = Math.round(mapCX + (entry.x - mapCX) * junctionDist);
      const jy = Math.round(mapCY + (entry.y - mapCY) * junctionDist);
      const junction: Point = { x: jx, y: jy };

      connect(center, junction);      // 主干：中心 → J
      connect(junction, entry);       // 支路A：J → 区域近中心侧入口
      connect(junction, centroid);    // 支路B：J → 区域质心
    }
  }

  return { roadGrid, centerGrid };
}
