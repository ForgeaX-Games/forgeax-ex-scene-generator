/**
 * riverLakeGen: 在单张输入网格上生成河流和湖泊系统
 *
 * DataTree 数据格式：输入 inputGrid 与输出 waterGrid 均为 grid/access:item——
 * 本算子每次只处理单张网格，网格列表由引擎按 DataTree 自动逐张 fanout / 重组。
 *
 * 输入：inputGrid (grid) — 基准网格; riverCount/algorithm/minWidth/maxWidth/lakeCount/waterItems/seed 参数
 * 输出：waterGrid (grid) — 含水域掩码的多值网格; nameList (array) — 水域ID名称清单
 */

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Point { x: number; y: number }

interface WaterIDs {
  shore: number;
  shallow: number;
  medium: number;
  deep: number;
  itemStart: number;
  itemIDs: number[];
}

interface NameEntry { id: number; name: string }

// ─────────────────────────────────────────────────────────────
// LCG random number generator (identical constants to Go source)
// ─────────────────────────────────────────────────────────────

class LCG {
  private state: bigint;

  constructor(seed: number) {
    this.state = seed !== 0 ? BigInt(seed) : BigInt(Date.now());
  }

  next(): bigint {
    this.state = (this.state * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    return this.state;
  }

  intn(n: number): number {
    if (n <= 0) return 0;
    return Number(this.next() % BigInt(n));
  }

  float64(): number {
    return Number(this.next() & 0xFFFFFFFFn) / 0xFFFFFFFF;
  }
}

// ─────────────────────────────────────────────────────────────
// Perlin noise (identical logic to Go source)
// ─────────────────────────────────────────────────────────────

/**
 * Build a fresh 512-entry permutation table from `seed`. Returned (not
 * mutated into module state) so `perlin2D` stays a pure function of its
 * arguments — no top-level mutable table shared across unrelated calls to
 * `riverLakeGen` (see the cosmos_zone_marker purity fix this mirrors).
 */
function buildPermutation(seed: number): number[] {
  const base = Array.from({ length: 256 }, (_, i) => i);
  let r = BigInt(seed === 0 ? 12345 : seed);
  for (let i = 255; i > 0; i--) {
    r = (r * 6364136223846793005n + 1442695040888963407n) & 0xFFFFFFFFFFFFFFFFn;
    const j = Number(r % BigInt(i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  const perm = new Array<number>(512);
  for (let i = 0; i < 256; i++) {
    perm[i] = base[i];
    perm[i + 256] = base[i];
  }
  return perm;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 7;
  let u = x, v = y;
  if (h >= 4) { u = y; v = x; }
  if (h & 1) u = -u;
  if (h & 2) v = -v;
  return u + v;
}

function perlin2D(perm: readonly number[], x: number, y: number): number {
  const xi = Math.floor(x) & 255;
  const yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);
  const aa = perm[perm[xi] + yi];
  const ab = perm[perm[xi] + yi + 1];
  const ba = perm[perm[xi + 1] + yi];
  const bb = perm[perm[xi + 1] + yi + 1];
  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampInt(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function maxInt(a: number, b: number): number { return a > b ? a : b; }
function absInt(a: number): number { return a < 0 ? -a : a; }
function sign(a: number): number { return a > 0 ? 1 : a < 0 ? -1 : 0; }

function findMaxValue(grid: number[][]): number {
  let max = 0;
  for (const row of grid) for (const v of row) if (v > max) max = v;
  return max;
}

// ─────────────────────────────────────────────────────────────
// River path generators
// ─────────────────────────────────────────────────────────────

function chooseRiverEndpoints(rng: LCG, width: number, height: number): [number, number, number, number] {
  const edge1 = rng.intn(4);
  const edge2 = (edge1 + 2) % 4;

  let startX = 0, startY = 0, endX = 0, endY = 0;

  switch (edge1) {
    case 0: startX = rng.intn(width); startY = 0; break;
    case 1: startX = width - 1; startY = rng.intn(height); break;
    case 2: startX = rng.intn(width); startY = height - 1; break;
    case 3: startX = 0; startY = rng.intn(height); break;
  }
  switch (edge2) {
    case 0: endX = rng.intn(width); endY = 0; break;
    case 1: endX = width - 1; endY = rng.intn(height); break;
    case 2: endX = rng.intn(width); endY = height - 1; break;
    case 3: endX = 0; endY = rng.intn(height); break;
  }

  return [startX, startY, endX, endY];
}

function generateStraightPath(startX: number, startY: number, endX: number, endY: number): Point[] {
  const steps = Math.max(absInt(endX - startX), absInt(endY - startY));
  if (steps === 0) return [{ x: startX, y: startY }];
  const path: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    path.push({
      x: Math.round(startX + t * (endX - startX)),
      y: Math.round(startY + t * (endY - startY)),
    });
  }
  return path;
}

function generateMeanderingPath(
  rng: LCG, startX: number, startY: number, endX: number, endY: number,
  width: number, height: number
): Point[] {
  const path: Point[] = [{ x: startX, y: startY }];
  let x = startX, y = startY;
  const targetX = endX, targetY = endY;
  const noiseOffset = rng.float64() * 1000;
  const maxSteps = width + height;

  for (let i = 0; i < maxSteps; i++) {
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) break;

    const ndx = dx / dist;
    const ndy = dy / dist;
    const t = i * 0.1;
    const perpX = -ndy, perpY = ndx;
    const meander = Math.sin(t * 2 + noiseOffset) * 3;

    x = clamp(x + (ndx + perpX * meander * 0.3) * 1.5, 0, width - 1);
    y = clamp(y + (ndy + perpY * meander * 0.3) * 1.5, 0, height - 1);

    const np: Point = { x: Math.floor(x), y: Math.floor(y) };
    const last = path[path.length - 1];
    if (last.x !== np.x || last.y !== np.y) path.push(np);
  }
  path.push({ x: endX, y: endY });
  return path;
}

function generateBranchingPath(
  perm: readonly number[], rng: LCG, startX: number, startY: number, endX: number, endY: number,
  width: number, height: number
): Point[] {
  const path: Point[] = [{ x: startX, y: startY }];
  let x = startX, y = startY;
  const targetX = endX, targetY = endY;
  const noiseOffset = rng.float64() * 1000;
  const maxSteps = width + height;

  for (let i = 0; i < maxSteps; i++) {
    const dx = targetX - x;
    const dy = targetY - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 2) break;

    const ndx = dx / dist;
    const ndy = dy / dist;
    const noise = perlin2D(perm, x / 30 + noiseOffset, y / 30 + noiseOffset);
    const noiseY = perlin2D(perm, x / 30 + noiseOffset + 100, y / 30 + noiseOffset + 100);

    x = clamp(x + (ndx + noise * 0.6) * 1.5, 0, width - 1);
    y = clamp(y + (ndy + noiseY * 0.6) * 1.5, 0, height - 1);

    const np: Point = { x: Math.floor(x), y: Math.floor(y) };
    const last = path[path.length - 1];
    if (last.x !== np.x || last.y !== np.y) path.push(np);
  }
  path.push({ x: endX, y: endY });
  return path;
}

function generateRandomPath(
  rng: LCG, startX: number, startY: number, endX: number, endY: number,
  width: number, height: number
): Point[] {
  const path: Point[] = [{ x: startX, y: startY }];
  let x = startX, y = startY;
  const maxSteps = (width + height) * 2;

  for (let i = 0; i < maxSteps; i++) {
    if (x === endX && y === endY) break;
    const dx = endX - x;
    const dy = endY - y;
    let nx = x, ny = y;

    if (rng.float64() < 0.7) {
      if (absInt(dx) > absInt(dy)) { nx = x + sign(dx); }
      else { ny = y + sign(dy); }
    } else {
      const dir = rng.intn(4);
      if (dir === 0) ny = y - 1;
      else if (dir === 1) nx = x + 1;
      else if (dir === 2) ny = y + 1;
      else nx = x - 1;
    }

    nx = clampInt(nx, 0, width - 1);
    ny = clampInt(ny, 0, height - 1);
    if (nx !== x || ny !== y) { x = nx; y = ny; path.push({ x, y }); }
  }

  const last = path[path.length - 1];
  if (last.x !== endX || last.y !== endY) path.push({ x: endX, y: endY });
  return path;
}

// ─────────────────────────────────────────────────────────────
// Drawing
// ─────────────────────────────────────────────────────────────

function drawRiver(
  path: Point[], minWidth: number, maxWidth: number,
  waterGrid: number[][], waterMask: boolean[][], ids: WaterIDs,
  width: number, height: number
): void {
  const pathLen = path.length;
  for (let i = 0; i < pathLen; i++) {
    const p = path[i];
    const t = i / pathLen;
    const widthFactor = Math.sin(t * Math.PI);
    const riverWidth = minWidth + widthFactor * (maxWidth - minWidth);
    const halfWidth = Math.floor(riverWidth / 2);

    for (let dy = -halfWidth - 1; dy <= halfWidth + 1; dy++) {
      for (let dx = -halfWidth - 1; dx <= halfWidth + 1; dx++) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist <= riverWidth / 2 + 1) {
            waterMask[ny][nx] = true;
            waterGrid[ny][nx] = ids.deep;
          }
        }
      }
    }
  }
}

