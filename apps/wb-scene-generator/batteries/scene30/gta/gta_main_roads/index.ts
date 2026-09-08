type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; has: boolean; }
interface HeapNode { idx: number; f: number; }
interface RoadAnchor extends Point { id: string; weight: number; kind: "outer" | "district" | "regional"; }
interface RoadComponent { cells: Point[]; center: Point; }
interface MaskComponent { cells: Point[]; center: Point; bounds: Bounds; }

class MinHeap {
  private data: HeapNode[] = [];
  get length(): number { return this.data.length; }
  push(node: HeapNode): void {
    this.data.push(node);
    this.up(this.data.length - 1);
  }
  pop(): HeapNode | undefined {
    const first = this.data[0];
    const last = this.data.pop();
    if (!last || this.data.length === 0) return first;
    this.data[0] = last;
    this.down(0);
    return first;
  }
  private up(i: number): void {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.data[p].f <= this.data[i].f) break;
      [this.data[p], this.data[i]] = [this.data[i], this.data[p]];
      i = p;
    }
  }
  private down(i: number): void {
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let b = i;
      if (l < this.data.length && this.data[l].f < this.data[b].f) b = l;
      if (r < this.data.length && this.data[r].f < this.data[b].f) b = r;
      if (b === i) break;
      [this.data[b], this.data[i]] = [this.data[i], this.data[b]];
      i = b;
    }
  }
}

const DIR8: Array<[number, number, number]> = [
  [-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
  [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [1, 1, Math.SQRT2],
];
// gta_zones v3 分区 ID：商业421/住宅422/工业423/公园424/乡郊427（沙滩420/绿化425/山地426 为地形）
const ZONE_VALUES = [421, 422, 423, 424, 427];

function isGrid(value: unknown): value is Grid {
  return Array.isArray(value)
    && value.length > 0
    && Array.isArray(value[0])
    && ((value[0] as unknown[]).length === 0 || typeof (value[0] as unknown[])[0] === "number");
}

function makeGrid(rows: number, cols: number, fill = 0): Grid {
  return Array.from({ length: rows }, () => new Array(cols).fill(fill));
}

function num(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function int(input: Record<string, unknown>, key: string, fallback: number): number {
  return Math.round(num(input, key, fallback));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveSeed(seed: unknown): number {
  const raw = typeof seed === "number" && Number.isFinite(seed) ? seed : 0;
  return raw === 0 ? 123456789 : raw >>> 0;
}

function boundsOf(mask: Grid): Bounds {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const out: Bounds = { minX: cols, minY: rows, maxX: 0, maxY: 0, has: false };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      out.has = true;
      out.minX = Math.min(out.minX, x);
      out.minY = Math.min(out.minY, y);
      out.maxX = Math.max(out.maxX, x);
      out.maxY = Math.max(out.maxY, y);
    }
  }
  return out;
}

function weightedCenter(mask: Grid): Point {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      sx += x;
      sy += y;
      sw++;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : { x: cols / 2, y: rows / 2 };
}

function distanceToOutside(mask: Grid): Grid {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dist = makeGrid(rows, cols, 999999);
  const queue: Point[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows || dist[y][x] === 0) return;
    dist[y][x] = 0;
    queue.push({ x, y });
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!mask[y]?.[x]) continue;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) {
          push(x, y);
          break;
        }
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy, step] of DIR8) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny]?.[nx]) continue;
      const nd = dist[p.y][p.x] + step;
      if (nd >= dist[ny][nx]) continue;
      dist[ny][nx] = nd;
      queue.push({ x: nx, y: ny });
    }
  }
  return dist;
}

