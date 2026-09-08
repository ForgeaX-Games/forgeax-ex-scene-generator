/**
 * complex_indoor_cleanup
 * Post-processing battery that fixes visual artifacts:
 * 1. Fixes oversized doors (doors spanning entire shared wall)
 * 2. Smooths outer contour (fills missing corners and single-cell notches)
 * 3. Removes orphan/floating wall cells not serving as room boundaries
 * 4. Removes thin wall protrusions into void
 * 5. Removes isolated wall chains disconnected from rooms
 */

const VOID = 0;
const WALL = 1;

export function complexIndoorCleanup(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || inputGrid.length === 0) return { error: "inputGrid is required" };

  const grid = inputGrid.map(row => [...row]);
  const H = grid.length;
  const W = grid[0].length;

  const nameListRaw = input.nameList as { id: number; name: string }[] | undefined;
  const nameList = Array.isArray(nameListRaw) ? nameListRaw.map(n => ({ ...n })) : [];

  const doorEntry = nameList.find(n => n.name === "门");
  const doorVal = doorEntry ? doorEntry.id : -1;

  // Step 1: Fix oversized doors — ensure wall remains at ends of door openings
  if (doorVal > 0) {
    fixOversizedDoors(grid, H, W, doorVal);
  }

  // Step 2: Smooth outer contour — fill missing corners and single-cell notches
  smoothOuterContour(grid, H, W);

  // Step 3: Remove orphan wall cells (not adjacent to any room interior)
  removeOrphanWalls(grid, H, W);

  // Step 4: Remove thin wall protrusions (wall cells exposed to void on 3+ sides)
  for (let pass = 0; pass < 5; pass++) {
    if (!removeThinWallProtrusions(grid, H, W)) break;
  }

  // Step 5: Remove floating wall chains disconnected from all room interiors
  removeFloatingWallChains(grid, H, W);

  // Rebuild nameList from actual grid values
  const usedVals = new Set<number>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== VOID) usedVals.add(grid[y][x]);
    }
  }
  const finalNameList = nameList.filter(n => n.id === 0 || usedVals.has(n.id));
  if (!finalNameList.some(n => n.id === 0)) {
    finalNameList.unshift({ id: 0, name: "空地" });
  }

  return {
    outputGrid: grid,
    nameList: finalNameList,
  };
}

function neighbors4(y: number, x: number): [number, number][] {
  return [[y - 1, x], [y + 1, x], [y, x - 1], [y, x + 1]];
}

/**
 * Fix doors that span the entire shared wall between two rooms,
 * leaving no wall at the edges. For each contiguous door segment,
 * convert outermost door cells back to wall if needed.
 */
function fixOversizedDoors(grid: number[][], H: number, W: number, doorVal: number): void {
  const visited = Array.from({ length: H }, () => new Array(W).fill(false));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== doorVal || visited[y][x]) continue;

      // BFS to find contiguous door segment
      const segment: [number, number][] = [];
      const queue: [number, number][] = [[y, x]];
      visited[y][x] = true;

      while (queue.length > 0) {
        const [cy, cx] = queue.shift()!;
        segment.push([cy, cx]);
        for (const [ny, nx] of neighbors4(cy, cx)) {
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && !visited[ny][nx] && grid[ny][nx] === doorVal) {
            visited[ny][nx] = true;
            queue.push([ny, nx]);
          }
        }
      }

      if (segment.length <= 2) continue;

      // Determine orientation (horizontal or vertical)
      const ys = segment.map(c => c[0]);
      const xs = segment.map(c => c[1]);
      const yRange = Math.max(...ys) - Math.min(...ys);
      const xRange = Math.max(...xs) - Math.min(...xs);

      // Sort by the primary axis
      if (xRange >= yRange) {
        segment.sort((a, b) => a[1] - b[1]);
      } else {
        segment.sort((a, b) => a[0] - b[0]);
      }

      // Check if end cells should be reverted to wall
      // A door end should have wall if it's at the edge of the room boundary
      for (const endIdx of [0, segment.length - 1]) {
        const [ey, ex] = segment[endIdx];
        // Check if this end cell is at the boundary of two rooms
        const adjRooms = new Set<number>();
        for (const [ny, nx] of neighbors4(ey, ex)) {
          if (ny >= 0 && ny < H && nx >= 0 && nx < W) {
            const v = grid[ny][nx];
            if (v > WALL && v !== doorVal) adjRooms.add(v);
          }
        }
        // If this door end touches two room interiors directly,
        // and is at the edge, convert it back to wall
        if (adjRooms.size >= 2 || segment.length > 2) {
          grid[ey][ex] = WALL;
        }
      }

      // After trimming ends, if all door cells were converted, restore center
      let doorCount = 0;
      for (const [sy, sx] of segment) {
        if (grid[sy][sx] === doorVal) doorCount++;
      }
      if (doorCount === 0 && segment.length >= 3) {
        const mid = Math.floor(segment.length / 2);
        grid[segment[mid][0]][segment[mid][1]] = doorVal;
        if (mid + 1 < segment.length) {
          grid[segment[mid + 1][0]][segment[mid + 1][1]] = doorVal;
        }
      }
    }
  }
}

