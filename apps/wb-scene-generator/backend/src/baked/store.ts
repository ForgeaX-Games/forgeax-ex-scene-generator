/**
 * Baked scene-layer store — a SECOND, graph-independent service.
 *
 * Hand-edited "baked" layers live as a scene-tree JSON (`baked-scene.json`) in
 * the ACTIVE PROJECT's folder, completely separate from the node graph
 * (`state/graph.json`). The node editor never touches this; the renderer reads
 * and writes it directly. Both meet only in the preview canvas (visualization)
 * and at the Bake operation (snapshot a transient graph layer into here).
 *
 * The tree is the same immutable `SceneNodeSnapshot` shape that flows through
 * the graph, so we reuse the vendored pure tree helpers (`upsertCells`,
 * `setAttribute`, `emptyTree`, `readNode`) and the canonical voxel projection
 * the `scene_output` battery uses. Unlike that projection, the panel must also
 * show EMPTY layers (a freshly-added layer has no cells yet), so we expose a
 * baked-specific DFS (`projectBaked`) that keeps cell-less nodes and surfaces
 * each layer's bound asset (attributes.asset_name / asset_alias / asset_type) inline.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getActiveProjectDir, getProjectDir } from '../runtime.js'
// baked-scene.json 是与 SceneGraph 管线完全独立的第二套持久化格式（见本文件顶部
// 文档注释）——刻意排除在 v3 重构范围外（scene-v3-refactor-spec 总览页）。它仍然
// 依赖旧 tree.ts 的嵌套树 + path-copying 语义，因此从 tree.ts 的深路径直接导入，
// 而不是从主 barrel（scene/index.ts 已不再 `export *` tree.ts——那些函数名会和
// graph.ts 的新原语混淆）。SceneNodeSnapshot / VoxelCell 类型仍来自 types.ts，
// 继续经主 barrel 导出，两边类型定义保持同一份，不会分叉。
import {
  emptyTree,
  readNode,
  setAttribute,
  splitPath,
  upsertCells,
  upsertSubtree,
} from '../../../vendor/dist/shared/types/scene/tree.js'
import type { SceneNodeSnapshot, VoxelCell } from '../../../vendor/dist/shared/types/scene/index.js'

const FILE = 'baked-scene.json'
const HISTORY_FILE = 'baked-scene-history.json'
const DEFAULT_HISTORY_LIMIT = 50
/** Skip undo snapshots larger than this (prevents Invalid string length on history file). */
const MAX_HISTORY_SNAPSHOT_BYTES = 2_000_000
/**
 * Max size of baked-scene.json we will parse for list/browse/edit.
 * Was 8MB — large Bake-selected scenes routinely exceed that, which made
 * summary return `{layers:[], truncated:true}` and full list throw, so the
 * Editable panel stayed empty after a successful bake. Align with the HTTP
 * bake bodyLimit (64MB).
 */
const MAX_BAKED_LOAD_BYTES = 64 * 1024 * 1024
/** Soft warn threshold — still load, but log so ops can spot heavy projects. */
const WARN_BAKED_LOAD_BYTES = 8 * 1024 * 1024
/** History metadata-only reads skip corrupt/huge files without JSON.parse. */
const MAX_HISTORY_FILE_BYTES = 4 * 1024 * 1024

// One cached tree per project file path (the active project rarely changes
// within a process; switching projects just resolves a different path).
const cache = new Map<string, SceneNodeSnapshot>()

export interface BakedCell {
  x: number
  y: number
  z: number
  token?: string
  state?: Readonly<Record<string, unknown>>
}

/** A baked layer descriptor — superset of the graph VoxelLayer, with the bound
 *  asset surfaced inline (no separate name_list) and EMPTY layers included. */
export interface BakedLayer {
  nodePath: string
  nodeName: string
  value: number
  schema?: string
  assetName: string
  assetAlias?: string
  assetType?: string
  cells: BakedCell[]
  /** Full scene-node attributes bag (includes reserved + custom keys). */
  attributes: Record<string, unknown>
  version?: number
  bounds?: { width: number; height: number }
}

/**
 * Reserved attribute that records a node's explicit sibling order (ascending).
 *
 * Sibling order is a BAKED-only concern, so it lives here as data — NOT as the
 * physical `children` array order and NOT as `version`. The vendored tree keeps
 * `children` strictly name-sorted (its `readNode`/`upsertCells` binary-search
 * depends on that invariant); overloading array order or version for "display
 * order" silently broke that invariant and corrupted lookups. With `__order`,
 * the array stays canonically sorted and ordering is decoupled, recoverable,
 * and single-sourced.
 */
export const BAKED_ORDER_ATTR = '__order'

/** Keys owned by the renderer / paint pipeline — not editable as custom fields. */
export const RESERVED_BAKED_ATTRIBUTE_KEYS = new Set(['asset_name', 'asset_alias', 'asset_type', BAKED_ORDER_ATTR])

