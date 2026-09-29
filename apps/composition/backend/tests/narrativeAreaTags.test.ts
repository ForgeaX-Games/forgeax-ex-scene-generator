import { describe, expect, it } from 'vitest'
import { applyNarrativeAreaTags } from '../src/scene-export/narrativeAreaTags.js'
import type { BakedLayer } from '../src/baked/store.js'

function baseLayer(partial: Partial<BakedLayer> & Pick<BakedLayer, 'nodePath' | 'nodeName'>): BakedLayer {
  return {
    value: 1,
    assetName: '',
    cells: [],
    attributes: {},
    ...partial,
  }
}

describe('applyNarrativeAreaTags — narrative structure', () => {
  it('rejects a duplicate location name', () => {
    expect(() => applyNarrativeAreaTags([], {
      locations: [
        { name: 'A', parent: null },
        { name: 'A', parent: null },
      ],
    })).toThrow(/duplicate location name: "A"/)
  })

  it('rejects a dangling parent reference', () => {
    expect(() => applyNarrativeAreaTags([], {
      locations: [{ name: 'A', parent: 'Ghost' }],
    })).toThrow(/location "A" has unknown parent "Ghost"/)
  })

  it('rejects a parent cycle', () => {
    expect(() => applyNarrativeAreaTags([], {
      locations: [
        { name: 'A', parent: 'B' },
        { name: 'B', parent: 'A' },
      ],
    })).toThrow(/cycle/)
  })

  it('collects multiple structural problems in one error', () => {
    // "A" (kept copy) and "B" both also fail the later missing-match check
    // against an empty layer set — this proves ALL problems across every
    // stage are collected into a single thrown error, not just the first.
    expect(() => applyNarrativeAreaTags([], {
      locations: [
        { name: 'A', parent: null },
        { name: 'A', parent: null },
        { name: 'B', parent: 'Ghost' },
      ],
    })).toThrow(/3 issues/)
  })
})

describe('applyNarrativeAreaTags — matching + containment', () => {
  const layers: BakedLayer[] = [
    baseLayer({ nodePath: '/大昭九州', nodeName: '大昭九州' }),
    baseLayer({ nodePath: '/大昭九州/京畿南境驿道', nodeName: '京畿南境驿道' }),
    baseLayer({ nodePath: '/大昭九州/京畿南境驿道/extra/清水镇', nodeName: '清水镇' }),
    baseLayer({ nodePath: '/大昭九州/京畿南境驿道/extra/清水镇/望江客栈', nodeName: '望江客栈' }),
  ]
  const narrative = {
    locations: [
      { name: '大昭九州', parent: null },
      { name: '京畿南境驿道', parent: '大昭九州' },
      { name: '清水镇', parent: '京畿南境驿道' },
      { name: '望江客栈', parent: '清水镇' },
    ],
  }

  it('reports a missing location', () => {
    const broken = layers.filter((l) => l.nodeName !== '望江客栈')
    expect(() => applyNarrativeAreaTags(broken, narrative)).toThrow(/missing: location "望江客栈" has no matching scene node/)
  })

  it('reports an ambiguous location', () => {
    const dup = [...layers, baseLayer({ nodePath: '/other/清水镇', nodeName: '清水镇' })]
    expect(() => applyNarrativeAreaTags(dup, narrative)).toThrow(/ambiguous: location "清水镇" matches 2 scene nodes/)
  })

  it('reports bad containment when the matched child is outside the matched parent subtree', () => {
    const sideways = layers.map((l) => l.nodeName === '望江客栈'
      ? { ...l, nodePath: '/大昭九州/京畿南境驿道/别的镇/望江客栈' }
      : l)
    expect(() => applyNarrativeAreaTags(sideways, narrative)).toThrow(/bad_containment: location "望江客栈"/)
  })

  it('allows extra inserted layers between matched parent and child', () => {
    expect(() => applyNarrativeAreaTags(layers, narrative)).not.toThrow()
  })
})