function drawBranches(
  rng: LCG, mainPath: Point[], minWidth: number, maxWidth: number,
  waterGrid: number[][], waterMask: boolean[][], ids: WaterIDs,
  width: number, height: number
): void {
  const branchProb = 0.15;
  const start = Math.floor(mainPath.length / 4);
  const end = Math.floor(mainPath.length * 3 / 4);

  for (let i = start; i < end; i++) {
    if (rng.float64() < branchProb) {
      const p = mainPath[i];
      let dx = 0, dy = 0;
      if (i < mainPath.length - 1) {
        dx = mainPath[i + 1].x - p.x;
        dy = mainPath[i + 1].y - p.y;
      }
      let perpX = -dy, perpY = dx;
      if (rng.intn(2) === 0) { perpX = -perpX; perpY = -perpY; }

      const branchLen = rng.intn(Math.floor(width / 4)) + Math.floor(width / 8);
      const ex = clampInt(p.x + perpX * branchLen, 0, width - 1);
      const ey = clampInt(p.y + perpY * branchLen, 0, height - 1);

      const branchPath = generateMeanderingPath(rng, p.x, p.y, ex, ey, width, height);
      drawRiver(
        branchPath,
        maxInt(1, minWidth - 1), maxInt(2, maxWidth - 2),
        waterGrid, waterMask, ids, width, height
      );
    }
  }
}

