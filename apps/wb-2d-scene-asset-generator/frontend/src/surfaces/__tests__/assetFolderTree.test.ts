// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest'
import { buildFolderTree, FAVORITES_FILTER, PRESET_FOLDER, readOrderMap } from '../assetFolderTree.js'

describe('buildFolderTree', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('pins virtual columns, then fixed leaves, then other top-level parents', () => {
    const tree = buildFolderTree(
      [
        { name: PRESET_FOLDER, count: 5 },
        { name: FAVORITES_FILTER, count: 2 },
        { name: 'ai', count: 17 },
        { name: 'staging', count: 8 },
        { name: 'user', count: 0 },
        { name: 'user/trees', count: 3 },
        { name: 'zeta', count: 1 },
      ],
      {},
      {},
    )
    const order = tree.map((n) => `${n.kind}:${n.folder ?? 'all'}`)
    expect(order).toEqual([
      `virtual:${PRESET_FOLDER}`,
      `virtual:${FAVORITES_FILTER}`,
      'virtual:all',
      'leaf:ai', // fixed leaf
      'leaf:staging', // fixed leaf
      'parent:user', // non-fixed parent (alphabetical)
      'parent:zeta',
    ])
  })

  it('nests sub-menus under their parent and folds their count into the parent total', () => {
    const tree = buildFolderTree(
      [
        { name: 'user', count: 1 },
        { name: 'user/a', count: 2 },
        { name: 'user/b', count: 4 },
      ],
      {},
      {},
    )
    const user = tree.find((n) => n.folder === 'user')!
    expect(user.kind).toBe('parent')
    expect(user.count).toBe(7) // 1 direct + 2 + 4
    expect(user.children?.map((c) => c.label)).toEqual(['a', 'b'])
  })

  it('honours the persisted sub-menu order, appending unseen children', () => {
    const tree = buildFolderTree(
      [
        { name: 'user', count: 0 },
        { name: 'user/a', count: 0 },
        { name: 'user/b', count: 0 },
        { name: 'user/c', count: 0 },
      ],
      {},
      { user: ['user/c', 'user/a'] },
    )
    const user = tree.find((n) => n.folder === 'user')!
    expect(user.children?.map((c) => c.folder)).toEqual(['user/c', 'user/a', 'user/b'])
  })

  it('reads back an empty order map by default', () => {
    expect(readOrderMap()).toEqual({})
  })
})
