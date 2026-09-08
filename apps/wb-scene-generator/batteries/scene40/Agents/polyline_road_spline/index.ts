/**
 * polylineRoadSpline: 控制点 → 自然曲线道路掩码
 *
 * 与 river_spline 的区别（也是本电池存在的理由）：river_spline 会先做法线随机扰动，
 * numMidPoints=0 时只保留首尾两点、>0 时把选中的控制点偏移并按 x 重排，因此道路不保证
 * 穿过给定控制点。本电池不含任何随机成分，Catmull-Rom 在 t=0 处恒等于控制点，
 * 曲线严格依次穿过每一个控制点；输出也只含道路本身，便于下游求剩余空地。
 *
 * 输入：inputGrid (grid) — 基准/足迹网格; points (point2d, access:list) — 整组控制点，
 *       元素可以是 point2d {x,y} 或 [col,row]，也接受整份数组/JSON 字符串作为单个 item;
 *       roadWidth (number) — 笔刷直径(格); tension (number) — 张力 [0,1];
 *       roundness (number) — 圆滑增益; samplesPerSegment (number) — 每段采样数;
 *       clipToFootprint (boolean) — 是否裁剪到足迹; reinforceJoints (boolean) — 斜向接缝加固;
 *       fillValue (number) — 道路格填充值
 * 输出：outputGrid (grid) — 道路掩码; cellCount (number) — 被填充的格数
 */

import { dedupeControlPoints, sampleOpenSpline, type Vec2 } from '../../../../vendor/shared/types/scene/spline.js'

type Grid = number[][];

/** 一个能解析成坐标的元素：[col,row] 或 {x,y} */
function isPointLike(v: unknown): boolean {
  if (Array.isArray(v)) return v.length >= 2 && Number.isFinite(Number(v[0])) && Number.isFinite(Number(v[1]));
  return !!v && typeof v === "object" && "x" in v && "y" in v;
}

/**
 * points 是 access:list 端口：dispatcher 交来的永远是「一层列表」。
 * 多个 pt2_construct 经 tree_merge 汇入时，列表元素就是各个点；
 * 而整份 [[col,row],...] 字面量（或其 JSON 字符串）作为单个 item 传入时，
 * 列表会是 [[[col,row],...]] —— 这里先剥掉这层包裹，再逐元素解析。
 */
function unwrapPointList(raw: unknown): unknown {
  let list: unknown = raw;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof list === "string") {
      try {
        list = JSON.parse(list);
        continue;
      } catch {
        return [];
      }
    }
    if (!Array.isArray(list)) return list;
    if (list.length === 1 && !isPointLike(list[0]) && (Array.isArray(list[0]) || typeof list[0] === "string")) {
      list = list[0];
      continue;
    }
    return list;
  }
  return list;
}

function parsePoints(raw: unknown): Vec2[] {
  const list = unwrapPointList(raw);
  if (!Array.isArray(list)) return [];

  const out: Vec2[] = [];
  for (const pt of list) {
    let col: number, row: number;
    if (Array.isArray(pt) && pt.length >= 2) {
      col = Number(pt[0]);
      row = Number(pt[1]);
    } else if (pt && typeof pt === "object" && "x" in pt && "y" in pt) {
      col = Number((pt as { x: unknown }).x);
      row = Number((pt as { y: unknown }).y);
    } else {
      continue;
    }
    if (Number.isFinite(col) && Number.isFinite(row)) out.push([col, row]);
  }
  return out;
}

/**
 * 圆笔刷描边。除了半径内的格，还总是落笔最近的整格——
 * roadWidth < 1 时半径覆盖不到格心，靠这一笔保证道路仍是 8-连通的单格路。
 */
function rasterize(
  path: Vec2[], rows: number, cols: number,
  footprint: Grid | null, roadWidth: number, fillValue: number, reinforceJoints: boolean
): { grid: Grid; cellCount: number } {
  const grid: Grid = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  let cellCount = 0;

  const halfW = roadWidth / 2;
  const r2 = halfW * halfW;

  const paint = (row: number, col: number): void => {
    if (row < 0 || row >= rows || col < 0 || col >= cols) return;
    if (footprint && !footprint[row][col]) return;
    if (grid[row][col] !== 0) return;
    grid[row][col] = fillValue;
    cellCount++;
  };

  const stamp = (px: number, py: number): void => {
    paint(Math.round(py), Math.round(px));
    const minRow = Math.max(0, Math.floor(py - halfW));
    const maxRow = Math.min(rows - 1, Math.ceil(py + halfW));
    const minCol = Math.max(0, Math.floor(px - halfW));
    const maxCol = Math.min(cols - 1, Math.ceil(px + halfW));
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const dx = col - px, dy = row - py;
        if (dx * dx + dy * dy <= r2) paint(row, col);
      }
    }
  };

  // 按 0.5 格步长沿采样点之间补插，采样数取小也不会断线。
  for (let i = 0; i < path.length; i++) {
    const [px, py] = path[i];
    stamp(px, py);
    const next = path[i + 1];
    if (!next) continue;
    const dx = next[0] - px, dy = next[1] - py;
    const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy) / 0.5);
    for (let s = 1; s < steps; s++) {
      stamp(px + (dx * s) / steps, py + (dy * s) / steps);
    }
  }

  if (reinforceJoints) reinforce(grid, rows, cols, paint);
  return { grid, cellCount };
}

