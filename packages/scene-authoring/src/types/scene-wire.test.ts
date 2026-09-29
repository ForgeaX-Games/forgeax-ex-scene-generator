import { describe, expect, it } from 'vitest'
import { encodeSceneDocument, decodeSceneDocument } from './scene-wire.js'
import { staticMeshAsset } from './mesh-asset.js'
import type { SceneDocument } from './scene-asset.js'

describe('native data and authoring transport', () => {
  it('preserves opaque components, mount windows, GUID bytes, LOD and morph buffers with shared views', () => {
    const buffer = new ArrayBuffer(48),
      a = new Float32Array(buffer, 8, 4),
      b = new Uint16Array(buffer, 4, 8)
    a.set([1, 2, 3, 4])
    const guid = new Uint8Array(16).fill(7)
    const doc: SceneDocument = {
      scene: {
        kind: 'scene',
        sourceKey: 'scene/test',
        skinGuids: ['skin-guid'],
        entities: [
          {
            localId: 0,
            bindingKey: 'building',
            components: { Custom: { entity: 1, asset: guid } },
          },
        ],
        mounts: [
          {
            localId: 2,
            source: 'scene/child',
            memberFirst: 3,
            memberCount: 2,
            parent: 0,
            overrides: [
              { localId: 3, comp: 'Custom', field: 'entity', value: 4 },
            ],
          },
        ],
      },
      assets: {
        mesh: {
          kind: 'mesh',
          vertices: a,
          indices: b,
          attributes: { position: a },
          submeshes: [],
          materialSlots: [],
          lods: [{ mesh: guid, screenCoverage: 0.5 }],
          morphTargets: [{ position: a }],
          morphWeights: new Float32Array([0.8]),
        },
      },
      authoring: { source: 'house.scene.ts' },
    }
    const wire = JSON.parse(JSON.stringify(encodeSceneDocument(doc)))
    const restored = decodeSceneDocument<SceneDocument>(wire),
      mesh = restored.assets.mesh as any
    expect(restored.scene).toEqual(doc.scene)
    expect(mesh.vertices.byteOffset).toBe(8)
    expect(mesh.indices.byteOffset).toBe(4)
    expect(mesh.vertices.buffer).toBe(mesh.indices.buffer)
    expect(mesh.lods[0].mesh).toBeInstanceOf(Uint8Array)
    expect(mesh.morphTargets[0].position.buffer).toBe(mesh.vertices.buffer)
    expect(wire.buffers).toHaveLength(3)
  })
  it('builds finite native tangent frames and RGBA attributes, rejecting invalid authored layout', () => {
    const asset = staticMeshAsset({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      colors: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    })
    expect(asset.vertices).toHaveLength(36)
    expect(asset.vertices.every(Number.isFinite)).toBe(true)
    expect(Array.from(asset.attributes.color as Float32Array)).toEqual([
      1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1,
    ])
    expect(() =>
      staticMeshAsset({ positions: [0, 0, 0], indices: [0, 1, 2] }),
    ).toThrow(/in-range/)
    expect(() =>
      staticMeshAsset({
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
        indices: [0, 1, 2],
        uvs: [0],
      }),
    ).toThrow(/uvs/)
  })
})
