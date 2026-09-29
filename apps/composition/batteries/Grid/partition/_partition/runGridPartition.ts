import { gridSize, readGrid } from '../../_shared/lattice.ts'

function connectivityOf(input: Record<string, unknown>): 4 | 8 {
  const raw = Number(input.connectivity)
  return raw === 4 ? 4 : 8
}

function neighbors(col: number, row: number, connectivity: 4 | 8): Array<[number, number]> {
  const out: Array<[number, number]> = [
    [col - 1, row],
    [col + 1, row],
    [col, row - 1],
    [col, row + 1],
  ]
  if (connectivity === 8) {
    out.push(
      [col - 1, row - 1],
      [col + 1, row - 1],
      [col - 1, row + 1],
      [col + 1, row + 1],
    )
  }
  return out
}

export function runGridComponents(input: Record<string, unknown>): {
  grid?: number[][]
  error?: string
} {
  const grid = readGrid(input.grid)
  if (!grid) return { error: 'gridComponents requires a Grid' }
  const { rows, columns } = gridSize(grid)
  const connectivity = connectivityOf(input)
  const ids = Array.from({ length: rows }, () => Array.from({ length: columns }, () => 0))
  let next = 0
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      if (!(Number(grid[j]?.[i]) > 0) || ids[j]![i] !== 0) continue
      next += 1
      const queue: Array<[number, number]> = [[i, j]]
      ids[j]![i] = next
      let head = 0
      while (head < queue.length) {
        const [col, row] = queue[head]!
        head++
        for (const [nc, nr] of neighbors(col, row, connectivity)) {
          if (nc < 0 || nr < 0 || nc >= columns || nr >= rows) continue
          if (!(Number(grid[nr]?.[nc]) > 0) || ids[nr]![nc] !== 0) continue
          ids[nr]![nc] = next
          queue.push([nc, nr])
        }
      }
    }
  }
  return { grid: ids }
}
