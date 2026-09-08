/**
 * tessHexGrid: 六边形镶嵌格光栅化
 *
 * 将平面光栅化为六边形镶嵌网格，每个像素标注所属六边形单元的 ID（1-based）。
 * 支持平顶（flat-top）和尖顶（pointy-top）两种朝向。
 *
 * 算法：轴坐标系（axial coordinates）+ cube-rounding
 */

// ─── Cube 坐标四舍五入（标准六边形舍入算法）────────────────────────────────

function cubeRound(fx: number, fy: number, fz: number): [number, number, number] {
  let rx = Math.round(fx);
  let ry = Math.round(fy);
  let rz = Math.round(fz);

  const dx = Math.abs(rx - fx);
  const dy = Math.abs(ry - fy);
  const dz = Math.abs(rz - fz);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }
  return [rx, ry, rz];
}

// ─── 像素 → 六边形轴坐标（平顶朝向）────────────────────────────────────────

function pixelToHexFlat(px: number, py: number, r: number): [number, number] {
  const q = (2 / 3) * px / r;
  const rCoord = (-1 / 3 * px + Math.sqrt(3) / 3 * py) / r;
  const [cq, , cr] = cubeRound(q, -q - rCoord, rCoord);
  return [cq, cr];
}

// ─── 像素 → 六边形轴坐标（尖顶朝向）────────────────────────────────────────

function pixelToHexPointy(px: number, py: number, r: number): [number, number] {
  const q = (Math.sqrt(3) / 3 * px - 1 / 3 * py) / r;
  const rCoord = (2 / 3 * py) / r;
  const [cq, , cr] = cubeRound(q, -q - rCoord, rCoord);
  return [cq, cr];
}

// ─── 构建六边形 ID 网格 ───────────────────────────────────────────────────────

function buildHexGrid(
  w: number, h: number,
  cellSize: number,
  orientation: "flat" | "pointy"
): number[][] {
  const cellMap = new Map<string, number>();
  let nextId = 1;

  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [q, r] = orientation === "flat"
        ? pixelToHexFlat(x, y, cellSize)
        : pixelToHexPointy(x, y, cellSize);

      const key = `${q},${r}`;
      if (!cellMap.has(key)) {
        cellMap.set(key, nextId++);
      }
      grid[y][x] = cellMap.get(key)!;
    }
  }
  return grid;
}

// ─── 主导出函数 ──────────────────────────────────────────────────────────────

export function tessHexGrid(
  input: Record<string, unknown>
): Record<string, unknown> {
  const w = typeof input.width === "number" ? Math.max(4, Math.round(input.width)) : 80;
  const h = typeof input.height === "number" ? Math.max(4, Math.round(input.height)) : 80;
  const cellSize = typeof input.cellSize === "number" ? Math.max(2, input.cellSize) : 10;
  const orientationRaw = typeof input.orientation === "string" ? input.orientation : "flat";
  const orientation = orientationRaw === "pointy" ? "pointy" : "flat";

  const regionGrid = buildHexGrid(w, h, cellSize, orientation);

  return { regionGrid };
}
