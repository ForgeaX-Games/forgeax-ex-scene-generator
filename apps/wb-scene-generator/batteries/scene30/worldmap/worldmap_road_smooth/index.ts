type Grid = number[][];

interface NameEntry {
  id: number;
  name: string;
  type?: string;
}

interface Point { x: number; y: number; }

const NAMES: NameEntry[] = [
  { id: 300, name: "主道路", type: "tile" },
  { id: 301, name: "城市道路", type: "tile" },
  { id: 303, name: "海底隧道", type: "tile" },
];

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

function cloneGrid(grid: Grid): Grid {
  return grid.map(row => row.slice());
}

function isRoadValue(v: number): boolean {
  return v === 300 || v === 301 || v === 302 || v === 303;
}

function writeSample(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid | null, x: number, y: number, radius: number, value: number): void {
  const rows = roadGrid.length;
  const cols = roadGrid[0]?.length ?? 0;
  const r = Math.max(0, radius);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (value === 303 || (landGrid && !landGrid[ny]?.[nx])) tunnelGrid[ny][nx] = 303;
      else roadGrid[ny][nx] = value === 0 || value === 303 ? 300 : value;
    }
  }
}

function drawLine(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid | null, a: Point, b: Point, radius: number, value: number): void {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    writeSample(
      roadGrid,
      tunnelGrid,
      landGrid,
      Math.round(a.x + (b.x - a.x) * t),
      Math.round(a.y + (b.y - a.y) * t),
      radius,
      value
    );
  }
}

function mergedValue(roadGrid: Grid, tunnelGrid: Grid, x: number, y: number): number {
  return roadGrid[y]?.[x] || tunnelGrid[y]?.[x] || 0;
}

function endpointCells(roadGrid: Grid, tunnelGrid: Grid): Array<Point & { value: number }> {
  const rows = roadGrid.length;
  const cols = roadGrid[0]?.length ?? 0;
  const out: Array<Point & { value: number }> = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const value = mergedValue(roadGrid, tunnelGrid, x, y);
      if (!isRoadValue(value)) continue;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (isRoadValue(mergedValue(roadGrid, tunnelGrid, x + dx, y + dy))) neighbors++;
        }
      }
      if (neighbors <= 2) out.push({ x, y, value });
    }
  }
  return out;
}

function closeEndpointGaps(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid | null, gapRadius: number, strokeRadius: number): void {
  const points = endpointCells(roadGrid, tunnelGrid);
  const used = new Set<number>();
  for (let i = 0; i < points.length; i++) {
    if (used.has(i)) continue;
    let best = -1;
    let bestDist = Infinity;
    for (let j = i + 1; j < points.length; j++) {
      if (used.has(j)) continue;
      const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (d > gapRadius || d < 2 || d >= bestDist) continue;
      best = j;
      bestDist = d;
    }
    if (best < 0) continue;
    const value = points[i].value === 303 || points[best].value === 303 ? 303 : Math.min(points[i].value, points[best].value);
    drawLine(roadGrid, tunnelGrid, landGrid, points[i], points[best], strokeRadius, value);
    used.add(i);
    used.add(best);
  }
}

function majorityFill(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid | null): void {
  const rows = roadGrid.length;
  const cols = roadGrid[0]?.length ?? 0;
  const srcRoad = cloneGrid(roadGrid);
  const srcTunnel = cloneGrid(tunnelGrid);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (isRoadValue(srcRoad[y][x] || srcTunnel[y][x])) continue;
      const counts = new Map<number, number>();
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const v = srcRoad[y + dy][x + dx] || srcTunnel[y + dy][x + dx] || 0;
          if (isRoadValue(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        }
      }
      let bestValue = 0;
      let bestCount = 0;
      for (const [value, count] of counts) {
        if (count > bestCount) {
          bestValue = value;
          bestCount = count;
        }
      }
      if (bestCount >= 3) writeSample(roadGrid, tunnelGrid, landGrid, x, y, 0, bestValue);
    }
  }
}

function dilate(roadGrid: Grid, tunnelGrid: Grid, landGrid: Grid | null, radius: number): void {
  const srcRoad = cloneGrid(roadGrid);
  const srcTunnel = cloneGrid(tunnelGrid);
  for (let y = 0; y < srcRoad.length; y++) {
    for (let x = 0; x < (srcRoad[0]?.length ?? 0); x++) {
      const v = srcRoad[y][x] || srcTunnel[y][x] || 0;
      if (isRoadValue(v)) writeSample(roadGrid, tunnelGrid, landGrid, x, y, radius, v);
    }
  }
}

function outputGrid(roadGrid: Grid, tunnelGrid: Grid): Grid {
  return roadGrid.map((row, y) => row.map((v, x) => v || tunnelGrid[y][x] || 0));
}

export function worldmapRoadSmooth(input: Record<string, unknown>): Record<string, unknown> {
  if (!isGrid(input.roadGrid)) return { error: "roadGrid is required" };
  const baseRoad = input.roadGrid as Grid;
  const rows = baseRoad.length;
  const cols = baseRoad[0]?.length ?? 0;
  const baseTunnel = isGrid(input.tunnelGrid) ? input.tunnelGrid as Grid : makeGrid(rows, cols, 0);
  const landGrid = isGrid(input.landGrid) ? input.landGrid as Grid : null;
  const roadGrid = cloneGrid(baseRoad);
  const tunnelGrid = cloneGrid(baseTunnel);
  const algorithm = typeof input.algorithm === "string" ? input.algorithm : "continuous";
  const iterations = clamp(int(input, "iterations", 1), 1, 4);
  const gapRadius = clamp(int(input, "gapRadius", 10), 2, 40);
  const strokeRadius = clamp(int(input, "strokeRadius", 0), 0, 4);

  for (let i = 0; i < iterations; i++) {
    if (algorithm === "majority") {
      majorityFill(roadGrid, tunnelGrid, landGrid);
    } else if (algorithm === "close_gaps") {
      closeEndpointGaps(roadGrid, tunnelGrid, landGrid, gapRadius, strokeRadius);
    } else {
      closeEndpointGaps(roadGrid, tunnelGrid, landGrid, gapRadius, strokeRadius);
      majorityFill(roadGrid, tunnelGrid, landGrid);
      if (strokeRadius > 1) dilate(roadGrid, tunnelGrid, landGrid, strokeRadius - 1);
    }
  }

  const combined = outputGrid(roadGrid, tunnelGrid);
  const used = new Set(combined.flat().filter(v => v !== 0));
  return {
    roadGrid,
    tunnelGrid,
    outputGrid: combined,
    outputNameList: NAMES.filter(entry => used.has(entry.id)),
  };
}