/** A node's explicit sibling-order rank, or undefined when unset (legacy data). */
function orderRank(node: SceneNodeSnapshot): number | undefined {
  const v = node.attributes?.[BAKED_ORDER_ATTR]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function filePath(projDir: string): string {
  return join(projDir, FILE)
}

function historyPath(projDir: string): string {
  return join(projDir, HISTORY_FILE)
}

export interface BakedHistorySummary {
  paths: string[]
  cellDelta?: number
  assetAlias?: string
  assetName?: string
}

export interface BakedHistoryEntry {
  id: string
  label: string
  tool: 'paint' | 'erase' | 'layer' | 'bake' | 'attributes'
  createdAt: string
  before: SceneNodeSnapshot
  after: SceneNodeSnapshot
  summary: BakedHistorySummary
}

export interface BakedHistoryStatus {
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
  entries: Array<Pick<BakedHistoryEntry, 'id' | 'label' | 'tool' | 'createdAt' | 'summary'>>
}

interface BakedHistoryFile {
  version: 1
  limit: number
  undo: BakedHistoryEntry[]
  redo: BakedHistoryEntry[]
}

interface BakedMutationMeta {
  label: string
  tool: BakedHistoryEntry['tool']
  summary: BakedHistorySummary
}

function load(projDir: string): SceneNodeSnapshot {
  const path = filePath(projDir)
  const hit = cache.get(path)
  if (hit) return hit
  let tree: SceneNodeSnapshot
  if (existsSync(path)) {
    try {
      tree = JSON.parse(readFileSync(path, 'utf-8')) as SceneNodeSnapshot
    } catch {
      tree = emptyTree()
    }
  } else {
    tree = emptyTree()
  }
  // Heal legacy corruption: earlier builds reordered the children array directly
  // (overloading array order / version for display order), which violated the
  // vendored tree's name-sorted invariant and let binary-search dedup miss
  // collisions — producing duplicate same-name siblings that clobbered each
  // other in the panel. Re-sort children by name, merge duplicates (keep the
  // richest), and pin the pre-merge display order onto `__order`.
  const healed = healTree(tree)
  if (!sceneEqual(healed, tree)) {
    persist(projDir, healed)
    return healed
  }
  cache.set(path, tree)
  return tree
}

/** Pick the "richest" of duplicate same-name siblings: most cells, then bound
 *  asset, then highest version. The others are discarded (empty placeholders). */
function pickRicher(a: SceneNodeSnapshot, b: SceneNodeSnapshot): SceneNodeSnapshot {
  const ca = a.cells?.length ?? 0
  const cb = b.cells?.length ?? 0
  if (ca !== cb) return ca > cb ? a : b
  const aa = attrString(a.attributes, 'asset_name') ? 1 : 0
  const ab = attrString(b.attributes, 'asset_name') ? 1 : 0
  if (aa !== ab) return aa > ab ? a : b
  return (a.version ?? 0) >= (b.version ?? 0) ? a : b
}

/** Recursively re-sort children by name + merge duplicate same-name siblings,
 *  preserving the pre-merge display order via `__order`. Idempotent. Exported
 *  for one-off maintenance migration of already-corrupted project files. */
export function healTree(node: SceneNodeSnapshot, visited: WeakSet<object> = new WeakSet()): SceneNodeSnapshot {
  // 复盘(2026-07-01 循环引用死循环事故):纵深防御——vendor 的不可变 tree API 理论
  // 上不会产生结构环,但这里不依赖那份保证。撞到已下探过的节点引用直接原样返回
  // (放弃继续 heal 这一层,而不是无限递归),把潜在死循环/栈溢出降级成"该重复
  // 子树跳过愈合",绝不挂死 backend。
  if (visited.has(node)) return node
  visited.add(node)
  const kids = node.children ?? []
  // Current display order (mirrors projectBaked's sort) — captured BEFORE dedup
  // so survivors keep their place.
  const displayOrder = [...kids].sort((a, b) => {
    const ra = orderRank(a)
    const rb = orderRank(b)
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
    if (ra !== undefined && rb === undefined) return -1
    if (ra === undefined && rb !== undefined) return 1
    if (a.version !== b.version) return a.version - b.version
    return a.name.localeCompare(b.name)
  })
  const merged = new Map<string, SceneNodeSnapshot>()
  for (const child of displayOrder) {
    const existing = merged.get(child.name)
    merged.set(child.name, existing ? pickRicher(existing, child) : child)
  }
  const rankByName = new Map<string, number>()
  let i = 0
  for (const name of new Set(displayOrder.map((c) => c.name))) rankByName.set(name, i++)

  const nextChildren = [...merged.values()]
    .map((child) => {
      const healedChild = healTree(child, visited)
      const rank = rankByName.get(child.name)!
      const withOrder = orderRank(healedChild) === rank
        ? healedChild
        : {
            ...healedChild,
            attributes: { ...(healedChild.attributes ?? {}), [BAKED_ORDER_ATTR]: rank },
          }
      return withOrder
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const sameLength = nextChildren.length === kids.length
  const sameRefs = sameLength && nextChildren.every((c, idx) => c === kids[idx])
  if (sameRefs) return node
  return { ...node, children: nextChildren }
}

function persist(projDir: string, tree: SceneNodeSnapshot): void {
  const path = filePath(projDir)
  cache.set(path, tree)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Atomic write (tmp + rename), mirroring the kernel registry's writeJsonAtomic.
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(tree, null, 2), 'utf-8')
  renameSync(tmp, path)
}

function defaultHistory(): BakedHistoryFile {
  return { version: 1, limit: DEFAULT_HISTORY_LIMIT, undo: [], redo: [] }
}

function normalizeHistory(value: unknown): BakedHistoryFile {
  const candidate = value as Partial<BakedHistoryFile> | null
  if (!candidate || candidate.version !== 1 || !Array.isArray(candidate.undo) || !Array.isArray(candidate.redo)) {
    return defaultHistory()
  }
  const limit = typeof candidate.limit === 'number' && candidate.limit > 0 ? Math.floor(candidate.limit) : DEFAULT_HISTORY_LIMIT
  return {
    version: 1,
    limit,
    undo: candidate.undo.slice(-limit),
    redo: candidate.redo.slice(-limit),
  }
}

function loadHistory(projDir: string): BakedHistoryFile {
  const path = historyPath(projDir)
  if (!existsSync(path)) return defaultHistory()
  try {
    const size = statSync(path).size
    if (size > MAX_HISTORY_FILE_BYTES) {
      console.warn(`[baked] history file ${size} bytes — too large, treating as empty (truncate ${path})`)
      return defaultHistory()
    }
    return normalizeHistory(JSON.parse(readFileSync(path, 'utf-8')))
  } catch {
    return defaultHistory()
  }
}

function persistHistory(projDir: string, history: BakedHistoryFile): void {
  const path = historyPath(projDir)
  const dir = dirname(path)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, JSON.stringify(normalizeHistory(history), null, 2), 'utf-8')
  renameSync(tmp, path)
}

function sceneEqual(a: SceneNodeSnapshot, b: SceneNodeSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function historyStatus(history: BakedHistoryFile): BakedHistoryStatus {
  const undoEntry = history.undo.at(-1)
  const redoEntry = history.redo.at(-1)
  return {
    canUndo: history.undo.length > 0,
    canRedo: history.redo.length > 0,
    ...(undoEntry ? { undoLabel: undoEntry.label } : {}),
    ...(redoEntry ? { redoLabel: redoEntry.label } : {}),
    entries: history.undo.slice().reverse().map(({ id, label, tool, createdAt, summary }) => ({
      id,
      label,
      tool,
      createdAt,
      summary,
    })),
  }
}

function pushBakedHistory(projDir: string, entry: Omit<BakedHistoryEntry, 'id' | 'createdAt'>): void {
  const beforeBytes = JSON.stringify(entry.before).length
  const afterBytes = JSON.stringify(entry.after).length
  if (beforeBytes + afterBytes > MAX_HISTORY_SNAPSHOT_BYTES) {
    return
  }
  const history = loadHistory(projDir)
  const next: BakedHistoryFile = {
    version: 1,
    limit: history.limit,
    undo: [
      ...history.undo,
      {
        ...entry,
        id: `baked_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        createdAt: new Date().toISOString(),
      },
    ].slice(-history.limit),
    redo: [],
  }
  persistHistory(projDir, next)
}

async function commitBakedMutationForDir(
  projDir: string,
  meta: BakedMutationMeta,
  apply: (tree: SceneNodeSnapshot, projDir: string) => SceneNodeSnapshot,
  opts?: { recordHistory?: boolean },
): Promise<{ before: SceneNodeSnapshot; after: SceneNodeSnapshot; recorded: boolean }> {
  const before = load(projDir)
  const after = apply(before, projDir)
  if (sceneEqual(before, after)) return { before, after, recorded: false }
  persist(projDir, after)
  if (opts?.recordHistory !== false) {
    pushBakedHistory(projDir, { ...meta, before, after })
    return { before, after, recorded: true }
  }
  return { before, after, recorded: false }
}

async function commitBakedMutation(
  meta: BakedMutationMeta,
  apply: (tree: SceneNodeSnapshot, projDir: string) => SceneNodeSnapshot,
): Promise<{ before: SceneNodeSnapshot; after: SceneNodeSnapshot; recorded: boolean }> {
  return commitBakedMutationForDir(await getActiveProjectDir(), meta, apply)
}

function nextVersion(tree: SceneNodeSnapshot): number {
  return (tree.version ?? 0) + 1
}

function attrString(attrs: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const v = attrs?.[key]
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** DFS the baked tree into layer descriptors, INCLUDING empty nodes so a newly
 *  added (cell-less) layer still shows in the panel. value is 1-based DFS order. */
function projectBaked(tree: SceneNodeSnapshot): BakedLayer[] {
  const out: BakedLayer[] = []
  // 复盘(2026-07-01 循环引用死循环事故):纵深防御——撞到已下探过的节点引用直接
  // 跳过(不再递归),绝不因潜在结构环挂死 backend。
  const visited = new WeakSet<object>()
  const walk = (node: SceneNodeSnapshot): void => {
    if (visited.has(node)) return
    visited.add(node)
    if (node.path !== '/') {
      out.push({
        nodePath: node.path,
        nodeName: node.name === '' ? '/' : node.name,
        value: out.length + 1,
        schema: node.schema,
        assetName: attrString(node.attributes, 'asset_name') ?? '',
        assetAlias: attrString(node.attributes, 'asset_alias'),
        assetType: attrString(node.attributes, 'asset_type') ?? node.schema,
        cells: (node.cells ?? []).map((c) => ({
          x: c.x,
          y: c.y,
          z: c.z,
          token: c.token,
          ...(c.state ? { state: c.state } : {}),
        })),
        attributes: { ...(node.attributes ?? {}) },
        version: node.version,
        ...(node.bounds ? { bounds: { width: node.bounds.width, height: node.bounds.height } } : {}),
      })
    }
    // Sibling order: explicit `__order` rank first (canonical, single source),
    // then legacy `version` (pre-__order data), then name as a stable tiebreak.
    // The physical children array is always name-sorted (vendored invariant);
    // we never rely on its order here.
    const ordered = [...node.children].sort((a, b) => {
      const ra = orderRank(a)
      const rb = orderRank(b)
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
      if (ra !== undefined && rb === undefined) return -1
      if (ra === undefined && rb !== undefined) return 1
      if (a.version !== b.version) return a.version - b.version
      return a.name.localeCompare(b.name)
    })
    for (const child of ordered) walk(child)
  }
  walk(tree)
  return out
}

export type BakedLayerSummary = Omit<BakedLayer, 'cells'> & { cellCount: number }

/** Like projectBaked but never copies voxel cells — browse/summary only. */
function projectBakedSummary(tree: SceneNodeSnapshot): BakedLayerSummary[] {
  const out: BakedLayerSummary[] = []
  const visited = new WeakSet<object>()
  const walk = (node: SceneNodeSnapshot): void => {
    if (visited.has(node)) return
    visited.add(node)
    if (node.path !== '/') {
      out.push({
        nodePath: node.path,
        nodeName: node.name === '' ? '/' : node.name,
        value: out.length + 1,
        schema: node.schema,
        assetName: attrString(node.attributes, 'asset_name') ?? '',
        assetAlias: attrString(node.attributes, 'asset_alias'),
        assetType: attrString(node.attributes, 'asset_type') ?? node.schema,
        cellCount: node.cells?.length ?? 0,
        attributes: { ...(node.attributes ?? {}) },
        version: node.version,
        ...(node.bounds ? { bounds: { width: node.bounds.width, height: node.bounds.height } } : {}),
      })
    }
    const ordered = [...node.children].sort((a, b) => {
      const ra = orderRank(a)
      const rb = orderRank(b)
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
      if (ra !== undefined && rb === undefined) return -1
      if (ra === undefined && rb !== undefined) return 1
      if (a.version !== b.version) return a.version - b.version
      return a.name.localeCompare(b.name)
    })
    for (const child of ordered) walk(child)
  }
  walk(tree)
  return out
}

function bakedSceneBytes(projDir: string): number {
  const path = filePath(projDir)
  if (!existsSync(path)) return 0
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

function sanitizeSegment(name: string): string {
  const s = (name ?? '').replace(/\//g, ' ').trim()
  return s.length > 0 ? s : 'Layer'
}

/** Rebuild the tree without the node at `path` (no vendored prune helper exists). */
function pruneNode(tree: SceneNodeSnapshot, path: string): SceneNodeSnapshot {
  const segs = splitPath(path)
  if (segs.length === 0) return tree
  const parentSegs = segs.slice(0, -1)
  const target = segs[segs.length - 1]
  const version = nextVersion(tree)
  const rec = (node: SceneNodeSnapshot, depth: number): SceneNodeSnapshot => {
    if (depth === parentSegs.length) {
      const children = node.children.filter((c) => c.name !== target)
      if (children.length === node.children.length) return node
      return { ...node, children, version }
    }
    const seg = parentSegs[depth]
    const idx = node.children.findIndex((c) => c.name === seg)
    if (idx < 0) return node
    const rebuilt = rec(node.children[idx]!, depth + 1)
    if (rebuilt === node.children[idx]) return node
    const children = [...node.children]
    children[idx] = rebuilt
    return { ...node, children, version }
  }
  return rec(tree, 0)
}

// ── Sibling-order preservation ──────────────────────────────────────────────
//
// `projectBaked` orders siblings by `version`, but the vendored `rewriteAtPath`
// stamps the fresh version onto EVERY node along the mutated path. So writing a
// child (or painting a layer) bumps its ancestors' versions and shoves them to
// the end of their sibling order. We don't want that: only a genuinely NEW node
// should append. After a mutation we therefore restore the version of every
// pre-existing node we touched (ancestors always; the leaf if it already existed).

/** Path-copy `tree`, changing ONLY the target node's version (ancestors untouched). */
function setNodeVersion(tree: SceneNodeSnapshot, path: string, version: number): SceneNodeSnapshot {
  const segs = splitPath(path)
  if (segs.length === 0) return tree
  const rec = (node: SceneNodeSnapshot, depth: number): SceneNodeSnapshot => {
    if (depth === segs.length) return node.version === version ? node : { ...node, version }
    const idx = node.children.findIndex((c) => c.name === segs[depth])
    if (idx < 0) return node
    const rebuilt = rec(node.children[idx]!, depth + 1)
    if (rebuilt === node.children[idx]) return node
    const children = [...node.children]
    children[idx] = rebuilt
    return { ...node, children } // NOTE: ancestor version deliberately preserved
  }
  return rec(tree, 0)
}

/** Strict-ancestor paths of `path` (excludes root and the leaf): "/A/B/C" → ["/A","/A/B"]. */
function ancestorPaths(path: string): string[] {
  const segs = splitPath(path)
  const out: string[] = []
  for (let i = 1; i < segs.length; i++) out.push(`/${segs.slice(0, i).join('/')}`)
  return out
}

/** Restore each strict ancestor of `leafPath` to its version in `before` (no-op for new ancestors). */
function restoreAncestorVersions(
  before: SceneNodeSnapshot,
  after: SceneNodeSnapshot,
  leafPath: string,
): SceneNodeSnapshot {
  let t = after
  for (const ap of ancestorPaths(leafPath)) {
    const old = readNode(before, ap)
    if (old) t = setNodeVersion(t, ap, old.version)
  }
  return t
}

/** Bind asset_name/asset_type onto an existing node without changing its order. */
function bindAssetPreservingOrder(
  tree: SceneNodeSnapshot,
  path: string,
  asset: { name: string; type?: string; alias?: string },
): SceneNodeSnapshot {
  const existing = readNode(tree, path)
  let next = setAttribute(tree, path, 'asset_name', asset.name, nextVersion(tree))
  if (asset.alias) next = setAttribute(next, path, 'asset_alias', asset.alias, nextVersion(next))
  if (asset.type) next = setAttribute(next, path, 'asset_type', asset.type, nextVersion(next))
  next = restoreAncestorVersions(tree, next, path)
  if (existing) next = setNodeVersion(next, path, existing.version)
  return next
}

/** Next free `layer-n` name among a node's direct children (n starts at 1). */
function nextLayerName(parent: SceneNodeSnapshot): string {
  let max = 0
  for (const c of parent.children) {
    const m = /^layer-(\d+)$/.exec(c.name)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `layer-${max + 1}`
}

// ── Public API (all resolve the active project's file) ──────────────────────

export function listBakedLayersForProjectDir(projDir: string): BakedLayer[] {
  return projectBaked(load(projDir))
}

export interface BakedLayersSummaryResult {
  layers: BakedLayerSummary[]
  /** True when baked-scene.json is too large to parse on the browse path. */
  truncated?: boolean
}

/** Layer metadata without voxel cells — for UI browse / project switch. */
export function listBakedLayersSummaryForProjectDir(projDir: string): BakedLayersSummaryResult {
  const bytes = bakedSceneBytes(projDir)
  if (bytes > MAX_BAKED_LOAD_BYTES) {
    console.warn(
      `[baked] summary skipped: baked-scene.json ${bytes} bytes (limit ${MAX_BAKED_LOAD_BYTES}) — UI browse returns empty`,
    )
    return { layers: [], truncated: true }
  }
  if (bytes > WARN_BAKED_LOAD_BYTES) {
    console.warn(`[baked] summary loading large baked-scene.json (${bytes} bytes)`)
  }
  return { layers: projectBakedSummary(load(projDir)) }
}

/** Wipe baked tree + history (orchestration replace bake). */
export function clearBakedSceneForProjectDir(projDir: string): void {
  const path = filePath(projDir)
  cache.delete(path)
  persist(projDir, emptyTree())
  persistHistory(projDir, defaultHistory())
}

export async function listBakedLayersForProject(projectId: string): Promise<BakedLayer[]> {
  const projDir = await getProjectDir(projectId)
  if (!projDir) throw new Error(`project not found: ${projectId}`)
  return listBakedLayersForProjectDir(projDir)
}

export async function listBakedLayers(): Promise<BakedLayer[]> {
  const projDir = await getActiveProjectDir()
  const bytes = bakedSceneBytes(projDir)
  if (bytes > MAX_BAKED_LOAD_BYTES) {
    throw new Error(
      `baked-scene.json too large (${bytes} bytes, limit ${MAX_BAKED_LOAD_BYTES}) — clear or replace before loading full cells`,
    )
  }
  if (bytes > WARN_BAKED_LOAD_BYTES) {
    console.warn(`[baked] full load of large baked-scene.json (${bytes} bytes)`)
  }
  return listBakedLayersForProjectDir(projDir)
}

/** A child path under `parentPath` that does not collide with an existing node.
 *  Defense-in-depth: also scans children linearly by name, so a (legacy)
 *  mis-sorted array can never let `readNode`'s binary search miss a collision. */
function uniqueChildPathSafe(tree: SceneNodeSnapshot, parentPath: string, name: string): string {
  const parent = parentPath === '/' ? tree : readNode(tree, parentPath)
  const taken = new Set((parent?.children ?? []).map((c) => c.name))
  const base = parentPath === '/' ? '' : parentPath
  let seg = sanitizeSegment(name)
  let n = 2
  while (taken.has(seg) || readNode(tree, `${base}/${seg}`)) seg = `${sanitizeSegment(name)} ${n++}`
  return `${base}/${seg}`
}

/** Highest `__order` rank among a node's children, or -1 when none are stamped. */
function maxOrderRank(parent: SceneNodeSnapshot | null): number {
  let max = -1
  for (const c of parent?.children ?? []) {
    const r = orderRank(c)
    if (r !== undefined) max = Math.max(max, r)
  }
  return max
}

/**
 * Child names in display order — the same key `projectBaked` sorts by:
 * `__order`, then legacy `version`, then name. Used to seed reorders so moving
 * one sibling preserves the others' established order.
 */
function displayOrderedChildNames(parent: SceneNodeSnapshot): string[] {
  return [...parent.children]
    .sort((a, b) => {
      const ra = orderRank(a)
      const rb = orderRank(b)
      if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb
      if (ra !== undefined && rb === undefined) return -1
      if (ra === undefined && rb !== undefined) return 1
      if (a.version !== b.version) return a.version - b.version
      return a.name.localeCompare(b.name)
    })
    .map((c) => c.name)
}

/** Create an empty editable layer under `parentPath` (default root). Returns its path. */
export async function addBakedLayer(name: string, parentPath = '/'): Promise<string> {
  const tree = load(await getActiveProjectDir())
  if (parentPath !== '/' && !readNode(tree, parentPath)) {
    throw new Error(`parent layer not found: ${parentPath}`)
  }
  const path = uniqueChildPathSafe(tree, parentPath, name)
  await commitBakedMutation({
    label: 'Add baked layer',
    tool: 'layer',
    summary: { paths: [path] },
  }, (before) => {
    // New leaf appends last: stamp __order = maxRank + 1 (decoupled from version).
    const parent = parentPath === '/' ? before : readNode(before, parentPath)
    const rank = maxOrderRank(parent) + 1
    let next = upsertCells(before, path, { schema: 'baked', cells: [] }, nextVersion(before))
    next = setAttribute(next, path, BAKED_ORDER_ATTR, rank, nextVersion(next))
    return restoreAncestorVersions(before, next, path)
  })
  return path
}

function cellsEqual(a: readonly VoxelCell[] | undefined, b: readonly VoxelCell[]): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b)
}

function assetBindingEqual(
  attrs: Readonly<Record<string, unknown>> | undefined,
  asset: { name: string; type?: string; alias?: string } | undefined,
): boolean {
  if (!asset) return true
  return attrString(attrs, 'asset_name') === asset.name
    && attrString(attrs, 'asset_alias') === asset.alias
    && attrString(attrs, 'asset_type') === asset.type
}

/** Overwrite a layer's full cell set (z=0 painting is whole-layer replace), and
 *  optionally (re)bind its asset. Creates the layer node if missing. */
export async function setBakedCells(
  path: string,
  cells: readonly BakedCell[],
  asset?: { name: string; type?: string; alias?: string },
): Promise<void> {
  const voxels: VoxelCell[] = cells.map((c) => ({
    x: c.x,
    y: c.y,
    z: c.z,
    token: c.token ?? asset?.name ?? '',
    ...(c.state ? { state: c.state } : {}),
  }))
  await commitBakedMutation({
    label: 'Paint baked layer',
    tool: 'paint',
    summary: {
      paths: [path],
      cellDelta: cells.length,
      ...(asset?.alias ? { assetAlias: asset.alias } : {}),
      ...(asset?.name ? { assetName: asset.name } : {}),
    },
  }, (tree) => {
    const existing = readNode(tree, path) // null = newly created by this write
    if (existing && cellsEqual(existing.cells, voxels) && assetBindingEqual(existing.attributes, asset)) return tree
    let next = upsertCells(tree, path, { schema: asset?.type ?? 'baked', cells: voxels }, nextVersion(tree))
    if (asset) {
      next = setAttribute(next, path, 'asset_name', asset.name, nextVersion(next))
      if (asset.alias) next = setAttribute(next, path, 'asset_alias', asset.alias, nextVersion(next))
      if (asset.type) next = setAttribute(next, path, 'asset_type', asset.type, nextVersion(next))
    }
    // Keep sibling order stable: ancestors never reorder, and painting an existing
    // layer must not move it to the end (only brand-new layers append).
    next = restoreAncestorVersions(tree, next, path)
    if (existing) next = setNodeVersion(next, path, existing.version)
    return next
  })
}

/**
 * Resolve which layer a paint stroke of `asset` under `parentPath` (the active
 * layer) should write into, creating a sub-layer if needed. Routing:
 *   - parent is empty (no asset_name)  → bind it to this asset, target = parent
 *   - parent already bound to this asset → target = parent
 *   - a direct child is already bound to this asset → reuse it (no new layer)
 *   - otherwise → create `layer-n` under parent bound to this asset
 * Never writes cells (that stays with setBakedCells); never reorders existing
 * layers. Returns the resolved target path.
 */
function sameAsset(
  attrs: Readonly<Record<string, unknown>> | undefined,
  asset: { name: string; alias?: string },
): boolean {
  const currentAlias = attrString(attrs, 'asset_alias')
  if (asset.alias && currentAlias) return currentAlias === asset.alias
  return attrString(attrs, 'asset_name') === asset.name
}

export async function ensurePaintTarget(parentPath: string, asset: { name: string; type?: string; alias?: string }): Promise<string> {
  const projDir = await getActiveProjectDir()
  const tree = load(projDir)
  const parent = parentPath === '/' ? tree : readNode(tree, parentPath)
  if (!parent) throw new Error(`paint-target parent not found: ${parentPath}`)

  const parentAsset = parentPath !== '/' ? attrString(parent.attributes, 'asset_name') : undefined

  // Paint into the active layer itself: empty layer binds; same asset reuses.
  if (parentPath !== '/' && (!parentAsset || sameAsset(parent.attributes, asset))) {
    if (!parentAsset) {
      await commitBakedMutation({
        label: 'Create paint target',
        tool: 'layer',
        summary: {
          paths: [parentPath],
          ...(asset.alias ? { assetAlias: asset.alias } : {}),
          assetName: asset.name,
        },
      }, (before) => bindAssetPreservingOrder(before, parentPath, asset))
    }
    return parentPath
  }

  // Reuse an existing direct child already bound to this asset.
  const reuse = parent.children.find((c) => sameAsset(c.attributes, asset))
  if (reuse) return reuse.path

  // Create a fresh `layer-n` sub-layer bound to this asset (appends; order stable).
  const path = uniqueChildPathSafe(tree, parentPath, nextLayerName(parent))
  await commitBakedMutation({
    label: 'Create paint target',
    tool: 'layer',
    summary: {
      paths: [path],
      ...(asset.alias ? { assetAlias: asset.alias } : {}),
      assetName: asset.name,
    },
  }, (before) => {
    const p = parentPath === '/' ? before : readNode(before, parentPath)
    const rank = maxOrderRank(p) + 1
    let next = upsertCells(before, path, { schema: asset.type ?? 'baked', cells: [] }, nextVersion(before))
    next = setAttribute(next, path, 'asset_name', asset.name, nextVersion(next))
    if (asset.alias) next = setAttribute(next, path, 'asset_alias', asset.alias, nextVersion(next))
    if (asset.type) next = setAttribute(next, path, 'asset_type', asset.type, nextVersion(next))
    next = setAttribute(next, path, BAKED_ORDER_ATTR, rank, nextVersion(next))
    return restoreAncestorVersions(before, next, path)
  })
  return path
}

export async function removeBakedLayer(path: string): Promise<void> {
  await commitBakedMutation({
    label: 'Delete baked layer',
    tool: 'layer',
    summary: { paths: [path] },
  }, (tree) => pruneNode(tree, path))
}

/**
 * Snapshot transient graph layers into the baked tree as new editable layers.
 *
 * Preserves the selection's **relative hierarchy and order**: each layer is
 * grafted at its original `nodePath` (so `/House` + `/House/Roof` stay nested,
 * and intermediate containers are auto-created). Only the TOP-LEVEL segment is
 * remapped when it collides with an existing baked layer, so re-baking never
 * clobbers prior baked work — the whole subtree shifts under the renamed root
 * together, keeping its internal structure. Layers must arrive in DFS order
 * (parent before child) so ascending versions reflect their order.
 */
export async function bakeLayersForProject(
  projectId: string,
  layers: ReadonlyArray<{ nodePath?: string; nodeName?: string; cells: readonly BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>,
  opts?: { replace?: boolean; recordHistory?: boolean },
): Promise<string[]> {
  const projDir = await getProjectDir(projectId)
  if (!projDir) throw new Error(`project not found: ${projectId}`)
  return bakeLayersForProjectDir(projDir, layers, opts)
}

async function bakeLayersForProjectDir(
  projDir: string,
  layers: ReadonlyArray<{ nodePath?: string; nodeName?: string; cells: readonly BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>,
  opts?: { replace?: boolean; recordHistory?: boolean },
): Promise<string[]> {
  if (opts?.replace) {
    clearBakedSceneForProjectDir(projDir)
  }
  let tree = opts?.replace ? emptyTree() : load(projDir)
  const rename = new Map<string, string>()
  const reserved = new Set<string>()
  const remapPath = (rawPath: string): string => {
    if (opts?.replace) return rawPath
    const segs = splitPath(rawPath)
    if (segs.length === 0) return rawPath
    const head = segs[0]!
    let mapped = rename.get(head)
    if (mapped === undefined) {
      mapped = head
      let n = 2
      while (readNode(tree, `/${mapped}`) || reserved.has(mapped)) mapped = `${head} ${n++}`
      rename.set(head, mapped)
      reserved.add(mapped)
    }
    segs[0] = mapped
    return `/${segs.join('/')}`
  }

  const created: string[] = []
  // Per-parent running order rank so the baked batch keeps its DFS arrival order
  // independent of version (which is content, not order).
  const orderByParent = new Map<string, number>()
  const nextRankUnder = (parentPath: string): number => {
    if (!orderByParent.has(parentPath)) {
      orderByParent.set(parentPath, maxOrderRank(parentPath === '/' ? tree : readNode(tree, parentPath)) + 1)
    }
    const r = orderByParent.get(parentPath)!
    orderByParent.set(parentPath, r + 1)
    return r
  }
  for (const layer of layers) {
    const raw = layer.nodePath && splitPath(layer.nodePath).length > 0
      ? layer.nodePath
      : `/${sanitizeSegment(layer.nodeName || 'Baked')}`
    const path = remapPath(raw)
    const voxels: VoxelCell[] = layer.cells.map((c) => ({
      x: c.x,
      y: c.y,
      z: c.z,
      token: c.token ?? layer.assetName ?? '',
      ...(c.state ? { state: c.state } : {}),
    }))
    tree = upsertCells(tree, path, { schema: layer.schema ?? layer.assetType ?? 'baked', cells: voxels }, nextVersion(tree))
    if (layer.assetName) tree = setAttribute(tree, path, 'asset_name', layer.assetName, nextVersion(tree))
    if (layer.assetAlias) tree = setAttribute(tree, path, 'asset_alias', layer.assetAlias, nextVersion(tree))
    if (layer.assetType) tree = setAttribute(tree, path, 'asset_type', layer.assetType, nextVersion(tree))
    tree = setAttribute(tree, path, BAKED_ORDER_ATTR, nextRankUnder(parentPathOf(path)), nextVersion(tree))
    created.push(path)
  }
  await commitBakedMutationForDir(projDir, {
    label: opts?.replace ? 'Replace baked from execute' : 'Bake selected layers',
    tool: 'bake',
    summary: { paths: created },
  }, () => tree, { recordHistory: opts?.recordHistory ?? !opts?.replace })
  return created
}

export async function bakeLayers(
  layers: ReadonlyArray<{ nodePath?: string; nodeName?: string; cells: readonly BakedCell[]; assetName?: string; assetAlias?: string; assetType?: string; schema?: string }>,
): Promise<string[]> {
  return bakeLayersForProjectDir(await getActiveProjectDir(), layers)
}

// ── Reorder / reparent (drag-and-drop in the Editable panel) ────────────────

function basename(path: string): string {
  const segs = splitPath(path)
  return segs[segs.length - 1] ?? ''
}
function parentPathOf(path: string): string {
  const segs = splitPath(path)
  return segs.length <= 1 ? '/' : `/${segs.slice(0, -1).join('/')}`
}
function joinPath(parent: string, name: string): string {
  return parent === '/' ? `/${name}` : `${parent}/${name}`
}

function sanitizeRenameSegment(name: string): string {
  const s = (name ?? '').replace(/\//g, ' ').trim()
  if (!s) throw new Error('layer name must not be empty')
  return s
}

/**
 * Reassign sibling order under `parentPath` by stamping each child's `__order`
 * attribute (projection sorts by it). Names not listed keep their relative
 * order, appended after. Crucially this does NOT touch the physical children
 * array order — `setAttribute` rewrites in place via the vendored binary-search
 * path, so the name-sorted invariant the tree relies on stays intact.
 */
function reorderSiblings(tree: SceneNodeSnapshot, parentPath: string, orderedNames: string[]): SceneNodeSnapshot {
  const parent = readNode(tree, parentPath)
  if (!parent) return tree
  const seen = new Set<string>()
  const sequence: string[] = []
  for (const n of orderedNames) {
    if (seen.has(n)) continue
    if (parent.children.some((c) => c.name === n)) {
      sequence.push(n)
      seen.add(n)
    }
  }
  for (const c of parent.children) if (!seen.has(c.name)) sequence.push(c.name)

  let next = tree
  sequence.forEach((name, i) => {
    const childPath = joinPath(parentPath, name)
    const child = readNode(next, childPath)
    if (!child) return
    if (orderRank(child) === i) return
    // Stamp order without disturbing the node's content version (order is not
    // content): write the attribute, then restore the node + ancestor versions.
    const before = next
    next = setAttribute(next, childPath, BAKED_ORDER_ATTR, i, nextVersion(next))
    next = restoreAncestorVersions(before, next, childPath)
    next = setNodeVersion(next, childPath, child.version)
  })
  return next
}

/**
 * Move (reparent and/or reorder) a layer subtree. `destParentPath` is the new
 * parent ('/' = top level); `beforeName` positions the moved node immediately
 * before that sibling (omit = append last). Internal hierarchy is preserved
 * (subtree moved whole). Moving a node into its own descendant is a no-op.
 */
export async function moveBakedLayer(srcPath: string, destParentPath: string, beforeName?: string): Promise<string | null> {
  let tree = load(await getActiveProjectDir())
  const src = readNode(tree, srcPath)
  if (!src) return null
  if (destParentPath === srcPath || destParentPath.startsWith(`${srcPath}/`)) return null // no cycles
  if (destParentPath !== '/' && !readNode(tree, destParentPath)) return null

  tree = pruneNode(tree, srcPath)
  // Unique name under the new parent (avoid clobbering an existing sibling).
  const name0 = basename(srcPath)
  let name = name0
  let n = 2
  while (readNode(tree, joinPath(destParentPath, name))) name = `${name0} ${n++}`
  const destPath = joinPath(destParentPath, name)
  tree = upsertSubtree(tree, destPath, src, nextVersion(tree))

  // Reorder unconditionally so the moved node lands where the drop implies:
  // `beforeName` set → just ahead of that sibling; omitted → appended last.
  // (Skipping this when `beforeName` is absent would leave the moved node's
  // stale `__order` intact, so "drag to bottom" would silently do nothing.)
  const parent = readNode(tree, destParentPath)
  if (parent) {
    // Build the order from the CURRENT display sequence (sorted by `__order`),
    // not the physical name-sorted array — otherwise reordering one node would
    // scramble the others' established order.
    const names = displayOrderedChildNames(parent).filter((x) => x !== name)
    const idx = beforeName ? names.indexOf(beforeName) : -1
    const order = idx < 0 ? [...names, name] : [...names.slice(0, idx), name, ...names.slice(idx)]
    tree = reorderSiblings(tree, destParentPath, order)
  }
  await commitBakedMutation({
    label: 'Move baked layer',
    tool: 'layer',
    summary: { paths: [srcPath, destPath] },
  }, () => tree)
  return destPath
}

/** Rename a layer in place, preserving its children and sibling position. */
export async function renameBakedLayer(path: string, name: string): Promise<string | null> {
  let tree = load(await getActiveProjectDir())
  const src = readNode(tree, path)
  if (!src) return null

  const parentPath = parentPathOf(path)
  const oldName = basename(path)
  const baseName = sanitizeRenameSegment(name)
  if (baseName === oldName) return path

  const parent = readNode(tree, parentPath)
  const siblingOrder = parent?.children.map((c) => c.name) ?? []
  tree = pruneNode(tree, path)

  let nextName = baseName
  let n = 2
  while (readNode(tree, joinPath(parentPath, nextName))) nextName = `${baseName} ${n++}`
  const destPath = joinPath(parentPath, nextName)
  tree = upsertSubtree(tree, destPath, src, nextVersion(tree))
  tree = reorderSiblings(tree, parentPath, siblingOrder.map((candidate) => candidate === oldName ? nextName : candidate))

  await commitBakedMutation({
    label: 'Rename baked layer',
    tool: 'layer',
    summary: { paths: [path, destPath] },
  }, () => tree)
  return destPath
}

function assertCustomAttributeKeys(attrs: Readonly<Record<string, unknown>>): void {
  for (const key of Object.keys(attrs)) {
    const trimmed = key.trim()
    if (!trimmed) throw new Error('attribute key must not be empty')
    if (trimmed.includes('/')) throw new Error(`invalid attribute key: ${key}`)
    if (RESERVED_BAKED_ATTRIBUTE_KEYS.has(trimmed)) throw new Error(`reserved attribute key: ${key}`)
  }
}

/**
 * Merge custom attributes onto one or more baked layers. Reserved keys are rejected.
 * By default, existing custom keys are preserved (overwrite=false).
 */
export async function patchBakedCustomAttributes(
  paths: readonly string[],
  attributes: Readonly<Record<string, unknown>>,
  opts?: { overwrite?: boolean },
): Promise<void> {
  if (paths.length === 0) return
  assertCustomAttributeKeys(attributes)
  const overwrite = !!opts?.overwrite
  let tree = load(await getActiveProjectDir())
  const before = tree

  for (const path of paths) {
    const existing = readNode(tree, path)
    if (!existing) throw new Error(`layer not found: ${path}`)
    const priorAttrs = existing.attributes ?? {}
    for (const [key, value] of Object.entries(attributes)) {
      if (!overwrite && Object.prototype.hasOwnProperty.call(priorAttrs, key)) continue
      tree = setAttribute(tree, path, key, value, nextVersion(tree))
    }
    tree = restoreAncestorVersions(before, tree, path)
    tree = setNodeVersion(tree, path, existing.version)
  }

  await commitBakedMutation({
    label: 'Update baked attributes',
    tool: 'attributes',
    summary: { paths: [...paths] },
  }, () => tree)
}

export async function getBakedHistoryStatus(): Promise<BakedHistoryStatus> {
  return historyStatus(loadHistory(await getActiveProjectDir()))
}

export async function undoBakedHistory(): Promise<BakedHistoryStatus> {
  const projDir = await getActiveProjectDir()
  const history = loadHistory(projDir)
  const entry = history.undo.at(-1)
  if (!entry) return historyStatus(history)
  persist(projDir, entry.before)
  const next: BakedHistoryFile = {
    version: 1,
    limit: history.limit,
    undo: history.undo.slice(0, -1),
    redo: [...history.redo, entry].slice(-history.limit),
  }
  persistHistory(projDir, next)
  return historyStatus(next)
}

export async function redoBakedHistory(): Promise<BakedHistoryStatus> {
  const projDir = await getActiveProjectDir()
  const history = loadHistory(projDir)
  const entry = history.redo.at(-1)
  if (!entry) return historyStatus(history)
  persist(projDir, entry.after)
  const next: BakedHistoryFile = {
    version: 1,
    limit: history.limit,
    undo: [...history.undo, entry].slice(-history.limit),
    redo: history.redo.slice(0, -1),
  }
  persistHistory(projDir, next)
  return historyStatus(next)
}

/** Test-only: drop the in-memory cache so a fresh load re-reads disk. */
export function _clearBakedCache(): void {
  cache.clear()
}
