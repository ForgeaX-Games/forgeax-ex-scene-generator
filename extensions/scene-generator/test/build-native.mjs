import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { deriveVertexLayoutProjection } from '@forgeax/engine/geometry'
const { default: pack } = await import(pathToFileURL(process.argv[2]).href)
assert.equal(pack.assets, undefined)
const result = await pack.build({ packageId: pack.packageId })
if (!result.ok) throw new Error(JSON.stringify(result.error))
for (const asset of Object.values(result.value)) {
  if (asset.kind !== 'mesh') continue
  const projection = deriveVertexLayoutProjection(asset.attributes)
  const vertexCount = asset.attributes.position.length / 3
  assert.equal(asset.vertices.byteLength, vertexCount * projection.arrayStride)
  const color = projection.attributes.find(attribute => attribute.key === 'color')
  if (color) {
    for (let vertex = 0; vertex < vertexCount; vertex++) {
      for (let channel = 0; channel < 4; channel++) {
        assert.equal(asset.vertices[vertex * projection.arrayStride / 4 + color.offset / 4 + channel], asset.attributes.color[vertex * 4 + channel])
      }
    }
  }
}
console.log(JSON.stringify({ schemaVersion: pack.schemaVersion, assets: result.value }))
