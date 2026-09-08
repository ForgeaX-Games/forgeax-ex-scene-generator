import { describe, expect, it } from 'vitest'
import { buildPathTree, collectDescendantLayerKeys, flattenVisiblePathTree } from '../pathTree'

describe('path tree', () => {
  const layers = {
    'baked:/Root': { nodePath: '/Root', nodeName: 'Root' },
    'baked:/Root/Child': { nodePath: '/Root/Child', nodeName: 'Child' },
    'baked:/Root/Child/Leaf': { nodePath: '/Root/Child/Leaf', nodeName: 'Leaf' },
  }

  it('builds rows with parent/child nesting even when parents are real layers', () => {
    const tree = buildPathTree(Object.keys(layers), (key) => layers[key as keyof typeof layers])
    expect(tree).toHaveLength(1)
    expect(tree[0].layerKey).toBe('baked:/Root')
    expect(tree[0].children[0].layerKey).toBe('baked:/Root/Child')
  })

  it('preserves backend layer order instead of sorting siblings by name', () => {
    const orderedLayers = {
      'baked:/B': { nodePath: '/B', nodeName: 'B' },
      'baked:/A': { nodePath: '/A', nodeName: 'A' },
    }
    const tree = buildPathTree(Object.keys(orderedLayers), (key) => orderedLayers[key as keyof typeof orderedLayers])
    expect(tree.map((node) => node.pathKey)).toEqual(['/B', '/A'])
  })

  it('flattens visible rows while hiding descendants of collapsed parents', () => {
    const tree = buildPathTree(Object.keys(layers), (key) => layers[key as keyof typeof layers])
    expect(flattenVisiblePathTree(tree, new Set()).map((r) => r.node.pathKey)).toEqual([
      '/Root',
      '/Root/Child',
      '/Root/Child/Leaf',
    ])
    expect(flattenVisiblePathTree(tree, new Set(['/Root'])).map((r) => r.node.pathKey)).toEqual(['/Root'])
  })

  // Alt-click on a parent row sweeps its whole subtree; the plain eye stays
  // single-layer because a scene path is both a layer and a parent.
  describe('collectDescendantLayerKeys', () => {
    it('collects every descendant layer, aliases included, excluding the node itself', () => {
      const cells = [{ x: 0, y: 0, z: 0 }]
      const tree = buildPathTree(
        ['n1:/Island', 'n1:/Island/Beach', 'n2:/Island/Beach', 'n1:/Island/Beach/Rock'],
        (key) => ({
          nodePath: key.slice(key.indexOf(':') + 1),
          // n2's Beach differs from n1's, so it gets its own row (not an alias).
          cells: key.startsWith('n2') ? [{ x: 9, y: 9, z: 9 }] : cells,
        }),
      )
      expect(collectDescendantLayerKeys(tree[0])).toEqual([
        'n1:/Island/Beach',
        'n2:/Island/Beach',
        'n1:/Island/Beach/Rock',
      ])
    })

    it('returns nothing for a leaf row', () => {
      const tree = buildPathTree(['n1:/Island'], () => ({ nodePath: '/Island', cells: [] }))
      expect(collectDescendantLayerKeys(tree[0])).toEqual([])
    })
  })

  // Two parallel scene_output sinks projecting the SAME scene path. The tree is
  // keyed by path (one coherent scene tree), so the rival layers must stack on
  // that path instead of overwriting each other — the "silently swallowed
  // parallel branch" bug.
  describe('rival scene_output sinks on the same path', () => {
    const cellsA = [{ x: 0, y: 0, z: 0 }]
    const cellsB = [{ x: 5, y: 5, z: 0 }]

    it('keeps both layers when the same path carries different content', () => {
      const rivals = {
        'n1:/Island/Beach': { nodePath: '/Island/Beach', nodeName: 'Beach', cells: cellsA },
        'n2:/Island/Beach': { nodePath: '/Island/Beach', nodeName: 'Beach', cells: cellsB },
      }
      const tree = buildPathTree(Object.keys(rivals), (key) => rivals[key as keyof typeof rivals])
      expect(tree[0].children[0].layerKeys).toEqual(['n1:/Island/Beach', 'n2:/Island/Beach'])
      expect(tree[0].children[0].layerKey).toBe('n1:/Island/Beach')
    })

    it('collapses byte-identical ancestors re-projected by every sink to one row', () => {
      const shared = [{ x: 1, y: 2, z: 3, token: 'grass' }]
      const inherited = {
        'n1:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...shared] },
        'n2:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...shared] },
      }
      const tree = buildPathTree(Object.keys(inherited), (key) => inherited[key as keyof typeof inherited])
      expect(tree).toHaveLength(1)
      expect(tree[0].layerKeys).toEqual(['n1:/Island'])
    })

    // The canvas paints every layer in the store, so a folded copy that the row
    // cannot reach keeps painting after the user hides that row.
    it('records folded copies as aliases of the row that represents them', () => {
      const shared = [{ x: 1, y: 2, z: 3 }]
      const inherited = {
        'n1:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...shared] },
        'n2:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...shared] },
        'n3:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...shared] },
      }
      const tree = buildPathTree(Object.keys(inherited), (key) => inherited[key as keyof typeof inherited])
      expect(tree[0].layerAliases).toEqual({ 'n1:/Island': ['n2:/Island', 'n3:/Island'] })
    })

    it('keeps aliases separate per represented row when content differs', () => {
      const a = [{ x: 0, y: 0, z: 0 }]
      const b = [{ x: 9, y: 9, z: 0 }]
      const mixed = {
        'n1:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...a] },
        'n2:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...b] },
        'n3:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...a] },
        'n4:/Island': { nodePath: '/Island', nodeName: 'Island', cells: [...b] },
      }
      const tree = buildPathTree(Object.keys(mixed), (key) => mixed[key as keyof typeof mixed])
      expect(tree[0].layerKeys).toEqual(['n1:/Island', 'n2:/Island'])
      expect(tree[0].layerAliases).toEqual({
        'n1:/Island': ['n3:/Island'],
        'n2:/Island': ['n4:/Island'],
      })
    })

    it('treats same coordinates with a different asset as distinct content', () => {
      const rivals = {
        'n1:/Island': { nodePath: '/Island', nodeName: 'Island', cells: cellsA, assetName: 'sand' },
        'n2:/Island': { nodePath: '/Island', nodeName: 'Island', cells: cellsA, assetName: 'dirt' },
      }
      const tree = buildPathTree(Object.keys(rivals), (key) => rivals[key as keyof typeof rivals])
      expect(tree[0].layerKeys).toHaveLength(2)
    })

    it('skips content de-duplication when disabled (baked bucket)', () => {
      const same = [{ x: 0, y: 0, z: 0 }]
      const bakedish = {
        'a:/X': { nodePath: '/X', nodeName: 'X', cells: same },
        'b:/X': { nodePath: '/X', nodeName: 'X', cells: same },
      }
      const tree = buildPathTree(
        Object.keys(bakedish),
        (key) => bakedish[key as keyof typeof bakedish],
        { dedupeByContent: false },
      )
      expect(tree[0].layerKeys).toEqual(['a:/X', 'b:/X'])
    })
  })
})
