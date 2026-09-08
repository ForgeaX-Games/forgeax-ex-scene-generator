// Asset Store left-pane controls — five draggable/collapsible sections matching the
// Scene Generator panel chrome (`editor-controls-panel` + `controlSections.tsx`).
//
//  1. Basic Operations   — search, import, repair, batch mode
//  2. Asset Preview · Anchor · Collision
//  3. Filters            — 13-field name filters
//  4. Library Info       — merged monitor stats
//  5. Help               — asset-library guide (separate from Scene Generator help)

import { useCallback, useEffect, useRef, useState } from 'react'
import { libraryApi, type AssetRecord, type MonitorResult, type NonStandardAsset } from '../surfaces/library/libraryApi.js'
import {
  readControl,
  readSelection,
  requestRefresh,
  requestReveal,
  subscribeSelection,
  writeControl,
  type AssetControl,
  type AssetSelection,
} from '../surfaces/library/assetControlBus.js'
import { DragTitle, SectionTitle } from './controlSections.js'
import { applySectionDragDelta, usePanelDragMinHeight } from './sectionDragResize.js'
import {
  DIRECTION_OPTIONS,
  fieldAt,
  MATERIAL_DEFAULT_OPTIONS,
  SLOT,
} from '../surfaces/library/aliasName.js'

const LS_HEIGHTS = 'wb-scene-generator.assetstore-heights'
const LS_COLLAPSED = 'wb-scene-generator.assetstore-collapsed'
const MIN_H = 48
const HELP_MIN = 100
const DEFAULTS = { basicOps: 200, preview: 220, filters: 200, libraryInfo: 160, help: 140 }

type SectionKey = 'basicOps' | 'preview' | 'filters' | 'libraryInfo' | 'help'
interface Heights {
  basicOps: number
  preview: number
  filters: number
  libraryInfo: number
  help: number
}

const SECTION_ORDER: readonly SectionKey[] = ['basicOps', 'preview', 'filters', 'libraryInfo', 'help']

function minHeightFor(key: SectionKey): number {
  return key === 'help' ? HELP_MIN : MIN_H
}

interface Collapsed {
  basicOps: boolean
  preview: boolean
  filters: boolean
  libraryInfo: boolean
  help: boolean
}

function loadCollapsed(): Collapsed {
  try {
    const raw = localStorage.getItem(LS_COLLAPSED)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      return {
        basicOps: o.basicOps === true,
        preview: o.preview === true,
        filters: o.filters !== false, // collapsed by default
        libraryInfo: o.libraryInfo !== false,
        help: o.help === true,
      }
    }
  } catch {
    /* ignore */
  }
  return { basicOps: false, preview: false, filters: true, libraryInfo: true, help: false }
}

function saveCollapsed(c: Collapsed): void {
  try {
    localStorage.setItem(LS_COLLAPSED, JSON.stringify(c))
  } catch {
    /* ignore */
  }
}

