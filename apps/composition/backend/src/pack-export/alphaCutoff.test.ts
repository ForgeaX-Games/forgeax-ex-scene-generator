import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { defineMaterial, paintSurfaceMesh } from '../../../vendor/shared/types/scene/surfacePaint.js'
import * as bridge from './engineBridge.js'
import { fingerprintProjection, firstDifference } from './fingerprint.js'
import { emitPackSource } from './emitPack.js'

const geometry = { positions: [0,0,0, 1,0,0, 0,1,0], indices: [0,1,2] }
const image = { width: 1, height: 1, rgba8: '////gA==', colorSpace: 'srgb' as const }
function scene(alphaCutoff?: number) {
  return { focus: 'a', graph: { a: { id: 'a', content: { schema: 'mesh', mesh: {
    ...geometry, material: { id: 'leaf', surface: { baseColor: [1,1,1,.8], baseColorTexture: image, normalTexture: { ...image, colorSpace: 'linear' as const }, alphaCutoff } },
  } } } } }
}

describe('portable alpha cutoff', () => {
  it('preserves threshold through painting and projection without deduping distinct cutouts', () => {
    const painted = paintSurfaceMesh({ ...geometry, indices: [0,1,2,0,2,1] }, defineMaterial({
      name: 'leaf', surface: s => ({ baseColor: [1,1,1,1], alphaCutoff: s.triangle ? .7 : .3 }),
    }))
    expect(painted.mesh.material?.palette?.map(s => s.alphaCutoff)).toEqual([.3,.7])
    const projection = bridge.projectScene({ focus: 'a', graph: { a: { id: 'a', content: { schema: 'mesh', mesh: painted.mesh } } } })
    expect(projection.materials.map(m => m.surface.alphaCutoff)).toEqual([.3,.7])
    expect(firstDifference(fingerprintProjection(bridge.projectScene(scene(.3))), fingerprintProjection(bridge.projectScene(scene(.7))))).toMatch(/material/)
  })
  it.each([-1, 1.01, NaN, Infinity, '0.5'])('rejects invalid threshold %s at both authoring entrances', value => {
    expect(() => bridge.projectScene(scene(value as number))).toThrow(/alphaCutoff/)
    expect(() => paintSurfaceMesh(geometry, defineMaterial({ name: 'leaf', surface: () => ({ baseColor: [1,1,1,1], alphaCutoff: value as number }) }))).toThrow(/alphaCutoff/)
  })
  it.each(['1.0.0', '2.0.0'] as const)('executes %s with cutout, opaque, and blend states and matching declarations', async schemaVersion => {
    const base = bridge.projectScene(scene(.5))
    const projection = { ...base, materials: [...base.materials,
      { key: 'opaque', surface: { baseColor: [1,1,1,1] as const, roughness: .8, metallic: 0 } },
      { key: 'blend', surface: { baseColor: [1,1,1,.8] as const, roughness: .8, metallic: 0, alphaCutoff: 0 } },
    ] }
    const source = emitPackSource({ schemaVersion, projection, packageUuid: '01900000-0000-7000-8000-000000000202', sceneSlug: 'test', packName: 'test', includeDefaultLighting: false })
    const ok = (value: unknown) => ({ ok: true, value })
    const guid = { AssetGuid: { parse: ok, format: (value: unknown) => value, derive: (_: unknown, key: string) => key } }
    const modules: Record<string, unknown> = {
      '@forgeax/engine-pack/guid': guid, '@forgeax/engine/pack/guid': guid,
      '@forgeax/engine-geometry': { meshFromInterleaved: () => ok({ kind: 'mesh', attributes: {} }) },
      '@forgeax/engine-render': { Materials: { standard: (value: object) => ({ kind: 'material', ...value }) } },
      '@forgeax/engine-scene': {}, '@forgeax/engine-types': { ok },
      '@forgeax/engine/pack/source': { ...guid, definePack: (value: unknown) => value, definePackageId: (value: unknown) => value },
      './platform/engineBridge.ts': { ...bridge, projectScene: () => projection }, [`./build-scene.${schemaVersion === '1.0.0' ? 'ts' : 'mjs'}`]: { generateScene: async () => ({}) },
    }
    for (const suffix of ['geometry', 'render', 'scene', 'types']) modules['@forgeax/engine/'+suffix] = modules['@forgeax/engine-'+suffix]
    const exports: Record<string, any> = {}
    new Function('require', 'exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(
      (id: string) => { if (!(id in modules)) throw new Error('Unexpected dependency '+id); return modules[id] }, exports)
    const pack = exports.default
    const built = await pack.build({ packageId: new Uint8Array(16) })
    expect(built.ok).toBe(true)
    const textures = Object.values(built.value).filter((asset: any) => asset.kind === 'texture')
    expect(textures).toHaveLength(2)
    const dimensions = schemaVersion === '1.0.0' ? { width: 1, height: 1, mipmap: true }
      : { shape: { viewDimension: '2d', extent: { width: 1, height: 1 } }, mips: { kind: 'generate' } }
    expect(textures).toEqual(expect.arrayContaining([
      expect.objectContaining({ ...dimensions, format: 'rgba8unorm-srgb', colorSpace: 'srgb', data: new Uint8Array([255,255,255,128]) }),
      expect.objectContaining({ ...dimensions, format: 'rgba8unorm', colorSpace: 'linear', data: new Uint8Array([255,255,255,128]) }),
    ]))
    const leaf = built.value['material/'+projection.materials[0]!.key]
    expect(leaf).toMatchObject({ alphaCutoff: .5, queue: 2450, renderState: { depthWriteEnabled: true, cullMode: 'none' }, baseColorTexture: { sampler: expect.any(String) } })
    expect(leaf.castShadow).not.toBe(false)
    expect(leaf.renderState.blend).toBeUndefined()
    expect(built.value['material/opaque'].renderState).toBeUndefined()
    expect(built.value['material/blend']).toMatchObject({ alphaCutoff: 0, queue: 3000, castShadow: false, renderState: { depthWriteEnabled: false } })
    if (schemaVersion === '1.0.0') expect(Object.keys(pack.assets).sort()).toEqual(Object.keys(built.value).sort())
  })
})
