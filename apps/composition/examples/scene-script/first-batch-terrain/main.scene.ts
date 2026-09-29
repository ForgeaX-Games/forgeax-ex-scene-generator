// @scene-module-id module.defaultScene
import { addChild, basePlane, createGrid, emptyScene, heightfield, heightfieldMesh, sceneNode, sceneOutput } from '@forgeax/scene'
import { rollHills } from './generators/roll-hills.generator.ts'

const worldWidth = 120

const world = basePlane({
  origin: [0, 0],
  width: worldWidth,
  height: 80,
})

const seed = createGrid({
  columns: 48,
  rows: 32,
  fill: 6,
})
const hills = rollHills({
  grid: seed,
  peak: 22,
  seed: 3,
})

const field = heightfield({
  geometry: world,
  height: hills.grid,
})
const mesh = heightfieldMesh({
  heightfield: field,
})
const terrain = sceneNode({
  name: 'hills',
  geometry: mesh,
})
const assembled = addChild({
  scene: emptyScene(),
  nodes: [terrain.scene],
})
sceneOutput({ scene: assembled.scene })