describe('applyNarrativeAreaTags — stamping', () => {
  const narrative = {
    locations: [
      { name: '大昭九州', parent: null },
      { name: '京畿南境驿道', parent: '大昭九州' },
      { name: '清水镇', parent: '京畿南境驿道' },
      { name: '望江客栈', parent: '清水镇' },
    ],
  }

  function scene(): BakedLayer[] {
    return [
      baseLayer({ nodePath: '/大昭九州', nodeName: '大昭九州' }),
      baseLayer({ nodePath: '/大昭九州/京畿南境驿道', nodeName: '京畿南境驿道' }),
      baseLayer({ nodePath: '/大昭九州/京畿南境驿道/extra/清水镇', nodeName: '清水镇' }),
      baseLayer({
        nodePath: '/大昭九州/京畿南境驿道/extra/清水镇/望江客栈',
        nodeName: '望江客栈',
        attributes: { area_L1: 'manual-stale', area_L4: 'manual-deep-untouched' },
      }),
      baseLayer({ nodePath: '/大昭九州/京畿南境驿道/extra/清水镇/望江客栈/floor', nodeName: 'floor' }),
      baseLayer({ nodePath: '/unrelated', nodeName: 'unrelated' }),
    ]
  }

  it('stamps area_L{depth} on every layer within a matched subtree, overriding same-level manual tags', () => {
    const out = applyNarrativeAreaTags(scene(), narrative)
    const byPath = new Map(out.map((l) => [l.nodePath, l]))

    expect(byPath.get('/大昭九州')!.attributes.area_L0).toBe('大昭九州')
    expect(byPath.get('/大昭九州/京畿南境驿道')!.attributes.area_L1).toBe('京畿南境驿道')
    expect(byPath.get('/大昭九州/京畿南境驿道/extra/清水镇')!.attributes.area_L2).toBe('清水镇')

    const inn = byPath.get('/大昭九州/京畿南境驿道/extra/清水镇/望江客栈')!
    expect(inn.attributes.area_L0).toBe('大昭九州')
    expect(inn.attributes.area_L1).toBe('京畿南境驿道') // overrides the stale manual value
    expect(inn.attributes.area_L2).toBe('清水镇')
    expect(inn.attributes.area_L3).toBe('望江客栈')
    expect(inn.attributes.area_L4).toBe('manual-deep-untouched') // untouched — narrative never reaches depth 4 here

    const floor = byPath.get('/大昭九州/京畿南境驿道/extra/清水镇/望江客栈/floor')!
    expect(floor.attributes.area_L3).toBe('望江客栈')

    expect(byPath.get('/unrelated')!.attributes.area_L0).toBeUndefined()
  })

  it('does not mutate the input layers array', () => {
    const input = scene()
    const before = JSON.stringify(input)
    applyNarrativeAreaTags(input, narrative)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('supports depth beyond 4', () => {
    const deepNarrative = {
      locations: [
        { name: 'L0', parent: null },
        { name: 'L1', parent: 'L0' },
        { name: 'L2', parent: 'L1' },
        { name: 'L3', parent: 'L2' },
        { name: 'L4', parent: 'L3' },
        { name: 'L5', parent: 'L4' },
        { name: 'L6', parent: 'L5' },
      ],
    }
    const deepLayers = [
      baseLayer({ nodePath: '/L0', nodeName: 'L0' }),
      baseLayer({ nodePath: '/L0/L1', nodeName: 'L1' }),
      baseLayer({ nodePath: '/L0/L1/L2', nodeName: 'L2' }),
      baseLayer({ nodePath: '/L0/L1/L2/L3', nodeName: 'L3' }),
      baseLayer({ nodePath: '/L0/L1/L2/L3/L4', nodeName: 'L4' }),
      baseLayer({ nodePath: '/L0/L1/L2/L3/L4/L5', nodeName: 'L5' }),
      baseLayer({ nodePath: '/L0/L1/L2/L3/L4/L5/L6', nodeName: 'L6' }),
    ]
    const out = applyNarrativeAreaTags(deepLayers, deepNarrative)
    const leaf = out.find((l) => l.nodePath === '/L0/L1/L2/L3/L4/L5/L6')!
    expect(leaf.attributes.area_L6).toBe('L6')
  })
})

describe('applyNarrativeAreaTags — region from sceneName', () => {
  const narrative = {
    sceneName: '大昭中叶清水镇',
    locations: [{ name: 'Town', parent: null }],
  }

  function scene(): BakedLayer[] {
    return [
      baseLayer({ nodePath: '/Town', nodeName: 'Town' }),
      baseLayer({ nodePath: '/Town/Ground', nodeName: 'Ground', attributes: { region: 'manual-stale' } }),
      baseLayer({ nodePath: '/unrelated', nodeName: 'unrelated', attributes: { region: 'manual-stale' } }),
    ]
  }

  it('stamps region from sceneName on every layer, including ones outside any matched subtree', () => {
    const out = applyNarrativeAreaTags(scene(), narrative)
    for (const layer of out) expect(layer.attributes.region).toBe('大昭中叶清水镇')
  })

  it('leaves region untouched when sceneName is absent, blank, or whitespace-only', () => {
    for (const sceneName of [undefined, '', '   ']) {
      const out = applyNarrativeAreaTags(scene(), { ...narrative, sceneName })
      const ground = out.find((l) => l.nodePath === '/Town/Ground')!
      expect(ground.attributes.region).toBe('manual-stale')
      const unrelated = out.find((l) => l.nodePath === '/unrelated')!
      expect(unrelated.attributes.region).toBe('manual-stale')
    }
  })

  it('does not mutate the input layers array when stamping region', () => {
    const input = scene()
    const before = JSON.stringify(input)
    applyNarrativeAreaTags(input, narrative)
    expect(JSON.stringify(input)).toBe(before)
  })
})
