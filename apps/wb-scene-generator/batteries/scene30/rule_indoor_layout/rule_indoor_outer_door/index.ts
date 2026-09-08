/**
 * rule_indoor_outer_door
 *
 * Opens doors in the building's outer wall where corridors approach the
 * perimeter. Door width comes from selecting multiple adjacent corridor cells
 * along the wall face — never carves perpendicular into room walls.
 *
 * Algorithm:
 *  1. For each corridor cell, in each direction, trace straight through wall
 *     cells (=0) until exterior is reached → candidate.
 *  2. Group candidates by (direction, wall-face-position) into runs of adjacent
 *     corridor cells facing the same wall segment.
 *  3. For each chosen group, carve the wall path for `doorWidth` corridor cells
 *     centered within the run (width comes from adjacent corridor cells, not
 *     perpendicular spray).
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

const DIRS4: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]];

interface DoorCandidate {
  corridorR: number;
  corridorC: number;
  dr: number;
  dc: number;
  wallPath: [number, number][];
  pathLen: number;
}

function isExteriorCell(
  r: number, c: number, rows: number, cols: number,
  footprint: number[][] | null
): boolean {
  if (r < 0 || r >= rows || c < 0 || c >= cols) return true;
  if (footprint) return footprint[r][c] === 0;
  return false;
}

function findDoorCandidates(
  grid: number[][], rows: number, cols: number,
  footprint: number[][] | null, maxWallDepth: number
): DoorCandidate[] {
  const candidates: DoorCandidate[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (grid[r][c] !== 1) continue;

      for (const [dr, dc] of DIRS4) {
        const path: [number, number][] = [];
        let cr = r + dr, cc = c + dc;
        let depth = 0;
        let reachedExterior = false;

        while (depth < maxWallDepth) {
          if (cr < 0 || cr >= rows || cc < 0 || cc >= cols) {
            reachedExterior = true;
            break;
          }
          if (isExteriorCell(cr, cc, rows, cols, footprint)) {
            reachedExterior = true;
            break;
          }
          if (grid[cr][cc] !== 0) break;
          path.push([cr, cc]);
          cr += dr;
          cc += dc;
          depth++;
        }

        if (reachedExterior && path.length > 0) {
          candidates.push({
            corridorR: r, corridorC: c,
            dr, dc,
            wallPath: path,
            pathLen: path.length,
          });
        }
      }
    }
  }

  return candidates;
}

interface DoorRun {
  dr: number;
  dc: number;
  wallLen: number;
  corrCells: [number, number][];
  centerR: number;
  centerC: number;
}

function buildDoorRuns(candidates: DoorCandidate[]): DoorRun[] {
  if (candidates.length === 0) return [];

  const runs: DoorRun[] = [];

  for (const [dr, dc] of DIRS4) {
    const matching = candidates.filter(c => c.dr === dr && c.dc === dc);
    if (matching.length === 0) continue;

    const isVertDir = dc === 0;

    if (isVertDir) {
      matching.sort((a, b) => a.corridorC - b.corridorC || a.corridorR - b.corridorR);
    } else {
      matching.sort((a, b) => a.corridorR - b.corridorR || a.corridorC - b.corridorC);
    }

    let run: DoorCandidate[] = [matching[0]];
    for (let i = 1; i < matching.length; i++) {
      const prev = matching[i - 1], curr = matching[i];
      const samePath = prev.pathLen === curr.pathLen;
      const adjacent = isVertDir
        ? (Math.abs(prev.corridorC - curr.corridorC) <= 1 && prev.corridorR === curr.corridorR)
        : (Math.abs(prev.corridorR - curr.corridorR) <= 1 && prev.corridorC === curr.corridorC);

      if (samePath && adjacent) {
        run.push(curr);
      } else {
        pushRun(run, dr, dc, runs);
        run = [curr];
      }
    }
    pushRun(run, dr, dc, runs);
  }

  return runs;
}

function pushRun(
  run: DoorCandidate[], dr: number, dc: number, out: DoorRun[]
): void {
  const corrCells = run.map(c => [c.corridorR, c.corridorC] as [number, number]);
  const cr = Math.round(run.reduce((s, c) => s + c.corridorR, 0) / run.length);
  const cc = Math.round(run.reduce((s, c) => s + c.corridorC, 0) / run.length);
  out.push({ dr, dc, wallLen: run[0].pathLen, corrCells, centerR: cr, centerC: cc });
}

export function ruleIndoorOuterDoor(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || !inputGrid.length || !inputGrid[0]?.length)
    return { error: "inputGrid is required" };

  const rows = inputGrid.length, cols = inputGrid[0].length;
  const doorWidth = typeof input.doorWidth === "number"
    ? Math.max(1, Math.min(8, Math.floor(input.doorWidth))) : 3;
  const maxDoors = typeof input.maxDoors === "number"
    ? Math.max(1, Math.floor(input.maxDoors)) : 8;
  const maxWallDepth = typeof input.maxWallDepth === "number"
    ? Math.max(1, Math.floor(input.maxWallDepth)) : 6;
  const seedRaw = typeof input.seed === "number" ? input.seed : 0;
  const rng = mulberry32(seedRaw === 0 ? Date.now() : seedRaw);

  const footprint = input.footprintGrid as number[][] | undefined;
  const fp: number[][] | null =
    footprint && footprint.length === rows && footprint[0]?.length === cols
      ? footprint : null;

  const outputGrid: number[][] = inputGrid.map(row => [...row]);

  const candidates = findDoorCandidates(outputGrid, rows, cols, fp, maxWallDepth);
  const runs = buildDoorRuns(candidates);
  if (runs.length === 0) return { outputGrid };

  const shuffled = [...runs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const placed: { r: number; c: number }[] = [];
  const minSpacing = doorWidth * 2 + 4;
  let doorsOpened = 0;

  for (const run of shuffled) {
    if (doorsOpened >= maxDoors) break;

    const tooClose = placed.some(
      p => Math.abs(p.r - run.centerR) + Math.abs(p.c - run.centerC) < minSpacing
    );
    if (tooClose) continue;

    const cells = run.corrCells;
    const n = cells.length;

    if (n < doorWidth) continue;

    const mid = Math.floor(n / 2);
    const halfW = Math.floor(doorWidth / 2);
    const startIdx = Math.max(0, Math.min(n - doorWidth, mid - halfW));
    const endIdx = startIdx + doorWidth;
    const selectedCorrCells = cells.slice(startIdx, endIdx);

    for (const [cr, cc] of selectedCorrCells) {
      let wr = cr + run.dr, wc = cc + run.dc;
      for (let step = 0; step < run.wallLen; step++) {
        if (wr < 0 || wr >= rows || wc < 0 || wc >= cols) break;
        if (outputGrid[wr][wc] === 0) {
          outputGrid[wr][wc] = 1;
        }
        wr += run.dr;
        wc += run.dc;
      }
    }

    placed.push({ r: run.centerR, c: run.centerC });
    doorsOpened++;
  }

  return { outputGrid };
}
