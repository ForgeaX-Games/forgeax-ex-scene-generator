/**
 * rule_indoor_anomaly
 * Generates an anomaly / rift zone in the indoor layout with selectable
 * shape modes: "natural" (organic blob via random walk + cellular automata),
 * "polygon" (random star polygon rasterized), "crack" (branching fracture lines).
 *
 * Input:  inputGrid (grid) — completed indoor layout
 * Output: outputGrid (grid) — layout with anomaly zone painted
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

function randInt(rng: () => number, lo: number, hi: number): number {
  return Math.floor(rng() * (hi - lo + 1)) + lo;
}

function findInteriorCenter(grid: number[][], rows: number, cols: number): [number, number] {
  let sr = 0, sc = 0, count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) { sr += r; sc += c; count++; }
    }
  }
  if (count === 0) return [Math.floor(rows / 2), Math.floor(cols / 2)];
  return [Math.round(sr / count), Math.round(sc / count)];
}

function countInterior(grid: number[][], rows: number, cols: number): number {
  let count = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 0) count++;
    }
  }
  return count;
}

function generateNatural(
  grid: number[][], rows: number, cols: number,
  centerR: number, centerC: number, targetArea: number,
  anomalyValue: number, rng: () => number
): void {
  const marked = new Set<string>();
  const frontier: [number, number][] = [];

  const mark = (r: number, c: number) => {
    const key = `${r},${c}`;
    if (marked.has(key)) return;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return;
    if (grid[r][c] === 0) return;
    marked.add(key);
    frontier.push([r, c]);
  };

  mark(centerR, centerC);

  let placed = 0;
  while (placed < targetArea && frontier.length > 0) {
    const idx = randInt(rng, 0, frontier.length - 1);
    const [r, c] = frontier[idx];
    frontier[idx] = frontier[frontier.length - 1];
    frontier.pop();

    grid[r][c] = anomalyValue;
    placed++;

    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] !== 0 && grid[nr][nc] !== anomalyValue) {
        if (rng() < 0.7) mark(nr, nc);
      }
    }

    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] !== 0 && grid[nr][nc] !== anomalyValue) {
        if (rng() < 0.3) mark(nr, nc);
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    const toFill: [number, number][] = [];
    for (let r = 1; r < rows - 1; r++) {
      for (let c = 1; c < cols - 1; c++) {
        if (grid[r][c] === anomalyValue) continue;
        if (grid[r][c] === 0) continue;
        let neighbors = 0;
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (grid[r + dr][c + dc] === anomalyValue) neighbors++;
        }
        if (neighbors >= 3) toFill.push([r, c]);
      }
    }
    for (const [r, c] of toFill) grid[r][c] = anomalyValue;
  }
}

function generatePolygon(
  grid: number[][], rows: number, cols: number,
  centerR: number, centerC: number, targetArea: number,
  anomalyValue: number, rng: () => number
): void {
  const estimatedRadius = Math.sqrt(targetArea / Math.PI) * 1.2;
  const numVertices = randInt(rng, 5, 9);
  const vertices: [number, number][] = [];

  for (let i = 0; i < numVertices; i++) {
    const angle = (2 * Math.PI * i) / numVertices + (rng() - 0.5) * 0.4;
    const radiusVariation = 0.5 + rng() * 0.8;
    const radius = estimatedRadius * radiusVariation;
    const vr = centerR + Math.sin(angle) * radius;
    const vc = centerC + Math.cos(angle) * radius * 1.5;
    vertices.push([vr, vc]);
  }

  const minR = Math.max(0, Math.floor(Math.min(...vertices.map(v => v[0]))) - 1);
  const maxR = Math.min(rows - 1, Math.ceil(Math.max(...vertices.map(v => v[0]))) + 1);
  const minC = Math.max(0, Math.floor(Math.min(...vertices.map(v => v[1]))) - 1);
  const maxC = Math.min(cols - 1, Math.ceil(Math.max(...vertices.map(v => v[1]))) + 1);

  for (let r = minR; r <= maxR; r++) {
    for (let c = minC; c <= maxC; c++) {
      if (grid[r][c] === 0) continue;
      if (isInsidePolygon(r, c, vertices)) {
        grid[r][c] = anomalyValue;
      }
    }
  }
}

function isInsidePolygon(r: number, c: number, vertices: [number, number][]): boolean {
  let inside = false;
  const n = vertices.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ri, ci] = vertices[i];
    const [rj, cj] = vertices[j];
    if ((ri > r) !== (rj > r) && c < ((cj - ci) * (r - ri)) / (rj - ri) + ci) {
      inside = !inside;
    }
  }
  return inside;
}

function generateCrack(
  grid: number[][], rows: number, cols: number,
  centerR: number, centerC: number, targetArea: number,
  anomalyValue: number, rng: () => number
): void {
  const numBranches = randInt(rng, 3, 7);
  const avgBranchLength = Math.sqrt(targetArea) * 0.8;
  const crackWidth = randInt(rng, 2, 4);

  for (let b = 0; b < numBranches; b++) {
    let r = centerR + randInt(rng, -3, 3);
    let c = centerC + randInt(rng, -3, 3);
    const angle = rng() * Math.PI * 2;
    const branchLen = avgBranchLength * (0.5 + rng() * 1.0);
    const dr = Math.sin(angle);
    const dc = Math.cos(angle);

    for (let step = 0; step < branchLen; step++) {
      const cr = Math.round(r);
      const cc = Math.round(c);

      for (let wr = -crackWidth; wr <= crackWidth; wr++) {
        for (let wc = -crackWidth; wc <= crackWidth; wc++) {
          const pr = cr + wr, pc = cc + wc;
          if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && grid[pr][pc] !== 0) {
            const dist = Math.sqrt(wr * wr + wc * wc);
            if (dist <= crackWidth * 0.7 || rng() < 0.3) {
              grid[pr][pc] = anomalyValue;
            }
          }
        }
      }

      r += dr + (rng() - 0.5) * 0.8;
      c += dc + (rng() - 0.5) * 0.8;

      if (r < 0 || r >= rows || c < 0 || c >= cols) break;

      if (rng() < 0.15 && step > branchLen * 0.3) {
        const subAngle = angle + (rng() - 0.5) * Math.PI * 0.8;
        const subLen = (branchLen - step) * 0.6;
        let sr = r, sc = c;
        const sdr = Math.sin(subAngle);
        const sdc = Math.cos(subAngle);
        const subWidth = Math.max(1, crackWidth - 1);

        for (let ss = 0; ss < subLen; ss++) {
          const csr = Math.round(sr), csc = Math.round(sc);
          for (let wr = -subWidth; wr <= subWidth; wr++) {
            for (let wc = -subWidth; wc <= subWidth; wc++) {
              const pr = csr + wr, pc = csc + wc;
              if (pr >= 0 && pr < rows && pc >= 0 && pc < cols && grid[pr][pc] !== 0) {
                if (Math.sqrt(wr * wr + wc * wc) <= subWidth) {
                  grid[pr][pc] = anomalyValue;
                }
              }
            }
          }
          sr += sdr + (rng() - 0.5) * 0.6;
          sc += sdc + (rng() - 0.5) * 0.6;
          if (sr < 0 || sr >= rows || sc < 0 || sc >= cols) break;
        }
      }
    }
  }
}

export function ruleIndoorAnomaly(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0 || !inputGrid[0] || inputGrid[0].length === 0) {
    return { error: "inputGrid is required" };
  }

  const rows = inputGrid.length;
  const cols = inputGrid[0].length;
  const anomalyValue = typeof input.anomalyValue === "number" ? Math.floor(input.anomalyValue) : 5;
  const sizeRatio = typeof input.sizeRatio === "number" ? Math.max(0.01, Math.min(0.5, input.sizeRatio)) : 0.15;
  const shape = typeof input.shape === "string" ? input.shape : "natural";
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const baseSeed = seedRaw === 0 ? Date.now() : seedRaw;
  const rng = mulberry32(baseSeed);

  const outputGrid: number[][] = inputGrid.map(row => [...row]);
  const interiorCount = countInterior(outputGrid, rows, cols);
  const targetArea = Math.round(interiorCount * sizeRatio);

  if (targetArea < 4) return { outputGrid };

  const [centerR, centerC] = findInteriorCenter(outputGrid, rows, cols);

  switch (shape) {
    case "polygon":
      generatePolygon(outputGrid, rows, cols, centerR, centerC, targetArea, anomalyValue, rng);
      break;
    case "crack":
      generateCrack(outputGrid, rows, cols, centerR, centerC, targetArea, anomalyValue, rng);
      break;
    case "natural":
    default:
      generateNatural(outputGrid, rows, cols, centerR, centerC, targetArea, anomalyValue, rng);
      break;
  }

  return { outputGrid };
}
