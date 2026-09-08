/**
 * rule_indoor_contour_corridor
 * Generates N concentric corridor rings by computing a distance field from
 * the boundary of an arbitrary filled region (L/U/T/irregular shapes).
 *
 * Ring placement:
 *   Ring 1 at distance `firstRingOffset` from the outer wall
 *   Ring 2 at Ring1 + `ringSpacing`
 *   Ring 3 at Ring2 + `ringSpacing`
 *   ... up to `maxRings` or until space runs out
 *
 * Output encoding: 0 = exterior/wall, 1 = corridor, 2 = room zone
 */

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function computeDistanceField(grid: number[][], rows: number, cols: number): number[][] {
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(-1));
  const queue: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] === 0) continue;
      let isBoundary = false;
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || grid[nr][nc] === 0) {
          isBoundary = true;
          break;
        }
      }
      if (isBoundary) {
        dist[r][c] = 0;
        queue.push([r, c]);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (grid[nr][nc] === 0) continue;
      if (dist[nr][nc] >= 0) continue;
      dist[nr][nc] = dist[r][c] + 1;
      queue.push([nr, nc]);
    }
  }

  return dist;
}

export function ruleIndoorContourCorridor(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0 || !inputGrid[0] || inputGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;

  const firstRingOffset = typeof input.firstRingOffset === "number" ? Math.max(3, Math.floor(input.firstRingOffset)) : 12;
  const ringSpacing = typeof input.ringSpacing === "number" ? Math.max(8, Math.floor(input.ringSpacing)) : 22;
  const corridorWidth = typeof input.corridorWidth === "number" ? Math.max(2, Math.floor(input.corridorWidth)) : 5;
  const wallThickness = typeof input.wallThickness === "number" ? Math.max(1, Math.floor(input.wallThickness)) : 2;
  const maxRings = typeof input.maxRings === "number" ? Math.max(1, Math.min(10, Math.floor(input.maxRings))) : 5;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const _baseSeed = seedRaw === 0 ? Date.now() : seedRaw;

  const dist = computeDistanceField(inputGrid, rows, cols);

  let maxDist = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (dist[r][c] > maxDist) maxDist = dist[r][c];
    }
  }

  const rings: { start: number; end: number }[] = [];
  for (let i = 0; i < maxRings; i++) {
    const start = firstRingOffset + i * ringSpacing;
    const end = start + corridorWidth;
    if (start + 2 >= maxDist) break;
    rings.push({ start, end: Math.min(end, maxDist) });
  }

  const ringCount = rings.length;

  const outputGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = dist[r][c];

      if (d < 0) {
        outputGrid[r][c] = 0;
        continue;
      }

      if (d < wallThickness) {
        outputGrid[r][c] = 0;
        continue;
      }

      let isCorridor = false;
      for (const ring of rings) {
        if (d >= ring.start && d < ring.end) {
          isCorridor = true;
          break;
        }
      }

      outputGrid[r][c] = isCorridor ? 1 : 2;
    }
  }

  return { outputGrid, ringCount };
}
