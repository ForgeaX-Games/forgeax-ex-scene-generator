/**
 * rule_indoor_wall_grid
 *
 * Extracts interior walls from the processed grid as a separate grid output.
 * Uses the original building footprint to distinguish interior walls from
 * exterior cells (both have value 0 in the processed grid).
 *
 * Interior wall: processedGrid == 0 AND footprint != 0
 *
 * Outputs both a pass-through grid (outputGrid) and a wall-only grid (wallGrid).
 */

export function ruleIndoorWallGrid(
  input: Record<string, unknown>
): Record<string, unknown> {
  const inputGrid = input.inputGrid as number[][] | undefined;
  if (!inputGrid || !inputGrid.length || !inputGrid[0]?.length)
    return { error: "inputGrid is required" };

  const rows = inputGrid.length, cols = inputGrid[0].length;
  const wallValue = typeof input.wallValue === "number"
    ? Math.max(1, Math.floor(input.wallValue)) : 3;

  const footprint = input.footprintGrid as number[][] | undefined;

  const wallGrid: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0)
  );

  if (footprint && footprint.length === rows && footprint[0]?.length === cols) {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (inputGrid[r][c] === 0 && footprint[r][c] !== 0)
          wallGrid[r][c] = wallValue;
  } else {
    const isExterior = floodExterior(inputGrid, rows, cols);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if (inputGrid[r][c] === 0 && !isExterior[r][c])
          wallGrid[r][c] = wallValue;
  }

  return { outputGrid: inputGrid, wallGrid };
}

function floodExterior(
  grid: number[][], rows: number, cols: number
): boolean[][] {
  const ext = Array.from({ length: rows }, () =>
    new Array<boolean>(cols).fill(false)
  );
  const queue: [number, number][] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r === 0 || r === rows - 1 || c === 0 || c === cols - 1) && grid[r][c] === 0) {
        ext[r][c] = true;
        queue.push([r, c]);
      }
    }
  }

  let head = 0;
  while (head < queue.length) {
    const [r, c] = queue[head++];
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (ext[nr][nc] || grid[nr][nc] !== 0) continue;
      ext[nr][nc] = true;
      queue.push([nr, nc]);
    }
  }
  return ext;
}
