/**
 * connected_components: Label connected components of non-zero cells in a 2D grid.
 * Input:  grid (grid), connectivity (string "4"|"8")
 * Output: grid (grid) — labeled, numComponents (number)
 */

const DIR4 = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
];
const DIR8 = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function labelComponents(
  src: number[][],
  dirs: number[][],
): { labeled: number[][]; count: number } {
  const rows = src.length;
  const cols = src[0].length;
  const labeled: number[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(0),
  );

  let componentId = 0;
  const queue: number[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (src[r][c] === 0 || labeled[r][c] !== 0) continue;

      componentId++;
      labeled[r][c] = componentId;
      queue.push(r, c);

      while (queue.length > 0) {
        const qc = queue.pop()!;
        const qr = queue.pop()!;
        for (const [dr, dc] of dirs) {
          const nr = qr + dr;
          const nc = qc + dc;
          if (
            nr >= 0 && nr < rows &&
            nc >= 0 && nc < cols &&
            src[nr][nc] !== 0 &&
            labeled[nr][nc] === 0
          ) {
            labeled[nr][nc] = componentId;
            queue.push(nr, nc);
          }
        }
      }
    }
  }

  return { labeled, count: componentId };
}

export function connectedComponents(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!Array.isArray(grid) || grid.length === 0) {
    return { error: "grid is required" };
  }

  const conn = typeof input.connectivity === "string" ? input.connectivity : "4";
  const dirs = conn === "8" ? DIR8 : DIR4;

  const { labeled, count } = labelComponents(grid, dirs);

  return { grid: labeled, numComponents: count };
}
