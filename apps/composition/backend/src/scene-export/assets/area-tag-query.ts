/**
 * area-tag-query.ts
 *
 * Utility for querying grid cells by area tag, with optional filtering by
 * height level and object-collider occupancy.
 *
 * ── CLI usage ──────────────────────────────────────────────────────────────
 *   # Print area-tag hierarchy tree
 *   npx tsx scripts/area-tag-query.ts <dir|terrain.json> --tree
 *
 *   # Query cells for a tag (optionally filter by height / free cells)
 *   npx tsx scripts/area-tag-query.ts <dir|terrain.json> "<area name>"
 *   npx tsx scripts/area-tag-query.ts <dir|terrain.json> "<area name>" --height 0
 *   npx tsx scripts/area-tag-query.ts <dir|terrain.json> "<area name>" --free
 *   npx tsx scripts/area-tag-query.ts <dir|terrain.json> "<area name>" --height 0 --free
 *
 *   --free requires object_atlas.tsj + object-type-config.json to be in the
 *   same directory as terrain.json (standard bundle layout).
 *
 * ── Module exports ─────────────────────────────────────────────────────────
 *   queryAreaTag(terrain, tagName, options?)        → CellCoord[]
 *   sampleTypicalCoord(terrain, tagName, options?)  → CellCoord | null
 *   sampleTypicalCoords(terrain, tagName, n, opts?) → CellCoord[]
 *   bakeObjectColliders(terrain, tsj, cfg)          → Set<"x,y">
 *   buildAreaTagTree(terrain)                       → AreaTagNode[]
 *   flattenCells(terrain)                           → TerrainCell[]
 *   loadTerrainJson(dirOrPath)                      → TerrainJson
 *   loadObjectTsj(dirOrPath)                        → ObjectTsj
 *   loadObjectTypeConfig(dirOrPath)                 → ObjectTypeConfig
 */

import fs from 'fs';
import path from 'path';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TerrainCell {
  x: number;
  y: number;
  height?: number;
  template_id?: string[];
  graphic_index?: number[];
  areaTags?: Record<string, string[]>;
  slope?: {
    elevationLow?: number;
    elevationHigh?: number;
    direction?: string;
  };
}

export interface TerrainObject {
  x: number;
  y: number;
  typeId: string;
  height?: number;
  [k: string]: unknown;
}

/** terrain.json top-level shape (grouped format used by the new renderer) */
export interface TerrainJson {
  version?: string;
  cols?: number;
  rows?: number;
  cells: Record<string, TerrainCell[]> | TerrainCell[][] | TerrainCell[];
  objects?: TerrainObject[];
}

export interface TsjCollider {
  type: 'none' | 'rect' | 'polygon';
  rect?: [number, number, number, number];
  points?: [number, number][];
}

export interface ObjectTsjTile {
  id: number;
  width: number;
  height: number;
  pivot?: { x: number; y: number };
  collider?: TsjCollider;
}

export interface ObjectTsj {
  tiles: ObjectTsjTile[];
}

export interface ObjectTypeDef {
  graphic: number;
  interaction: string | { type: string; range?: number };
  [k: string]: unknown;
}

export interface ObjectTypeConfig {
  types: Record<string, ObjectTypeDef>;
}

/** A named node in the area-tag hierarchy */
export interface AreaTagNode {
  name: string;
  level: string;
  cellCount: number;
  children: AreaTagNode[];
}

export interface CellCoord {
  x: number;
  y: number;
  height?: number;
}

export interface QueryOptions {
  /**
   * When set, only return cells whose `height` field equals this value.
   * Corresponds to the elevation group key in the grouped cells format.
   */
  height?: number;

  /**
   * When true, exclude cells whose center is inside an object's baked
   * collision footprint.  Requires `occupiedCells` to be pre-built via
   * `bakeObjectColliders()`, or for the terrain to have objects[] and for
   * the caller to pass `objectTsj` + `objectTypeConfig`.
   */
  freeOnly?: boolean;

  /**
   * Pre-baked collision set produced by `bakeObjectColliders()`.
   * If `freeOnly` is true and this is provided, it is used directly.
   * If `freeOnly` is true and this is omitted, the query function will
   * attempt to bake it internally from terrain.objects[] — but that
   * requires `objectTsj` and `objectTypeConfig` to also be provided.
   */
  occupiedCells?: Set<string>;

  /** Required when freeOnly=true and occupiedCells is not pre-built. */
  objectTsj?: ObjectTsj;
  /** Required when freeOnly=true and occupiedCells is not pre-built. */
  objectTypeConfig?: ObjectTypeConfig;
}

