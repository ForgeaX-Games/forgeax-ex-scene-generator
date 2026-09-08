/**
 * heightfield_scale (HeightfieldScale):
 * Scales and smooths a discrete elevation grid (e.g. contour level index grid)
 * into a continuous heightfield with realistic vertical scale and natural slopes.
 *
 * Inputs:
 *   - grid: 2D number grid
 *   - scale: elevation multiplier in metres (default: 3.2)
 *   - base: base elevation in metres (default: 0)
 *   - smooth: whether to apply 3x3 gaussian smoothing (default: true)
 *   - exponent: shaping power curve (default: 1.0)
 *
 * Outputs:
 *   - heightGrid: continuous 2D height grid
 *   - minElevation: minimum height in grid
 *   - maxElevation: maximum height in grid
 */

export interface HeightfieldScaleInput {
  grid: unknown
  scale?: number
  base?: number
  smooth?: boolean
  exponent?: number
}

function isGrid2D(v: unknown): v is number[][] {
  return Array.isArray(v) && v.length > 0 && Array.isArray(v[0])
}

export function heightfieldScale(input: Record<string, unknown>): Record<string, unknown> {
  const rawGrid = input.grid ?? input.inputGrid ?? input.heightGrid
  if (!isGrid2D(rawGrid)) {
    return { heightGrid: [], minElevation: 0, maxElevation: 0, error: 'grid is required and must be 2D number array' }
  }

  const rows = rawGrid.length
  const cols = rawGrid[0]?.length ?? 0
  if (rows === 0 || cols === 0) {
    return { heightGrid: [], minElevation: 0, maxElevation: 0 }
  }

  const scale = Number(input.scale ?? 3.2)
  const base = Number(input.base ?? 0)
  const smooth = input.smooth !== false && input.smooth !== 'false'
  const exponent = Number(input.exponent ?? 1.0)

  // Step 1: Copy and extract numeric values
  const src: number[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const val = Number(rawGrid[r]?.[c] ?? 0)
      return Number.isFinite(val) ? val : 0
    }),
  )

  // Step 2: Optional 3x3 weighted smoothing on non-zero regions
  let smoothed: number[][] = src
  if (smooth) {
    smoothed = Array.from({ length: rows }, () => new Array(cols).fill(0))
    // 3x3 kernel weights: center 4, orthogonal 2, diagonal 1
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (src[r]![c]! === 0) {
          smoothed[r]![c] = 0
          continue
        }
        let weightedSum = 0
        let totalWeight = 0
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr
            const nc = c + dc
            if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
            const nVal = src[nr]![nc]!
            if (nVal > 0) {
              const weight = (dr === 0 && dc === 0) ? 4 : (dr === 0 || dc === 0) ? 2 : 1
              weightedSum += nVal * weight
              totalWeight += weight
            }
          }
        }
        smoothed[r]![c] = totalWeight > 0 ? weightedSum / totalWeight : src[r]![c]!
      }
    }
  }

  // Step 3: Scale and curve mapping
  let minElev = Infinity
  let maxElev = -Infinity
  const resultGrid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0))

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const val = smoothed[r]![c]!
      if (val <= 0) {
        resultGrid[r]![c] = 0
      } else {
        const shaped = Math.pow(val, exponent) * scale + base
        const rounded = Math.round(shaped * 100) / 100
        resultGrid[r]![c] = rounded
        if (rounded < minElev) minElev = rounded
        if (rounded > maxElev) maxElev = rounded
      }
    }
  }

  if (minElev === Infinity) minElev = 0
  if (maxElev === -Infinity) maxElev = 0

  return {
    heightGrid: resultGrid,
    minElevation: minElev,
    maxElevation: maxElev,
  }
}
