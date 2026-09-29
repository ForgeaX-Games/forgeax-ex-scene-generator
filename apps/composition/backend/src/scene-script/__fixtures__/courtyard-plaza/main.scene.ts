// @scene-module-id module.courtyardPlaza
import { createGrid } from '@forgeax/scene'
import { growPlot } from "./generators/grow-plot.generator.ts"
import { solveCourtyard } from "./generators/solve-courtyard.generator.ts"

function pickGrid(wide: boolean) {
  if (wide) {
    return createGrid({
      columns: 32,
      rows: 24,
      fill: 0,
    })
  }
  return createGrid({
    columns: 16,
    rows: 12,
    fill: 0,
  })
}

const selected = pickGrid(true)
let grown: { grid?: unknown; state?: unknown } = selected
for (let i = 0; i < 2; i++) {
  grown = growPlot({ state: grown.grid ?? grown.state ?? grown })
}

export const courtyard = solveCourtyard({
  grid: grown.state ?? grown.grid ?? grown,
  fail: 0,
})
