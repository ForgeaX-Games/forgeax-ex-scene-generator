/**
 * Procedural voxel CITY generator @ 1 voxel = 1 m.
 *
 * A large, natural-feeling city that is deliberately NOT tidy:
 *   - seeded RNG + value-noise terrain (rolling elevation, low-lying water)
 *   - CONTINUOUS ground base across the whole area (no gaps between districts)
 *   - BSP street network → irregular, non-uniform blocks (not a 2×2 grid)
 *   - district type assigned by distance-to-core + noise → organic borders
 *   - buildings sit ON the terrain (footprint podium fills any slope)
 *   - hollow-shell buildings with setbacks / L-notches / rooftop plant / spires
 *   - dedicated LANDMARK towers (taller, stepped, crowned) in the core
 *
 * Output: hierarchical nodes[] for json2voxels → voxels2scene. Node names are
 * nested ("downtown/B03", "terrain/land", "landmarks/L00") so the scene tree is
 * grouped by district / feature.
 */

export type Cell = { x: number; y: number; z: number; token: string };

// ── seeded RNG ──────────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RNG = () => number;
const randInt = (rng: RNG, min: number, max: number): number =>
  min + Math.floor(rng() * (max - min + 1));
const chance = (rng: RNG, p: number): boolean => rng() < p;

