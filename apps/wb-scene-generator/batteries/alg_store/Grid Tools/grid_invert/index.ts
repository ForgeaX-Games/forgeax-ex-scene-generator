/**
 * grid_invert: Invert a binary 2D grid — swap 0s and 1s.
 * Input:  grid (grid) — binary grid
 * Output: grid (grid) — inverted binary grid
 */

function invertBinaryGrid(src: number[][]): number[][] {
  return src.map((row) => row.map((v) => (v === 0 ? 1 : 0)));
}

export function gridInvert(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!Array.isArray(grid) || grid.length === 0) {
    return { error: "grid is required", grid: [] };
  }

  return { grid: invertBinaryGrid(grid) };
}
