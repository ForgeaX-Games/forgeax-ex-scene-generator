import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  assetDisplayName,
  copyAssetToFolder,
  createGeneratedFolder,
  deleteGeneratedAssets,
  deleteGeneratedFolder,
  generatedAssetUrl,
  importUserAsset,
  latestPreviewAsset,
  listGeneratedAssets,
  listGeneratedFolders,
  moveAssetsToFavoriteGroup,
  moveGeneratedAssets,
  readFileAsDataUrl,
  renameGeneratedAsset,
  setAssetFavorite,
  type GeneratedAssetRecord,
} from './generatedAssetsApi.js'
import { useWorkbenchChild } from '../workbench/useWorkbenchChild.js'
import { writeDraggedAsset, clearDraggedAssetDeferred } from './library/draggedAssetBus.js'
import { writeSelectedPreview } from './library/selectedPreviewBus.js'
import { ChevronDown, ChevronRight, Folder, LayoutGrid, List, Maximize2, Minimize2 } from './icons.js'
import {
  buildFolderTree,
  FAVORITES_FILTER,
  isFixedTopFolder,
  PRESET_FOLDER,
  readOpenMap,
  readOrderMap,
  toggleParentOpen,
  writeChildOrder,
  type FolderNode,
} from './assetFolderTree.js'
import './GeneratedAssetStoreSurface.css'

type ImportTarget = { kind: 'staging' } | { kind: 'user' } | { kind: 'current' } | { kind: 'new' }

/** Card layout for the asset grid: comfortable thumbnails, a compact list, or a
 *  folder browser (folder cards instead of the left rail). */
type ViewMode = 'grid' | 'list' | 'folder'

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: JSX.Element }[] = [
  { mode: 'grid', label: 'Grid', icon: <LayoutGrid size={13} /> },
  { mode: 'list', label: 'List', icon: <List size={13} /> },
  { mode: 'folder', label: 'Folder', icon: <Folder size={13} /> },
]

// The right-click menu acts on a target set: when the right-clicked card is part
// of the current multi-selection we delete the whole selection, otherwise we act
// on just that one card.
type ContextMenuState = { aliases: string[]; x: number; y: number; blank?: boolean }

// The folder rail's right-click menu — targets one menu/sub-menu row. `parent`
// is the top segment; `canAddChild` gates the "new sub-menu" action (only on a
// non-fixed parent row).
type FolderMenuState = { folder: string; top: string; canAddChild: boolean; count: number; x: number; y: number }

