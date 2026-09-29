import { GridLcg, clampInt, filledGrid, normalize01, unwrapNumber } from './grid.ts'

export interface FractalInitArgs {
  power: number
  roughness: number
  initHeight: number
  spread: number
  seed: number
}

export function readFractalArgs(input: Record<string, unknown>): FractalInitArgs {
  return {
    power: clampInt(unwrapNumber(input.power, 6), 2, 10, 6),
    roughness: Math.min(1, Math.max(0, unwrapNumber(input.roughness, 0.5))),
    initHeight: unwrapNumber(input.initHeight, 0.5),
    spread: unwrapNumber(input.spread, 1),
    seed: unwrapNumber(input.seed, 0),
  }
}

function seedCorners(grid: number[][], size: number, initHeight: number): void {
  grid[0][0] = initHeight
  grid[0][size - 1] = initHeight
  grid[size - 1][0] = initHeight
  grid[size - 1][size - 1] = initHeight
}

/** Diamond-square. Lattice is always (2^power + 1)². */
export function diamondSquare(input: Record<string, unknown>): number[][] {
  const { power, roughness, initHeight, spread, seed } = readFractalArgs(input)
  const size = (1 << power) + 1
  const grid = filledGrid(size, size, 0)
  const rng = new GridLcg(seed)
  seedCorners(grid, size, initHeight)

  let step = size - 1
  let scale = spread
  while (step > 1) {
    const half = step >> 1
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        const avg = (
          grid[y][x]
          + grid[y][x + step]
          + grid[y + step][x]
          + grid[y + step][x + step]
        ) * 0.25
        grid[y + half][x + half] = avg + rng.float() * scale
      }
    }
    for (let y = 0; y < size; y += half) {
      const xStart = (y + half) % step === 0 ? 0 : half
      for (let x = xStart; x < size; x += step) {
        let sum = 0
        let count = 0
        if (y >= half) { sum += grid[y - half][x]; count++ }
        if (y + half < size) { sum += grid[y + half][x]; count++ }
        if (x >= half) { sum += grid[y][x - half]; count++ }
        if (x + half < size) { sum += grid[y][x + half]; count++ }
        grid[y][x] = sum / count + rng.float() * scale
      }
    }
    scale *= 2 ** -roughness
    step = half
  }
  return normalize01(grid)
}

/** Midpoint displacement. Same lattice as diamond-square; edges use two endpoints. */
export function midpointDisplacement(input: Record<string, unknown>): number[][] {
  const { power, roughness, initHeight, spread, seed } = readFractalArgs(input)
  const size = (1 << power) + 1
  const grid = filledGrid(size, size, 0)
  const rng = new GridLcg(seed)
  seedCorners(grid, size, initHeight)

  let step = size - 1
  let scale = spread
  while (step > 1) {
    const half = step >> 1
    for (let y = 0; y < size; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        grid[y][x + half] = (grid[y][x] + grid[y][x + step]) * 0.5 + rng.float() * scale
      }
    }
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size; x += step) {
        grid[y + half][x] = (grid[y][x] + grid[y + step][x]) * 0.5 + rng.float() * scale
      }
    }
    for (let y = 0; y < size - 1; y += step) {
      for (let x = 0; x < size - 1; x += step) {
        grid[y + half][x + half] = (
          grid[y][x + half]
          + grid[y + step][x + half]
          + grid[y + half][x]
          + grid[y + half][x + step]
        ) * 0.25 + rng.float() * scale
      }
    }
    scale *= 2 ** -roughness
    step = half
  }
  return normalize01(grid)
}