function maskComponents(mask: Grid): MaskComponent[] {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const out: MaskComponent[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (seen[idx] || !mask[y]?.[x]) continue;
      const cells: Point[] = [];
      const q = [{ x, y }];
      const bounds: Bounds = { minX: x, minY: y, maxX: x, maxY: y, has: true };
      seen[idx] = 1;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < q.length; i++) {
        const p = q[i];
        cells.push(p);
        sx += p.x;
        sy += p.y;
        bounds.minX = Math.min(bounds.minX, p.x);
        bounds.minY = Math.min(bounds.minY, p.y);
        bounds.maxX = Math.max(bounds.maxX, p.x);
        bounds.maxY = Math.max(bounds.maxY, p.y);
        for (const [dx, dy] of DIR8) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          const ni = ny * cols + nx;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ni] || !mask[ny]?.[nx]) continue;
          seen[ni] = 1;
          q.push({ x: nx, y: ny });
        }
      }
      out.push({ cells, bounds, center: { x: sx / cells.length, y: sy / cells.length } });
    }
  }
  return out.sort((a, b) => b.cells.length - a.cells.length);
}

function componentAnchors(routeMask: Grid, components: MaskComponent[]): RoadAnchor[] {
  const anchors: RoadAnchor[] = [];
  for (const [componentIndex, component] of components.slice(0, 6).entries()) {
    if (component.cells.length < 450) continue;
    const center = nearestMaskPoint(routeMask, component.center);
    if (center) anchors.push({ ...center, id: `component-${componentIndex}-center`, weight: component.cells.length, kind: "regional" });
    const extremes = [
      component.cells.reduce((best, p) => p.x < best.x ? p : best, component.cells[0]),
      component.cells.reduce((best, p) => p.x > best.x ? p : best, component.cells[0]),
      component.cells.reduce((best, p) => p.y < best.y ? p : best, component.cells[0]),
      component.cells.reduce((best, p) => p.y > best.y ? p : best, component.cells[0]),
    ];
    const targets = extremes.map(p => ({
      x: p.x * 0.9 + component.center.x * 0.1,
      y: p.y * 0.9 + component.center.y * 0.1,
    }));
    for (const [i, target] of targets.entries()) {
      const p = nearestMaskPoint(routeMask, target);
      if (p) anchors.push({ ...p, id: `component-${componentIndex}-extreme-${i}`, weight: component.cells.length * 0.5, kind: "regional" });
    }
  }
  return anchors;
}

function zoneCenter(zoneGrid: Grid, buildableMask: Grid, routeMask: Grid, zoneValue: number): RoadAnchor | null {
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!buildableMask[y]?.[x] || zoneGrid[y]?.[x] !== zoneValue) continue;
      sx += x;
      sy += y;
      count++;
    }
  }
  if (count < 40) return null;
  const p = nearestMaskPoint(routeMask, { x: sx / count, y: sy / count });
  return p ? { ...p, id: `zone-${zoneValue}`, weight: count, kind: "district" } : null;
}

function radialAnchor(mask: Grid, center: Point, angle: number, targetInset: number): RoadAnchor | null {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let lastInside: Point | null = null;
  for (let r = 0; r < Math.max(rows, cols); r++) {
    const x = Math.round(center.x + dx * r);
    const y = Math.round(center.y + dy * r);
    if (x < 0 || y < 0 || x >= cols || y >= rows) break;
    if (mask[y]?.[x]) lastInside = { x, y };
    else if (lastInside) break;
  }
  if (!lastInside) return null;
  const p = nearestMaskPoint(mask, {
    x: lastInside.x - dx * targetInset,
    y: lastInside.y - dy * targetInset,
  });
  return p ? { ...p, id: `outer-${Math.round(angle * 1000)}`, weight: 1, kind: "outer" } : null;
}

function uniqueAnchors(anchors: RoadAnchor[], minDist: number): RoadAnchor[] {
  const out: RoadAnchor[] = [];
  for (const a of anchors) {
    if (out.some(b => Math.hypot(a.x - b.x, a.y - b.y) < minDist)) continue;
    out.push(a);
  }
  return out;
}

