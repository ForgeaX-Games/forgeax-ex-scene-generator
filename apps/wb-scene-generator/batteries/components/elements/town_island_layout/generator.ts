/**
 * Town Island Layout Generator
 *
 * Phase 1 – Single-level BSP road generation:
 *   BSP splits produce road cells; leaf blocks become parcels.
 *   Road direction (H / V / intersection) is tracked per cell to enable
 *   clean directional border extensions later.
 *
 * Phase 2 – Island shape clipping:
 *   Coverage threshold is used ONLY as a keep/remove decision per parcel block.
 *   Kept parcels are output whole — individual cells are never pixel-clipped.
 *
 * Phase 3 – Road retention:
 *   Road cells within (roadWidth + 1) BFS steps of any kept parcel are retained.
 *
 * Phase 4 – Border road extension:
 *   Only true endpoints of H/V road segments extend (in their natural direction).
 *   Extension is 1–4 cells (hardcoded). Intersections never extend.
 */

export interface TownIslandOptions {
  roadWidth: number;         // shared by both main and sub roads
  blockMinSize: number;      // shared by both BSP levels
  shapeType: string;         // 'circle' | 'ellipse' | 'organic'
  shapeScale: number;
  coverageThreshold: number;
  seed: number;
}

export interface NameEntry { id: number; name: string; type: string; }

