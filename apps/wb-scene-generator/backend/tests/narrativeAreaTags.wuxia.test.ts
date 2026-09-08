import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applyNarrativeAreaTags, type NarrativeInput } from '../src/scene-export/narrativeAreaTags.js'
import type { BakedLayer } from '../src/baked/store.js'

function baseLayer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return { value: 1, assetName: '', cells: [], attributes: {}, ...partial }
}

const FIXTURE_PATH = resolve(
  import.meta.dirname,
  'fixtures/scene_nodes.wuxia.json',
)

describe('applyNarrativeAreaTags — real wuxia fixture', () => {
  it('validates and tags a baked scene that mirrors the fixture hierarchy plus an extra inserted layer', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as NarrativeInput
    expect(raw.locations.length).toBeGreaterThan(0)

    // Build one baked layer per narrative location, nested by walking each
    // location's parent chain and inserting an extra "extra" segment right
    // before each location to prove extra layers are tolerated.
    const pathByName = new Map<string, string>()
    function pathFor(name: string): string {
      const cached = pathByName.get(name)
      if (cached) return cached
      const loc = raw.locations.find((l) => l.name === name)!
      const path = loc.parent === null ? `/${name}` : `${pathFor(loc.parent)}/extra/${name}`
      pathByName.set(name, path)
      return path
    }
    const layers = raw.locations.map((loc) => baseLayer({ nodePath: pathFor(loc.name), nodeName: loc.name }))

    const out = applyNarrativeAreaTags(layers, raw)
    const byName = new Map(out.map((l) => [l.nodeName, l]))

    function depthOf(name: string): number {
      let depth = 0
      let cursor: string | null = name
      while (true) {
        const current = raw.locations.find((l) => l.name === cursor)!
        if (current.parent === null) return depth
        depth++
        cursor = current.parent
      }
    }

    for (const loc of raw.locations) {
      const depth = depthOf(loc.name)
      expect(byName.get(loc.name)!.attributes[`area_L${depth}`]).toBe(loc.name)
    }
  })

  it('fails with a bad_containment error when a fixture location resolves outside its narrative parent', () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, 'utf-8')) as NarrativeInput
    const nonRoot = raw.locations.find((l) => l.parent !== null)!
    const layers = raw.locations.map((loc) => baseLayer({
      nodePath: loc.name === nonRoot.name ? `/sideways/${loc.name}` : `/${loc.name}`,
      nodeName: loc.name,
    }))
    expect(() => applyNarrativeAreaTags(layers, raw)).toThrow(new RegExp(`bad_containment: location "${nonRoot.name}"`))
  })
})
