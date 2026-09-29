/**
 * Meter-based renderer coordinate contract.
 *
 * Authoring grids grow toward +Y (screen down); Three.js uses Z-up, so world Y
 * is flipped. Integer voxel/grid cells are one metre wide and Layout positions
 * are already metres.
 */
export function gridCornerToWorld(cellX: number, cellY: number): { x: number; y: number } {
  return { x: cellX, y: -cellY }
}

export function gridCellCenterToWorld(cellX: number, cellY: number): { x: number; y: number } {
  return { x: cellX + 0.5, y: -(cellY + 0.5) }
}

export function layoutToWorld(x: number, y: number): { x: number; y: number } {
  return { x, y: -y }
}
