const root = emptyScene({})
const baseName = stringValue({ value: "Ground" })
const width = numberValue({ value: 24 })
const height = numberValue({ value: 18 })
const baseAsset = stringValue({ value: "Grass" })

const base = addBaseGrid({
  rootScene: root,
  baseName,
  width,
  height,
  baseAsset,
})

sceneOutput({ scene: base.rootScene })