export interface SampleOptions extends QueryOptions {
  /**
   * Previously returned "x,y" keys to avoid repeating.
   * Matching cells are removed from the candidate pool before sampling.
   * If ALL candidates are excluded, the full pool is used as fallback
   * (so the function never returns null merely due to exclusions).
   */
  exclude?: Set<string>;

  /**
   * Gaussian sigma expressed as a fraction of the maximum distance from
   * the area centroid.  Controls how strongly the sampling is biased
   * toward the centre.
   *   - 0.3  → tightly centred (only inner ~30% of radius gets high weight)
   *   - 0.5  → moderately centred (default)
   *   - 1.0+ → nearly uniform
   * Must be > 0.
   */
  sigma?: number;

  /**
   * Optional deterministic random function () => [0, 1).
   * Defaults to Math.random.  Pass a seeded PRNG for reproducibility.
   */
  rng?: () => number;
}

// ─── Typical-coordinate sampling ─────────────────────────────────────────────

/**
 * Return a single "typical" coordinate for an area tag using Gaussian-weighted
 * random sampling biased toward the area's centroid.
 *
 * Properties:
 *   1. Always within the area (passes all QueryOptions filters).
 *   2. Closer to the centroid → higher probability (Gaussian weight).
 *   3. Cells listed in `options.exclude` are removed from the pool, reducing
 *      the chance of repeating a previously returned value.
 *
 * Returns null only when the area has no cells at all (after filtering).
 */
export function sampleTypicalCoord(
  terrain: TerrainJson,
  tagName: string,
  options?: SampleOptions,
): CellCoord | null {
  const all = queryAreaTag(terrain, tagName, options);
  if (all.length === 0) return null;

  const rng = options?.rng ?? Math.random.bind(Math);
  const sigmaFraction = Math.max(0.01, options?.sigma ?? 0.5);
  const exclude = options?.exclude;

  // Remove previously returned coords; fall back to full pool if all excluded
  const pool = exclude && exclude.size > 0
    ? (all.filter(c => !exclude.has(`${c.x},${c.y}`))  )
    : all;
  const candidates = pool.length > 0 ? pool : all;

  // Centroid of the active candidate pool
  let sumX = 0, sumY = 0;
  for (const c of candidates) { sumX += c.x; sumY += c.y; }
  const cx = sumX / candidates.length;
  const cy = sumY / candidates.length;

  // Gaussian sigma = sigmaFraction × max distance from centroid
  let maxDist = 0;
  for (const c of candidates) {
    const d = Math.hypot(c.x - cx, c.y - cy);
    if (d > maxDist) maxDist = d;
  }
  const sigma = Math.max(0.5, maxDist * sigmaFraction);
  const twoSigmaSq = 2 * sigma * sigma;

  // Build cumulative weight table
  let total = 0;
  const cumulative: number[] = new Array(candidates.length);
  for (let i = 0; i < candidates.length; i++) {
    const d = Math.hypot(candidates[i].x - cx, candidates[i].y - cy);
    total += Math.exp(-(d * d) / twoSigmaSq);
    cumulative[i] = total;
  }

  // Weighted random pick
  const threshold = rng() * total;
  let lo = 0, hi = candidates.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid] < threshold) lo = mid + 1; else hi = mid;
  }
  return candidates[lo];
}

/**
 * Return `n` typical coordinates from an area, automatically excluding each
 * picked cell from subsequent draws to minimise repetition.
 *
 * The returned array may be shorter than `n` if the area has fewer cells
 * (after filtering) than requested.
 *
 * @param n  Number of coordinates to return (default: 1)
 */
export function sampleTypicalCoords(
  terrain: TerrainJson,
  tagName: string,
  n = 1,
  options?: SampleOptions,
): CellCoord[] {
  const rng = options?.rng ?? Math.random.bind(Math);
  // Share one rng instance across all draws so a seeded PRNG advances correctly
  const sharedOpts: SampleOptions = { ...options, rng };

  const results: CellCoord[] = [];
  const exclude = new Set<string>(options?.exclude ?? []);

  for (let i = 0; i < n; i++) {
    const pick = sampleTypicalCoord(terrain, tagName, { ...sharedOpts, exclude });
    if (!pick) break;
    results.push(pick);
    exclude.add(`${pick.x},${pick.y}`);
  }
  return results;
}

