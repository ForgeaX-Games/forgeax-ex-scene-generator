/** Coordinate hash from archived field_noise. Same constants; no region / mask. */
export function hashCell(row: number, column: number, seed: number): number {
  let h = seed ^ (row * 374761393) ^ (column * 668265263)
  h = (Math.imul(h, 1540483477) + 0x6b43a9b5) >>> 0
  h = (h ^ (h >>> 15)) >>> 0
  h = Math.imul(h, 0x85ebca77) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 0xc2b2ae3d) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 0x100000000
}