/**
 * 台阶接缝加固：道路换向的那一格（斜向台阶）处，两段直路只按一格搭接，
 * 沿路面法向量的实际通行宽度掉到 1 格，是视觉与通行上的弱点。
 *
 * 规则：2×2 窗口里已有 3 格是路、只缺 1 格时补上那一格，台阶两侧各补一格后接缝
 * 就与路面同宽。但只在**换向处**补：连续 45° 斜路每格都在错位，若无条件补会把整条
 * 斜路从 2 格加粗到 3 格。判据是缺口两侧的直路段至少持续 2 格——沿 A 所在列再往
 * 外一行仍是路（纵向错位），或沿 B 所在行再往外一列仍是路（横向错位）。
 *
 * 只做一遍且判定基于加固前的快照，避免补出来的格触发下一轮连锁加粗。补格走 paint，
 * 因此仍受足迹裁剪约束。
 */
function reinforce(
  grid: Grid, rows: number, cols: number, paint: (row: number, col: number) => void
): void {
  const snap = grid.map((row) => row.slice());
  const road = (row: number, col: number): boolean =>
    row >= 0 && row < rows && col >= 0 && col < cols && snap[row][col] !== 0;

  const gaps: Array<[number, number]> = [];
  for (let row = 0; row + 1 < rows; row++) {
    for (let col = 0; col + 1 < cols; col++) {
      const empty: Array<[number, number]> = [];
      for (const cell of [[row, col], [row, col + 1], [row + 1, col], [row + 1, col + 1]] as Array<[number, number]>) {
        if (!road(cell[0], cell[1])) empty.push(cell);
      }
      if (empty.length !== 1) continue;

      // 缺口 N 与其对角 O，A/B 是 L 形的两条臂
      const [nRow, nCol] = empty[0];
      const oRow = nRow === row ? row + 1 : row;
      const oCol = nCol === col ? col + 1 : col;
      const straightRun =
        road(nRow + (nRow - oRow), oCol) || road(oRow, nCol + (nCol - oCol));
      if (straightRun) gaps.push(empty[0]);
    }
  }
  for (const [row, col] of gaps) paint(row, col);
}

export function polylineRoadSpline(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.inputGrid as Grid | undefined;
  if (!Array.isArray(inputGrid) || inputGrid.length === 0 || !Array.isArray(inputGrid[0]) || inputGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const controlPoints = dedupeControlPoints(parsePoints(input.points));
  if (controlPoints.length < 2) {
    return { error: "points must contain at least 2 distinct [col,row] control points" };
  }

  const roadWidth = typeof input.roadWidth === "number" && input.roadWidth > 0 ? input.roadWidth : 2;
  const tension = typeof input.tension === "number"
    ? Math.max(0, Math.min(1, input.tension)) : 0;
  const roundness = typeof input.roundness === "number"
    ? Math.max(0, Math.min(2.5, input.roundness)) : 1.3;
  const samplesPerSegment = typeof input.samplesPerSegment === "number"
    ? Math.max(1, Math.floor(input.samplesPerSegment)) : 24;
  const clipToFootprint = typeof input.clipToFootprint === "boolean" ? input.clipToFootprint : true;
  const reinforceJoints = typeof input.reinforceJoints === "boolean" ? input.reinforceJoints : true;
  const fillValue = typeof input.fillValue === "number" && input.fillValue !== 0
    ? Math.round(input.fillValue) : 1;

  const path = sampleOpenSpline(controlPoints, samplesPerSegment, tension, roundness);
  const { grid, cellCount } = rasterize(
    path, inputGrid.length, inputGrid[0].length,
    clipToFootprint ? inputGrid : null, roadWidth, fillValue, reinforceJoints
  );

  return { outputGrid: grid, cellCount };
}