function loadHeights(): Heights {
  try {
    const raw = localStorage.getItem(LS_HEIGHTS)
    if (raw) {
      const o = JSON.parse(raw) as Record<string, unknown>
      return {
        basicOps: Math.max(MIN_H, typeof o.basicOps === 'number' ? o.basicOps : DEFAULTS.basicOps),
        preview: Math.max(MIN_H, typeof o.preview === 'number' ? o.preview : DEFAULTS.preview),
        filters: Math.max(MIN_H, typeof o.filters === 'number' ? o.filters : DEFAULTS.filters),
        libraryInfo: Math.max(MIN_H, typeof o.libraryInfo === 'number' ? o.libraryInfo : DEFAULTS.libraryInfo),
        help: Math.max(HELP_MIN, typeof o.help === 'number' ? o.help : DEFAULTS.help),
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

function saveHeights(h: Heights): void {
  try {
    localStorage.setItem(LS_HEIGHTS, JSON.stringify(h))
  } catch {
    /* ignore */
  }
}

// 13-field filter definitions. Labels + option values mirror the asset-library
// generator's SSOT (asset_manager FILTER_FIELD_DEFS / fieldDropdownOptions), so
// the two apps' schema stay in lockstep. `select` fields merge these static
// defaults with the library's live distinct values (see FieldFilterRow), so
// e.g. Material stays open-ended (纸/布/竹… appear automatically once ingested).
interface FieldDef {
  idx: number
  label: string
  type: 'select' | 'input'
  staticOptions?: string[]
}

const FIELD_DEFS: FieldDef[] = [
  { idx: SLOT.index, label: '索引', type: 'input' },
  { idx: SLOT.indoorOutdoor, label: '内外', type: 'select', staticOptions: ['室内', '室外'] },
  { idx: SLOT.name, label: '名称', type: 'input' },
  { idx: SLOT.material, label: '材质', type: 'select', staticOptions: [...MATERIAL_DEFAULT_OPTIONS] },
  { idx: SLOT.direction, label: '朝向', type: 'select', staticOptions: [...DIRECTION_OPTIONS] },
  { idx: SLOT.themeStyle, label: '题材风格', type: 'select' },
  { idx: SLOT.state, label: '状态', type: 'select', staticOptions: ['正常', '破损'] },
  { idx: SLOT.cropType, label: '类型/规则', type: 'select' },
  { idx: SLOT.size, label: '尺寸', type: 'select' },
  { idx: SLOT.isStatic, label: '静态', type: 'select', staticOptions: ['静态', '动态'] },
  {
    idx: SLOT.filterTemplate,
    label: '滤镜模板',
    type: 'select',
    staticOptions: [
      '无', '中式仙侠', '中式恐怖', '日式和风', '标准西幻', '黑暗奇幻', '历史/维多利亚',
      '赛博朋克', '太空高科', '废土黄沙', '血腥深渊', '生化异星', '梦境糖果',
    ],
  },
  // 变体：任意 ≥0 整数皆合法 → 自由输入(子串匹配)，不锁定成固定下拉。
  { idx: SLOT.serial, label: '变体', type: 'input' },
  { idx: SLOT.appearancePlace, label: '出现场所', type: 'input' },
]

type NameFilters = Record<number, string>

function toFieldFilters(f: NameFilters): AssetControl['fieldFilters'] {
  return Object.entries(f)
    .filter(([, v]) => v.trim().length > 0)
    .map(([idx, v]) => ({ fieldIdx: Number(idx), value: v.trim() }))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

function formatWhen(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString()
}

function sortOptions(opts: string[]): string[] {
  const numeric = opts.length > 0 && opts.every((v) => /^\d+$/.test(v))
  return numeric ? [...opts].sort((a, b) => Number(a) - Number(b)) : opts
}

function clampAnchor(v: string): number | null {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

export function AssetStorePanel(): JSX.Element {
  const [control, setControlState] = useState<AssetControl>(() => readControl())
  const [filters, setFilters] = useState<NameFilters>(() => {
    const map: NameFilters = {}
    for (const f of readControl().fieldFilters) map[f.fieldIdx] = f.value
    return map
  })
  const [selection, setSelection] = useState<AssetSelection>(() => readSelection())
  const [heights, setHeights] = useState<Heights>(loadHeights)
  const [collapsed, setCollapsed] = useState<Collapsed>(loadCollapsed)
  const panelRef = useRef<HTMLDivElement>(null)
  const { panelStyle, onDragStart } = usePanelDragMinHeight(panelRef)

  const pushControl = useCallback((next: AssetControl) => {
    setControlState(next)
    writeControl(next)
  }, [])

  useEffect(() => subscribeSelection(setSelection), [])
  useEffect(() => setSelection(readSelection()), [])

  const toggleCollapsed = useCallback((key: SectionKey) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      saveCollapsed(next)
      return next
    })
  }, [])

  const dragBasicOps = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'basicOps', dy, minHeightFor) as Heights
      saveHeights(next)
      return next
    })
  }, [])
  const dragPreview = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'preview', dy, minHeightFor) as Heights
      saveHeights(next)
      return next
    })
  }, [])
  const dragFilters = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'filters', dy, minHeightFor) as Heights
      saveHeights(next)
      return next
    })
  }, [])
  const dragLibraryInfo = useCallback((dy: number) => {
    setHeights((prev) => {
      const next = applySectionDragDelta(prev, SECTION_ORDER, 'libraryInfo', dy, minHeightFor) as Heights
      saveHeights(next)
      return next
    })
  }, [])

  const setSearch = (search: string) => pushControl({ ...control, search })
  const setFilter = (idx: number, value: string) => {
    const next = { ...filters }
    if (value.trim()) next[idx] = value.trim()
    else delete next[idx]
    setFilters(next)
    pushControl({ ...control, fieldFilters: toFieldFilters(next) })
  }
  const clearFilters = () => {
    setFilters({})
    pushControl({ ...control, fieldFilters: [] })
  }
  const setBatch = (batchMode: boolean) => pushControl({ ...control, batchMode })

  const activeFilterCount = Object.keys(filters).length

  return (
    <div className="editor-controls-panel" ref={panelRef} style={panelStyle}>
      {/* 1 — Basic Operations */}
      <div
        className="editor-controls__section"
        style={collapsed.basicOps ? undefined : { height: heights.basicOps }}
      >
        <SectionTitle
          label="Basic Operations"
          collapsed={collapsed.basicOps}
          onToggle={() => toggleCollapsed('basicOps')}
        />
        {!collapsed.basicOps && (
          <div className="editor-controls__section-content">
            <BasicOperationsBody
              search={control.search}
              batchMode={control.batchMode}
              selection={selection}
              onSearch={setSearch}
              onToggleBatch={() => setBatch(!control.batchMode)}
            />
          </div>
        )}
      </div>

      {/* 2 — Asset Preview · Anchor · Collision */}
      <div
        className="editor-controls__section"
        style={collapsed.preview ? undefined : { height: heights.preview }}
      >
        <DragTitle
          label="Asset Preview · Anchor · Collision"
          collapsed={collapsed.preview}
          onToggle={() => toggleCollapsed('preview')}
          onDrag={dragBasicOps}
          onDragStart={onDragStart}
        />
        {!collapsed.preview && (
          <div className="editor-controls__section-content">
            <PreviewAnchorCollisionBody asset={selection.asset} />
          </div>
        )}
      </div>

      {/* 3 — Filters */}
      <div
        className="editor-controls__section"
        style={collapsed.filters ? undefined : { height: heights.filters }}
      >
        <DragTitle
          label="Filters"
          collapsed={collapsed.filters}
          onToggle={() => toggleCollapsed('filters')}
          onDrag={dragPreview}
          onDragStart={onDragStart}
        />
        {!collapsed.filters && (
          <div className="editor-controls__section-content">
            <FiltersBody
              filters={filters}
              activeCount={activeFilterCount}
              onChange={setFilter}
              onClear={clearFilters}
            />
          </div>
        )}
      </div>

      {/* 4 — Library Info */}
      <div
        className="editor-controls__section"
        style={collapsed.libraryInfo ? undefined : { height: heights.libraryInfo }}
      >
        <DragTitle
          label="Library Info"
          collapsed={collapsed.libraryInfo}
          onToggle={() => toggleCollapsed('libraryInfo')}
          onDrag={dragFilters}
          onDragStart={onDragStart}
        />
        {!collapsed.libraryInfo && (
          <div className="editor-controls__section-content">
            <LibraryInfoBody />
          </div>
        )}
      </div>

      {/* 5 — Help */}
      <div
        className="editor-controls__section"
        style={collapsed.help ? undefined : { height: heights.help }}
      >
        <DragTitle
          label="Help"
          collapsed={collapsed.help}
          onToggle={() => toggleCollapsed('help')}
          onDrag={dragLibraryInfo}
          onDragStart={onDragStart}
        />
        {!collapsed.help && (
          <div className="editor-controls__section-content">
            <div className="scene-left-pane__help">
              <AssetStoreHelp />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 1. Basic Operations ───────────────────────────────────────────────────────

function BasicOperationsBody({
  search,
  batchMode,
  selection,
  onSearch,
  onToggleBatch,
}: {
  search: string
  batchMode: boolean
  selection: AssetSelection
  onSearch: (q: string) => void
  onToggleBatch: () => void
}): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(search)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [repairOpen, setRepairOpen] = useState(false)
  const [candidates, setCandidates] = useState<AssetRecord[]>([])
  const [suggestOpen, setSuggestOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const searchRef = useRef<HTMLDivElement>(null)
  // Set when picking a candidate so the input's blur handler skips committing a
  // grid-filtering search (a candidate pick reveals, it does not filter).
  const pickingRef = useRef(false)
  const ids = selection.selectedIds
  const inTrash = selection.zone === 'trash'
  const zone = selection.zone || 'raw'

  useEffect(() => setDraft(search), [search])

  // Debounced candidate fetch for the current-zone alias dropdown. Read-only
  // (libraryApi.list) — never writes `control`, so the right-side grid is not
  // filtered while typing.
  useEffect(() => {
    const q = draft.trim()
    if (!suggestOpen || q.length === 0) {
      setCandidates([])
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      libraryApi
        .list({ zone, search: q, page: 1, pageSize: 20 })
        .then((res) => {
          if (!cancelled) {
            setCandidates(res.items)
            setActiveIdx(-1)
          }
        })
        .catch(() => {
          if (!cancelled) setCandidates([])
        })
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [draft, zone, suggestOpen])

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!suggestOpen) return
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSuggestOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [suggestOpen])

  // Pick a candidate: fill the input, reveal/select it in the grid (jump to its
  // page), and close — without committing a grid-filtering search.
  const pickCandidate = useCallback(
    (alias: string) => {
      pickingRef.current = true
      setDraft(alias)
      setSuggestOpen(false)
      setCandidates([])
      requestReveal(alias)
    },
    [],
  )

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    setMsg(null)
    let ok = 0
    const errors: string[] = []
    for (const file of Array.from(files)) {
      try {
        await libraryApi.import(file)
        ok += 1
      } catch (e) {
        errors.push(`${file.name}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    setMsg(errors.length ? `Imported ${ok}, ${errors.length} failed` : `Imported ${ok} asset(s) to staging`)
    requestRefresh()
  }, [])

  const runBatch = async (op: 'trash' | 'restore' | 'delete', confirmMsg?: string) => {
    if (ids.length === 0) return
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      await libraryApi.batch(op, ids)
    } finally {
      setBusy(false)
      requestRefresh(true)
    }
  }

  return (
    <div className="asp-stack">
      <div className="asp-search" ref={searchRef}>
        <input
          className="asp-input"
          value={draft}
          placeholder="Search by alias…"
          role="combobox"
          aria-expanded={suggestOpen && candidates.length > 0}
          aria-autocomplete="list"
          aria-controls="asp-suggest-list"
          onChange={(e) => {
            setDraft(e.target.value)
            setSuggestOpen(true)
          }}
          onFocus={() => setSuggestOpen(true)}
          onKeyDown={(e) => {
            if (suggestOpen && candidates.length > 0) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActiveIdx((i) => (i + 1) % candidates.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActiveIdx((i) => (i <= 0 ? candidates.length - 1 : i - 1))
                return
              }
              if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault()
                pickCandidate(candidates[activeIdx].alias)
                return
              }
            }
            if (e.key === 'Enter') {
              setSuggestOpen(false)
              onSearch(draft)
            }
            if (e.key === 'Escape') {
              if (suggestOpen) {
                setSuggestOpen(false)
              } else {
                setDraft('')
                onSearch('')
              }
            }
          }}
          onBlur={() => {
            // A candidate pick handles its own state; don't also commit a search.
            if (pickingRef.current) {
              pickingRef.current = false
              return
            }
            onSearch(draft)
          }}
        />
        {draft && (
          <button
            type="button"
            className="asp-input-clear"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setDraft('')
              setSuggestOpen(false)
              setCandidates([])
              onSearch('')
            }}
            title="Clear"
          >
            ×
          </button>
        )}
        {suggestOpen && candidates.length > 0 && (
          <ul className="asp-suggest" id="asp-suggest-list" role="listbox">
            {candidates.map((c, i) => (
              <li
                key={c.id}
                role="option"
                aria-selected={i === activeIdx}
                className={`asp-suggest-item${i === activeIdx ? ' is-active' : ''}`}
                title={c.alias}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => {
                  // Keep input focus so blur doesn't fire a grid-filtering search.
                  e.preventDefault()
                  pickCandidate(c.alias)
                }}
              >
                <img className="asp-suggest-thumb" src={libraryApi.serveUrl(c.alias)} alt="" loading="lazy" />
                <span className="asp-suggest-alias">{c.alias}</span>
                {c.private && <span className="asp-suggest-badge">私</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="asp-actions">
        <button
          type="button"
          className="editor-controls__btn asp-btn-primary"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy ? 'Importing…' : 'Import from disk'}
        </button>
        <button type="button" className="editor-controls__btn" onClick={() => setRepairOpen(true)}>
          Repair aliases
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.currentTarget.value = ''
          }}
        />
      </div>

      <div className="asp-actions">
        <button
          type="button"
          className={`editor-controls__btn${batchMode ? ' is-on' : ''}`}
          onClick={onToggleBatch}
        >
          {batchMode ? 'Exit batch mode' : 'Batch mode'}
        </button>
      </div>

      {batchMode && (
        <div className="asp-batch">
          <p className="asp-hint">
            Selected <strong>{ids.length}</strong> private asset(s) in the grid. Built-in assets cannot be
            batch-edited.
          </p>
          <div className="asp-actions">
            {inTrash ? (
              <>
                <button
                  type="button"
                  className="editor-controls__btn"
                  disabled={busy || ids.length === 0}
                  onClick={() => void runBatch('restore')}
                >
                  Restore
                </button>
                <button
                  type="button"
                  className="editor-controls__btn asp-btn-danger"
                  disabled={busy || ids.length === 0}
                  onClick={() =>
                    void runBatch('delete', `Permanently delete ${ids.length} asset(s)? This cannot be undone.`)
                  }
                >
                  Delete permanently
                </button>
              </>
            ) : (
              <button
                type="button"
                className="editor-controls__btn asp-btn-danger"
                disabled={busy || ids.length === 0}
                onClick={() => void runBatch('trash')}
              >
                Move to trash
              </button>
            )}
            <button
              type="button"
              className="editor-controls__btn"
              disabled={ids.length === 0}
              onClick={() => requestRefresh(true)}
            >
              Clear selection
            </button>
          </div>
        </div>
      )}

      {msg && <p className="asp-hint">{msg}</p>}
      <p className="asp-hint asp-hint--muted">
        Imports are project-private (marked with a Private badge on thumbnails). They can be repaired, moved, or
        deleted. The built-in library is read-only.
      </p>
      {repairOpen && <RepairModal onClose={() => setRepairOpen(false)} />}
    </div>
  )
}

function RepairModal({ onClose }: { onClose: () => void }): JSX.Element {
  type Phase = 'loading' | 'list' | 'working' | 'done' | 'error'
  const [phase, setPhase] = useState<Phase>('loading')
  const [rows, setRows] = useState<NonStandardAsset[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [err, setErr] = useState('')
  const [count, setCount] = useState(0)

  useEffect(() => {
    libraryApi
      .nonStandard()
      .then((r) => {
        setRows(r)
        setSelected(new Set(r.map((x) => x.id)))
        setPhase(r.length === 0 ? 'done' : 'list')
      })
      .catch((e) => {
        setErr(String(e))
        setPhase('error')
      })
  }, [])

  const convert = async () => {
    if (selected.size === 0) return
    setPhase('working')
    try {
      const res = await libraryApi.batchRepair([...selected])
      setCount(res.repaired)
      requestRefresh()
      setPhase('done')
    } catch (e) {
      setErr(String(e))
      setPhase('error')
    }
  }

  return (
    <div
      className="asp-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="asp-modal">
        <div className="asp-modal-head">
          <span>Repair aliases</span>
          <button type="button" className="asp-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        {phase === 'list' && (
          <>
            <p className="asp-hint">
              These private assets do not use the standard <code>[field]_[field]…</code> bracket format. Repair
              copies the filename into the <strong>Item name</strong> field.
            </p>
            <div className="asp-modal-list">
              {rows.map((r) => (
                <label key={r.id} className="asp-modal-row">
                  <input
                    type="checkbox"
                    checked={selected.has(r.id)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(r.id)) next.delete(r.id)
                      else next.add(r.id)
                      setSelected(next)
                    }}
                  />
                  <span className="asp-modal-alias" title={r.alias}>
                    {r.alias}
                  </span>
                  <span className="asp-modal-zone">{r.zone}</span>
                </label>
              ))}
            </div>
            <div className="asp-modal-foot">
              <span className="asp-hint">
                {selected.size}/{rows.length} selected
              </span>
              <button type="button" className="editor-controls__btn" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="editor-controls__btn asp-btn-primary"
                disabled={selected.size === 0}
                onClick={() => void convert()}
              >
                Repair
              </button>
            </div>
          </>
        )}
        {phase === 'loading' && <p className="asp-hint">Scanning…</p>}
        {phase === 'working' && <p className="asp-hint">Repairing…</p>}
        {phase === 'done' && (
          <>
            <p className="asp-hint">{count > 0 ? `Repaired ${count} asset(s).` : 'No private assets need repair.'}</p>
            <div className="asp-modal-foot">
              <button type="button" className="editor-controls__btn asp-btn-primary" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="asp-hint asp-hint--err">{err}</p>
            <div className="asp-modal-foot">
              <button type="button" className="editor-controls__btn" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── 2. Preview · Anchor · Collision ───────────────────────────────────────────

function PreviewAnchorCollisionBody({ asset }: { asset: AssetRecord | null }): JSX.Element {
  const [imgError, setImgError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ax, setAx] = useState('')
  const [ay, setAy] = useState('')

  useEffect(() => {
    setImgError(false)
    setAx(asset?.anchorX != null ? String(asset.anchorX) : '')
    setAy(asset?.anchorY != null ? String(asset.anchorY) : '')
  }, [asset?.id, asset?.alias, asset?.anchorX, asset?.anchorY])

  if (!asset) {
    return (
      <p className="asp-hint asp-hint--muted">Select an asset in the grid to inspect preview, anchor, and collision.</p>
    )
  }

  const inTrash = asset.zone === 'trash'
  const canEdit = !!asset.private

  const act = async (fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
      requestRefresh(true)
    }
  }

  const saveMeta = async (patch: { alias?: string; anchorX?: number | null; anchorY?: number | null }) => {
    if (!canEdit) return
    try {
      await libraryApi.patchPrivate(asset.id, patch)
      requestRefresh()
    } catch {
      /* ignore */
    }
  }

  const w = asset.widthPx ?? 0
  const h = asset.heightPx ?? 0

  return (
    <div className="asp-stack">
      <h3 className="asp-subhead">Preview</h3>
      <div className="asp-preview-thumb">
        {!imgError ? (
          <img src={libraryApi.serveUrl(asset.alias)} alt={asset.alias} onError={() => setImgError(true)} />
        ) : (
          <span className="asp-hint">No preview</span>
        )}
        {asset.private && <span className="asp-preview-badge">Private</span>}
      </div>
      {canEdit ? (
        <input
          className="asp-input"
          defaultValue={asset.alias}
          key={asset.alias}
          title="Edit alias"
          onBlur={(e) => void saveMeta({ alias: e.target.value.trim() })}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
      ) : (
        <div className="asp-preview-name" title={asset.alias}>
          {asset.alias}
        </div>
      )}
      <dl className="asp-meta">
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(asset.sizeBytes)}</dd>
        </div>
        {w > 0 && h > 0 && (
          <div>
            <dt>Dimensions</dt>
            <dd>
              {w}×{h}
            </dd>
          </div>
        )}
        <div>
          <dt>Zone</dt>
          <dd>{asset.zone}</dd>
        </div>
        <div>
          <dt>Format</dt>
          <dd>{asset.mimeType}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{asset.private ? 'Project private' : 'Built-in (read-only)'}</dd>
        </div>
        {fieldAt(asset.alias, SLOT.appearancePlace) && (
          <div>
            <dt>出现场所</dt>
            <dd>{fieldAt(asset.alias, SLOT.appearancePlace)}</dd>
          </div>
        )}
        {formatWhen(asset.createdAt) && (
          <div>
            <dt>创建</dt>
            <dd>{formatWhen(asset.createdAt)}</dd>
          </div>
        )}
        {formatWhen(asset.updatedAt) && (
          <div>
            <dt>更新</dt>
            <dd>{formatWhen(asset.updatedAt)}</dd>
          </div>
        )}
        {(asset.hasError || asset.isPlaceholder) && (
          <div>
            <dt>状态标记</dt>
            <dd>
              {asset.hasError ? '⚠ 有错误' : ''}
              {asset.hasError && asset.isPlaceholder ? ' · ' : ''}
              {asset.isPlaceholder ? '占位' : ''}
            </dd>
          </div>
        )}
      </dl>
      {asset.tags && asset.tags.length > 0 && (
        <div className="asp-tags">
          {asset.tags.map((t) => (
            <span key={t} className="asp-tag">{t}</span>
          ))}
        </div>
      )}

      <h3 className="asp-subhead">Anchor</h3>
      <p className="asp-hint asp-hint--muted">
        Normalized pivot (0–1): X = left→right, Y = bottom→top. Used by the renderer when placing sprites.
      </p>
      <div className="asp-anchor-row">
        <label>
          <span>anchorX</span>
          <input
            className="asp-input asp-input--narrow"
            value={ax}
            disabled={!canEdit}
            onChange={(e) => setAx(e.target.value)}
            onBlur={() => void saveMeta({ anchorX: clampAnchor(ax), anchorY: clampAnchor(ay) })}
          />
        </label>
        <label>
          <span>anchorY</span>
          <input
            className="asp-input asp-input--narrow"
            value={ay}
            disabled={!canEdit}
            onChange={(e) => setAy(e.target.value)}
            onBlur={() => void saveMeta({ anchorX: clampAnchor(ax), anchorY: clampAnchor(ay) })}
          />
        </label>
      </div>
      {!canEdit && <p className="asp-hint asp-hint--muted">Anchor is read-only on built-in assets.</p>}

      <h3 className="asp-subhead">Collision</h3>
      <p className="asp-hint asp-hint--muted">
        Collision footprint is inferred from the image bounds
        {w > 0 && h > 0 ? ` (${w}×${h} px at the asset PPU)` : ''}. Tilemap rules define neighbour stitching
        separately in the Rules zone.
      </p>

      {canEdit && (
        <div className="asp-actions">
          {inTrash ? (
            <>
              <button
                type="button"
                className="editor-controls__btn"
                disabled={busy}
                onClick={() => void act(() => libraryApi.restore(asset.id))}
              >
                Restore
              </button>
              <button
                type="button"
                className="editor-controls__btn asp-btn-danger"
                disabled={busy}
                onClick={() =>
                  void act(() => libraryApi.remove(asset.id), `Permanently delete "${asset.alias}"? Cannot be undone.`)
                }
              >
                Delete permanently
              </button>
            </>
          ) : (
            <button
              type="button"
              className="editor-controls__btn asp-btn-danger"
              disabled={busy}
              onClick={() => void act(() => libraryApi.trash(asset.id))}
            >
              Move to trash
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── 3. Filters ────────────────────────────────────────────────────────────────

function FiltersBody({
  filters,
  activeCount,
  onChange,
  onClear,
}: {
  filters: NameFilters
  activeCount: number
  onChange: (idx: number, value: string) => void
  onClear: () => void
}): JSX.Element {
  return (
    <div className="asp-stack">
      <div className="asp-filter-bar">
        <button
          type="button"
          className={`editor-controls__btn${activeCount > 0 ? ' is-on' : ''}`}
          onClick={onClear}
          disabled={activeCount === 0}
        >
          Clear filters ({activeCount})
        </button>
      </div>
      <div className="asp-fields">
        {FIELD_DEFS.map((def, i) => (
          <FieldFilterRow key={def.idx} def={def} num={i + 1} value={filters[def.idx] ?? ''} onChange={onChange} />
        ))}
      </div>
    </div>
  )
}

function FieldFilterRow({
  def,
  num,
  value,
  onChange,
}: {
  def: FieldDef
  num: number
  value: string
  onChange: (idx: number, value: string) => void
}): JSX.Element {
  const [options, setOptions] = useState<string[]>(sortOptions(def.staticOptions ?? []))
  useEffect(() => {
    if (def.type !== 'select') return
    let cancelled = false
    libraryApi
      .fieldValues(def.idx)
      .then((vals) => {
        if (cancelled) return
        const set = new Set(vals)
        const merged = [...vals]
        for (const s of def.staticOptions ?? []) if (!set.has(s)) merged.push(s)
        if (merged.length) setOptions(sortOptions(merged))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [def.idx, def.type, def.staticOptions])

  const hasValue = !!value
  if (def.type === 'select') {
    return (
      <div className={`asp-field${hasValue ? ' is-active' : ''}`}>
        <span className="asp-field-num">{num}</span>
        <span className="asp-field-label">{def.label}</span>
        <div className="asp-field-opts">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`asp-opt${value === opt ? ' is-active' : ''}`}
              onClick={() => onChange(def.idx, value === opt ? '' : opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className={`asp-field${hasValue ? ' is-active' : ''}`}>
      <span className="asp-field-num">{num}</span>
      <span className="asp-field-label">{def.label}</span>
      <input
        className="asp-input asp-field-input"
        defaultValue={value}
        placeholder="Filter…"
        onBlur={(e) => onChange(def.idx, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange(def.idx, (e.target as HTMLInputElement).value)
        }}
      />
    </div>
  )
}

// ── 4. Library Info ───────────────────────────────────────────────────────────

function LibraryInfoBody(): JSX.Element {
  const [data, setData] = useState<MonitorResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const fetchMonitor = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setData(await libraryApi.monitor())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMonitor()
  }, [fetchMonitor])

  return (
    <div className="asp-stack">
      <div className="asp-filter-bar">
        <button type="button" className="editor-controls__btn" onClick={() => void fetchMonitor()} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>
      {err && <p className="asp-hint asp-hint--err">{err}</p>}
      {!data && !err && <p className="asp-hint">Loading…</p>}
      {data && (
        <>
          <div className="asp-info-summary">
            <strong>{data.totalAssets.toLocaleString()}</strong> assets · <strong>{data.privateCount}</strong>{' '}
            private · {formatBytes(data.totalBytes)}
          </div>
          <table className="asp-info-table">
            <thead>
              <tr>
                <th>Zone</th>
                <th className="num">Count</th>
                <th className="num">Size</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {data.zoneStats.map((z) => (
                <tr key={`${z.source}-${z.zone}`}>
                  <td>{z.zone}</td>
                  <td className="num">{z.assetCount.toLocaleString()}</td>
                  <td className="num">{formatBytes(z.totalBytes)}</td>
                  <td>{z.source === 'private' ? 'Private' : 'Base'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ── 5. Help ─────────────────────────────────────────────────────────────────────

function AssetStoreHelp(): JSX.Element {
  return (
    <>
      <p>
        <strong>Asset Store</strong> browses the built-in library plus <strong>project-private</strong> imports
        (Private badge on thumbnails). Use the zone dropdown in the grid titlebar to switch raw / staging / trash /
        Rules.
      </p>
      <p>
        <strong>Basic Operations</strong> — search filters the grid; import adds PNG/JPEG/WebP files to your project;
        repair normalizes non-bracket filenames; batch mode lets you select private assets in the grid and move them to
        trash or delete them permanently from the trash zone.
      </p>
      <p>
        <strong>Preview · Anchor · Collision</strong> — select any asset to see its thumbnail and metadata. Private
        assets can be renamed and have anchorX/anchorY edited (0–1 pivot for renderer placement). Built-in assets are
        read-only.
      </p>
      <p>
        <strong>Filters</strong> — narrow the grid by any of the 13 bracket fields in the standard alias format{' '}
        <code>[field]_[field]…</code>.
      </p>
      <p>
        <strong>Library Info</strong> — zone counts for the merged base + private libraries.
      </p>
    </>
  )
}