// ── value-noise terrain ─────────────────────────────────────────────────────
function makeNoise(seed: number) {
  const hash = (ix: number, iy: number): number => {
    let h = (ix * 374761393 + iy * 668265263 + seed * 362437) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const smooth = (t: number): number => t * t * (3 - 2 * t);
  const value = (x: number, y: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = smooth(x - ix);
    const fy = smooth(y - iy);
    const a = hash(ix, iy);
    const b = hash(ix + 1, iy);
    const c = hash(ix, iy + 1);
    const d = hash(ix + 1, iy + 1);
    return (
      a * (1 - fx) * (1 - fy) +
      b * fx * (1 - fy) +
      c * (1 - fx) * fy +
      d * fx * fy
    );
  };
  return (x: number, y: number): number => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    for (let o = 0; o < 4; o += 1) {
      sum += value(x * freq, y * freq) * amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum; // ~[0,1)
  };
}

// ── config ──────────────────────────────────────────────────────────────────
const FLOOR_HEIGHT = 4;
let AREA = 116; // mutated per-call by buildVoxelCityDocument(scale)
const MAX_ELEV = 7;
const WATER_LEVEL = 1;
const TERRAIN_SCALE = 0.028;
const ROAD_W = 3;
const BLOCK_MIN = 20;

const DISTRICT_KEYS = ['downtown', 'midtown', 'residential', 'oldtown'] as const;
type DistrictKey = (typeof DISTRICT_KEYS)[number];

interface DistrictProfile {
  plotMin: number;
  plotMax: number;
  alley: number;
  floorsMin: number;
  floorsMax: number;
  landmarkChance: number;
  landmarkBonus: [number, number];
  setbackChance: number;
  notchChance: number;
  spireChance: number;
  fillChance: number;
  tokens: {
    ground: string;
    wall: string;
    window: string;
    band: string;
    roof: string;
    parapet: string;
    mech: string;
    spire: string;
    podium: string;
  };
}

const PROFILES: Record<DistrictKey, DistrictProfile> = {
  downtown: {
    plotMin: 9, plotMax: 15, alley: 2,
    floorsMin: 8, floorsMax: 16,
    landmarkChance: 0.3, landmarkBonus: [4, 10],
    setbackChance: 0.55, notchChance: 0.2, spireChance: 0.35, fillChance: 0.9,
    tokens: { ground: 'plaza', wall: 'dt_wall', window: 'dt_glass', band: 'dt_band', roof: 'dt_roof', parapet: 'dt_parapet', mech: 'dt_mech', spire: 'dt_spire', podium: 'dt_podium' },
  },
  midtown: {
    plotMin: 8, plotMax: 13, alley: 2,
    floorsMin: 4, floorsMax: 10,
    landmarkChance: 0.15, landmarkBonus: [3, 7],
    setbackChance: 0.3, notchChance: 0.3, spireChance: 0.12, fillChance: 0.86,
    tokens: { ground: 'mt_pavement', wall: 'mt_wall', window: 'mt_window', band: 'mt_band', roof: 'mt_roof', parapet: 'mt_parapet', mech: 'mt_mech', spire: 'mt_spire', podium: 'mt_podium' },
  },
  residential: {
    plotMin: 7, plotMax: 11, alley: 3,
    floorsMin: 2, floorsMax: 5,
    landmarkChance: 0.05, landmarkBonus: [2, 4],
    setbackChance: 0.15, notchChance: 0.35, spireChance: 0.0, fillChance: 0.78,
    tokens: { ground: 'res_lawn', wall: 'res_wall', window: 'res_window', band: 'res_band', roof: 'res_roof', parapet: 'res_eave', mech: 'res_chimney', spire: 'res_spire', podium: 'res_podium' },
  },
  oldtown: {
    plotMin: 5, plotMax: 9, alley: 2,
    floorsMin: 2, floorsMax: 4,
    landmarkChance: 0.05, landmarkBonus: [1, 3],
    setbackChance: 0.1, notchChance: 0.5, spireChance: 0.08, fillChance: 0.95,
    tokens: { ground: 'old_cobble', wall: 'old_wall', window: 'old_window', band: 'old_band', roof: 'old_roof', parapet: 'old_eave', mech: 'old_chimney', spire: 'old_belltower', podium: 'old_podium' },
  },
};

// ── BSP block subdivision (irregular, non-uniform) ──────────────────────────
interface Rect { x0: number; y0: number; x1: number; y1: number }

function bspBlocks(rng: RNG): { blocks: Rect[]; roads: Rect[] } {
  const blocks: Rect[] = [];
  const roads: Rect[] = [];
  const root: Rect = { x0: 2, y0: 2, x1: AREA - 3, y1: AREA - 3 };

  const split = (r: Rect, depth: number): void => {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    const canSplitW = w > BLOCK_MIN * 2;
    const canSplitH = h > BLOCK_MIN * 2;
    // stop with a jittered probability so blocks come in varied sizes
    if (depth <= 0 || (!canSplitW && !canSplitH) || (depth < 4 && chance(rng, 0.22))) {
      blocks.push(r);
      return;
    }
    // choose axis: prefer the longer side, but sometimes flip for irregularity
    let vertical = w >= h;
    if (canSplitW !== canSplitH) vertical = canSplitW;
    else if (chance(rng, 0.25)) vertical = !vertical;

    if (vertical) {
      const cut = r.x0 + Math.floor(w * (0.35 + rng() * 0.3));
      roads.push({ x0: cut, y0: r.y0, x1: cut + ROAD_W - 1, y1: r.y1 });
      split({ ...r, x1: cut - 1 }, depth - 1);
      split({ ...r, x0: cut + ROAD_W }, depth - 1);
    } else {
      const cut = r.y0 + Math.floor(h * (0.35 + rng() * 0.3));
      roads.push({ x0: r.x0, y0: cut, x1: r.x1, y1: cut + ROAD_W - 1 });
      split({ ...r, y1: cut - 1 }, depth - 1);
      split({ ...r, y0: cut + ROAD_W }, depth - 1);
    }
  };
  split(root, 6);
  return { blocks, roads };
}

// ── plot subdivision inside a block (jittered) ──────────────────────────────
interface Plot { x: number; y: number; w: number; h: number }

function subdivide(block: Rect, p: DistrictProfile, rng: RNG): Plot[] {
  const plots: Plot[] = [];
  let y = block.y0;
  while (y + p.plotMin <= block.y1) {
    const rowH = Math.min(randInt(rng, p.plotMin, p.plotMax), block.y1 - y);
    let x = block.x0;
    while (x + p.plotMin <= block.x1) {
      const colW = Math.min(randInt(rng, p.plotMin, p.plotMax), block.x1 - x);
      plots.push({ x, y, w: colW, h: rowH });
      x += colW + p.alley + randInt(rng, 0, 1);
    }
    y += rowH + p.alley + randInt(rng, 0, 1);
  }
  return plots;
}

// ── district assignment (organic, polycentric) ──────────────────────────────
interface Core { x: number; y: number }

function assignDistrict(
  block: Rect,
  noise: (x: number, y: number) => number,
  cores: readonly Core[],
  coreRadius: number,
): DistrictKey {
  const cx = (block.x0 + block.x1) / 2;
  const cy = (block.y0 + block.y1) / 2;
  // distance to the NEAREST downtown core → each core grows its own CBD cluster
  let best = Infinity;
  for (const c of cores) {
    const d = Math.hypot(cx - c.x, cy - c.y);
    if (d < best) best = d;
  }
  const dc = Math.min(1.35, best / coreRadius); // 0 at a core .. clamps far out
  const n = noise(cx * 0.05 + 11, cy * 0.05 + 7);
  const score = dc * 0.82 + (n - 0.5) * 0.45;
  if (score < 0.4) return 'downtown';
  if (score < 0.62) return 'midtown';
  if (score < 0.82) return n > 0.5 ? 'residential' : 'oldtown';
  return n > 0.45 ? 'oldtown' : 'residential';
}

// ── building shell ──────────────────────────────────────────────────────────
function isPerimeter(x: number, y: number, r: Rect): boolean {
  return x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
}
function insetRect(r: Rect, by: number): Rect {
  return { x0: r.x0 + by, y0: r.y0 + by, x1: r.x1 - by, y1: r.y1 - by };
}
function rectOk(r: Rect): boolean {
  return r.x1 - r.x0 >= 2 && r.y1 - r.y0 >= 2;
}

interface BuildOpts {
  baseZ: number;
  elevAt: (x: number, y: number) => number;
  landmark: boolean;
}

function buildBuilding(plot: Plot, p: DistrictProfile, rng: RNG, opts: BuildOpts): Cell[] {
  const cells: Cell[] = [];
  const t = p.tokens;

  // footprint inside the plot, offset (not centered) for irregular street walls
  const marginW = randInt(rng, 1, Math.max(1, Math.floor(plot.w / 4)));
  const marginH = randInt(rng, 1, Math.max(1, Math.floor(plot.h / 4)));
  const offX = randInt(rng, 0, marginW);
  const offY = randInt(rng, 0, marginH);
  const base: Rect = {
    x0: plot.x + offX,
    y0: plot.y + offY,
    x1: plot.x + plot.w - 1 - (marginW - offX),
    y1: plot.y + plot.h - 1 - (marginH - offY),
  };
  if (!rectOk(base)) return cells;

  let floors = randInt(rng, p.floorsMin, p.floorsMax);
  if (opts.landmark) floors = Math.round(floors * 1.6) + randInt(rng, 4, 10);
  else if (chance(rng, p.landmarkChance)) floors += randInt(rng, p.landmarkBonus[0], p.landmarkBonus[1]);

  const baseZ = opts.baseZ;
  const top = baseZ + floors * FLOOR_HEIGHT;

  // foundation podium: fill footprint from local terrain up to baseZ (flush seat)
  for (let x = base.x0; x <= base.x1; x += 1) {
    for (let y = base.y0; y <= base.y1; y += 1) {
      const g = opts.elevAt(x, y);
      for (let z = g + 1; z <= baseZ; z += 1) cells.push({ x, y, z, token: t.podium });
      cells.push({ x, y, z: baseZ, token: t.podium });
    }
  }

  // L-shaped corner notch (full height) → irregular footprint
  let notch: Rect | null = null;
  if (!opts.landmark && chance(rng, p.notchChance) && plot.w >= 7 && plot.h >= 7) {
    const nw = randInt(rng, 2, Math.max(2, Math.floor((base.x1 - base.x0) / 2)));
    const nh = randInt(rng, 2, Math.max(2, Math.floor((base.y1 - base.y0) / 2)));
    const corner = randInt(rng, 0, 3);
    if (corner === 0) notch = { x0: base.x0, y0: base.y0, x1: base.x0 + nw, y1: base.y0 + nh };
    else if (corner === 1) notch = { x0: base.x1 - nw, y0: base.y0, x1: base.x1, y1: base.y0 + nh };
    else if (corner === 2) notch = { x0: base.x0, y0: base.y1 - nh, x1: base.x0 + nw, y1: base.y1 };
    else notch = { x0: base.x1 - nw, y0: base.y1 - nh, x1: base.x1, y1: base.y1 };
  }
  const inNotch = (x: number, y: number): boolean =>
    notch !== null && x >= notch.x0 && x <= notch.x1 && y >= notch.y0 && y <= notch.y1;

  // setbacks: landmarks step multiple times; others maybe once
  const steps: Array<{ fromZ: number; rect: Rect }> = [{ fromZ: baseZ + 1, rect: base }];
  if (opts.landmark && floors >= 8) {
    const nSteps = randInt(rng, 2, 3);
    let cur = base;
    for (let s = 1; s <= nSteps; s += 1) {
      const zAt = baseZ + Math.floor((floors * s) / (nSteps + 1)) * FLOOR_HEIGHT;
      const shr = insetRect(cur, randInt(rng, 1, 2));
      if (!rectOk(shr)) break;
      cur = shr;
      steps.push({ fromZ: zAt, rect: cur });
    }
  } else if (chance(rng, p.setbackChance) && floors >= 6) {
    const zAt = baseZ + randInt(rng, Math.floor(floors * 0.45), Math.floor(floors * 0.75)) * FLOOR_HEIGHT;
    const shr = insetRect(base, randInt(rng, 1, 2));
    if (rectOk(shr)) steps.push({ fromZ: zAt, rect: shr });
  }
  const rectAt = (z: number): Rect => {
    let r = base;
    for (const s of steps) if (z >= s.fromZ) r = s.rect;
    return r;
  };

  // walls + floor bands + windows
  for (let z = baseZ + 1; z <= top; z += 1) {
    const r = rectAt(z);
    const rel = (z - baseZ) % FLOOR_HEIGHT;
    for (let x = r.x0; x <= r.x1; x += 1) {
      for (let y = r.y0; y <= r.y1; y += 1) {
        if (!isPerimeter(x, y, r) || inNotch(x, y)) continue;
        let token: string;
        if (rel === 1) token = t.band;
        else if ((rel === 2 || rel === 3) && (x + y) % 2 === 0) token = t.window;
        else token = t.wall;
        cells.push({ x, y, z, token });
      }
    }
  }

  // roof cap + parapet over final footprint
  const roofRect = rectAt(top);
  const roofZ = top + 1;
  for (let x = roofRect.x0; x <= roofRect.x1; x += 1) {
    for (let y = roofRect.y0; y <= roofRect.y1; y += 1) {
      if (inNotch(x, y)) continue;
      cells.push({ x, y, z: roofZ, token: t.roof });
      if (isPerimeter(x, y, roofRect)) cells.push({ x, y, z: roofZ + 1, token: t.parapet });
    }
  }

  // rooftop plant box
  if (rectOk(insetRect(roofRect, 1)) && chance(rng, 0.6)) {
    const mr = insetRect(roofRect, 1 + randInt(rng, 0, 1));
    if (rectOk(mr)) {
      const boxH = randInt(rng, 1, 3);
      const bx0 = randInt(rng, mr.x0, Math.max(mr.x0, mr.x1 - 2));
      const by0 = randInt(rng, mr.y0, Math.max(mr.y0, mr.y1 - 2));
      const bx1 = Math.min(mr.x1, bx0 + randInt(rng, 1, 3));
      const by1 = Math.min(mr.y1, by0 + randInt(rng, 1, 3));
      for (let z = roofZ + 1; z <= roofZ + boxH; z += 1)
        for (let x = bx0; x <= bx1; x += 1)
          for (let y = by0; y <= by1; y += 1) cells.push({ x, y, z, token: t.mech });
    }
  }

  // spire / crown
  const cx = Math.round((roofRect.x0 + roofRect.x1) / 2);
  const cy = Math.round((roofRect.y0 + roofRect.y1) / 2);
  if (opts.landmark) {
    // stepped crown pyramid + tall spire
    let cr = insetRect(roofRect, 1);
    let cz = roofZ + 1;
    while (rectOk(cr)) {
      for (let x = cr.x0; x <= cr.x1; x += 1)
        for (let y = cr.y0; y <= cr.y1; y += 1)
          if (isPerimeter(x, y, cr)) cells.push({ x, y, z: cz, token: t.roof });
      cr = insetRect(cr, 1);
      cz += 2;
    }
    const spireH = randInt(rng, 8, 16);
    for (let z = cz; z <= cz + spireH; z += 1) cells.push({ x: cx, y: cy, z, token: t.spire });
  } else if (chance(rng, p.spireChance)) {
    const spireH = randInt(rng, 3, 10);
    for (let z = roofZ + 1; z <= roofZ + spireH; z += 1) cells.push({ x: cx, y: cy, z, token: t.spire });
  }

  return cells;
}

// ── terrain surface (continuous base + water + roads) ───────────────────────
export interface CityDocument {
  schema: string;
  root: string;
  meta: {
    unit: string;
    floorHeight: number;
    area: { width: number; height: number };
    districts: string[];
    seed: number;
    coreCount: number;
    buildingCount: number;
    landmarkCount: number;
    propCount: number;
    voxelCount: number;
    maxHeight: number;
    maxElevation: number;
  };
  nodes: Array<{ name: string; cells: Cell[] }>;
}

export interface CityOptions {
  /** Square side length in metres (voxels). Default 116. Larger ⇒ bigger city. */
  area?: number;
  /** Convenience: area-scale multiplier vs the base 116×116 (5 ⇒ ~5× footprint). */
  scale?: number;
}

export function buildVoxelCityDocument(seed = 20260703, opts: CityOptions = {}): CityDocument {
  const BASE = 116;
  AREA = opts.area
    ? Math.max(48, Math.round(opts.area))
    : opts.scale
      ? Math.round(BASE * Math.sqrt(opts.scale))
      : BASE;

  const rng = mulberry32(seed);
  const noise = makeNoise(seed);

  // polycentric downtown cores — count grows with footprint area, but the
  // first core is anchored near the centre so even a small city keeps a CBD.
  const coreRadius = Math.min(AREA * 0.34, 72);
  const nCores = Math.max(1, Math.round((AREA * AREA) / (170 * 170)));
  const cores: Core[] = [
    { x: Math.round(AREA * (0.42 + rng() * 0.16)), y: Math.round(AREA * (0.42 + rng() * 0.16)) },
  ];
  let guard = 0;
  while (cores.length < nCores && guard < 3000) {
    guard += 1;
    const cxp = randInt(rng, Math.round(AREA * 0.12), Math.round(AREA * 0.88));
    const cyp = randInt(rng, Math.round(AREA * 0.12), Math.round(AREA * 0.88));
    if (cores.every((c) => Math.hypot(c.x - cxp, c.y - cyp) > coreRadius * 1.2)) {
      cores.push({ x: cxp, y: cyp });
    }
  }

  // elevation field (cached)
  const elev: number[][] = [];
  for (let y = 0; y < AREA; y += 1) {
    elev[y] = [];
    for (let x = 0; x < AREA; x += 1) {
      const n = noise(x * TERRAIN_SCALE, y * TERRAIN_SCALE);
      elev[y]![x] = Math.max(0, Math.round(n * MAX_ELEV));
    }
  }
  const elevAt = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= AREA || y >= AREA) return 0;
    return elev[y]![x]!;
  };

  // block/road/district rasters
  const { blocks, roads } = bspBlocks(rng);
  const roadGrid: boolean[][] = Array.from({ length: AREA }, () => new Array(AREA).fill(false));
  const distGrid: (DistrictKey | null)[][] = Array.from({ length: AREA }, () => new Array(AREA).fill(null));

  for (const r of roads)
    for (let y = Math.max(0, r.y0); y <= Math.min(AREA - 1, r.y1); y += 1)
      for (let x = Math.max(0, r.x0); x <= Math.min(AREA - 1, r.x1); x += 1) roadGrid[y]![x] = true;

  const blockDistrict = new Map<Rect, DistrictKey>();
  for (const b of blocks) {
    const key = assignDistrict(b, noise, cores, coreRadius);
    blockDistrict.set(b, key);
    for (let y = Math.max(0, b.y0); y <= Math.min(AREA - 1, b.y1); y += 1)
      for (let x = Math.max(0, b.x0); x <= Math.min(AREA - 1, b.x1); x += 1)
        if (!roadGrid[y]![x]) distGrid[y]![x] = key;
  }

  // terrain nodes
  const land: Cell[] = [];
  const water: Cell[] = [];
  const road: Cell[] = [];
  let maxElevation = 0;

  for (let y = 0; y < AREA; y += 1) {
    for (let x = 0; x < AREA; x += 1) {
      const e = elev[y]![x]!;
      if (e > maxElevation) maxElevation = e;
      // fill slope sides down to the lowest 4-neighbour to avoid floating steps
      const lo = Math.min(e, elevAt(x - 1, y), elevAt(x + 1, y), elevAt(x, y - 1), elevAt(x, y + 1));
      if (e <= WATER_LEVEL) {
        water.push({ x, y, z: Math.max(e, WATER_LEVEL), token: 'water' });
        for (let z = Math.max(0, lo); z < WATER_LEVEL; z += 1) land.push({ x, y, z, token: 'lakebed' });
        continue;
      }
      let token: string;
      if (roadGrid[y]![x]) token = 'road';
      else {
        const d = distGrid[y]![x];
        token = d ? PROFILES[d].tokens.ground : 'wildgrass';
      }
      if (token === 'road') road.push({ x, y, z: e, token });
      else land.push({ x, y, z: e, token });
      for (let z = Math.max(0, lo); z < e; z += 1) land.push({ x, y, z, token: e - z <= 1 ? 'soil' : 'rock' });
    }
  }

  const nodes: Array<{ name: string; cells: Cell[] }> = [];
  nodes.push({ name: 'terrain/land', cells: land });
  nodes.push({ name: 'terrain/road', cells: road });
  if (water.length) nodes.push({ name: 'terrain/water', cells: water });

  // buildings
  let buildingCount = 0;
  let landmarkCount = 0;
  let voxelCount = land.length + road.length + water.length;
  let maxHeight = maxElevation;

  const perDistrictIdx: Record<string, number> = {};
  const occupiedXY = new Set<string>(); // building ground footprints (keep props clear)

  for (const b of blocks) {
    const key = blockDistrict.get(b)!;
    const p = PROFILES[key];
    const plots = subdivide(b, p, rng);
    // pick a landmark plot in downtown/midtown blocks (largest plot)
    let landmarkPlot: Plot | null = null;
    if ((key === 'downtown' || key === 'midtown') && plots.length && chance(rng, key === 'downtown' ? 0.7 : 0.3)) {
      landmarkPlot = plots.reduce((a, c) => (c.w * c.h > a.w * a.h ? c : a), plots[0]!);
    }

    for (const plot of plots) {
      const isLandmark = plot === landmarkPlot;
      if (!isLandmark && !chance(rng, p.fillChance)) continue;
      // seat on terrain: use the max elevation across the plot footprint
      let baseZ = 0;
      for (let y = plot.y; y < plot.y + plot.h && y < AREA; y += 1)
        for (let x = plot.x; x < plot.x + plot.w && x < AREA; x += 1) baseZ = Math.max(baseZ, elevAt(x, y));
      const cells = buildBuilding(plot, p, rng, { baseZ, elevAt, landmark: isLandmark });
      if (cells.length === 0) continue;
      for (const c of cells) {
        if (c.z > maxHeight) maxHeight = c.z;
        occupiedXY.add(`${c.x},${c.y}`);
      }
      voxelCount += cells.length;
      if (isLandmark) {
        const id = `L${String(landmarkCount).padStart(2, '0')}`;
        landmarkCount += 1;
        nodes.push({ name: `landmarks/${key}_${id}`, cells });
      } else {
        const idx = perDistrictIdx[key] ?? 0;
        perDistrictIdx[key] = idx + 1;
        buildingCount += 1;
        nodes.push({ name: `${key}/B${String(idx).padStart(2, '0')}`, cells });
      }
    }
  }

  // ── street furniture along roads (lamps, stalls, trees, benches …) ─────────
  const lamps: Cell[] = [];
  const stalls: Cell[] = [];
  const greenery: Cell[] = [];
  const props: Cell[] = [];
  const propGrid: boolean[][] = Array.from({ length: AREA }, () => new Array(AREA).fill(false));
  let propCount = 0;

  const isWater = (x: number, y: number): boolean => elevAt(x, y) <= WATER_LEVEL;
  const isRoad = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < AREA && y < AREA && roadGrid[y]![x] === true;
  const hasRoadNbr = (x: number, y: number): boolean =>
    isRoad(x - 1, y) || isRoad(x + 1, y) || isRoad(x, y - 1) || isRoad(x, y + 1);
  const areaFree = (x0: number, y0: number, x1: number, y1: number): boolean => {
    const bz = elevAt(x0, y0);
    for (let y = y0; y <= y1; y += 1)
      for (let x = x0; x <= x1; x += 1) {
        if (x < 0 || y < 0 || x >= AREA || y >= AREA) return false;
        if (propGrid[y]![x] || isRoad(x, y) || isWater(x, y)) return false;
        if (occupiedXY.has(`${x},${y}`)) return false;
        if (elevAt(x, y) !== bz) return false;
      }
    return true;
  };
  const mark = (x0: number, y0: number, x1: number, y1: number, pad: number): void => {
    for (let y = y0 - pad; y <= y1 + pad; y += 1)
      for (let x = x0 - pad; x <= x1 + pad; x += 1)
        if (x >= 0 && y >= 0 && x < AREA && y < AREA) propGrid[y]![x] = true;
  };

  for (let y = 0; y < AREA; y += 1) {
    for (let x = 0; x < AREA; x += 1) {
      if (isRoad(x, y) || isWater(x, y) || occupiedXY.has(`${x},${y}`) || propGrid[y]![x]) continue;
      if (!hasRoadNbr(x, y)) continue; // only decorate the strip facing a road
      const d = distGrid[y]![x];
      const urban = d === 'downtown' || d === 'midtown';
      const bz = elevAt(x, y);
      const r = rng();

      if (r < 0.05) {
        // street lamp
        for (let z = bz + 1; z <= bz + 3; z += 1) lamps.push({ x, y, z, token: 'lamp_pole' });
        lamps.push({ x, y, z: bz + 4, token: 'lamp_head' });
        mark(x, y, x, y, 2);
        propCount += 1;
      } else if (r < (urban ? 0.095 : 0.07) && areaFree(x, y, x + 2, y + 1)) {
        // market stall (3×2 canopy on posts)
        for (const [sx, sy] of [[x, y], [x + 2, y], [x, y + 1], [x + 2, y + 1]] as const) {
          stalls.push({ x: sx, y: sy, z: bz + 1, token: 'stall_post' });
          stalls.push({ x: sx, y: sy, z: bz + 2, token: 'stall_post' });
        }
        for (let yy = y; yy <= y + 1; yy += 1)
          for (let xx = x; xx <= x + 2; xx += 1) stalls.push({ x: xx, y: yy, z: bz + 3, token: 'stall_roof' });
        stalls.push({ x: x + 1, y, z: bz + 1, token: 'stall_goods' });
        mark(x, y, x + 2, y + 1, 1);
        propCount += 1;
      } else if (r < (urban ? 0.14 : 0.2)) {
        // street tree: trunk on the sidewalk, canopy overhangs (may overlap road/air)
        greenery.push({ x, y, z: bz + 1, token: 'tree_trunk' });
        greenery.push({ x, y, z: bz + 2, token: 'tree_trunk' });
        for (let yy = y - 1; yy <= y + 1; yy += 1)
          for (let xx = x - 1; xx <= x + 1; xx += 1) {
            if (xx < 0 || yy < 0 || xx >= AREA || yy >= AREA) continue;
            greenery.push({ x: xx, y: yy, z: bz + 3, token: 'tree_foliage' });
            greenery.push({ x: xx, y: yy, z: bz + 4, token: 'tree_foliage' });
          }
        greenery.push({ x, y, z: bz + 5, token: 'tree_foliage' });
        mark(x, y, x, y, 2);
        propCount += 1;
      } else if (r < 0.24) {
        // small props: bench / bin / hydrant / parasol / sign / planter
        const pr = rng();
        if (pr < 0.26) {
          props.push({ x, y, z: bz + 1, token: 'bench' });
          if (areaFree(x, y + 1, x, y + 1)) props.push({ x, y: y + 1, z: bz + 1, token: 'bench' });
        } else if (pr < 0.46) {
          props.push({ x, y, z: bz + 1, token: 'bin' });
        } else if (pr < 0.62) {
          props.push({ x, y, z: bz + 1, token: 'hydrant' });
        } else if (pr < 0.8 && areaFree(x - 1, y - 1, x + 1, y + 1)) {
          // parasol
          props.push({ x, y, z: bz + 1, token: 'parasol_pole' });
          props.push({ x, y, z: bz + 2, token: 'parasol_pole' });
          for (let yy = y - 1; yy <= y + 1; yy += 1)
            for (let xx = x - 1; xx <= x + 1; xx += 1) props.push({ x: xx, y: yy, z: bz + 3, token: 'parasol_top' });
        } else if (pr < 0.92) {
          props.push({ x, y, z: bz + 1, token: 'sign' });
          props.push({ x, y, z: bz + 2, token: 'sign' });
        } else if (areaFree(x, y, x + 1, y + 1)) {
          for (let yy = y; yy <= y + 1; yy += 1)
            for (let xx = x; xx <= x + 1; xx += 1) props.push({ x: xx, y: yy, z: bz + 1, token: 'planter' });
        } else {
          props.push({ x, y, z: bz + 1, token: 'bin' });
        }
        mark(x, y, x, y, 1);
        propCount += 1;
      }
    }
  }

  if (lamps.length) nodes.push({ name: 'street/lamps', cells: lamps });
  if (stalls.length) nodes.push({ name: 'street/stalls', cells: stalls });
  if (greenery.length) nodes.push({ name: 'street/greenery', cells: greenery });
  if (props.length) nodes.push({ name: 'street/props', cells: props });
  voxelCount += lamps.length + stalls.length + greenery.length + props.length;

  return {
    schema: 'voxel-mass',
    root: 'VoxelCity',
    meta: {
      unit: '1m',
      floorHeight: FLOOR_HEIGHT,
      area: { width: AREA, height: AREA },
      districts: [...DISTRICT_KEYS],
      seed,
      coreCount: cores.length,
      buildingCount,
      landmarkCount,
      propCount,
      voxelCount,
      maxHeight,
      maxElevation,
    },
    nodes,
  };
}

export const VOXEL_CITY_JSON = JSON.stringify(buildVoxelCityDocument());