function regionalAnchors(routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid, base: RoadAnchor[], count: number): RoadAnchor[] {
  const rows = routeMask.length;
  const cols = routeMask[0]?.length ?? 0;
  const anchors: RoadAnchor[] = [...base];
  const picked: RoadAnchor[] = [];
  const stride = Math.max(16, Math.round(Math.min(rows, cols) / 30));
  for (let i = 0; i < count; i++) {
    let best: RoadAnchor | null = null;
    let bestScore = -Infinity;
    for (let y = Math.floor(stride / 2); y < rows; y += stride) {
      for (let x = Math.floor(stride / 2); x < cols; x += stride) {
        if (!routeMask[y]?.[x]) continue;
        const nearest = anchors.reduce((m, a) => Math.min(m, Math.hypot(x - a.x, y - a.y)), Infinity);
        if (nearest < stride * 1.4) continue;
        const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
        const highPenalty = Math.max(0, h - 0.72) * 120;
        const coastPenalty = Math.max(0, 10 - (edgeDist[y]?.[x] ?? 0)) * 8;
        const zoneBonus = zoneGrid[y]?.[x] ? 35 : 0;
        const score = nearest + zoneBonus - highPenalty - coastPenalty;
        if (score <= bestScore) continue;
        bestScore = score;
        best = { x, y, id: `regional-${i}-${x}-${y}`, weight: score, kind: "regional" };
      }
    }
    if (!best) break;
    anchors.push(best);
    picked.push(best);
  }
  return picked;
}

function buildAnchors(zoneGrid: Grid, buildableMask: Grid, routeMask: Grid, heightMap: Grid | null, edgeDist: Grid, bounds: Bounds, center: Point): RoadAnchor[] {
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const targetInset = clamp(Math.round(Math.min(w, h) * 0.08), 14, 48);
  const outer: RoadAnchor[] = [];
  const sectors = Math.max(10, Math.min(16, Math.round(Math.hypot(w, h) / 78)));
  for (let i = 0; i < sectors; i++) {
    const p = radialAnchor(routeMask, center, (i / sectors) * Math.PI * 2, targetInset);
    if (p) outer.push(p);
  }
  const districts = ZONE_VALUES
    .map(zone => zoneCenter(zoneGrid, buildableMask, routeMask, zone))
    .filter((p): p is RoadAnchor => !!p)
    .sort((a, b) => b.weight - a.weight);
  const componentSeeds = componentAnchors(routeMask, maskComponents(routeMask));
  const base = uniqueAnchors([...outer, ...districts, ...componentSeeds], Math.max(16, Math.min(w, h) * 0.04));
  const regionalCount = Math.max(8, Math.min(14, Math.round(Math.hypot(w, h) / 85)));
  return uniqueAnchors([...base, ...regionalAnchors(routeMask, zoneGrid, heightMap, edgeDist, base, regionalCount)], Math.max(18, Math.min(w, h) * 0.045));
}

function maskedDisk(grid: Grid, mask: Grid | null, cx: number, cy: number, radius: number, value: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const r = Math.max(0, Math.round(radius));
  const r2 = r * r;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = Math.round(cx) + dx;
      const y = Math.round(cy) + dy;
      if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
      if (mask && !mask[y]?.[x]) continue;
      grid[y][x] = value;
    }
  }
}

function drawClippedLine(grid: Grid, mask: Grid | null, a: Point, b: Point, radius: number, value: number, minRun = 5, maxGap = 0): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let run: Point[] = [];
  let gap: Point[] = [];
  const flush = () => {
    const drawMask = maxGap > 0 ? null : mask;
    if (run.length >= minRun) for (const p of run) maskedDisk(grid, drawMask, p.x, p.y, radius, value);
    run = [];
    gap = [];
  };
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    const ok = x >= 0 && y >= 0 && x < cols && y < rows && (!mask || mask[y]?.[x] > 0);
    if (ok) {
      if (gap.length > 0 && gap.length <= maxGap) run.push(...gap);
      else if (gap.length > maxGap) flush();
      gap = [];
      if (run.length === 0 || run[run.length - 1].x !== x || run[run.length - 1].y !== y) run.push({ x, y });
    } else {
      gap.push({ x, y });
    }
  }
  flush();
}

function nearestMaskPoint(mask: Grid, point: Point): Point | null {
  const rows = mask.length;
  const cols = mask[0]?.length ?? 0;
  const sx = clamp(Math.round(point.x), 0, cols - 1);
  const sy = clamp(Math.round(point.y), 0, rows - 1);
  if (mask[sy]?.[sx]) return { x: sx, y: sy };
  const maxR = Math.max(rows, cols);
  for (let r = 1; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        if (mask[y]?.[x]) return { x, y };
      }
    }
  }
  return null;
}

