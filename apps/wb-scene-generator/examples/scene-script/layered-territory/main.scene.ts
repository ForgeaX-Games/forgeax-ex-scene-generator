// @scene-module-id module.layeredTerritory
// Live Continent → Valley → Plaza. Children author local metres.
// Continent is a 2048 m frame (not a 4M-cell heightfield). Valley sits at
// local (0,0)–(128,128) — the identity corner — so zooming out shows how
// small 128 m is on a 2 km board. place() will later move it to [960, 960].

import { valley } from "./valley.scene.ts"

const continentRoot = scopeSceneNode({
  name: "Continent",
  schema: "scope",
})

const continentFrame = controlPoints({
  points: [[0, 0], [2048, 0], [2048, 2048], [0, 2048], [0, 0]],
})

const valleyFrame = controlPoints({
  points: [[0, 0], [128, 0], [128, 128], [0, 128], [0, 0]],
})

const plazaFrame = controlPoints({
  points: [[60, 54], [84, 54], [84, 78], [60, 78], [60, 54]],
})

const continentRiver = controlPoints({
  points: [[800, 1000], [960, 1012], [1088, 1014], [1400, 1040]],
})

const continentFrameGuide = pointsToNode({
  name: "ContinentFrame",
  points: continentFrame.points,
  style: "polyline",
})

const valleyFrameGuide = pointsToNode({
  name: "ValleyFrame",
  points: valleyFrame.points,
  style: "polyline",
})

const plazaFrameGuide = pointsToNode({
  name: "PlazaFrame",
  points: plazaFrame.points,
  style: "polyline",
})

const continentRiverGuide = pointsToNode({
  name: "ContinentRiver",
  points: continentRiver.points,
  style: "polyline",
})

const withContinentFrame = addSceneChildren({
  scene: continentRoot.scene,
  nodes: continentFrameGuide.scene,
})
const withValleyFrame = addSceneChildren({
  scene: withContinentFrame.scene,
  nodes: valleyFrameGuide.scene,
})
const withPlazaFrame = addSceneChildren({
  scene: withValleyFrame.scene,
  nodes: plazaFrameGuide.scene,
})
const withContinentRiver = addSceneChildren({
  scene: withPlazaFrame.scene,
  nodes: continentRiverGuide.scene,
})
const assembled = addSceneChildren({
  scene: withContinentRiver.scene,
  nodes: valley.scene,
})

sceneOutput({
  scene: assembled.scene,
})
