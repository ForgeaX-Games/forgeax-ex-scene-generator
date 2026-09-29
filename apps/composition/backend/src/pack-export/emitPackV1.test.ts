import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import * as bridge from './engineBridge.js'
import { deriveAssetGuid } from './identity.js'
import { emitPackSource } from './emitPack.js'

const packageUuid = '01900000-0000-7000-8000-000000000202'
const image = { width: 1, height: 1, rgba8: '/////w==', colorSpace: 'srgb' as const }
function fixture() {
  const projection = bridge.projectScene({ focus: 'root', graph: { root: { id: 'root', name: 'Parent', children: { a: 'a' } }, a: {
    id: 'a', name: 'A', parent: 'root', transform: { pos: [2, 3, 4] },
    content: { schema: 'mesh', mesh: { positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2, 0,2,1], material: {
      id: 'wall', palette: [{ baseColor: [1,1,1,1], baseColorTexture: image }, { baseColor: [1,1,1,.5], baseColorTexture: { ...image, scale: [2,2] } }],
      runs: [{ surface: 0, indexOffset: 0, indexCount: 3 }, { surface: 1, indexOffset: 3, indexCount: 3 }],
    } } },
  } } })
  const entity = projection.entities.find(e => e.mesh)!
  return { ...projection, entities: [...projection.entities, { ...entity, name: 'B', slug: 'b' }] }
}

describe('v1 native emitter', () => {
  it('declares exact shared meshes/materials/textures, stable GUIDs and no generation at initialization', async () => {
    const projection = fixture()
    const source = emitPackSource({ schemaVersion: '1.0.0', projection, packageUuid, sceneSlug: 'ignored', sceneKey: 'scene/stable', packName: 'fixture', args: [{ width: 7 }], includeDefaultLighting: false })
    expect(source).not.toContain('@forgeax/engine/')
    expect(source).not.toContain('definePack')
    expect(source).toContain("from '@forgeax/engine-pack/source'")
    let generations = 0
    const modules: Record<string, unknown> = {
      '@forgeax/engine-pack/guid': { AssetGuid: { parse: (value: unknown) => ({ ok: true, value }), format: (value: unknown) => value } },
      '@forgeax/engine-geometry': { meshFromInterleaved: () => ({ ok: true, value: { kind: 'mesh', attributes: {} } }) },
      '@forgeax/engine-render': { Materials: { standard: (value: unknown) => ({ kind: 'material', ...value as object }) } },
      '@forgeax/engine-scene': {}, '@forgeax/engine-types': { ok: (value: unknown) => ({ ok: true, value }) },
      './platform/engineBridge.ts': { ...bridge, projectScene: () => projection },
      './build-scene.ts': { generateScene: async (args: unknown) => { expect(args).toEqual([{ width: 7 }]); generations++; return {} } },
    }
    const javascript = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const exports: Record<string, any> = {}
    new Function('require', 'exports', javascript)((id: string) => { if (!(id in modules)) throw new Error('Unexpected dependency: '+id); return modules[id] }, exports)
    const pack = exports.default
    expect(generations).toBe(0)
    expect(pack.schemaVersion).toBe('1.0.0')
    expect(pack.externalAssets).toEqual({})
    expect(pack.parameters).toBeUndefined()
    const built = await pack.build({ readByGuid: () => { throw new Error('must not read assets') } })
    expect(generations).toBe(1)
    expect(built.ok).toBe(true)
    expect(Object.keys(pack.assets).sort()).toEqual(Object.keys(built.value).sort())
    expect(Object.keys(pack.assets).filter(k => k.startsWith('mesh/'))).toHaveLength(1)
    expect(Object.keys(pack.assets).filter(k => k.startsWith('material/'))).toHaveLength(2)
    expect(Object.keys(pack.assets).filter(k => k.startsWith('texture/'))).toHaveLength(1)
    for (const [key, declaration] of Object.entries<any>(pack.assets)) {
      expect(declaration).toEqual({ guid: deriveAssetGuid(packageUuid, key), kind: built.value[key].kind, name: expect.any(String) })
    }
    const entities = built.value['scene/stable'].entities
    expect(entities).toHaveLength(projection.entities.length+1)
    expect(entities[2].components.Transform.pos).toEqual([2,3,4])
    expect(entities[2].components.ChildOf.parent).toBe(1)
    expect(entities[2].components.MeshFilter).toEqual(entities[3].components.MeshFilter)
    expect([...built.value['texture/surface-0'].data]).toEqual([255,255,255,255])
    expect(built.value['sampler/surface-repeat'].addressModeU).toBe('repeat')
  })
  it('requires projection, rejects parameterized v1 and invalid targets, and preserves v2 default', () => {
    const options = { packageUuid, sceneSlug: 'test', packName: 'fixture' }
    expect(() => emitPackSource({ ...options, schemaVersion: '1.0.0' })).toThrow(/projection/)
    expect(() => emitPackSource({ ...options, schemaVersion: '1.0.0', projection: fixture(), parameters: [{ name: 'width' }] })).toThrow(/fixed args/)
    expect(() => emitPackSource({ ...options, schemaVersion: null as never })).toThrow(/schemaVersion/)
    expect(emitPackSource(options)).toContain("schemaVersion: '2.0.0'")
    expect(emitPackSource(options)).toContain('export default definePack(')
  })
})