function terrainStepCost(x: number, y: number, fromX: number, fromY: number, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid | null, coastalBias: boolean): number {
  const h = heightMap ? (heightMap[y]?.[x] ?? 0.55) : 0.55;
  const prevH = heightMap ? (heightMap[fromY]?.[fromX] ?? h) : h;
  const zone = zoneGrid[y]?.[x] ?? 0;
  // 商业/住宅最易通行；工业次之；乡郊一般；公园较贵；其余地形(沙滩/绿化/山地)最贵
  const zoneBias = zone === 421 || zone === 422 ? 0.75 : zone === 423 ? 0.88 : zone === 427 ? 1.0 : zone === 424 ? 1.25 : 1.18;
  const slopePenalty = Math.abs(h - prevH) * 18;
  const highPenalty = Math.max(0, h - 0.72) * 6;
  const lowPenalty = Math.max(0, 0.48 - h) * 5;
  const d = edgeDist ? edgeDist[y]?.[x] ?? 20 : 20;
  const edgePenalty = coastalBias ? Math.abs(d - 24) * 0.035 : d < 8 ? (8 - d) * 0.45 : 0;
  return zoneBias + highPenalty + lowPenalty + slopePenalty + edgePenalty;
}

function terrainPath(routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid | null, start: Point, goal: Point, coastalBias = false): Point[] {
  const rows = routeMask.length;
  const cols = routeMask[0]?.length ?? 0;
  const s = nearestMaskPoint(routeMask, start);
  const g0 = nearestMaskPoint(routeMask, goal);
  if (!s || !g0) return [start, goal];
  const startIdx = s.y * cols + s.x;
  const goalIdx = g0.y * cols + g0.x;
  const best = new Float64Array(rows * cols);
  const prev = new Int32Array(rows * cols);
  best.fill(Infinity);
  prev.fill(-1);
  best[startIdx] = 0;
  const heap = new MinHeap();
  heap.push({ idx: startIdx, f: 0 });
  while (heap.length > 0) {
    const cur = heap.pop();
    if (!cur) break;
    if (cur.idx === goalIdx) break;
    const x = cur.idx % cols;
    const y = Math.floor(cur.idx / cols);
    const heuristic = Math.hypot(g0.x - x, g0.y - y);
    if (cur.f > best[cur.idx] + heuristic + 1e-6) continue;
    for (const [dx, dy, step] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !routeMask[ny]?.[nx]) continue;
      const ni = ny * cols + nx;
      const cost = best[cur.idx] + step * terrainStepCost(nx, ny, x, y, zoneGrid, heightMap, edgeDist, coastalBias);
      if (cost >= best[ni]) continue;
      best[ni] = cost;
      prev[ni] = cur.idx;
      heap.push({ idx: ni, f: cost + Math.hypot(g0.x - nx, g0.y - ny) });
    }
  }
  if (prev[goalIdx] < 0) return [s, g0];
  const out: Point[] = [];
  for (let idx = goalIdx; idx >= 0; idx = prev[idx]) {
    out.push({ x: idx % cols, y: Math.floor(idx / cols) });
    if (idx === startIdx) break;
  }
  return out.reverse();
}

function simplifyPath(path: Point[], spacing: number): Point[] {
  if (path.length <= 2) return path;
  const out: Point[] = [path[0]];
  let last = path[0];
  for (let i = spacing; i < path.length - 1; i += spacing) {
    const p = path[i];
    if (Math.hypot(p.x - last.x, p.y - last.y) < spacing * 0.65) continue;
    out.push(p);
    last = p;
  }
  out.push(path[path.length - 1]);
  return out;
}