/**
 * Smooth the building's outer contour by filling single-cell notches
 * and missing corners. A void cell is filled with WALL if:
 *   (a) it has 3+ non-void cardinal neighbors (single-cell notch), or
 *   (b) it is the only void cell in a 2x2 block (missing corner), or
 *   (c) it is a 1-wide gap between two non-void regions on the same axis.
 * Multiple passes handle cascading fills.
 */
function smoothOuterContour(grid: number[][], H: number, W: number): void {
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (grid[y][x] !== VOID) continue;

        // (a) 3+ non-void cardinal neighbors → single-cell notch
        let nonVoidCard = 0;
        for (const [ny, nx] of neighbors4(y, x)) {
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] !== VOID) {
            nonVoidCard++;
          }
        }
        if (nonVoidCard >= 3) {
          grid[y][x] = WALL;
          changed = true;
          continue;
        }

        // (b) Only void cell in a 2x2 block → missing corner
        let filled = false;
        for (const [dy, dx] of [[0, 0], [0, -1], [-1, 0], [-1, -1]]) {
          const by = y + dy, bx = x + dx;
          if (by < 0 || by + 1 >= H || bx < 0 || bx + 1 >= W) continue;

          const cells: [number, number][] = [[by, bx], [by, bx + 1], [by + 1, bx], [by + 1, bx + 1]];
          let voidCount = 0;
          for (const [cy, cx] of cells) {
            if (grid[cy][cx] === VOID) voidCount++;
          }
          if (voidCount === 1) {
            grid[y][x] = WALL;
            changed = true;
            filled = true;
            break;
          }
        }
        if (filled) continue;

        // (c) 1-wide gap: void has non-void on both sides of the same axis
        const up    = y > 0     && grid[y - 1][x] !== VOID;
        const down  = y < H - 1 && grid[y + 1][x] !== VOID;
        const left  = x > 0     && grid[y][x - 1] !== VOID;
        const right = x < W - 1 && grid[y][x + 1] !== VOID;
        if ((up && down && !left && !right) || (left && right && !up && !down)) {
          grid[y][x] = WALL;
          changed = true;
        }
      }
    }

    if (!changed) break;
  }
}

/**
 * Remove wall cells that are NOT adjacent to any room interior (value > 1).
 * These are "orphan" walls floating in void or only touching other walls.
 */
function removeOrphanWalls(grid: number[][], H: number, W: number): void {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== WALL) continue;

      let touchesRoom = false;
      for (const [ny, nx] of neighbors4(y, x)) {
        if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] > WALL) {
          touchesRoom = true;
          break;
        }
      }
      if (!touchesRoom) {
        // Also check diagonal neighbors
        let touchesDiag = false;
        for (const [dy, dx] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] > WALL) {
            touchesDiag = true;
            break;
          }
        }
        if (!touchesDiag) {
          grid[y][x] = VOID;
        }
      }
    }
  }
}

/**
 * Remove wall cells that protrude into void (touching void on 3+ cardinal sides).
 * Returns true if any cells were removed.
 */
function removeThinWallProtrusions(grid: number[][], H: number, W: number): boolean {
  let changed = false;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== WALL) continue;

      let voidCount = 0;
      let roomCount = 0;
      for (const [ny, nx] of neighbors4(y, x)) {
        if (ny < 0 || ny >= H || nx < 0 || nx >= W) {
          voidCount++;
        } else if (grid[ny][nx] === VOID) {
          voidCount++;
        } else if (grid[ny][nx] > WALL) {
          roomCount++;
        }
      }

      // Wall cell touching void on 3+ sides and not separating rooms
      if (voidCount >= 3 && roomCount === 0) {
        grid[y][x] = VOID;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Find connected components of wall cells. If a component doesn't
 * touch any room interior cell, remove it entirely.
 */
function removeFloatingWallChains(grid: number[][], H: number, W: number): void {
  const visited = Array.from({ length: H }, () => new Array(W).fill(false));

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x] !== WALL || visited[y][x]) continue;

      // BFS to find connected wall component
      const component: [number, number][] = [];
      const queue: [number, number][] = [[y, x]];
      visited[y][x] = true;
      let touchesRoom = false;

      while (queue.length > 0) {
        const [cy, cx] = queue.shift()!;
        component.push([cy, cx]);

        for (const [ny, nx] of neighbors4(cy, cx)) {
          if (ny < 0 || ny >= H || nx < 0 || nx >= W) continue;
          if (grid[ny][nx] > WALL) {
            touchesRoom = true;
          }
          if (grid[ny][nx] === WALL && !visited[ny][nx]) {
            visited[ny][nx] = true;
            queue.push([ny, nx]);
          }
        }
      }

      if (!touchesRoom) {
        for (const [cy, cx] of component) {
          grid[cy][cx] = VOID;
        }
      }
    }
  }
}