export interface TownIslandResult {
  road: number[][];
  parcels: number[][];
  nameList: NameEntry[];
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface Block { x: number; y: number; w: number; h: number; }

const DIR_H = 1;  // horizontal strip
const DIR_V = 2;  // vertical strip
const DIR_X = 3;  // intersection

// ─── RNG (LCG) ────────────────────────────────────────────────────────────────

function makeRng(seed: number): () => number {
  let s = (seed === 0 ? Date.now() : seed) >>> 0;
  return () => {
    s = Math.imul(s, 1664525) + 1013904223;
    return (s >>> 0) / 0x100000000;
  };
}

// ─── BSP split ────────────────────────────────────────────────────────────────

function bspSplit(
  block: Block,
  minSize: number,
  roadWidth: number,
  splitRatio: number,
  roadGrid: number[][],
  dirGrid: number[][],
  mask: boolean[][],
  rows: number,
  cols: number,
  rng: () => number,
): Block[] {
  const canH = block.h >= minSize * 2 + roadWidth;
  const canV = block.w >= minSize * 2 + roadWidth;
  if (!canH && !canV) return [block];

  const splitH = canH && (!canV || rng() < 0.5);

  if (splitH) {
    const lo = Math.max(minSize, Math.floor(block.h * splitRatio));
    const hi = Math.min(
      block.h - minSize - roadWidth,
      Math.floor(block.h * (1 - splitRatio)) - roadWidth,
    );
    if (lo > hi) return [block];
    const split = lo + Math.floor(rng() * (hi - lo + 1));

    for (let dy = 0; dy < roadWidth; dy++) {
      const r = block.y + split + dy;
      if (r < 0 || r >= rows) continue;
      for (let c = block.x; c < block.x + block.w; c++) {
        if (c >= 0 && c < cols && mask[r][c]) {
          roadGrid[r][c] = 1;
          dirGrid[r][c] = dirGrid[r][c] === DIR_V ? DIR_X : DIR_H;
        }
      }
    }
    const top: Block = { x: block.x, y: block.y,                    w: block.w, h: split };
    const bot: Block = { x: block.x, y: block.y + split + roadWidth, w: block.w, h: block.h - split - roadWidth };
    return [
      ...bspSplit(top, minSize, roadWidth, splitRatio, roadGrid, dirGrid, mask, rows, cols, rng),
      ...bspSplit(bot, minSize, roadWidth, splitRatio, roadGrid, dirGrid, mask, rows, cols, rng),
    ];
  } else {
    const lo = Math.max(minSize, Math.floor(block.w * splitRatio));
    const hi = Math.min(
      block.w - minSize - roadWidth,
      Math.floor(block.w * (1 - splitRatio)) - roadWidth,
    );
    if (lo > hi) return [block];
    const split = lo + Math.floor(rng() * (hi - lo + 1));

    for (let dx = 0; dx < roadWidth; dx++) {
      const c = block.x + split + dx;
      if (c < 0 || c >= cols) continue;
      for (let r = block.y; r < block.y + block.h; r++) {
        if (r >= 0 && r < rows && mask[r][c]) {
          roadGrid[r][c] = 1;
          dirGrid[r][c] = dirGrid[r][c] === DIR_H ? DIR_X : DIR_V;
        }
      }
    }
    const left:  Block = { x: block.x,                    y: block.y, w: split,                    h: block.h };
    const right: Block = { x: block.x + split + roadWidth, y: block.y, w: block.w - split - roadWidth, h: block.h };
    return [
      ...bspSplit(left,  minSize, roadWidth, splitRatio, roadGrid, dirGrid, mask, rows, cols, rng),
      ...bspSplit(right, minSize, roadWidth, splitRatio, roadGrid, dirGrid, mask, rows, cols, rng),
    ];
  }
}

// ─── Island shape checker ─────────────────────────────────────────────────────

function buildShapeChecker(
  shapeType: string,
  cx: number, cy: number,
  bboxW: number, bboxH: number,
  scale: number,
  rng: () => number,
): (r: number, c: number) => boolean {
  const area = bboxW * bboxH * Math.min(0.9, Math.max(0.2, scale));

  if (shapeType === "circle") {
    const radius = Math.sqrt(area / Math.PI);
    return (r, c) => {
      const dx = c - cx, dy = r - cy;
      return dx * dx + dy * dy <= radius * radius;
    };
  }

  if (shapeType === "ellipse") {
    const aspect = 0.5 + rng() * 1.0;
    const rx = Math.sqrt((area * aspect) / Math.PI);
    const ry = Math.sqrt(area / (aspect * Math.PI));
    const angle = rng() * Math.PI;
    const cosA = Math.cos(angle), sinA = Math.sin(angle);
    return (r, c) => {
      const dx = c - cx, dy = r - cy;
      const lx = dx * cosA + dy * sinA;
      const ly = -dx * sinA + dy * cosA;
      return (lx / rx) * (lx / rx) + (ly / ry) * (ly / ry) <= 1;
    };
  }

  // organic – sine-wave distorted ellipse
  const aspect = 0.5 + rng() * 1.0;
  const rx = Math.sqrt((area * aspect) / Math.PI);
  const ry = Math.sqrt(area / (aspect * Math.PI));
  const freq  = 3 + Math.floor(rng() * 4);
  const amp   = 0.10 + rng() * 0.20;
  const phase = rng() * Math.PI * 2;
  return (r, c) => {
    const dx = c - cx, dy = r - cy;
    const theta = Math.atan2(dy / ry, dx / rx);
    const distortion = 1 + amp * Math.sin(freq * theta + phase);
    const normalDist = Math.sqrt((dx / rx) * (dx / rx) + (dy / ry) * (dy / ry));
    return normalDist <= distortion;
  };
}

// ─── BFS mask expansion ───────────────────────────────────────────────────────

function expandMask(
  mask: boolean[][],
  rows: number,
  cols: number,
  radius: number,
): boolean[][] {
  const dist: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(Infinity));
  const result: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  const queue: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (mask[r][c]) {
        dist[r][c] = 0;
        result[r][c] = true;
        queue.push([r, c]);
      }
    }
  }

  const DIRS4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;
  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    if (dist[r][c] >= radius) continue;
    for (const [dr, dc] of DIRS4) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && dist[nr][nc] === Infinity) {
        dist[nr][nc] = dist[r][c] + 1;
        result[nr][nc] = true;
        queue.push([nr, nc]);
      }
    }
  }
  return result;
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export function generateTownIsland(
  grid: number[][],
  opts: TownIslandOptions,
): TownIslandResult {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const empty = (): number[][] =>
    Array.from({ length: rows }, () => new Array(cols).fill(0));

  if (rows === 0 || cols === 0) {
    return { road: empty(), parcels: empty(), nameList: [] };
  }

  // Build input mask and bounding box
  const mask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  let minX = cols, minY = rows, maxX = -1, maxY = -1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) {
        mask[r][c] = true;
        if (c < minX) minX = c;
        if (c > maxX) maxX = c;
        if (r < minY) minY = r;
        if (r > maxY) maxY = r;
      }
    }
  }

  if (maxX < 0) {
    return { road: empty(), parcels: empty(), nameList: [] };
  }

  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const rng = makeRng(opts.seed);

  const rw  = Math.max(1, opts.roadWidth);
  const bms = Math.max(2, opts.blockMinSize);
  const sr  = 0.4; // fixed split ratio

  // ── Phase 1: BSP road generation + parcel assignment ─────────────────────
  const road    = empty();
  const roadDir = empty();
  const parcels = empty();

  const root: Block = { x: minX, y: minY, w: bboxW, h: bboxH };

  // Single-level BSP: splits produce roads, leaf blocks become parcels
  const leafBlocks = bspSplit(
    root, bms, rw, sr, road, roadDir, mask, rows, cols, rng,
  );

  let parcelId = 1;
  for (const lb of leafBlocks) {
    for (let r = lb.y; r < lb.y + lb.h; r++) {
      for (let c = lb.x; c < lb.x + lb.w; c++) {
        if (r >= 0 && r < rows && c >= 0 && c < cols && mask[r][c] && road[r][c] === 0) {
          parcels[r][c] = parcelId;
        }
      }
    }
    parcelId++;
  }

  // ── Phase 2: Island shape ──────────────────────────────────────────────────
  // Center is always the geometric center of the valid bounding box
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const isInShape = buildShapeChecker(
    opts.shapeType, cx, cy, bboxW, bboxH, opts.shapeScale, rng,
  );

  // ── Phase 3: Parcel coverage filter (block-level only, no pixel clipping) ─
  //
  // Coverage is used ONLY to decide keep/remove. A kept parcel is output
  // with ALL its cells intact — never partially clipped.
  const parcelStats = new Map<number, { inside: number; total: number }>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pid = parcels[r][c];
      if (pid <= 0) continue;
      if (!parcelStats.has(pid)) parcelStats.set(pid, { inside: 0, total: 0 });
      const s = parcelStats.get(pid)!;
      s.total++;
      if (isInShape(r, c)) s.inside++;
    }
  }

  const threshold = Math.min(1, Math.max(0, opts.coverageThreshold));
  const keptIds = new Set<number>();
  for (const [pid, s] of parcelStats) {
    if (s.total > 0 && s.inside / s.total >= threshold) keptIds.add(pid);
  }

  // Build kept-parcel mask (whole blocks, no shape clip)
  const keptParcelMask: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (keptIds.has(parcels[r][c])) {
        keptParcelMask[r][c] = true;
      } else {
        parcels[r][c] = 0; // remove whole parcel block
      }
    }
  }

  // ── Phase 4: Road retention (BFS from kept parcels) ───────────────────────
  const roadKeepZone = expandMask(keptParcelMask, rows, cols, rw + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (road[r][c] === 1 && !roadKeepZone[r][c]) {
        road[r][c] = 0;
        roadDir[r][c] = 0;
      }
    }
  }

  // ── Phase 5: Border road extension (1–4 cells, direction-aligned) ─────────
  //
  // Only true endpoints of H/V segments extend, and only along their travel
  // axis. Intersections (DIR_X) never extend.
  {
    const wasRoad: boolean[][] = road.map(row => row.map(v => v === 1));

    const isKeptRoad = (r: number, c: number): boolean =>
      r >= 0 && r < rows && c >= 0 && c < cols && wasRoad[r][c];

    const filled = new Set<number>();

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!wasRoad[r][c]) continue;

        const dir = roadDir[r][c];
        if (dir === DIR_X) continue;

        // H roads extend left/right; V roads extend up/down
        const candidates: [number, number][] =
          dir === DIR_H ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];

        for (const [dr, dc] of candidates) {
          // Endpoint check: no road neighbour in the extension direction
          if (isKeptRoad(r + dr, c + dc)) continue;

          // Backbone check: road or parcel in the opposite direction
          const pr = r - dr, pc = c - dc;
          const hasBackbone =
            pr >= 0 && pr < rows && pc >= 0 && pc < cols &&
            (wasRoad[pr][pc] || keptParcelMask[pr][pc]);
          if (!hasBackbone) continue;

          // Must face outside the kept parcel zone
          const nr = r + dr, nc = c + dc;
          const isOutside =
            nr < 0 || nr >= rows || nc < 0 || nc >= cols ||
            !keptParcelMask[nr][nc];
          if (!isOutside) continue;

          // Extend 1–4 cells (hardcoded range)
          const ext = 1 + Math.floor(rng() * 4);
          for (let step = 1; step <= ext; step++) {
            const er = r + dr * step, ec = c + dc * step;
            if (er < 0 || er >= rows || ec < 0 || ec >= cols) break;
            if (keptParcelMask[er][ec]) break;
            const key = er * cols + ec;
            if (filled.has(key)) break;
            filled.add(key);
            road[er][ec] = 1;
          }
        }
      }
    }
  }

  // ── Phase 6: Build nameList ────────────────────────────────────────────────
  const presentParcels = new Set<number>();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pid = parcels[r][c];
      if (pid > 0) presentParcels.add(pid);
    }
  }

  const nameList: NameEntry[] = Array.from(presentParcels)
    .sort((a, b) => a - b)
    .map(pid => ({ id: pid, name: `地块 ${pid}`, type: "tile" }));

  return { road, parcels, nameList };
}