function chaikin(points: Point[], iterations: number): Point[] {
  let out = points;
  for (let it = 0; it < iterations; it++) {
    if (out.length < 3) break;
    const next: Point[] = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

function smoothPath(path: Point[], spacing: number): Point[] {
  return chaikin(simplifyPath(path, Math.max(4, Math.round(spacing))), 2);
}

function drawSmoothPath(grid: Grid, mask: Grid | null, path: Point[], radius: number, value: number, bridgeGap = 0): void {
  if (path.length < 2) return;
  const spacing = Math.max(6, Math.hypot(path[0].x - path[path.length - 1].x, path[0].y - path[path.length - 1].y) / 18);
  const smoothed = smoothPath(path, spacing);
  for (let i = 1; i < smoothed.length; i++) {
    drawClippedLine(grid, mask, smoothed[i - 1], smoothed[i], radius, value, 3, bridgeGap);
  }
}

const NAMES: NameEntry[] = [{ id: 300, name: "GTA 主干路", type: "tile" }];

function connectRoad(grid: Grid, routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid, a: Point, b: Point, width: number, bridgeGap: number, coastalBias = false): void {
  const path = terrainPath(routeMask, zoneGrid, heightMap, edgeDist, a, b, coastalBias);
  drawSmoothPath(grid, routeMask, path, width, 300, Math.max(0, Math.round(bridgeGap * 0.18)));
}

function connectOuterLoop(grid: Grid, routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid, anchors: RoadAnchor[], width: number, bridgeGap: number): void {
  const outer = anchors.filter(a => a.kind === "outer");
  if (outer.length < 3) return;
  const center = weightedCenter(routeMask);
  outer.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
  for (let i = 0; i < outer.length; i++) {
    const a = outer[i];
    const b = outer[(i + 1) % outer.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) > Math.max(routeMask.length, routeMask[0]?.length ?? 0) * 0.42) continue;
    connectRoad(grid, routeMask, zoneGrid, heightMap, edgeDist, a, b, width, bridgeGap, true);
  }
}

function connectAnchorTree(grid: Grid, routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid, anchors: RoadAnchor[], width: number, bridgeGap: number): void {
  if (anchors.length < 2) return;
  const connected = new Set<number>([0]);
  const remaining = new Set<number>(anchors.map((_, i) => i).slice(1));
  while (remaining.size > 0) {
    let best: { a: number; b: number; d: number } | null = null;
    for (const a of connected) {
      for (const b of remaining) {
        const direct = Math.hypot(anchors[a].x - anchors[b].x, anchors[a].y - anchors[b].y);
        const kindPenalty = anchors[a].kind === "outer" && anchors[b].kind === "outer" ? 1.45 : anchors[a].kind === "regional" || anchors[b].kind === "regional" ? 1.08 : 1;
        const d = direct * kindPenalty;
        if (!best || d < best.d) best = { a, b, d };
      }
    }
    if (!best) break;
    connectRoad(grid, routeMask, zoneGrid, heightMap, edgeDist, anchors[best.a], anchors[best.b], width, bridgeGap, false);
    connected.add(best.b);
    remaining.delete(best.b);
  }
}

function bridgeAcrossWater(grid: Grid, buildableMask: Grid, bounds: Bounds, width: number, bridgeGap: number): void {
  if (bridgeGap <= 0) return;
  const rows = buildableMask.length;
  const cols = buildableMask[0]?.length ?? 0;
  const samples: Array<[Point, Point]> = [];
  const ys = [0.28, 0.48, 0.68].map(t => Math.round(bounds.minY + (bounds.maxY - bounds.minY) * t));
  for (const y of ys) {
    let last: Point | null = null;
    for (let x = bounds.minX; x <= bounds.maxX; x++) {
      if (x < 0 || x >= cols || y < 0 || y >= rows) continue;
      if (!buildableMask[y]?.[x]) continue;
      if (last && x - last.x > 8 && x - last.x <= bridgeGap) samples.push([last, { x, y }]);
      last = { x, y };
    }
  }
  for (const [a, b] of samples.slice(0, 4)) drawClippedLine(grid, null, a, b, width, 300, 2, 0);
}

function roadComponents(grid: Grid): RoadComponent[] {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const seen = new Uint8Array(rows * cols);
  const out: RoadComponent[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (seen[idx] || !grid[y]?.[x]) continue;
      const cells: Point[] = [];
      const q = [{ x, y }];
      seen[idx] = 1;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < q.length; i++) {
        const p = q[i];
        cells.push(p);
        sx += p.x;
        sy += p.y;
        for (const [dx, dy] of DIR8) {
          const nx = p.x + dx;
          const ny = p.y + dy;
          const ni = ny * cols + nx;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen[ni] || !grid[ny]?.[nx]) continue;
          seen[ni] = 1;
          q.push({ x: nx, y: ny });
        }
      }
      out.push({ cells, center: { x: sx / cells.length, y: sy / cells.length } });
    }
  }
  return out.sort((a, b) => b.cells.length - a.cells.length);
}

