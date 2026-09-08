/**
 * thermal_erosion
 * 简单热风化（talus angle）：邻居高差超过 talusAngle 时按比例输送，
 * 反复迭代直到陡崖塌平为碎石坡。
 */

type Grid = number[][];

const D4X = [1, 0, -1, 0];
const D4Y = [0, 1, 0, -1];
const D8X = [1, 1, 0, -1, -1, -1, 0, 1];
const D8Y = [0, 1, 1, 1, 0, -1, -1, -1];

export function thermalErosion(input: Record<string, unknown>): Record<string, unknown> {
  const src = input.heightGrid as Grid | undefined;
  if (!src || src.length === 0 || !src[0] || src[0].length === 0) {
    return { heightGrid: [] };
  }
  const h = src.length;
  const w = src[0].length;
  const iterations = Math.max(1, Math.min(1000, Math.floor(typeof input.iterations === "number" ? input.iterations : 50)));
  const talus = typeof input.talusAngle === "number" ? input.talusAngle : 0.05;
  const rate = Math.max(0, Math.min(1, typeof input.transportRate === "number" ? input.transportRate : 0.5));
  const diag = input.diagonal === undefined ? true : !!input.diagonal;

  const map = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) map[y * w + x] = src[y][x];

  const dxArr = diag ? D8X : D4X;
  const dyArr = diag ? D8Y : D4Y;
  const dirs = dxArr.length;

  const buf = new Float64Array(w * h);

  for (let it = 0; it < iterations; it++) {
    buf.fill(0);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const cur = map[idx];
        let totalExcess = 0;
        const excesses = new Array<number>(dirs);
        for (let d = 0; d < dirs; d++) {
          const nx = x + dxArr[d];
          const ny = y + dyArr[d];
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) { excesses[d] = 0; continue; }
          const nIdx = ny * w + nx;
          const diff = cur - map[nIdx];
          if (diff > talus) {
            excesses[d] = diff - talus;
            totalExcess += diff - talus;
          } else {
            excesses[d] = 0;
          }
        }
        if (totalExcess <= 0) continue;
        const totalMove = totalExcess * 0.5 * rate;
        buf[idx] -= totalMove;
        for (let d = 0; d < dirs; d++) {
          if (excesses[d] === 0) continue;
          const share = totalMove * (excesses[d] / totalExcess);
          const nx = x + dxArr[d];
          const ny = y + dyArr[d];
          buf[ny * w + nx] += share;
        }
      }
    }

    for (let i = 0; i < map.length; i++) map[i] += buf[i];
  }

  const heightGrid: Grid = new Array(h);
  for (let y = 0; y < h; y++) {
    heightGrid[y] = new Array(w);
    for (let x = 0; x < w; x++) heightGrid[y][x] = Math.round(map[y * w + x] * 100000) / 100000;
  }

  return { heightGrid };
}
