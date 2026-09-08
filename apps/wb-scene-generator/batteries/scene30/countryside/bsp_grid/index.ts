/**
 * bspGrid: 用二叉空间分割（BSP）算法生成多房间布局，输出多值网格
 * 输入：grid (grid) — 输入网格，从尺寸推断生成区域大小;
 *       minRoomSize (number) — 最小房间尺寸; maxDepth (number) — 最大分割深度;
 *       wallThickness (number) — 墙体厚度;
 *       seed (number) — 随机种子
 * 输出：outputGrid (grid) — 每房间填充唯一ID的多值网格;
 *       outputNameList (array) — [{id, name}] 房间清单;
 *       roomCount (number) — 房间总数
 */

type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 线性同余伪随机数生成器，返回 [0, 1) 范围浮点数 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * BSP 递归分割：将 rect 区域递归切分为叶节点矩形列表。
 *
 * 切割方向：奇偶深度强制交替（偶数层竖切、奇数层横切），只在单边不可切时才退化到可切方向。
 * 强制交替方向可避免同一方向的墙缝在不同层对齐，消除视觉上的直通道路。
 *
 * 切割点：在 [minSize, size-minSize] 范围内完全随机取点（不再以中心为基准偏移），
 * 使各层切线位置分散，进一步降低墙缝对齐概率。
 */
function bspSplit(
  rect: Rect,
  minSize: number,
  maxDepth: number,
  rng: () => number,
  depth: number,
  leaves: Rect[]
): void {
  const canSplitW = rect.w >= minSize * 2;
  const canSplitH = rect.h >= minSize * 2;

  if (depth >= maxDepth || (!canSplitW && !canSplitH)) {
    leaves.push(rect);
    return;
  }

  // 奇偶深度交替方向：偶数层竖切，奇数层横切，只在单边不可切时退化
  let cutVertical: boolean;
  if (canSplitW && !canSplitH) {
    cutVertical = true;
  } else if (!canSplitW && canSplitH) {
    cutVertical = false;
  } else {
    cutVertical = depth % 2 === 0;
  }

  if (cutVertical) {
    // 竖切：切点在 [minSize, w-minSize] 内完全随机，避免对齐
    const range = rect.w - minSize * 2;
    const splitX = minSize + Math.round(rng() * range);
    bspSplit({ x: rect.x, y: rect.y, w: splitX, h: rect.h }, minSize, maxDepth, rng, depth + 1, leaves);
    bspSplit({ x: rect.x + splitX, y: rect.y, w: rect.w - splitX, h: rect.h }, minSize, maxDepth, rng, depth + 1, leaves);
  } else {
    // 横切：切点在 [minSize, h-minSize] 内完全随机，避免对齐
    const range = rect.h - minSize * 2;
    const splitY = minSize + Math.round(rng() * range);
    bspSplit({ x: rect.x, y: rect.y, w: rect.w, h: splitY }, minSize, maxDepth, rng, depth + 1, leaves);
    bspSplit({ x: rect.x, y: rect.y + splitY, w: rect.w, h: rect.h - splitY }, minSize, maxDepth, rng, depth + 1, leaves);
  }
}

/**
 * 将叶节点矩形列表渲染到网格：收缩 wall 格后内部区域填充 roomId。
 * 收缩后若任意方向尺寸 < 1，则跳过该房间（空间不足，视为纯墙）。
 */
function renderRooms(
  grid: Grid,
  leaves: Rect[],
  wallThickness: number
): NameEntry[] {
  const nameList: NameEntry[] = [];
  let roomId = 1;

  for (const leaf of leaves) {
    const inner: Rect = {
      x: leaf.x + wallThickness,
      y: leaf.y + wallThickness,
      w: leaf.w - wallThickness * 2,
      h: leaf.h - wallThickness * 2,
    };

    if (inner.w <= 0 || inner.h <= 0) continue;

    for (let r = inner.y; r < inner.y + inner.h; r++) {
      for (let c = inner.x; c < inner.x + inner.w; c++) {
        grid[r][c] = roomId;
      }
    }

    nameList.push({ id: roomId, name: `房间 ${roomId}` });
    roomId++;
  }

  return nameList;
}

export function bspGrid(input: Record<string, unknown>): Record<string, unknown> {
  const inputGrid = input.grid as Grid | undefined;
  if (!inputGrid || inputGrid.length === 0 || (inputGrid[0]?.length ?? 0) === 0) {
    return { error: "grid is required" };
  }

  const height = inputGrid.length;
  const width = inputGrid[0].length;

  const minRoomSize = typeof input.minRoomSize === "number" && input.minRoomSize >= 10 ? Math.round(input.minRoomSize) : 20;
  const maxDepth = typeof input.maxDepth === "number" && input.maxDepth >= 1 ? Math.round(input.maxDepth) : 2;
  const wallThickness = typeof input.wallThickness === "number" && input.wallThickness >= 1 ? Math.round(input.wallThickness) : 1;
  const rawSeed = typeof input.seed === "number" ? input.seed : 0;
  const seed = rawSeed === 0 ? Date.now() : rawSeed;

  const rng = makeRng(seed);

  const outputGrid: Grid = Array.from({ length: height }, () => new Array(width).fill(0));

  const leaves: Rect[] = [];
  bspSplit({ x: 0, y: 0, w: width, h: height }, minRoomSize, maxDepth, rng, 0, leaves);

  const outputNameList = renderRooms(outputGrid, leaves, wallThickness);

  return {
    outputGrid,
    outputNameList,
    roomCount: outputNameList.length,
  };
}
