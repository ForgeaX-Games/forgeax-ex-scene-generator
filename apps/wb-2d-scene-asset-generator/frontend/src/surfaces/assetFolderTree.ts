// Asset Store left-rail tree model + browser persistence.
//
// The backend serves a FLAT list of folder columns whose `name` encodes the
// hierarchy as a path (`top` or `top/child`) — mirroring the real on-disk
// `generated/<path>/` directories. This module derives the two-level menu tree
// the surface renders, and owns the two pieces of state the filesystem cannot
// express: each parent menu's open/closed state and the order of its
// sub-menus. Both persist to localStorage so a refresh restores the layout.

/** The virtual cross-folder favorites column token (matches the backend). */
export const FAVORITES_FILTER = '__favorites__'

/** The virtual read-only preset column served from the plugin dir. */
export const PRESET_FOLDER = 'presets'

/** Fixed top-level columns: plain leaves (hold images directly), never get
 *  sub-menus and cannot be deleted/created as menus. New menus sort after these. */
export const FIXED_TOP_FOLDERS = ['ai', 'grayscale', 'processed', 'staging'] as const

const FIXED_SET = new Set<string>(FIXED_TOP_FOLDERS)

export function isFixedTopFolder(name: string): boolean {
  return FIXED_SET.has(name)
}

/** A single rendered rail row. `kind` drives interaction:
 *  - `virtual`: presets / favorites / All — pinned, click-selects. presets and
 *    favorites may also carry `children` (their `presets/<sub>` /
 *    `__favorites__/<group>` sub-menus), rendering an expandable group.
 *  - `leaf`: a fixed top column or a sub-menu — click-selects a folder.
 *  - `parent`: a non-fixed top folder — click toggles its sub-menu, holds children. */
export interface FolderNode {
  /** Folder filter value: a path string, or null for the synthetic All. */
  folder: string | null
  /** Display label (last path segment for children, else the name). */
  label: string
  count: number
  kind: 'virtual' | 'leaf' | 'parent'
  /** Top-level segment (used to key open-state / child ordering). */
  top: string
  /** Sub-menus, only present on `parent` nodes (already ordered). */
  children?: FolderNode[]
}

const OPEN_KEY = 'asset2d-store-open-folders'
const ORDER_KEY = 'asset2d-store-folder-order'

type OpenMap = Record<string, boolean>
type OrderMap = Record<string, string[]>

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* storage may be unavailable (private mode); state stays in-memory. */
  }
}

export function readOpenMap(): OpenMap {
  return readJson<OpenMap>(OPEN_KEY, {})
}

export function isParentOpen(open: OpenMap, top: string): boolean {
  return open[top] === true
}

export function toggleParentOpen(top: string): OpenMap {
  const open = readOpenMap()
  const next: OpenMap = { ...open, [top]: !(open[top] === true) }
  writeJson(OPEN_KEY, next)
  return next
}

export function readOrderMap(): OrderMap {
  return readJson<OrderMap>(ORDER_KEY, {})
}

/** Persist the explicit sub-menu order (full child paths) for one parent. */
export function writeChildOrder(top: string, childPaths: string[]): OrderMap {
  const order = readOrderMap()
  const next: OrderMap = { ...order, [top]: childPaths }
  writeJson(ORDER_KEY, next)
  return next
}

/** Order children by the persisted order first, then any unseen ones appended
 *  (alphabetically) so newly-created sub-menus still show up deterministically. */
function applyChildOrder(top: string, children: FolderNode[], order: OrderMap): FolderNode[] {
  const wanted = order[top]
  if (!wanted || wanted.length === 0) return children
  const byPath = new Map(children.map((c) => [c.folder as string, c]))
  const out: FolderNode[] = []
  for (const path of wanted) {
    const node = byPath.get(path)
    if (node) {
      out.push(node)
      byPath.delete(path)
    }
  }
  for (const leftover of byPath.values()) out.push(leftover)
  return out
}

/**
 * Build the rendered rail tree from the backend's flat folder list.
 * Order: pinned virtual columns (presets, favorites, All) first; then the four
 * fixed top columns (alphabetical); then every other top-level menu
 * (alphabetical), each carrying its ordered sub-menus.
 */
