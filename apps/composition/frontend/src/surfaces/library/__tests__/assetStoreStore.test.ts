import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useAssetStoreStore, RULES_ZONE } from '../assetStoreStore'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 })
}

// Let a fire-and-forget store action's async chain (loadView → fetch → .json())
// fully settle before asserting.
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  useAssetStoreStore.setState({
    zones: [],
    activeZone: 'raw',
    search: '',
    viewMode: 'grid',
    assets: [],
    total: 0,
    page: 1,
    pageSize: 60,
    loading: false,
    selected: null,
    rules: [],
    selectedRule: null,
    taxonomy: null,
    folderPath: [],
    folders: [],
    loadingFolders: false,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('assetStoreStore', () => {
  it('init loads zones then the first asset page', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/zones')) return jsonResponse(['raw', 'staging'])
      if (url.includes('/library/list')) {
        return jsonResponse({ items: [{ id: 'a1', alias: 'x', zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 10, anchorX: null, anchorY: null }], total: 1, page: 1, pageSize: 60 })
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    await useAssetStoreStore.getState().init()

    const s = useAssetStoreStore.getState()
    // The synthetic Rules pseudo-zone is appended so it shows in the dropdown.
    expect(s.zones).toEqual(['raw', 'staging', RULES_ZONE])
    expect(s.assets).toHaveLength(1)
    expect(s.total).toBe(1)
  })

  it('setZone resets page, persists, and re-fetches the new zone', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/library/list')) {
        return jsonResponse({ items: [], total: 0, page: 1, pageSize: 60 })
      }
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    useAssetStoreStore.getState().setZone('staging')
    // allow the fire-and-forget fetchAssets() to settle
    await flush()

    expect(useAssetStoreStore.getState().activeZone).toBe('staging')
    expect(useAssetStoreStore.getState().page).toBe(1)
    expect(seen.some((u) => u.includes('zone=staging'))).toBe(true)
  })

  it('fetchAssets surfaces an empty list on network error without throwing', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('boom')
    })
    vi.stubGlobal('fetch', fetchMock)

    await useAssetStoreStore.getState().fetchAssets()
    const s = useAssetStoreStore.getState()
    expect(s.assets).toEqual([])
    expect(s.total).toBe(0)
    expect(s.loading).toBe(false)
  })

  it('fetchAssets loads the WHOLE zone by looping the page-based route', async () => {
    const rec = (id: string) => ({ id, alias: id, zone: 'raw', blobSha256: 's', mimeType: 'image/png', sizeBytes: 10, anchorX: null, anchorY: null })
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('/library/list')) return jsonResponse([])
      const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? '1')
      return page === 1
        ? jsonResponse({ items: [rec('a1'), rec('a2')], total: 3, page: 1, pageSize: 500 })
        : jsonResponse({ items: [rec('a3')], total: 3, page: 2, pageSize: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    await useAssetStoreStore.getState().fetchAssets()

    const s = useAssetStoreStore.getState()
    expect(s.assets.map((a) => a.id)).toEqual(['a1', 'a2', 'a3'])
    expect(s.total).toBe(3)
    const listCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes('/library/list'))
    expect(listCalls).toHaveLength(2)
  })

  it('derives the page from scroll position / pager clicks without re-fetching', () => {
    useAssetStoreStore.setState({ total: 100, pageSize: 10, page: 1, pendingScrollToPage: null })

    useAssetStoreStore.getState().setPageFromScroll(4)
    expect(useAssetStoreStore.getState().page).toBe(4)
    expect(useAssetStoreStore.getState().pendingScrollToPage).toBeNull() // scroll never requests a scroll

    useAssetStoreStore.getState().setPageFromScroll(999) // clamps to last page
    expect(useAssetStoreStore.getState().page).toBe(10)

    useAssetStoreStore.getState().goToPage(3) // pager click DOES request a scroll
    expect(useAssetStoreStore.getState().page).toBe(3)
    expect(useAssetStoreStore.getState().pendingScrollToPage).toBe(3)
  })

  it('setPageSize keeps the current page within range', () => {
    useAssetStoreStore.setState({ total: 100, pageSize: 10, page: 9 })
    useAssetStoreStore.getState().setPageSize(50) // 100/50 → 2 pages
    expect(useAssetStoreStore.getState().pageSize).toBe(50)
    expect(useAssetStoreStore.getState().page).toBe(2)
  })

  it('the Rules pseudo-zone fetches rule summaries instead of image blobs', async () => {
    const ruleItem = {
      alias: 'common_16', name: 'common_16', schemaVersion: 2, ppu: 16, spriteCount: 20,
      faces: { top: { basePieces: 16, mapEntries: 47, variants: 0, hasRandom: false } }, regions: [],
    }
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/library/rules')) return jsonResponse([ruleItem])
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 60 })
    })
    vi.stubGlobal('fetch', fetchMock)

    useAssetStoreStore.setState({ activeZone: RULES_ZONE })
    await useAssetStoreStore.getState().fetchAssets()

    const s = useAssetStoreStore.getState()
    expect(s.activeZone).toBe(RULES_ZONE)
    expect(s.rules.map((r) => r.alias)).toEqual(['common_16'])
    expect(s.total).toBe(1)
    // It must hit /library/rules and NOT the image /library/list route.
    expect(seen.some((u) => u.includes('/library/rules'))).toBe(true)
    expect(seen.some((u) => u.includes('/library/list'))).toBe(false)
  })

  it('setTaxonomy loads top-level folders (facets) instead of the flat asset list', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/library/facets')) {
        return jsonResponse([{ value: 'tilemap', label: 'tilemap', count: 12, samples: ['a', 'b'] }])
      }
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 60 })
    })
    vi.stubGlobal('fetch', fetchMock)

    useAssetStoreStore.getState().setTaxonomy('type')
    await flush()

    const s = useAssetStoreStore.getState()
    expect(s.taxonomy).toBe('type')
    expect(s.folders.map((f) => f.value)).toEqual(['tilemap'])
    expect(seen.some((u) => u.includes('/library/facets') && u.includes('by=type'))).toBe(true)
    expect(seen.some((u) => u.includes('/library/list'))).toBe(false)
  })

  it('openFolder at a leaf fetches the filtered asset list with by/value params', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/library/facets')) return jsonResponse([])
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    // type is a one-level taxonomy → opening a folder is already a leaf.
    useAssetStoreStore.setState({ taxonomy: 'type', folderPath: [] })
    useAssetStoreStore.getState().openFolder({ value: 'tilemap', label: 'tilemap', count: 3, samples: [] })
    await flush()

    const s = useAssetStoreStore.getState()
    expect(s.folderPath.map((c) => c.value)).toEqual(['tilemap'])
    expect(seen.some((u) => u.includes('/library/list') && u.includes('by=type') && u.includes('value=tilemap'))).toBe(true)
  })

  it('place is single-level: opening 室内/室外 loads filtered assets (no room drill-down)', async () => {
    const seen: string[] = []
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url)
      if (url.includes('/library/facets')) {
        return jsonResponse([{ value: '室内', label: '室内', count: 30, samples: [] }])
      }
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    useAssetStoreStore.setState({ taxonomy: 'place', folderPath: [] })
    useAssetStoreStore.getState().openFolder({ value: '室内', label: '室内', count: 30, samples: [] })
    await flush()
    expect(useAssetStoreStore.getState().folderPath.map((c) => c.value)).toEqual(['室内'])
    expect(seen.some((u) => u.includes('/library/list') && u.includes('by=place') && u.includes('value=%E5%AE%A4%E5%86%85'))).toBe(true)
    expect(seen.some((u) => u.includes('/library/facets') && u.includes('parent='))).toBe(false)
  })

  it('goToCrumb(0) climbs back from a leaf to the taxonomy root folders', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/library/facets')) return jsonResponse([{ value: 'forest', label: 'forest', count: 2, samples: [] }])
      return jsonResponse({ items: [], total: 0, page: 1, pageSize: 500 })
    })
    vi.stubGlobal('fetch', fetchMock)

    useAssetStoreStore.setState({ taxonomy: 'type', folderPath: [{ value: 'forest', label: 'forest' }] })
    useAssetStoreStore.getState().goToCrumb(0)
    await flush()

    const s = useAssetStoreStore.getState()
    expect(s.folderPath).toEqual([])
    expect(s.folders.map((f) => f.value)).toEqual(['forest'])
  })

  it('setSelectedRule selects, then toggles off on re-click of the same rule', () => {
    const rule = {
      alias: 'fence_7', schemaVersion: 2 as const, ppu: 16, spriteCount: 7,
      faces: { top: { basePieces: 7, mapEntries: 12, variants: 0, hasRandom: false } }, regions: [],
    }
    useAssetStoreStore.getState().setSelectedRule(rule)
    expect(useAssetStoreStore.getState().selectedRule?.alias).toBe('fence_7')
    useAssetStoreStore.getState().setSelectedRule(rule) // re-click → deselect
    expect(useAssetStoreStore.getState().selectedRule).toBeNull()
  })
})
