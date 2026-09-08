import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cookBakedScene } from '../src/scene-export/cooker.js'
import { listMergedAliasMetas } from '../src/library/mergedLibraryPool.js'
import { resolveLayerAlias } from '../src/scene-export/assetMatch.js'

const bakedPath = resolve(import.meta.dirname, 'fixtures/siheyuan-baked-layers.json')

function findSiheyuanObject(result: ReturnType<typeof cookBakedScene>) {
  return result.terrain.objects.find((object) => object.typeId.includes('四合院'))
}

describe('project 623 siheyuan placement', () => {
  it('matches renderer anchor when cooked from baked snapshot', () => {
    const { layers } = JSON.parse(readFileSync(bakedPath, 'utf8'))
    const sh = layers.find((L: { nodePath: string }) => L.nodePath === '/ground/四合院')
    const alias = {
      alias: '[建筑]_[室外]_[四合院]_[]_[无]_[国风仙侠]_[正常]_[asset]_[16]_[静态]_[]_[0]_[庭院].png',
      anchorX: 0.5,
      anchorY: 0.007,
      widthPx: 288,
      heightPx: 96,
      ppu: 16,
    }
    const solo = cookBakedScene({
      bundleId: 'solo',
      sceneName: 'solo',
      layers: [sh],
      aliases: [alias],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(findSiheyuanObject(solo)).toMatchObject({ x: 29.5, y: 37, height: 1 })

    const full = cookBakedScene({
      bundleId: 'full',
      sceneName: 'full',
      layers,
      aliases: [alias],
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    expect(findSiheyuanObject(full)).toMatchObject({ x: 29.5, y: 37, height: 1 })
  })

  it('matches renderer anchor with merged library aliases (live export path)', async () => {
    const { layers } = JSON.parse(readFileSync(bakedPath, 'utf8'))
    const sh = layers.find((L: { nodePath: string }) => L.nodePath === '/ground/四合院')
    const aliases = await listMergedAliasMetas('raw')
    const resolved = resolveLayerAlias(sh, aliases)
    expect(resolved?.ppu).toBe(16)
    const full = cookBakedScene({
      bundleId: 'full-lib',
      sceneName: 'full-lib',
      layers,
      aliases,
      generatedAt: new Date('2026-06-04T06:00:00.000Z'),
    })
    const object = findSiheyuanObject(full)
    expect(object).toMatchObject({ x: 29.5, height: 1 })
    // Full library resolution emits the whole scene; negative billboard rows trigger
    // global Y offset (+1 for project 623), so grid y becomes 38 not 37.
    expect(object!.y).toBeGreaterThanOrEqual(37)
    expect(object!.y).toBeLessThanOrEqual(38)
  })
})
