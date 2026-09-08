/**
 * grid_mirror: Mirror (flip) a 2D grid along horizontal or vertical axis.
 * Input:  grid (grid) — source grid; axis (string) — flip mode
 * Output: grid (grid) — mirrored grid
 *
 * Convention (aligned with Photoshop / OpenCV / Unity / HTML canvas):
 *   - "horizontal" flip → left ↔ right swap  (mirror across the vertical axis)
 *   - "vertical"   flip → top  ↔ bottom swap (mirror across the horizontal axis)
 *
 * Accepted axis values (case-insensitive):
 *   - "horizontal" | "lr" | "flip_x" | "x"  → left-right flip
 *   - "vertical"   | "tb" | "flip_y" | "y"  → top-bottom flip
 *   - "both" | "xy" | "180"                 → both (equivalent to 180° rotation)
 *
 * NOTE: Prior to this fix, the semantics of "horizontal" and "vertical"
 * were inverted. Any pipeline that relied on the old behavior must swap
 * the axis value.
 */

function flipLeftRight(src: number[][]): number[][] {
  return src.map((row) => row.slice().reverse());
}

function flipTopBottom(src: number[][]): number[][] {
  return src.slice().reverse().map((row) => row.slice());
}

export function gridMirror(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const grid = input.grid as number[][] | undefined;
  if (!Array.isArray(grid) || grid.length === 0) {
    return { error: "grid is required", grid: [] };
  }

  const raw = typeof input.axis === "string" ? input.axis : "horizontal";
  const axis = raw.trim().toLowerCase();

  const isHorizontal =
    axis === "horizontal" || axis === "lr" || axis === "flip_x" || axis === "x";
  const isVertical =
    axis === "vertical" || axis === "tb" || axis === "flip_y" || axis === "y";
  const isBoth = axis === "both" || axis === "xy" || axis === "180";

  if (isBoth) {
    return { grid: flipTopBottom(flipLeftRight(grid)) };
  }
  if (isVertical) {
    return { grid: flipTopBottom(grid) };
  }
  // Default / horizontal: left-right flip (standard image-processing meaning).
  if (!isHorizontal) {
    // Unknown value — fall back to horizontal rather than silently misbehaving.
  }
  return { grid: flipLeftRight(grid) };
}
