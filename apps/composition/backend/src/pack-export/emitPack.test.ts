import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { exportSceneModulePack } from './moduleExport.js'

const repo = resolve(import.meta.dirname, '../../../../..')
const scratch = resolve(repo, '.scratch-repro/native-pack')
const tsx = createRequire(resolve(repo, 'apps/composition/backend/package.json')).resolve('tsx')

describe('Engine 0.2.1 native scene publication', () => {
  it('builds named entities, parent references, native materials, and optional lighting', async () => {
    mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(resolve(scratch, 'consumer-'))
    writeFileSync(resolve(root, 'package.json'), JSON.stringify({ type: 'module' }))
    const sourceDir = resolve(repo, 'extensions/scene-generator/test')
    for (const lighting of [undefined, true, false]) {
      const exported = await exportSceneModulePack({
        sourceDir, entryFile: 'native.scene.ts', destination: resolve(root, String(lighting)),
        packageId: '01900000-0000-7000-8000-000000000203', includeDefaultLighting: lighting,
      })
      const report = JSON.parse(execFileSync(process.execPath, [
        '--import', tsx, resolve(repo, 'extensions/scene-generator/test/build-native.mjs'),
        resolve(exported.path, exported.packFile),
      ], { cwd: repo, encoding: 'utf8' }))
      expect(report.schemaVersion).toBe('2.0.0')
      const scene = report.assets[exported.sceneKey]
      expect(Array.isArray(scene.entities)).toBe(false)
      const building = Object.values(scene.entities).find((entity: any) => entity.components.Name?.value === 'Building') as any
      const glass = Object.values(scene.entities).find((entity: any) => entity.components.Name?.value === 'Glass') as any
      expect(building.components.ChildOf.parent).toBe('axis-root')
      expect(scene.entities[glass.components.ChildOf.parent]).toBe(building)
      expect(building.localId).toBeUndefined()
      expect(building.bindingKey).toBeUndefined()
      expect(scene.entities['axis-root'].components.Transform.quat).toHaveLength(4)
      expect(Object.values(scene.entities).filter((entity: any) => entity.components.DirectionalLight || entity.components.Skylight))
        .toHaveLength(lighting ? 2 : 0)
      const materials = Object.values(report.assets).filter((asset: any) => asset.kind === 'material') as any[]
      expect(materials.find(asset => asset.values.baseColor[3] === 1)).toMatchObject({
        colorSpace: 'linear', values: { baseColor: [0.2, 0.3, 0.4, 1] },
      })
      const transparent = materials.find(asset => asset.values.baseColor[3] === 0.35)
      expect(transparent).toMatchObject({ colorSpace: 'linear', values: { baseColor: [0.2, 0.3, 0.4, 0.35] } })
      expect(transparent.passes).toHaveLength(1)
      expect(transparent.passes[0].renderState).toMatchObject({
        queue: 3000, depthWriteEnabled: false, blend: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' } },
      })
      expect(Object.values(report.assets).some((asset: any) => asset.kind === 'mesh')).toBe(true)
      const coloredMesh = Object.values(report.assets).find((asset: any) => asset.kind === 'mesh' && asset.attributes.color) as any
      expect(Object.values(coloredMesh.attributes.color).slice(0, 4)).toEqual([1, .5, .25, 1])
      expect(Object.values(report.assets).find((asset: any) => asset.kind === 'texture')).toMatchObject({
        shape: { viewDimension: '2d', extent: { width: 1, height: 1 } }, mips: { kind: 'generate' }, format: 'rgba8unorm-srgb',
      })
    }
  }, 30000)
})