// ─── Geometry helpers (mirrors viewer.js) ────────────────────────────────────

const TILE_PIXEL = 16;

function pivotTopOffsetRatio(pvy: number): number {
  const py = pvy > 1 ? pvy - Math.floor(pvy) : pvy;
  return 1 - py;
}

function pointInCollider(nx: number, ny: number, col: TsjCollider): boolean {
  if (!col || col.type === 'none') return false;
  if (col.type === 'rect' && Array.isArray(col.rect)) {
    const [x1, y1, x2, y2] = col.rect;
    return nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2;
  }
  if (col.type === 'polygon' && Array.isArray(col.points)) {
    let inside = false;
    const pts = col.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
      if ((yi > ny) !== (yj > ny) && nx < ((xj - xi) * (ny - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  }
  return false;
}

function getInteractionType(typeDef: ObjectTypeDef): string {
  const v = typeDef?.interaction;
  if (typeof v === 'string') return v;
  if (v && typeof (v as { type: string }).type === 'string') return (v as { type: string }).type;
  return 'none';
}

// ─── Core functions ───────────────────────────────────────────────────────────

/**
 * Flatten terrain.json cells (grouped / 2D array / flat) into a single array.
 * Cells from all elevation groups and the transition group are included.
 * Each cell's `height` field reflects its elevation group when present.
 */
export function flattenCells(terrain: TerrainJson): TerrainCell[] {
  const cellsField = terrain.cells;
  if (!cellsField) return [];

  // Grouped object format: { "0": [...], "1": [...], "transition": [...] }
  if (typeof cellsField === 'object' && !Array.isArray(cellsField)) {
    const grouped = cellsField as Record<string, TerrainCell[]>;
    const result: TerrainCell[] = [];
    for (const [key, list] of Object.entries(grouped)) {
      const elev = Number.isNaN(Number(key)) ? undefined : Number(key);
      for (const cell of (Array.isArray(list) ? list : [])) {
        // Merge group elev into height when the cell itself lacks it
        result.push(elev !== undefined && cell.height === undefined
          ? { ...cell, height: elev }
          : cell);
      }
    }
    return result;
  }

  // 2D array format: MapCell[y][x]
  if (Array.isArray(cellsField) && Array.isArray((cellsField as unknown[][])[0])) {
    return (cellsField as TerrainCell[][]).flat();
  }

  // Flat array
  return cellsField as TerrainCell[];
}

/**
 * Bake all object sprites' colliders into a Set of occupied "x,y" cell keys.
 *
 * Only cells whose normalised centre falls inside a real TSJ collider shape
 * (rect or polygon) are marked. Objects with `collider.type === 'none'` are
 * ignored — consistent with the viewer's collision overlay behaviour.
 *
 * Mirrors the viewer.js `drawSelection` / `findObjectAtCell` geometry exactly:
 *   - PPU = 32 for pickup objects, 16 for everything else
 *   - Pivot offset applied to image anchor
 */
export function bakeObjectColliders(
  terrain: TerrainJson,
  objectTsj: ObjectTsj,
  objectTypeConfig: ObjectTypeConfig,
): Set<string> {
  const tileById = new Map<number, ObjectTsjTile>(objectTsj.tiles.map(t => [t.id, t]));
  const occupied = new Set<string>();

  for (const obj of (terrain.objects ?? [])) {
    const typeDef = objectTypeConfig.types[obj.typeId];
    if (!typeDef) continue;
    const tile = tileById.get(typeDef.graphic);
    if (!tile) continue;

    const interaction = getInteractionType(typeDef);
    const ppu = interaction === 'pickup' ? 32 : 16;
    const scale = TILE_PIXEL / ppu;
    const pivot = tile.pivot ?? { x: 0.5, y: 0.5 };
    const dw = tile.width * scale;
    const dh = tile.height * scale;
    const imgX = (obj.x + 0.5) * TILE_PIXEL - pivot.x * dw;
    const imgY = (obj.y + 0.5) * TILE_PIXEL - pivotTopOffsetRatio(pivot.y) * dh;

    const colMin = Math.floor(imgX / TILE_PIXEL);
    const colMax = Math.floor((imgX + dw - 1) / TILE_PIXEL);
    const rowMin = Math.floor(imgY / TILE_PIXEL);
    const rowMax = Math.floor((imgY + dh - 1) / TILE_PIXEL);

    const col = tile.collider;
    if (col && col.type !== 'none') {
      for (let r = rowMin; r <= rowMax; r++) {
        for (let c = colMin; c <= colMax; c++) {
          const nx = ((c + 0.5) * TILE_PIXEL - imgX) / dw;
          const ny = 1 - ((r + 0.5) * TILE_PIXEL - imgY) / dh;
          if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;
          if (pointInCollider(nx, ny, col)) occupied.add(`${c},${r}`);
        }
      }
    }
    // collider.type === 'none'：无碰撞体，不标记任何格子
  }

  return occupied;
}

/**
 * Return grid cells that are tagged with `tagName` in any areaTags level,
 * with optional filtering by height and object-collider occupancy.
 *
 * @param terrain       Parsed terrain.json
 * @param tagName       Area name to match, e.g. "失落之域"
 * @param options       Optional filters (height, freeOnly, occupiedCells)
 */
export function queryAreaTag(
  terrain: TerrainJson,
  tagName: string,
  options?: QueryOptions,
): CellCoord[] {
  const cells = flattenCells(terrain);

  // Build occupied set lazily if freeOnly is requested but set not pre-provided
  let occupied: Set<string> | undefined = options?.occupiedCells;
  if (options?.freeOnly && !occupied) {
    if (!options.objectTsj || !options.objectTypeConfig) {
      throw new Error(
        'queryAreaTag: freeOnly=true requires either occupiedCells or ' +
        'both objectTsj and objectTypeConfig to be provided in options.',
      );
    }
    occupied = bakeObjectColliders(terrain, options.objectTsj, options.objectTypeConfig);
  }

  const seen = new Set<string>();
  const result: CellCoord[] = [];

  for (const cell of cells) {
    if (!cell.areaTags) continue;

    // ── filter 1: area tag match ──
    let matched = false;
    for (const names of Object.values(cell.areaTags)) {
      if (names.includes(tagName)) { matched = true; break; }
    }
    if (!matched) continue;

    // ── filter 2: height ──
    if (options?.height !== undefined && cell.height !== options.height) continue;

    // ── filter 3: free (not occupied by any object collider) ──
    const key = `${cell.x},${cell.y}`;
    if (occupied && occupied.has(key)) continue;

    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ x: cell.x, y: cell.y, height: cell.height });
  }

  return result;
}

/**
 * Build a hierarchical tree of all unique area tag names in the terrain.
 * Returns L1 root nodes; each node may contain L2 children, and so on.
 */
export function buildAreaTagTree(terrain: TerrainJson): AreaTagNode[] {
  const cells = flattenCells(terrain);

  const levelSet = new Set<string>();
  for (const cell of cells) {
    if (!cell.areaTags) continue;
    for (const k of Object.keys(cell.areaTags)) levelSet.add(k);
  }
  const levels = [...levelSet].sort();
  if (levels.length === 0) return [];

  interface InternalNode {
    name: string;
    level: string;
    cells: Set<string>;
    children: Map<string, InternalNode>;
  }

  const roots = new Map<string, InternalNode>();

  for (const cell of cells) {
    if (!cell.areaTags) continue;
    const coordKey = `${cell.x},${cell.y}`;
    const pathNodes: Array<{ name: string; level: string }> = [];
    for (const lv of levels) {
      const names = cell.areaTags[lv];
      if (!names || names.length === 0) break;
      pathNodes.push({ name: names[0], level: lv });
    }
    if (!pathNodes.length) continue;

    let parentMap = roots;
    for (const { name, level } of pathNodes) {
      if (!parentMap.has(name)) {
        parentMap.set(name, { name, level, cells: new Set(), children: new Map() });
      }
      const node = parentMap.get(name)!;
      node.cells.add(coordKey);
      parentMap = node.children;
    }
  }

  function toPublic(node: InternalNode): AreaTagNode {
    return {
      name: node.name,
      level: node.level,
      cellCount: node.cells.size,
      children: [...node.children.values()].map(toPublic),
    };
  }

  return [...roots.values()].map(toPublic);
}

// ─── File loaders (Node.js only) ──────────────────────────────────────────────

/** Resolve the directory that contains terrain.json (accepts dir or file). */
function resolveDir(dirOrFile: string): string {
  const abs = path.resolve(dirOrFile);
  return fs.statSync(abs).isDirectory() ? abs : path.dirname(abs);
}

/**
 * Load terrain.json from either a direct path to the file or a directory
 * that contains it (standard bundle layout).
 */
export function loadTerrainJson(dirOrFile: string): TerrainJson {
  let abs = path.resolve(dirOrFile);
  if (fs.statSync(abs).isDirectory()) abs = path.join(abs, 'terrain.json');
  return JSON.parse(fs.readFileSync(abs, 'utf-8')) as TerrainJson;
}

/** Load object_atlas.tsj from a directory or sibling path. */
export function loadObjectTsj(dirOrFile: string): ObjectTsj {
  const dir = resolveDir(dirOrFile);
  const fp = path.join(dir, 'object_atlas.tsj');
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as ObjectTsj;
}

/** Load object-type-config.json from a directory or sibling path. */
export function loadObjectTypeConfig(dirOrFile: string): ObjectTypeConfig {
  const dir = resolveDir(dirOrFile);
  const fp = path.join(dir, 'object-type-config.json');
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as ObjectTypeConfig;
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): {
  input: string;
  tag: string | null;
  tree: boolean;
  height: number | undefined;
  free: boolean;
  sample: number | undefined;
  sigma: number | undefined;
} {
  const [, , input, ...rest] = argv;
  const tree = rest.includes('--tree');
  const free = rest.includes('--free');
  const hi = rest.indexOf('--height');
  const height = hi >= 0 ? Number(rest[hi + 1]) : undefined;
  const si = rest.indexOf('--sample');
  const sample = si >= 0 ? Math.max(1, parseInt(rest[si + 1] ?? '1', 10)) : undefined;
  const sgi = rest.indexOf('--sigma');
  const sigma = sgi >= 0 ? parseFloat(rest[sgi + 1] ?? '0.5') : undefined;
  const tag = tree ? null : (rest.find(a => !a.startsWith('-')) ?? null);
  return { input, tag, tree, height, free, sample, sigma };
}

async function main() {
  const { input, tag, tree, height, free, sample, sigma } = parseArgs(process.argv);
  if (!input) {
    console.error('Usage: npx tsx area-tag-query.ts <dir|terrain.json> --tree');
    console.error('       npx tsx area-tag-query.ts <dir|terrain.json> "<area>" [--height N] [--free] [--sample N] [--sigma 0.5]');
    process.exit(1);
  }

  const terrain = loadTerrainJson(input);

  if (tree) {
    const nodes = buildAreaTagTree(terrain);
    function printTree(nodes: AreaTagNode[], indent = 0) {
      for (const n of nodes) {
        console.log(' '.repeat(indent * 2) + `[${n.level}] ${n.name}  (${n.cellCount} cells)`);
        printTree(n.children, indent + 1);
      }
    }
    printTree(nodes);
    return;
  }

  if (!tag) {
    console.error('Error: provide an area name or --tree');
    process.exit(1);
  }

  // Build occupied set if --free is requested
  let occupiedCells: Set<string> | undefined;
  if (free) {
    const objectTsj = loadObjectTsj(input);
    const objectTypeConfig = loadObjectTypeConfig(input);
    occupiedCells = bakeObjectColliders(terrain, objectTsj, objectTypeConfig);
    console.log(`Baked ${occupiedCells.size} occupied cells from ${terrain.objects?.length ?? 0} objects`);
  }

  // --sample: return N typical coordinates biased toward area centre
  if (sample !== undefined) {
    const coords = sampleTypicalCoords(terrain, tag, sample, { height, freeOnly: free, occupiedCells, sigma });
    if (!coords.length) {
      console.log(`No cells found for "${tag}"`);
      process.exit(0);
    }
    const hint = [
      height !== undefined ? `height=${height}` : null,
      free ? 'free' : null,
      `sample=${sample}`,
      sigma !== undefined ? `sigma=${sigma}` : null,
    ].filter(Boolean).join(', ');
    console.log(`Sampled ${coords.length} typical coord(s) for "${tag}" [${hint}]:`);
    console.log(JSON.stringify(coords, null, 2));
    return;
  }

  const coords = queryAreaTag(terrain, tag, { height, freeOnly: free, occupiedCells });

  if (!coords.length) {
    const hint = [
      height !== undefined ? `height=${height}` : null,
      free ? 'free' : null,
    ].filter(Boolean).join(', ');
    console.log(`No cells found for "${tag}"${hint ? ` (filter: ${hint})` : ''}`);
    process.exit(0);
  }

  const hint = [
    height !== undefined ? `height=${height}` : null,
    free ? 'free (unoccupied)' : null,
  ].filter(Boolean).join(', ');
  console.log(`Found ${coords.length} cells for "${tag}"${hint ? ` [${hint}]` : ''}:`);
  console.log(JSON.stringify(coords, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
