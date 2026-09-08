import { parsePoint2dList } from '../../../../vendor/shared/types/scene/points.js'
import { sampleHeightfieldSurface } from '../../../../vendor/shared/types/scene/heightfield.js'

export function sampleHeight(input: Record<string, unknown>): { heights: number[]; count: number; error?: string } {
  const grid = input.grid ?? input.heightGrid
  const points = parsePoint2dList(input.points)
  if (points.length === 0) return { heights: [], count: 0, error: 'points are required' }
  if (grid == null) return { heights: [], count: 0, error: 'grid is required' }
  const heights = points.map(([x, y]) => sampleHeightfieldSurface(grid, x, y))
  return { heights, count: heights.length }
}