export function GeneratedAssetStoreSurface(): JSX.Element {
  const [folders, setFolders] = useState<Array<{ name: string; count: number }>>([])
  const [folder, setFolder] = useState<string | null>(null)
  const [assets, setAssets] = useState<GeneratedAssetRecord[]>([])
  // Which folder the currently-loaded `assets` belong to. When this lags behind
  // `folder` (right after navigating) the grid is stale, so we mask it with a
  // loading state instead of flashing the previous folder's thumbnails.
  const [assetsFolder, setAssetsFolder] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [target, setTarget] = useState<ImportTarget>({ kind: 'staging' })
  const [newFolderName, setNewFolderName] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  // The folder rail's own right-click menu (new sub-menu / delete menu).
  const [folderMenu, setFolderMenu] = useState<FolderMenuState | null>(null)
  // In-app "new menu" dialog (replaces window.prompt). `parent === null` creates
  // a new top-level menu; otherwise a sub-menu under that parent.
  const [createPrompt, setCreatePrompt] = useState<{ parent: string | null } | null>(null)
  const [createName, setCreateName] = useState('')
  const createInputRef = useRef<HTMLInputElement | null>(null)
  // In-app confirmation dialog (replaces window.confirm). `onConfirm` runs the
  // pending destructive action; `tone` styles the confirm button.
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string
    message: string
    confirmLabel: string
    onConfirm: () => void
  } | null>(null)
  // Persisted UI-only menu state: which parent menus are expanded, and the
  // explicit per-parent sub-menu order. Mirrored to localStorage on every edit.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>(() => readOpenMap())
  const [orderMap, setOrderMap] = useState<Record<string, string[]>>(() => readOrderMap())
  // Drag-reorder of sub-menus within one parent: the path being dragged.
  const [dragChild, setDragChild] = useState<{ top: string; folder: string } | null>(null)
  // When non-null the Transport submenu is open, anchored under the parent row.
  const [transportOpen, setTransportOpen] = useState(false)
  // Open the Transport fly-out to the left instead of the right when there's no
  // room on the right edge of the (iframe) viewport.
  const [transportFlip, setTransportFlip] = useState(false)
  // In-app clipboard: a single copied alias plus its mode. "Copy" duplicates on
  // paste; "Cut" duplicates then deletes the original (no system clipboard /
  // no bytes moved until paste).
  const [clipboardAlias, setClipboardAlias] = useState<string | null>(null)
  const [clipboardMode, setClipboardMode] = useState<'copy' | 'cut'>('copy')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // The alias currently being renamed inline (null = no edit in progress).
  const [renaming, setRenaming] = useState<{ alias: string; value: string } | null>(null)
  // Anchor alias for Shift range-selection; updated on every plain/Ctrl click.
  const anchorRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLUListElement | null>(null)
  // Card layout + its dropdown open state (titlebar view switcher).
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [viewMenuOpen, setViewMenuOpen] = useState(false)
  // Folder-view drill path: the chain of folder nodes the user has opened
  // (e.g. [parent] while browsing its sub-menus, [parent, leaf] while viewing a
  // leaf's images). Empty = top-level folder cards. Only used in `folder` mode.
  const [folderPath, setFolderPath] = useState<FolderNode[]>([])
  const viewMenuRef = useRef<HTMLDivElement | null>(null)
  const { isFocused, requestFocus, reportStatus } = useWorkbenchChild('assetstore')

  useEffect(() => {
    let cancelled = false
    void Promise.all([listGeneratedFolders(), listGeneratedAssets(folder ?? undefined)])
      .then(([nextFolders, nextAssets]) => {
        if (cancelled) return
        setFolders(nextFolders)
        setAssets(nextAssets)
        setAssetsFolder(folder)
        // Drop selected aliases that no longer exist in the freshly loaded list.
        setSelected((prev) => {
          if (prev.size === 0) return prev
          const present = new Set(nextAssets.map((a) => a.alias))
          const next = new Set<string>()
          for (const alias of prev) if (present.has(alias)) next.add(alias)
          return next.size === prev.size ? prev : next
        })
        reportStatus({ assets: nextAssets.length, folder: folder ?? 'all' })
      })
      .catch((e) => !cancelled && setError(String(e)))
    return () => {
      cancelled = true
    }
  }, [folder, reloadKey, reportStatus])

  // Switching folders is a fresh context — clear the multi-selection + anchor.
  useEffect(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [folder])

  // Live refresh: the asset list otherwise only re-fetches on a folder switch
  // or a local mutation, so images produced by AI image nodes don't appear in
  // the grid (incl. the `All` column) until the user clicks a tab. Mirror the
  // Preview pane and poll the cheap `/preview/latest` (a single record): when
  // the newest alias changes a new asset was generated, so bump `reloadKey` to
  // re-list. We never auto-reload mid-interaction (rename / menus / dialogs /
  // import / drag) to avoid yanking the grid out from under the user.
  const liveBaselineAlias = useRef<string | null>(null)
  const interactingRef = useRef(false)
  interactingRef.current =
    renaming !== null ||
    contextMenu !== null ||
    folderMenu !== null ||
    createPrompt !== null ||
    confirmDialog !== null ||
    importing ||
    dragChild !== null
  useEffect(() => {
    const detectNewAsset = (): void => {
      if (interactingRef.current) return
      void latestPreviewAsset()
        .then((asset) => {
          const alias = asset?.alias ?? null
          // First poll just records the baseline — never reload on mount.
          if (liveBaselineAlias.current === null) {
            liveBaselineAlias.current = alias ?? ''
            return
          }
          if ((alias ?? '') !== liveBaselineAlias.current) {
            liveBaselineAlias.current = alias ?? ''
            setReloadKey((k) => k + 1)
          }
        })
        .catch(() => {})
    }
    const timer = window.setInterval(detectNewAsset, 2000)
    return () => window.clearInterval(timer)
  }, [])

  const resolveTargetFolder = useCallback((): string | null => {
    // Resolve the explicit import-destination selection into a folder name.
    // The backend slug()-normalizes it; importing into a not-yet-existing
    // folder makes it appear in the list.
    if (target.kind === 'staging') return 'staging'
    if (target.kind === 'user') return 'user'
    // The `presets` column is a read-only plugin source; never import into it.
    if (target.kind === 'current')
      return folder && folder !== PRESET_FOLDER && folder !== FAVORITES_FILTER ? folder : 'staging'
    const name = newFolderName.trim()
    return name || null
  }, [target, folder, newFolderName])

  const onImportClick = useCallback(() => {
    if (importing) return
    if (resolveTargetFolder() === null) {
      setError('Please enter a name for the new folder before importing.')
      return
    }
    fileInputRef.current?.click()
  }, [importing, resolveTargetFolder])

  const onFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const input = e.currentTarget
      const files = Array.from(input.files ?? [])
      input.value = '' // allow re-selecting the same file(s)
      if (files.length === 0) return
      const targetFolder = resolveTargetFolder()
      if (!targetFolder) {
        setError('Please enter a name for the new folder before importing.')
        return
      }
      setImporting(true)
      setError('')
      try {
        for (const file of files) {
          if (!file.type.startsWith('image/')) {
            throw new Error(`not an image: ${file.name}`)
          }
          const dataUrl = await readFileAsDataUrl(file)
          await importUserAsset({
            imageBase64: dataUrl,
            mimeType: file.type || undefined,
            prompt: file.name.replace(/\.[^.]+$/u, ''),
            folder: targetFolder,
            source: 'user-upload',
            tags: ['user-upload'],
          })
        }
        // Jump to the destination folder so the freshly imported images are
        // visible, then bump reloadKey to re-fetch folders + assets.
        setFolder(targetFolder)
        setReloadKey((k) => k + 1)
      } catch (err) {
        setError(String(err))
      } finally {
        setImporting(false)
      }
    },
    [resolveTargetFolder],
  )

  // Card click: plain = select-one + drive preview; Ctrl/Cmd = toggle; Shift =
  // range from anchor to this card (by visual order in `assets`).
  const onCardClick = useCallback(
    (e: React.MouseEvent, asset: GeneratedAssetRecord) => {
      const multi = e.ctrlKey || e.metaKey
      const range = e.shiftKey
      if (range && anchorRef.current) {
        const order = assets.map((a) => a.alias)
        const from = order.indexOf(anchorRef.current)
        const to = order.indexOf(asset.alias)
        if (from !== -1 && to !== -1) {
          const [lo, hi] = from <= to ? [from, to] : [to, from]
          const rangeAliases = order.slice(lo, hi + 1)
          setSelected((prev) => {
            const next = multi ? new Set(prev) : new Set<string>()
            for (const a of rangeAliases) next.add(a)
            return next
          })
          return
        }
      }
      if (multi) {
        anchorRef.current = asset.alias
        setSelected((prev) => {
          const next = new Set(prev)
          if (next.has(asset.alias)) next.delete(asset.alias)
          else next.add(asset.alias)
          return next
        })
        return
      }
      // Plain click: single-select + preview.
      anchorRef.current = asset.alias
      setSelected(new Set([asset.alias]))
      writeSelectedPreview(asset.alias)
    },
    [assets],
  )

  const onCardContextMenu = useCallback(
    (e: React.MouseEvent, asset: GeneratedAssetRecord) => {
      e.preventDefault()
      // If the right-clicked card is in the active selection, operate on the
      // whole selection; otherwise target just this card (and select it).
      const isInSelection = selected.has(asset.alias)
      const aliases = isInSelection && selected.size > 0 ? Array.from(selected) : [asset.alias]
      if (!isInSelection) {
        anchorRef.current = asset.alias
        setSelected(new Set([asset.alias]))
      }
      // Read-only preset assets have no rename/delete actions — when the target
      // set is entirely read-only there is nothing to show, so skip the menu.
      const ro = new Set(assets.filter((a) => a.readonly).map((a) => a.alias))
      if (aliases.every((alias) => ro.has(alias))) return
      // Clamp the open position so the menu never spills past this surface's
      // viewport (it lives in an iframe and can't paint outside it). We use a
      // conservative estimate of the menu box; a post-render effect refines it.
      const MENU_W = 150
      const MENU_H = 210
      const x = Math.min(e.clientX, Math.max(4, window.innerWidth - MENU_W))
      const y = Math.min(e.clientY, Math.max(4, window.innerHeight - MENU_H))
      setContextMenu({ aliases: aliases.filter((alias) => !ro.has(alias)), x, y })
    },
    [selected, assets],
  )

  // Right-click on the grid's empty area: open an in-app menu (suppressing the
  // browser's native one) that offers only Paste — enabled when the in-app
  // clipboard holds an alias, otherwise shown disabled.
  const onBlankContextMenu = useCallback((e: React.MouseEvent) => {
    // Only when the target is the grid container itself or the empty-state
    // placeholder — not a card bubbling up.
    const t = e.target as HTMLElement
    if (e.target !== e.currentTarget && !t.classList.contains('asset2d-store__empty')) return
    e.preventDefault()
    const MENU_W = 150
    const MENU_H = 80
    const x = Math.min(e.clientX, Math.max(4, window.innerWidth - MENU_W))
    const y = Math.min(e.clientY, Math.max(4, window.innerHeight - MENU_H))
    setSelected(new Set())
    anchorRef.current = null
    setContextMenu({ aliases: [], x, y, blank: true })
  }, [])

  const onDeleteAliases = useCallback(async (aliases: string[]) => {
    setContextMenu(null)
    setError('')
    if (aliases.length === 0) return
    const runDelete = async (): Promise<void> => {
      try {
        await deleteGeneratedAssets(aliases)
        setSelected(new Set())
        anchorRef.current = null
        setReloadKey((k) => k + 1)
      } catch (err) {
        setError(String(err))
      }
    }
    // If any target is a favorite, confirm before deleting (deletion also drops
    // it from favorites). Uses the in-app dialog, never a browser confirm.
    const favCount = aliases.filter((a) => assets.find((x) => x.alias === a)?.favorite).length
    if (favCount > 0) {
      setConfirmDialog({
        title: 'Delete favorited images',
        message:
          favCount === aliases.length
            ? `All ${aliases.length} selected image${aliases.length > 1 ? 's are' : ' is'} favorited. Delete them? They will also be removed from favorites. This cannot be undone.`
            : `${favCount} of the ${aliases.length} selected images ${favCount > 1 ? 'are' : 'is'} favorited. Delete all? They will also be removed from favorites. This cannot be undone.`,
        confirmLabel: 'Delete',
        onConfirm: () => {
          setConfirmDialog(null)
          void runDelete()
        },
      })
      return
    }
    void runDelete()
  }, [assets])

  // Open the inline rename editor on a single card, seeded with its current
  // display name (the editable `name`, falling back to the alias).
  const onStartRename = useCallback(
    (alias: string) => {
      setContextMenu(null)
      const asset = assets.find((a) => a.alias === alias)
      setRenaming({ alias, value: asset ? assetDisplayName(asset) : alias })
    },
    [assets],
  )

  const onCommitRename = useCallback(async () => {
    if (!renaming) return
    const { alias, value } = renaming
    const next = value.trim()
    setRenaming(null)
    if (!next) return
    const current = assets.find((a) => a.alias === alias)
    if (current && next === assetDisplayName(current)) return
    setError('')
    try {
      await renameGeneratedAsset(alias, next)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(String(err))
    }
  }, [renaming, assets])

  // Move the target aliases into another folder. We intentionally stay on the
  // current folder (don't follow the moved cards) — the reload drops them from
  // this view.
  const onTransport = useCallback(async (aliases: string[], destFolder: string) => {
    setContextMenu(null)
    setTransportOpen(false)
    setError('')
    if (aliases.length === 0) return
    try {
      await moveGeneratedAssets(aliases, destFolder)
      setSelected(new Set())
      anchorRef.current = null
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  // Move the target aliases into a favorite sub-group (favorites them + assigns
  // the group). A Transport destination of `__favorites__/<group>`.
  const onTransportToFavoriteGroup = useCallback(async (aliases: string[], groupFolder: string) => {
    setContextMenu(null)
    setTransportOpen(false)
    setError('')
    if (aliases.length === 0) return
    const group = groupFolder.slice(`${FAVORITES_FILTER}/`.length)
    try {
      await moveAssetsToFavoriteGroup(aliases, group)
      setSelected(new Set())
      anchorRef.current = null
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(String(err))
    }
  }, [])

  // Copy just records the source alias in the in-app clipboard — no bytes are
  // touched and the system clipboard is intentionally untouched (iframe-safe).
  const onCopy = useCallback((alias: string) => {
    setContextMenu(null)
    setClipboardAlias(alias)
    setClipboardMode('copy')
  }, [])

  // Cut mirrors Copy but flags the source for removal: on paste we duplicate
  // into the destination and then delete the original (read-only presets can't
  // be cut, so the menu hides Cut for them).
  const onCut = useCallback((alias: string) => {
    setContextMenu(null)
    setClipboardAlias(alias)
    setClipboardMode('cut')
  }, [])

  // Paste re-imports the clipboard alias into the active folder (a server-side
  // duplicate). In the All/presets views (no real writable folder) it lands in
  // `user`, matching the Import-to default. For a Cut, the original is removed
  // after a successful duplicate.
  const onPaste = useCallback(async () => {
    setContextMenu(null)
    const alias = clipboardAlias
    if (!alias) return
    const dest = folder && folder !== PRESET_FOLDER && folder !== FAVORITES_FILTER ? folder : 'staging'
    setError('')
    try {
      const asset = await copyAssetToFolder(alias, dest)
      if (clipboardMode === 'cut') {
        await deleteGeneratedAssets([alias])
        setClipboardAlias(null)
        setClipboardMode('copy')
      }
      setFolder(asset.folder)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(String(err))
    }
  }, [clipboardAlias, clipboardMode, folder])

  // Toggle the favorite flag on the target aliases (a flag on the record — never
  // copies). When called from the menu we favorite the whole target set based on
  // the right-clicked card's current state (un-favorite a favorited one).
  const onToggleFavorite = useCallback(
    async (aliases: string[]) => {
      setContextMenu(null)
      if (aliases.length === 0) return
      // Decide the new state from the first target: if it's already a favorite,
      // the action un-favorites; otherwise it favorites.
      const first = assets.find((a) => a.alias === aliases[0])
      const nextFav = !(first?.favorite === true)
      setError('')
      try {
        for (const alias of aliases) await setAssetFavorite(alias, nextFav)
        setReloadKey((k) => k + 1)
      } catch (err) {
        setError(String(err))
      }
    },
    [assets],
  )

  // Dismiss the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!contextMenu) return
    const close = () => {
      setContextMenu(null)
      setTransportOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  // After the menu mounts, refine its position from the real measured box so it
  // always stays fully inside the (iframe) viewport — never clipped at an edge.
  useEffect(() => {
    if (!contextMenu) return
    const el = menuRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const maxX = Math.max(4, window.innerWidth - rect.width - 4)
    const maxY = Math.max(4, window.innerHeight - rect.height - 4)
    const nx = Math.min(contextMenu.x, maxX)
    const ny = Math.min(contextMenu.y, maxY)
    if (nx !== contextMenu.x || ny !== contextMenu.y) {
      setContextMenu((prev) => (prev ? { ...prev, x: nx, y: ny } : prev))
    }
  }, [contextMenu])

  // Keyboard: Escape clears the selection; Delete/Backspace removes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.key === 'Escape' && selected.size > 0) {
        setSelected(new Set())
        anchorRef.current = null
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size > 0) {
        e.preventDefault()
        // Read-only preset assets cannot be deleted — drop them from the batch.
        const readonly = new Set(assets.filter((a) => a.readonly).map((a) => a.alias))
        const deletable = Array.from(selected).filter((alias) => !readonly.has(alias))
        if (deletable.length > 0) void onDeleteAliases(deletable)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, onDeleteAliases, assets])

  // Build the two-level rail tree from the backend's flat folder list. Pinned
  // virtual columns (presets / favorites / All) first; then the four fixed
  // leaf columns; then every other top-level menu with its ordered sub-menus.
  const tree = useMemo(() => buildFolderTree(folders, openMap, orderMap), [folders, openMap, orderMap])

  // A flat list of all real, writable destination folders (every leaf + child),
  // used by the Transport submenu (never the virtual presets/favorites/All).
  const transportTargets = useMemo(() => {
    const out: string[] = []
    for (const node of tree) {
      if (node.kind === 'virtual') continue
      if (node.folder && node.folder !== folder) out.push(node.folder)
      for (const child of node.children ?? []) if (child.folder !== folder) out.push(child.folder as string)
    }
    return out
  }, [tree, folder])

  // Favorite sub-groups (`__favorites__/<group>`) are also valid Transport
  // destinations — moving there favorites the asset and assigns the group
  // (a different op than a physical folder move). Listed as `favorites/<group>`.
  const favoriteGroupTargets = useMemo(() => {
    const fav = tree.find((n) => n.top === FAVORITES_FILTER)
    return (fav?.children ?? [])
      .map((c) => c.folder as string)
      .filter((f) => f !== folder)
  }, [tree, folder])

  // Whether the active view is a real writable folder (drives Paste / Import-to).
  const inWritableFolder = folder !== null && folder !== PRESET_FOLDER && folder !== FAVORITES_FILTER

  // Click a parent menu: toggle its sub-menu open/closed (persisted). A parent
  // is a grouping header — it does not itself become the active folder filter.
  const onToggleParent = useCallback((top: string) => {
    setOpenMap(toggleParentOpen(top))
  }, [])

  // Folder rail right-click → new sub-menu / delete menu. Only a non-fixed
  // top-level parent may add a sub-menu; fixed columns offer no menu ops at all.
  const onFolderContextMenu = useCallback(
    (e: React.MouseEvent, node: FolderNode) => {
      e.preventDefault()
      e.stopPropagation()
      // presets is plugin-shipped and read-only — no create/delete operations.
      if (node.top === PRESET_FOLDER) return
      // favorites is a single flat virtual column with no menu operations
      // (sub-groups are no longer supported).
      if (node.top === FAVORITES_FILTER) return
      // The All column and other plain virtual columns have no menu operations.
      if (node.kind === 'virtual' || node.folder === null) return
      if (isFixedTopFolder(node.folder)) return
      const canAddChild = node.kind === 'parent'
      const MENU_W = 160
      const MENU_H = 90
      const x = Math.min(e.clientX, Math.max(4, window.innerWidth - MENU_W))
      const y = Math.min(e.clientY, Math.max(4, window.innerHeight - MENU_H))
      setFolderMenu({ folder: node.folder, top: node.top, canAddChild, count: node.count, x, y })
    },
    [],
  )

  // Right-click "new menu" opens an in-app dialog (no browser prompt). The
  // actual folder creation happens on confirm in onConfirmCreateMenu.
  const onCreateMenu = useCallback((parent: string | null) => {
    setFolderMenu(null)
    setCreateName('')
    setCreatePrompt({ parent })
  }, [])

  const onConfirmCreateMenu = useCallback(
    async () => {
      const prompt = createPrompt
      const name = createName.trim()
      if (!prompt) return
      if (!name) {
        setCreatePrompt(null)
        return
      }
      const parent = prompt.parent
      const path = parent ? `${parent}/${name}` : name
      setCreatePrompt(null)
      setError('')
      try {
        const created = await createGeneratedFolder(path)
        // Auto-expand the parent so the freshly created sub-menu is visible.
        if (parent) {
          const top = created.split('/')[0]
          setOpenMap((prev) => {
            const next = { ...prev, [top]: true }
            try {
              localStorage.setItem('asset2d-store-open-folders', JSON.stringify(next))
            } catch {
              /* best-effort persistence */
            }
            return next
          })
        }
        setReloadKey((k) => k + 1)
      } catch (err) {
        setError(String(err))
      }
    },
    [createPrompt, createName],
  )

  const onDeleteMenu = useCallback(
    (path: string, count: number) => {
      setFolderMenu(null)
      const runDelete = async (): Promise<void> => {
        setError('')
        try {
          await deleteGeneratedFolder(path)
          // If the active folder was inside the deleted menu, fall back to All.
          if (folder && (folder === path || folder.startsWith(`${path}/`))) setFolder(null)
          setReloadKey((k) => k + 1)
        } catch (err) {
          setError(String(err))
        }
      }
      // Non-empty menus need an explicit confirmation (the images go with it).
      if (count > 0) {
        setConfirmDialog({
          title: 'Delete menu',
          message: `Delete menu “${path}” and its ${count} image${count > 1 ? 's' : ''}? This cannot be undone.`,
          confirmLabel: 'Delete',
          onConfirm: () => {
            setConfirmDialog(null)
            void runDelete()
          },
        })
        return
      }
      void runDelete()
    },
    [folder],
  )

  // Drop a dragged sub-menu before/onto a target sub-menu within the same
  // parent, persisting the new order. Cross-parent drops are ignored.
  const onChildDrop = useCallback(
    (top: string, targetFolder: string) => {
      const dragged = dragChild
      setDragChild(null)
      if (!dragged || dragged.top !== top || dragged.folder === targetFolder) return
      const parent = tree.find((n) => n.top === top && n.kind === 'parent')
      if (!parent?.children) return
      const paths = parent.children.map((c) => c.folder as string)
      const fromIdx = paths.indexOf(dragged.folder)
      const toIdx = paths.indexOf(targetFolder)
      if (fromIdx === -1 || toIdx === -1) return
      paths.splice(fromIdx, 1)
      paths.splice(toIdx, 0, dragged.folder)
      setOrderMap(writeChildOrder(top, paths))
    },
    [dragChild, tree],
  )

  // Autofocus the new-menu dialog input when it opens.
  useEffect(() => {
    if (!createPrompt) return
    const id = window.setTimeout(() => createInputRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [createPrompt])

  // Dismiss the folder rail menu on any outside click / scroll / Escape.
  useEffect(() => {
    if (!folderMenu) return
    const close = () => setFolderMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [folderMenu])

  // Close the view dropdown on an outside click.
  useEffect(() => {
    if (!viewMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setViewMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [viewMenuOpen])

  const currentView = VIEW_OPTIONS.find((v) => v.mode === viewMode) ?? VIEW_OPTIONS[0]

  // The loaded `assets` are stale during the brief window after a folder change
  // but before the refetch resolves. Mask the grid then so we never flash the
  // previous folder's thumbnails.
  const assetsStale = assetsFolder !== folder
  const displayedAssets = assetsStale ? [] : assets

  // ── Folder-view navigation ────────────────────────────────────────────────
  // The node at the tip of the drill path (null while at the top level).
  const folderTip = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null
  const hasChildren = (n: FolderNode | null): boolean => (n?.children?.length ?? 0) > 0
  // We show images (the asset grid) only when the tip is a leaf-like node (no
  // sub-folders). Otherwise we show that level's folder cards.
  const folderShowsImages = folderTip != null && !hasChildren(folderTip)
  // Cards to render at the current level: the tip's children, else the root tree.
  const folderCards = folderTip ? folderTip.children ?? [] : tree

  // Open a folder card: drill into its sub-folders, or (if it has none) descend
  // to its images — staying in folder mode, with the breadcrumb to climb back.
  const openFolderNode = useCallback(
    (node: FolderNode) => {
      setFolderPath((prev) => [...prev, node])
      // Images load off `folder`; set it whenever we enter a leaf (no children).
      if (!hasChildren(node)) setFolder(node.folder)
    },
    [],
  )

  // Breadcrumb click: 0 = the "Folders" root, i = the i-th path segment.
  const goToFolderCrumb = useCallback(
    (index: number) => {
      setFolderPath((prev) => {
        const next = prev.slice(0, index)
        const tip = next.length > 0 ? next[next.length - 1] : null
        // Re-point the asset list if the new tip is a leaf, else it's irrelevant.
        if (tip && (tip.children?.length ?? 0) === 0) setFolder(tip.folder)
        return next
      })
    },
    [],
  )

  // Leaving folder mode (or never in it) resets the drill path so re-entering
  // starts at the top level.
  useEffect(() => {
    if (viewMode !== 'folder') setFolderPath([])
  }, [viewMode])

  return (
    <main className="asset2d-store">
      <div className="asset2d-store__titlebar">
        <span className="asset2d-store__title">Asset Store</span>
        {selected.size > 0 && (
          <span className="asset2d-store__scope">{selected.size} selected</span>
        )}

        <div className="asset2d-store__titlebar-spacer" />

        <label className="asset2d-store__target">
          <span>Import to</span>
          <select
            value={target.kind}
            disabled={importing}
            onChange={(e) => {
              setTarget({ kind: e.currentTarget.value as ImportTarget['kind'] })
            }}
          >
            <option value="staging">staging</option>
            <option value="user">user</option>
            {inWritableFolder && <option value="current">{`current (${folder})`}</option>}
            <option value="new">new folder…</option>
          </select>
        </label>
        {target.kind === 'new' && (
          <input
            type="text"
            className="asset2d-store__new-folder"
            placeholder="folder name"
            value={newFolderName}
            disabled={importing}
            onChange={(e) => setNewFolderName(e.currentTarget.value)}
          />
        )}
        <button
          type="button"
          className="asset2d-store__import-btn"
          onClick={onImportClick}
          disabled={importing}
          title="Import images from your computer"
        >
          {importing ? 'Importing…' : 'Import Files'}
        </button>

        {/* View mode: icon-only dropdown (grid / list). */}
        <div className="asset2d-store__view" ref={viewMenuRef}>
          <button
            type="button"
            className={`asset2d-store__view-trigger${viewMenuOpen ? ' is-open' : ''}`}
            title={`View: ${currentView.label}`}
            aria-haspopup="listbox"
            aria-expanded={viewMenuOpen}
            onClick={() => setViewMenuOpen((o) => !o)}
          >
            <span className="asset2d-store__view-icon">{currentView.icon}</span>
            <ChevronDown size={13} />
          </button>
          {viewMenuOpen && (
            <div className="asset2d-store__view-menu" role="listbox">
              <div className="asset2d-store__view-header">View</div>
              {VIEW_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  role="option"
                  aria-selected={viewMode === opt.mode}
                  className={`asset2d-store__view-item${viewMode === opt.mode ? ' is-active' : ''}`}
                  onClick={() => {
                    setViewMode(opt.mode)
                    setViewMenuOpen(false)
                  }}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          type="button"
          className={`asset2d-store__ctrl-btn${isFocused ? ' is-active' : ''}`}
          title={isFocused ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={requestFocus}
        >
          {isFocused ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={onFileChange}
      />

      {error && <div className="asset2d-store__error">{error}</div>}

      {viewMode === 'folder' && (
        <nav className="asset2d-store__crumbs" aria-label="Folder path">
          <button
            type="button"
            className={`asset2d-store__crumb${folderPath.length === 0 ? ' is-current' : ''}`}
            onClick={() => goToFolderCrumb(0)}
          >
            <Folder size={12} />
            <span>Folders</span>
          </button>
          {folderPath.map((node, i) => (
            <span key={`${node.folder ?? node.top}-${i}`} className="asset2d-store__crumb-seg">
              <ChevronRight size={11} />
              <button
                type="button"
                className={`asset2d-store__crumb${i === folderPath.length - 1 ? ' is-current' : ''}`}
                onClick={() => goToFolderCrumb(i + 1)}
              >
                {node.label}
              </button>
            </span>
          ))}
        </nav>
      )}

      <section className={`asset2d-store__body${viewMode === 'folder' ? ' asset2d-store__body--folder' : ''}`}>
        {viewMode !== 'folder' && (
        <aside
          className="asset2d-store__folders"
          onContextMenu={(e) => {
            // Right-click on empty rail space → create a new top-level menu.
            e.preventDefault()
            const MENU_W = 160
            const MENU_H = 50
            const x = Math.min(e.clientX, Math.max(4, window.innerWidth - MENU_W))
            const y = Math.min(e.clientY, Math.max(4, window.innerHeight - MENU_H))
            setFolderMenu({ folder: '', top: '', canAddChild: false, count: 0, x, y })
          }}
        >
          {tree.map((node) => {
            if (node.kind === 'parent') {
              const isOpen = openMap[node.top] === true
              return (
                <div key={node.top} className="asset2d-store__folder-group">
                  <button
                    type="button"
                    className={
                      'asset2d-store__folder asset2d-store__folder--parent' +
                      (folder === node.top ? ' asset2d-store__folder--active' : '')
                    }
                    onClick={() => {
                      // Selecting a parent acts as an "All" for its subtree, and
                      // also toggles its sub-menu open/closed.
                      setFolder(node.top)
                      onToggleParent(node.top)
                    }}
                    onContextMenu={(e) => onFolderContextMenu(e, node)}
                    aria-expanded={isOpen}
                  >
                    <span className="asset2d-store__folder-label">{node.label}</span>
                    <span className="asset2d-store__folder-caret" aria-hidden>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <strong>{node.count}</strong>
                  </button>
                  {isOpen &&
                    (node.children ?? []).map((child) => (
                      <button
                        key={child.folder as string}
                        type="button"
                        className={
                          'asset2d-store__folder asset2d-store__folder--child' +
                          (folder === child.folder ? ' asset2d-store__folder--active' : '') +
                          (dragChild?.folder === child.folder ? ' asset2d-store__folder--dragging' : '')
                        }
                        draggable
                        onDragStart={(e) => {
                          setDragChild({ top: node.top, folder: child.folder as string })
                          e.dataTransfer.effectAllowed = 'move'
                          // A payload is required for the drag to start in some browsers.
                          e.dataTransfer.setData('text/plain', child.folder as string)
                        }}
                        onDragOver={(e) => {
                          if (dragChild?.top === node.top) {
                            e.preventDefault()
                            e.dataTransfer.dropEffect = 'move'
                          }
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          onChildDrop(node.top, child.folder as string)
                        }}
                        onDragEnd={() => setDragChild(null)}
                        onClick={() => setFolder(child.folder)}
                        onContextMenu={(e) => onFolderContextMenu(e, child)}
                      >
                        <span className="asset2d-store__folder-label">{child.label}</span>
                        <strong>{child.count}</strong>
                      </button>
                    ))}
                </div>
              )
            }
            // virtual (presets/favorites/All) — may carry children (preset
            // sub-folders / favorite groups) rendered as an expandable group.
            if (node.children && node.children.length > 0) {
              const isOpen = openMap[node.top] === true
              return (
                <div key={node.top} className="asset2d-store__folder-group">
                  <button
                    type="button"
                    className={
                      'asset2d-store__folder asset2d-store__folder--vparent' +
                      (folder === node.folder ? ' asset2d-store__folder--active' : '') +
                      (node.folder === PRESET_FOLDER ? ' asset2d-store__folder--preset' : '')
                    }
                    onClick={() => {
                      // Match real parent menus: clicking anywhere on the row
                      // selects the column AND toggles its sub-menu open/closed.
                      setFolder(node.folder)
                      onToggleParent(node.top)
                    }}
                    onContextMenu={(e) => onFolderContextMenu(e, node)}
                  >
                    <span className="asset2d-store__folder-label">{node.label}</span>
                    <span className="asset2d-store__folder-caret" aria-hidden>
                      {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </span>
                    <strong>{node.count}</strong>
                  </button>
                  {isOpen &&
                    node.children.map((child) => (
                      <button
                        key={child.folder as string}
                        type="button"
                        className={
                          'asset2d-store__folder asset2d-store__folder--child' +
                          (folder === child.folder ? ' asset2d-store__folder--active' : '')
                        }
                        onClick={() => setFolder(child.folder)}
                        onContextMenu={(e) => onFolderContextMenu(e, child)}
                      >
                        <span className="asset2d-store__folder-label">{child.label}</span>
                        <strong>{child.count}</strong>
                      </button>
                    ))}
                </div>
              )
            }
            // virtual without children, or fixed leaf column.
            return (
              <button
                key={node.folder ?? '__all__'}
                type="button"
                className={
                  'asset2d-store__folder' +
                  (folder === node.folder ? ' asset2d-store__folder--active' : '') +
                  (node.folder === PRESET_FOLDER ? ' asset2d-store__folder--preset' : '')
                }
                onClick={() => setFolder(node.folder)}
                onContextMenu={(e) => onFolderContextMenu(e, node)}
              >
                <span className="asset2d-store__folder-label">{node.label}</span>
                <strong>{node.count}</strong>
              </button>
            )
          })}
        </aside>
        )}

        {viewMode === 'folder' && !folderShowsImages ? (
          <div className="asset2d-store__folder-view">
            {folderCards.map((node) => (
              <FolderCard
                key={node.folder ?? node.top ?? '__all__'}
                node={node}
                onOpen={() => openFolderNode(node)}
              />
            ))}
            {folderCards.length === 0 && <p className="asset2d-store__empty">No folders yet.</p>}
          </div>
        ) : (
        <div
          className={`asset2d-store__grid asset2d-store__grid--${viewMode === 'folder' ? 'grid' : viewMode}`}
          onContextMenu={onBlankContextMenu}
        >
          {displayedAssets.map((asset) => (
            <article
              key={asset.alias}
              className={`asset2d-store__card${selected.has(asset.alias) ? ' asset2d-store__card--selected' : ''}`}
              onClick={(e) => onCardClick(e, asset)}
              onContextMenu={(e) => onCardContextMenu(e, asset)}
              draggable
              onDragStart={(e) => {
                // Native dataTransfer does not cross the iframe boundary into the
                // host canvas, so hand the asset off through the localStorage bus
                // (channel C). The host canvas reads it synchronously on drop and
                // creates an `image_source` node. We still set a dataTransfer
                // payload so the browser shows a drag image / allows the drag.
                writeDraggedAsset({ alias: asset.alias, blobId: asset.blobId, mimeType: asset.mimeType })
                e.dataTransfer.effectAllowed = 'copy'
                e.dataTransfer.setData('text/plain', asset.alias)
              }}
              onDragEnd={() => clearDraggedAssetDeferred()}
            >
              <img src={generatedAssetUrl(asset.alias)} alt={assetDisplayName(asset)} draggable={false} />
              {asset.favorite && folder !== FAVORITES_FILTER && (
                <span className="asset2d-store__fav-badge" title="Favorite" aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                    <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.9l-5.81 3.06 1.11-6.47L2.6 9.35l6.5-.95L12 2.5z" />
                  </svg>
                </span>
              )}
              <div className="asset2d-store__card-body">
                {renaming?.alias === asset.alias ? (
                  <input
                    className="asset2d-store__rename-input"
                    type="text"
                    autoFocus
                    value={renaming.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenaming({ alias: asset.alias, value: e.currentTarget.value })}
                    onBlur={() => void onCommitRename()}
                    onKeyDown={(e) => {
                      e.stopPropagation()
                      if (e.key === 'Enter') void onCommitRename()
                      else if (e.key === 'Escape') setRenaming(null)
                    }}
                  />
                ) : (
                  <h2 onDoubleClick={() => !asset.readonly && onStartRename(asset.alias)}>{assetDisplayName(asset)}</h2>
                )}
                <p>{asset.prompt ?? asset.source ?? asset.relPath}</p>
              </div>
            </article>
          ))}
          {!assetsStale && assets.length === 0 && <p className="asset2d-store__empty">No generated assets in this folder yet.</p>}
        </div>
        )}
      </section>

      {contextMenu && (
        <ul
          ref={menuRef}
          className="asset2d-store__context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.blank ? (
            <li>
              <button
                type="button"
                className={
                  'asset2d-store__context-item' +
                  (clipboardAlias ? '' : ' asset2d-store__context-item--disabled')
                }
                disabled={!clipboardAlias}
                onClick={() => clipboardAlias && void onPaste()}
              >
                Paste
              </button>
            </li>
          ) : (
            <>
          {contextMenu.aliases.length === 1 && (
            <li>
              <button
                type="button"
                className="asset2d-store__context-item"
                onClick={() => onStartRename(contextMenu.aliases[0])}
              >
                Rename
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="asset2d-store__context-item"
              onClick={() => void onToggleFavorite(contextMenu.aliases)}
            >
              {assets.find((a) => a.alias === contextMenu.aliases[0])?.favorite
                ? 'Remove from favorites'
                : 'Add to favorites'}
            </button>
          </li>
          {(transportTargets.length > 0 || favoriteGroupTargets.length > 0) && (
            <li
              className="asset2d-store__context-sub"
              onMouseEnter={() => {
                // Decide which side the fly-out opens on so it never spills past
                // the (iframe) viewport: prefer the right, flip left when there
                // isn't room. ~150px is the submenu's max width.
                const rect = menuRef.current?.getBoundingClientRect()
                const SUBMENU_W = 150
                const flip = rect ? rect.right + SUBMENU_W > window.innerWidth : false
                setTransportFlip(flip)
                setTransportOpen(true)
              }}
              onMouseLeave={() => setTransportOpen(false)}
            >
              <button type="button" className="asset2d-store__context-item">
                <span>Transport</span>
                <span className="asset2d-store__context-caret">›</span>
              </button>
              {transportOpen && (
                <ul
                  className={
                    'asset2d-store__context-submenu' +
                    (transportFlip ? ' asset2d-store__context-submenu--left' : '')
                  }
                >
                  {transportTargets.map((dest) => (
                    <li key={dest}>
                      <button
                        type="button"
                        className="asset2d-store__context-item"
                        onClick={() => void onTransport(contextMenu.aliases, dest)}
                      >
                        {dest}
                      </button>
                    </li>
                  ))}
                  {favoriteGroupTargets.map((dest) => (
                    <li key={dest}>
                      <button
                        type="button"
                        className="asset2d-store__context-item"
                        onClick={() => void onTransportToFavoriteGroup(contextMenu.aliases, dest)}
                      >
                        {`favorites/${dest.slice(`${FAVORITES_FILTER}/`.length)}`}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )}
          {contextMenu.aliases.length === 1 && (
            <li>
              <button
                type="button"
                className="asset2d-store__context-item"
                onClick={() => onCopy(contextMenu.aliases[0])}
              >
                Copy
              </button>
            </li>
          )}
          {contextMenu.aliases.length === 1 &&
            !assets.find((a) => a.alias === contextMenu.aliases[0])?.readonly && (
              <li>
                <button
                  type="button"
                  className="asset2d-store__context-item"
                  onClick={() => onCut(contextMenu.aliases[0])}
                >
                  Cut
                </button>
              </li>
            )}
          {clipboardAlias && (
            <li>
              <button type="button" className="asset2d-store__context-item" onClick={() => void onPaste()}>
                Paste
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              className="asset2d-store__context-item asset2d-store__context-item--danger"
              onClick={() => void onDeleteAliases(contextMenu.aliases)}
            >
              {contextMenu.aliases.length > 1 ? `Delete ${contextMenu.aliases.length} items` : 'Delete'}
            </button>
          </li>
            </>
          )}
        </ul>
      )}

      {folderMenu && (
        <ul
          className="asset2d-store__context-menu"
          style={{ left: folderMenu.x, top: folderMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {folderMenu.folder === '' ? (
            <li>
              <button
                type="button"
                className="asset2d-store__context-item"
                onClick={() => onCreateMenu(null)}
              >
                New menu
              </button>
            </li>
          ) : (
            <>
              {folderMenu.canAddChild && (
                <li>
                  <button
                    type="button"
                    className="asset2d-store__context-item"
                    onClick={() => onCreateMenu(folderMenu.folder)}
                  >
                    New sub-menu
                  </button>
                </li>
              )}
              <li>
                <button
                  type="button"
                  className="asset2d-store__context-item asset2d-store__context-item--danger"
                  onClick={() => void onDeleteMenu(folderMenu.folder, folderMenu.count)}
                >
                  Delete menu
                </button>
              </li>
            </>
          )}
        </ul>
      )}

      {createPrompt && (
        <div
          className="asset2d-store__dialog-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setCreatePrompt(null)
          }}
        >
          <div className="asset2d-store__dialog">
            <div className="asset2d-store__dialog-header">
              <span className="asset2d-store__dialog-title">
                {createPrompt.parent ? 'New sub-menu' : 'New menu'}
              </span>
              <button
                type="button"
                className="asset2d-store__dialog-close"
                onClick={() => setCreatePrompt(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="asset2d-store__dialog-body">
              <label className="asset2d-store__dialog-label">
                {createPrompt.parent ? `Under “${createPrompt.parent}”` : 'Menu name'}
              </label>
              <input
                ref={createInputRef}
                className="asset2d-store__dialog-input"
                type="text"
                value={createName}
                placeholder="Enter a name…"
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') void onConfirmCreateMenu()
                  else if (e.key === 'Escape') setCreatePrompt(null)
                }}
              />
            </div>
            <div className="asset2d-store__dialog-footer">
              <button
                type="button"
                className="asset2d-store__dialog-btn asset2d-store__dialog-btn--cancel"
                onClick={() => setCreatePrompt(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="asset2d-store__dialog-btn asset2d-store__dialog-btn--confirm"
                onClick={() => void onConfirmCreateMenu()}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div
          className="asset2d-store__dialog-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setConfirmDialog(null)
          }}
        >
          <div className="asset2d-store__dialog">
            <div className="asset2d-store__dialog-header">
              <span className="asset2d-store__dialog-title">{confirmDialog.title}</span>
              <button
                type="button"
                className="asset2d-store__dialog-close"
                onClick={() => setConfirmDialog(null)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="asset2d-store__dialog-body">
              <p className="asset2d-store__dialog-message">{confirmDialog.message}</p>
            </div>
            <div className="asset2d-store__dialog-footer">
              <button
                type="button"
                className="asset2d-store__dialog-btn asset2d-store__dialog-btn--cancel"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="asset2d-store__dialog-btn asset2d-store__dialog-btn--danger"
                onClick={confirmDialog.onConfirm}
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

// A folder card in the folder view — a Windows-explorer-style folder whose lid
// peeks at up to 4 sample thumbnails inside, plus the folder name + asset count.
// Mirrors the scene-generator AssetStore's FolderCard. Samples are fetched
// lazily per card (the folder list only carries name + count).
function FolderCard({ node, onOpen }: { node: FolderNode; onOpen: () => void }): JSX.Element {
  const [samples, setSamples] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    // A folder that only holds sub-folders (e.g. `presets`) has no assets of its
    // own to peek at, so its own listing comes back empty. In that case peek into
    // its children's folders instead so the card still previews real thumbnails.
    const children = node.children ?? []
    const sources: Array<string | undefined> =
      children.length > 0 ? children.map((c) => c.folder ?? undefined) : [node.folder ?? undefined]
    void Promise.all(
      sources.map((f) =>
        listGeneratedAssets(f)
          .then((items) => items.map((a) => a.alias))
          .catch(() => [] as string[]),
      ),
    )
      .then((lists) => {
        if (cancelled) return
        // Round-robin a couple from each source so a mixed peek shows variety,
        // but cap at 4 cells.
        const flat: string[] = []
        let i = 0
        while (flat.length < 4 && lists.some((l) => i < l.length)) {
          for (const l of lists) {
            if (i < l.length && flat.length < 4) flat.push(l[i])
          }
          i += 1
        }
        setSamples(flat)
      })
      .catch(() => {
        /* a card with no peek is fine — it falls back to the folder glyph. */
      })
    return () => {
      cancelled = true
    }
  }, [node.folder, node.children])

  return (
    <button
      type="button"
      className="asset2d-store__folder-card"
      onClick={onOpen}
      title={`${node.label} · ${node.count}`}
    >
      <div className="asset2d-store__folder-card-visual">
        <div className="asset2d-store__folder-card-tab" />
        <div className="asset2d-store__folder-card-body">
          <div className={`asset2d-store__folder-card-peek asset2d-store__folder-card-peek--${samples.length}`}>
            {samples.length === 0 ? (
              <Folder size={26} />
            ) : (
              samples.map((alias) => (
                <span key={alias} className="asset2d-store__folder-card-cell">
                  <img className="asset2d-store__folder-card-img" src={generatedAssetUrl(alias)} alt="" loading="lazy" />
                </span>
              ))
            )}
          </div>
        </div>
      </div>
      <div className="asset2d-store__folder-card-name">{node.label}</div>
      <div className="asset2d-store__folder-card-count">{node.count}</div>
    </button>
  )
}