function nearestCells(a: RoadComponent, b: RoadComponent): [Point, Point] {
  let bestA = a.cells[0];
  let bestB = b.cells[0];
  let best = Infinity;
  const stepA = Math.max(1, Math.floor(a.cells.length / 160));
  const stepB = Math.max(1, Math.floor(b.cells.length / 160));
  for (let i = 0; i < a.cells.length; i += stepA) {
    const pa = a.cells[i];
    for (let j = 0; j < b.cells.length; j += stepB) {
      const pb = b.cells[j];
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
      if (d >= best) continue;
      best = d;
      bestA = pa;
      bestB = pb;
    }
  }
  return [bestA, bestB];
}

function connectRoadComponents(grid: Grid, routeMask: Grid, zoneGrid: Grid, heightMap: Grid | null, edgeDist: Grid, width: number, bridgeGap: number): void {
  for (let pass = 0; pass < 10; pass++) {
    const comps = roadComponents(grid);
    if (comps.length <= 1) return;
    const main = comps[0];
    const next = comps[1];
    const [a, b] = nearestCells(main, next);
    const before = comps.length;
    connectRoad(grid, routeMask, zoneGrid, heightMap, edgeDist, a, b, width, bridgeGap, false);
    const after = roadComponents(grid).length;
    if (after < before) continue;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d <= bridgeGap * 1.8) drawClippedLine(grid, null, a, b, width, 300, 2, 0);
  }
}

// 过滤小岛：保留最大陆块；其余岛屿仅当面积达到阈值（视为超大岛屿）才保留。
// 被移除的岛屿从 routeMask 中清零 → 不生成任何锚点与道路。
function filterRoadLandMask(routeMask: Grid, minIslandArea: number): Grid {
  const rows = routeMask.length;
  const cols = routeMask[0]?.length ?? 0;
  const comps = maskComponents(routeMask);  // 已按面积降序
  const out = makeGrid(rows, cols, 0);
  for (let i = 0; i < comps.length; i++) {
    const keep = i === 0 || comps[i].cells.length >= minIslandArea;
    if (keep) for (const c of comps[i].cells) out[c.y][c.x] = 1;
  }
  return out;
}

const DIR8_XY: Array<[number, number]> = [
  [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1],
];

// 闭合发丝级断点：填补「两侧均有道路」的空像素（相对方向成对，或被 ≥3 个道路像素包围）。
// 纯增量操作，不会削薄已有道路；可修复接口处的细小断开。
function closeRoadGaps(grid: Grid, value: number, iterations: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  // 4 组相对方向：N/S、E/W、NE/SW、NW/SE
  const opp: Array<[[number, number], [number, number]]> = [
    [[0, -1], [0, 1]], [[-1, 0], [1, 0]], [[1, -1], [-1, 1]], [[-1, -1], [1, 1]],
  ];
  for (let it = 0; it < iterations; it++) {
    const adds: Array<[number, number]> = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (grid[y][x]) continue;
        let n = 0;
        for (const [dx, dy] of DIR8_XY) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && grid[ny][nx]) n++;
        }
        let oppositePair = false;
        for (const [[ax, ay], [bx, by]] of opp) {
          const a = x + ax, a2 = y + ay, b = x + bx, b2 = y + by;
          const ra = a >= 0 && a2 >= 0 && a < cols && a2 < rows && grid[a2][a];
          const rb = b >= 0 && b2 >= 0 && b < cols && b2 < rows && grid[b2][b];
          if (ra && rb) { oppositePair = true; break; }
        }
        if (n >= 3 || oppositePair) adds.push([x, y]);
      }
    }
    for (const [x, y] of adds) grid[y][x] = value;
    if (adds.length === 0) break;
  }
}

