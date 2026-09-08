// @scene-module-id module.courtyardPlaza
import { growPlot } from "./generators/grow-plot.generator.ts"
import { solveCourtyard } from "./generators/solve-courtyard.generator.ts"

const root = emptyScene({})

const widePlane = basePlane({
  width: 64,
  height: 48,
})

const narrowPlane = basePlane({
  width: 32,
  height: 24,
})

const wide = workGrid({
  plane: widePlane.plane,
  cellSize: 2,
})

const narrow = workGrid({
  plane: narrowPlane.plane,
  cellSize: 2,
})

const flag = booleanValue({ value: true })

const selected = choose({
  when: flag.value,
  then: wide.grid,
  otherwise: narrow.grid,
})

const grown = repeat({
  count: 2,
  initial: selected.value,
  step: growPlot,
})

const courtyard = solveCourtyard({
  grid: grown.state,
  fail: 0,
})

const named = scopeSceneNode({
  name: "Courtyard",
  schema: "scope",
})

const placed = place({
  scene: root.scene,
  child: named.scene,
  name: "Courtyard",
})

sceneOutput({ scene: placed.scene })
