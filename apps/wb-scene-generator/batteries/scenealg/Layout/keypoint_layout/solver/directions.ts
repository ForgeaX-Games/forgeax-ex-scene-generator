// Orientation token → target bearing (radians, math convention: CCW from +x = east).
// World convention: x = east(+), y = north(+).

const DEG = Math.PI / 180

// Case-insensitive lookup table. Bearings: E=0, N=90, W=180, S=270 (+ diagonals).
const TABLE: Record<string, number> = {
  e: 0,
  east: 0,
  ne: 45 * DEG,
  northeast: 45 * DEG,
  n: 90 * DEG,
  north: 90 * DEG,
  nw: 135 * DEG,
  northwest: 135 * DEG,
  w: 180 * DEG,
  west: 180 * DEG,
  sw: 225 * DEG,
  southwest: 225 * DEG,
  s: 270 * DEG,
  south: 270 * DEG,
  se: 315 * DEG,
  southeast: 315 * DEG,
}

/** Resolve a direction token to a bearing in radians, or null if unknown. */
export function directionToAngle(token: string): number | null {
  const key = token.trim().toLowerCase()
  return key in TABLE ? TABLE[key] : null
}
