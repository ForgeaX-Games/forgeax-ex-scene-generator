/**
 * tessRhombus: 菱形（平行四边形）镶嵌格
 *
 * 使用斜坐标系将平面分割为完全相同的菱形/平行四边形单元格。
 * 核心：将直角坐标系转换为斜坐标系，在斜坐标系中取整即可定位格子。
 *
 * 两种预设：
 *  - rhombus: 60° 菱形（等边，视觉上是"3D 立方体叠加"效果）
 *  - oblique:  可调倾斜角的平行四边形
 */

/**
 * 直角坐标 → 斜坐标（轴 X 水平，轴 Y 倾斜 angle 角）
 * 斜坐标 u = px - py * cos(angle) / sin(angle)
 *          v = py / sin(angle)
 * 则每个格子 (floor(u/s), floor(v/s)) 对应一个平行四边形单元。
 */
function pixelToOblique(
  px: number, py: number,
  sideLen: number, angleDeg: number
): [number, number] {
  const angleRad = (angleDeg * Math.PI) / 180;
  const sinA = Math.sin(angleRad);
  const cosA = Math.cos(angleRad);
  // 斜坐标转换
  const u = px - py * cosA / sinA;
  const v = py / sinA;
  return [Math.floor(u / sideLen), Math.floor(v / sideLen)];
}

function buildRhombusGrid(
  w: number, h: number,
  sideLen: number, angleDeg: number
): number[][] {
  const cellMap = new Map<string, number>();
  let nextId = 1;
  const grid: number[][] = Array.from({ length: h }, () => new Array(w).fill(0));

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [cu, cv] = pixelToOblique(x, y, sideLen, angleDeg);
      const key = `${cu},${cv}`;
      if (!cellMap.has(key)) cellMap.set(key, nextId++);
      grid[y][x] = cellMap.get(key)!;
    }
  }
  return grid;
}

export function tessRhombus(
  input: Record<string, unknown>
): Record<string, unknown> {
  const w = typeof input.width === "number" ? Math.max(4, Math.round(input.width)) : 80;
  const h = typeof input.height === "number" ? Math.max(4, Math.round(input.height)) : 80;
  const sideLen = typeof input.sideLen === "number" ? Math.max(2, input.sideLen) : 12;
  const angleDeg = typeof input.angle === "number"
    ? Math.max(20, Math.min(160, input.angle))
    : 60;

  const regionGrid = buildRhombusGrid(w, h, sideLen, angleDeg);
  return { regionGrid };
}
