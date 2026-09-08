// Atomic pilot: parameters, typed references, scene composition and a
// DataTree dynamic-port call. This source is intentionally small enough to
// inspect as the canonical authoring equivalent of the runtime graph.
const root = emptyScene({})
const width = numberValue({ value: 12 })
const height = numberValue({ value: 8 })
const fill = numberValue({ value: 1 })
const name = stringValue({ value: "Pilot ground" })
const asset = stringValue({ value: "Grass" })
const enabled = booleanValue({ value: true })
const sceneSeed = seed({ seed: 42 })

const grid = rectangularGrid({ width, height, fillValue: fill })
const voxel = gridSceneNode({ name, grid: grid.grid, token: asset })
const composed = addSceneChildren({ scene: root, nodes: [voxel.scene] })

const pointA = manualPoint({ x: 2, y: 3 })
const pointB = manualPoint({ x: 8, y: 5 })
const points = mergePoints({ items: [pointA.point, pointB.point] })

sceneOutput({ scene: composed.scene })