function generateLake(
  perm: readonly number[], rng: LCG, minWidth: number, maxWidth: number,
  waterGrid: number[][], waterMask: boolean[][], ids: WaterIDs,
  width: number, height: number
): void {
  const minRadius = maxInt(5, minWidth * 2);
  const maxRadius = maxInt(10, maxWidth * 3);
  const radiusX = minRadius + rng.intn(maxRadius - minRadius + 1);
  const radiusY = minRadius + rng.intn(maxRadius - minRadius + 1);

  let centerX = radiusX, centerY = radiusY;
  for (let attempt = 0; attempt < 100; attempt++) {
    centerX = radiusX + rng.intn(Math.max(1, width - 2 * radiusX));
    centerY = radiusY + rng.intn(Math.max(1, height - 2 * radiusY));
    if (!waterMask[centerY]?.[centerX]) break;
  }

  const noiseOffset = rng.float64() * 1000;
  const irregularity = 0.3;

  for (let dy = -radiusY - 2; dy <= radiusY + 2; dy++) {
    for (let dx = -radiusX - 2; dx <= radiusX + 2; dx++) {
      const nx = centerX + dx;
      const ny = centerY + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;

      const distX = dx / radiusX;
      const distY = dy / radiusY;
      const dist = Math.sqrt(distX * distX + distY * distY);
      const angle = Math.atan2(dy, dx);
      const noise = perlin2D(
        perm,
        nx / 10 + noiseOffset + Math.cos(angle),
        ny / 10 + noiseOffset + Math.sin(angle)
      );
      const threshold = 1.0 + noise * irregularity;

      if (dist <= threshold) {
        waterMask[ny][nx] = true;
        waterGrid[ny][nx] = ids.deep;
      }
    }
  }
}