export function buildFolderTree(
  folders: Array<{ name: string; count: number }>,
  open: OpenMap,
  order: OrderMap,
): FolderNode[] {
  const hasPresets = folders.some((f) => f.name === PRESET_FOLDER || f.name.startsWith(`${PRESET_FOLDER}/`))
  const presetCount = folders
    .filter((f) => f.name === PRESET_FOLDER || f.name.startsWith(`${PRESET_FOLDER}/`))
    .reduce((sum, f) => sum + f.count, 0)
  const favoriteCount = folders.find((f) => f.name === FAVORITES_FILTER)?.count ?? 0
  const hasFavorites = folders.some((f) => f.name === FAVORITES_FILTER || f.name.startsWith(`${FAVORITES_FILTER}/`))

  // Sub-menus of the two virtual columns: `presets/<sub>` and
  // `__favorites__/<group>` render as children under their virtual parent.
  const presetChildren: FolderNode[] = folders
    .filter((f) => f.name.startsWith(`${PRESET_FOLDER}/`))
    .map((f) => ({
      folder: f.name,
      label: f.name.slice(`${PRESET_FOLDER}/`.length),
      count: f.count,
      kind: 'leaf' as const,
      top: PRESET_FOLDER,
    }))
    .sort((a, b) => a.label.localeCompare(b.label))
  // Favorites is a single flat virtual column — sub-groups are no longer
  // supported, so any `__favorites__/<group>` rows from the backend are ignored.
  const favoriteChildren: FolderNode[] = []

  // Real folders only (exclude the two virtual columns and their sub-menus).
  const real = folders.filter(
    (f) =>
      f.name !== PRESET_FOLDER &&
      f.name !== FAVORITES_FILTER &&
      !f.name.startsWith(`${PRESET_FOLDER}/`) &&
      !f.name.startsWith(`${FAVORITES_FILTER}/`),
  )

  // Group by top segment; collect direct count + children.
  const tops = new Map<string, { count: number; children: FolderNode[] }>()
  for (const f of real) {
    const segments = f.name.split('/')
    const top = segments[0]
    const entry = tops.get(top) ?? { count: 0, children: [] }
    if (segments.length === 1) {
      entry.count = f.count
    } else {
      entry.children.push({
        folder: f.name,
        label: segments.slice(1).join('/'),
        count: f.count,
        kind: 'leaf',
        top,
      })
    }
    tops.set(top, entry)
  }

  // `All` now includes the read-only preset column (presets render in All too),
  // so its count is every real folder's assets plus the preset count.
  const allCount = real.reduce((sum, item) => sum + item.count, 0) + presetCount

  const list: FolderNode[] = []
  if (hasPresets)
    list.push({
      folder: PRESET_FOLDER,
      label: PRESET_FOLDER,
      count: presetCount,
      kind: 'virtual',
      top: PRESET_FOLDER,
      ...(presetChildren.length > 0 ? { children: presetChildren } : {}),
    })
  if (hasFavorites)
    list.push({
      folder: FAVORITES_FILTER,
      label: 'favorites',
      count: favoriteCount,
      kind: 'virtual',
      top: FAVORITES_FILTER,
      ...(favoriteChildren.length > 0 ? { children: favoriteChildren } : {}),
    })
  list.push({ folder: null, label: 'All', count: allCount, kind: 'virtual', top: '__all__' })

  const topNames = Array.from(tops.keys())
  const fixed = FIXED_TOP_FOLDERS.filter((name) => tops.has(name))
  const others = topNames.filter((name) => !FIXED_SET.has(name)).sort((a, b) => a.localeCompare(b))

  for (const name of fixed) {
    const entry = tops.get(name)!
    list.push({ folder: name, label: name, count: entry.count, kind: 'leaf', top: name })
  }
  for (const name of others) {
    const entry = tops.get(name)!
    const children = applyChildOrder(name, entry.children.sort((a, b) => a.label.localeCompare(b.label)), order)
    list.push({
      folder: name,
      label: name,
      count: entry.count + children.reduce((s, c) => s + c.count, 0),
      kind: 'parent',
      top: name,
      children,
    })
  }
  // `open` is read by the renderer; returned tree is order-stable regardless.
  void open
  return list
}