// 接口/交叉口加固：检测道路交叉口（环采样统计「道路臂」分组数 ≥3），
// 在其周围补一个圆盘，消除接口处薄弱。
function reinforceJunctions(grid: Grid, value: number, baseWidth: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const ring = Math.max(2, Math.round(baseWidth * 0.9));
  const samples = 16;
  const junctions: Point[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!grid[y][x]) continue;
      // 沿半径 ring 的圆环采样，统计道路样本的环向分组数（= 臂数）
      const hit: boolean[] = [];
      for (let k = 0; k < samples; k++) {
        const a = (k / samples) * Math.PI * 2;
        const px = Math.round(x + Math.cos(a) * ring);
        const py = Math.round(y + Math.sin(a) * ring);
        hit.push(px >= 0 && py >= 0 && px < cols && py < rows && grid[py][px] > 0);
      }
      let arms = 0;
      for (let k = 0; k < samples; k++) {
        if (hit[k] && !hit[(k - 1 + samples) % samples]) arms++;
      }
      if (arms >= 3) junctions.push({ x, y });
    }
  }
  const r = Math.max(1, Math.ceil(baseWidth / 2) + 1);
  for (const j of junctions) maskedDisk(grid, null, j.x, j.y, r, value);
}

export function gtaMainRoads(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.zoneGrid)) return { error: "zoneGrid is required" };
  if (!isGrid(input.buildableMask)) return { error: "buildableMask is required" };
  const zoneGrid = input.zoneGrid as Grid;
  const buildableMask = input.buildableMask as Grid;
  const landGrid = isGrid(input.landGrid) ? input.landGrid as Grid : null;
  const rawRouteMask = landGrid ?? buildableMask;
  const heightMap = isGrid(input.heightMap) ? input.heightMap as Grid : null;
  const rows = zoneGrid.length;
  const cols = zoneGrid[0]?.length ?? 0;
  const seed = resolveSeed(input.seed);
  void seed;
  const roadWidth = clamp(int(input, "roadWidth", 3), 1, 8);
  const bridgeGap = clamp(int(input, "bridgeGap", 90), 0, 220);
  const minIslandArea = clamp(int(input, "minIslandArea", 1200), 0, 20000);

  // 过滤小岛：仅最大陆块与超大岛屿参与路网
  const routeMask = filterRoadLandMask(rawRouteMask, minIslandArea);
  // 可建设掩码同步限制在保留的陆块内，避免桥接到被过滤掉的小岛
  const buildableFiltered = buildableMask.map((row, y) => row.map((v, x) => routeMask[y]?.[x] ? v : 0));

  const bounds = boundsOf(routeMask);
  const center = weightedCenter(routeMask);
  const mainRoadGrid = makeGrid(rows, cols, 0);
  if (!bounds.has) return { mainRoadGrid, outputGrid: mainRoadGrid, outputNameList: [] };

  const edgeDist = distanceToOutside(routeMask);
  const anchors = buildAnchors(zoneGrid, buildableFiltered, routeMask, heightMap, edgeDist, bounds, center);
  connectOuterLoop(mainRoadGrid, routeMask, zoneGrid, heightMap, edgeDist, anchors, roadWidth, bridgeGap);
  connectAnchorTree(mainRoadGrid, routeMask, zoneGrid, heightMap, edgeDist, anchors, roadWidth, bridgeGap);
  bridgeAcrossWater(mainRoadGrid, buildableFiltered, bounds, roadWidth, bridgeGap);
  connectRoadComponents(mainRoadGrid, routeMask, zoneGrid, heightMap, edgeDist, roadWidth, bridgeGap);

  // ── 后处理：修复接口处断点 + 加固交叉口 ──
  closeRoadGaps(mainRoadGrid, 300, 2);          // 闭合发丝级断点
  reinforceJunctions(mainRoadGrid, 300, roadWidth); // 交叉口补圆盘
  closeRoadGaps(mainRoadGrid, 300, 1);          // 加固后再补一次残余缝隙

  return { mainRoadGrid, outputGrid: mainRoadGrid, outputNameList: NAMES };
}