function applyDepthZones(
  perm: readonly number[], rng: LCG, waterGrid: number[][], waterMask: boolean[][], ids: WaterIDs,
  width: number, height: number
): void {
  // Initialize distance map
  const distMap: number[][] = Array.from({ length: height }, () =>
    new Array(width).fill(0)
  );
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (waterMask[y][x]) distMap[y][x] = 999;
    }
  }

  // BFS seed: water cells touching non-water
  const queue: Point[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!waterMask[y][x]) continue;
      let isEdge = false;
      outer:
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width || !waterMask[ny][nx]) {
            isEdge = true;
            break outer;
          }
        }
      }
      if (isEdge) { distMap[y][x] = 0; queue.push({ x, y }); }
    }
  }

  // BFS propagation
  const dirs: Point[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
  let head = 0;
  while (head < queue.length) {
    const p = queue[head++];
    const currDist = distMap[p.y][p.x];
    for (const d of dirs) {
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && waterMask[ny][nx]) {
        if (distMap[ny][nx] > currDist + 1) {
          distMap[ny][nx] = currDist + 1;
          queue.push({ x: nx, y: ny });
        }
      }
    }
  }

  const noiseOffset = rng.float64() * 1000;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!waterMask[y][x]) continue;
      const dist = distMap[y][x];
      const noise = perlin2D(perm, x / 8 + noiseOffset, y / 8 + noiseOffset) * 0.8;
      const adjusted = dist + noise;

      if (adjusted < 0.5) waterGrid[y][x] = ids.shore;
      else if (adjusted < 1.5) waterGrid[y][x] = ids.shallow;
      else if (adjusted < 2.5) waterGrid[y][x] = ids.medium;
      else waterGrid[y][x] = ids.deep;
    }
  }
}

function placeWaterItems(
  waterGrid: number[][], waterMask: boolean[][], ids: WaterIDs,
  waterItems: string[], seed: number,
  width: number, height: number
): void {
  if (waterItems.length === 0 || ids.itemIDs.length === 0) return;

  const itemRng = new LCG(seed + 0x12345678);

  const available = new Map<number, true>();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (waterGrid[y][x] === ids.shallow || waterGrid[y][x] === ids.medium) {
        available.set(y * width + x, true);
      }
    }
  }
  if (available.size === 0) return;

  const totalItems = maxInt(1, Math.floor(available.size / 20));
  const itemsPerType = maxInt(1, Math.floor(totalItems / waterItems.length));
  const minSpacing = maxInt(2, Math.floor(Math.sqrt(available.size / totalItems)));

  for (let itemIdx = 0; itemIdx < ids.itemIDs.length; itemIdx++) {
    if (available.size === 0) break;
    const itemID = ids.itemIDs[itemIdx];

    const candidates: Point[] = [];
    for (const key of available.keys()) {
      candidates.push({ x: key % width, y: Math.floor(key / width) });
    }

    const placed: Point[] = [];
    let attempts = 0;
    const maxAttempts = itemsPerType * 50;

    while (placed.length < itemsPerType && attempts < maxAttempts && candidates.length > 0) {
      attempts++;
      const idx = itemRng.intn(candidates.length);
      const p = candidates[idx];

      let tooClose = false;
      for (const e of placed) {
        const dx = p.x - e.x, dy = p.y - e.y;
        if (dx * dx + dy * dy < minSpacing * minSpacing) { tooClose = true; break; }
      }

      if (!tooClose) {
        waterGrid[p.y][p.x] = itemID;
        placed.push(p);
        available.delete(p.y * width + p.x);
      }
      candidates.splice(idx, 1);
    }

    if (itemIdx < ids.itemIDs.length - 1) {
      for (const p of placed) {
        for (let dy = -minSpacing; dy <= minSpacing; dy++) {
          for (let dx = -minSpacing; dx <= minSpacing; dx++) {
            if (dx * dx + dy * dy <= minSpacing * minSpacing) {
              const nx = p.x + dx, ny = p.y + dy;
              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                available.delete(ny * width + nx);
              }
            }
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────

export function riverLakeGen(input: Record<string, unknown>): Record<string, unknown> {
  const grid = input.inputGrid as number[][] | undefined;
  if (!grid || grid.length === 0 || grid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const riverCount = typeof input.riverCount === "number" && input.riverCount > 0
    ? Math.floor(input.riverCount) : 2;
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "meandering";
  const minWidth = typeof input.minWidth === "number" && input.minWidth > 0
    ? Math.floor(input.minWidth) : 2;
  let maxWidth = typeof input.maxWidth === "number" && input.maxWidth > 0
    ? Math.floor(input.maxWidth) : 6;
  if (maxWidth < minWidth) maxWidth = minWidth;
  const lakeCount = typeof input.lakeCount === "number" && input.lakeCount > 0
    ? Math.floor(input.lakeCount) : 0;
  const seedRaw = typeof input.seed === "number" ? Math.floor(input.seed) : 0;
  const seed = seedRaw === 0 ? Date.now() : seedRaw;

  // Parse waterItems — accept JSON string or array
  let waterItems: string[] = [];
  const rawItems = input.waterItems;
  if (Array.isArray(rawItems)) {
    waterItems = rawItems.filter((v): v is string => typeof v === "string");
  } else if (typeof rawItems === "string" && rawItems.trim().startsWith("[")) {
    try { waterItems = JSON.parse(rawItems); } catch { /* ignore */ }
  }

  // Parse inputNameList
  let inputNameList: NameEntry[] = [];
  const rawNL = input.inputNameList;
  if (Array.isArray(rawNL)) {
    inputNameList = rawNL.filter(
      (e): e is NameEntry => e != null && typeof (e as NameEntry).id === "number"
    );
  }

  const height = grid.length;
  const width = grid[0].length;

  const rng = new LCG(seed);
  const perm = buildPermutation(seed);

  // Copy input grid
  const waterGrid: number[][] = grid.map((row) => [...row]);

  const maxVal = findMaxValue(grid);
  const ids: WaterIDs = {
    shore: maxVal + 1,
    shallow: maxVal + 2,
    medium: maxVal + 3,
    deep: maxVal + 4,
    itemStart: maxVal + 5,
    itemIDs: waterItems.map((_, i) => maxVal + 5 + i),
  };

  const nameList: NameEntry[] = [
    { id: ids.shore, name: "河岸" },
    { id: ids.shallow, name: "浅水" },
    { id: ids.medium, name: "中水" },
    { id: ids.deep, name: "深水" },
    ...waterItems.map((name, i) => ({ id: ids.itemIDs[i], name })),
  ];

  const waterMask: boolean[][] = Array.from({ length: height }, () =>
    new Array(width).fill(false)
  );

  // Generate rivers
  for (let i = 0; i < riverCount; i++) {
    const [sx, sy, ex, ey] = chooseRiverEndpoints(rng, width, height);
    let path: Point[];
    switch (algorithm) {
      case "straight":
        path = generateStraightPath(sx, sy, ex, ey);
        break;
      case "meandering":
        path = generateMeanderingPath(rng, sx, sy, ex, ey, width, height);
        break;
      case "branching":
        path = generateBranchingPath(perm, rng, sx, sy, ex, ey, width, height);
        drawBranches(rng, path, minWidth, maxWidth, waterGrid, waterMask, ids, width, height);
        break;
      case "random":
        path = generateRandomPath(rng, sx, sy, ex, ey, width, height);
        break;
      default:
        path = generateMeanderingPath(rng, sx, sy, ex, ey, width, height);
    }
    drawRiver(path, minWidth, maxWidth, waterGrid, waterMask, ids, width, height);
  }

  // Generate lakes
  for (let i = 0; i < lakeCount; i++) {
    generateLake(perm, rng, minWidth, maxWidth, waterGrid, waterMask, ids, width, height);
  }

  // Apply depth zones
  applyDepthZones(perm, rng, waterGrid, waterMask, ids, width, height);

  // Place water items
  if (waterItems.length > 0) {
    placeWaterItems(waterGrid, waterMask, ids, waterItems, seed, width, height);
  }

  // Merge name lists (input first, then water)
  const mergedNameList = inputNameList.length > 0
    ? [...inputNameList, ...nameList]
    : nameList;

  return { waterGrid, nameList: mergedNameList };
}
