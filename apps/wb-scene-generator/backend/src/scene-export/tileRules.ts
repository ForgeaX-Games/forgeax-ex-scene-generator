// 💡 Tile-group autotile resolution for the cooker — DELEGATES to the renderer.
//
// PRINCIPLE: the exported per-cell sprite MUST be the EXACT sprite the renderer
// draws. The renderer resolves it at bake time from (cell + same-template
// neighbours + the rule JSON) via `pickFaceSprite` /  `pickFaceSpriteIndex` in
// `modes/topBillboard/buildVoxelMaster/pickFaceSprite.ts`. The export path now
// calls THAT SAME function — there is ONE implementation of the autotile pick
// (neighbour-key incl. `adjacent8` / `edgeDist2`, wildcard precedence, variant region-map
// selection, randomRules substitution), shared by render and export with zero
// drift. (SELECT is a separate capability — it resolves a clicked cell to its
// owning LAYER via framework/cellAttribution, not to a sprite — so it does not
// participate here.)
//
// The renderer's pure resolver is value-imported via the vendored bundle
// `vendor/dist/renderer-resolve/...`, which `scripts/build-vendor.mjs` compiles
// directly from the frontend SOURCE (no copy). We can't static-import the
// frontend `.ts` (its module graph pulls browser/DOM deps + sits outside the
// backend tsc `rootDir`), so the vendored emit is the bridge; ambient types live
// in `vendorResolver.d.ts`.
//
// What REMAINS backend-local here is NOT rule re-derivation — it is only:
//   * rule JSON loading/parsing (`loadTileRule` / `parseRule`), and
//   * the variant-candidate PIXEL FILTER (`computeValid*VariantIdxs`), which the
//     renderer performs via a canvas pixel-probe (DOM) that can't run headless;
//     we reproduce that candidate set from the decoded RGBA so randomRules
//     samples the same visible variants. The PICK itself is the renderer's.
//
// We resolve BOTH faces because the editor renders in `topBillboard` mode: every
// voxel (x,y,z) draws a top cap at screen row (y-z-1) PLUS a front wall at
// (y-z). The cooker bakes that billboard projection into flat cells and asks the
// shared resolver for each face's sprite index.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeValidVariantPool as computeValidVariantPoolShared,
  computeValidVariantPoolsByTileId as computeValidVariantPoolsByTileIdShared,
  type VariantPool,
  pickFaceSpriteIndex,
  pickFaceSpriteIndexIfMapped,
  type CollectedCell,
  type FaceRule as RendererFaceRule,
  type PickFaceContext,
} from '../../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'
import type { RgbaImage } from './png.js'

export interface RuleSprite {
  x: number
  y: number
  w: number
  h: number
}

export type FaceKeyMode = 'adjacent4' | 'adjacent8' | 'edgeDist2' | 'edgeDist4'

export type FaceVariantWhen =
  | { regionContains: { region: string; offset: [number, number] } }
  | { stateEquals: { key: string; value: string } }

export interface FaceVariant {
  when: FaceVariantWhen
  map: Record<string, number>
}

export type { VariantPool }

export interface RandomRule {
  tileId: number
  keepProbability: number
  variantIdxs?: number[]
  variantWeights?: number[]
}

/** 连续 3×3 实心块整体换大图(仅 front 有意义);见前端 ruleCache.ts 同名类型注释 */
export interface FaceBlockVariant {
  probability: number
  groups: number[][]
}

export interface FaceRule {
  basePieces: number
  keyMode?: FaceKeyMode
  map: Record<string, number>
  variants?: FaceVariant[]
  randomRules?: RandomRule[]
  variantIdxs?: number[]
  variantWeights?: number[]
  blockVariants?: FaceBlockVariant
}

export interface TileRule {
  schemaVersion: 1 | 2
  ppu: number
  sprites: RuleSprite[]
  faces: { top?: FaceRule; front?: FaceRule; entry?: FaceRule }
  regions?: Record<string, { source: 'parent' | 'self' }>
}

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'rules')

const cache = new Map<string, TileRule | null>()

/** Override the rules directory (tests). Pass `undefined` to reset to default. */
let rulesDirOverride: string | undefined
export function setRulesDir(dir: string | undefined): void {
  rulesDirOverride = dir
  cache.clear()
  validVariantCache.clear()
  validVariantPoolsByTileIdCache.clear()
}

/**
 * Load + normalize a tile rule by alias (= asset_kind / tileType). Returns
 * `null` (cached) when the file is missing or invalid so callers degrade to a
 * single whole-sheet tile.
 */
export function loadTileRule(tileType: string): TileRule | null {
  if (cache.has(tileType)) return cache.get(tileType) ?? null
  const dir = rulesDirOverride ?? RULES_DIR
  let parsed: TileRule | null = null
  try {
    const raw = readFileSync(join(dir, `${tileType}.json`), 'utf8')
    parsed = parseRule(JSON.parse(raw))
  } catch {
    parsed = null
  }
  cache.set(tileType, parsed)
  return parsed
}

// ── Rule JSON → TileRule (mirror of ruleCache.parseRule) ─────────────────────
//
// Byte-for-byte mirror of the renderer's private `parseRule` in
// framework/asset/ruleCache.ts (which we must not edit/export). Kept in lockstep
// by scene-export-renderer-parity.test.ts.

export function parseRule(json: unknown): TileRule | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const v = o.schemaVersion
  if (v !== 1 && v !== 2) return null
  if (typeof o.ppu !== 'number' || o.ppu <= 0) return null
  if (!Array.isArray(o.sprites) || o.sprites.length === 0) return null
  const sprites: RuleSprite[] = []
  for (const s of o.sprites) {
    if (!s || typeof s !== 'object') return null
    const sp = s as Record<string, unknown>
    if (typeof sp.x !== 'number' || typeof sp.y !== 'number'
      || typeof sp.w !== 'number' || typeof sp.h !== 'number') return null
    sprites.push({ x: sp.x, y: sp.y, w: sp.w, h: sp.h })
  }

  if (v === 1) {
    if (typeof o.basePieces !== 'number' || o.basePieces < 0) return null
    const map = o.map as Record<string, unknown> | undefined
    if (!map || typeof map !== 'object' || !validateMap(map)) return null
    return {
      schemaVersion: 1,
      ppu: o.ppu,
      sprites,
      faces: {
        top: {
          basePieces: o.basePieces,
          map: map as Record<string, number>,
          ...(parseRandomRules(o.randomRules) ? { randomRules: parseRandomRules(o.randomRules) } : {}),
        },
      },
    }
  }

  const faces = o.faces as Record<string, unknown> | undefined
  if (!faces || typeof faces !== 'object') return null
  const top = parseFace(faces.top)
  const front = parseFace(faces.front)
  const entry = parseFace(faces.entry)
  if (!top && !front && !entry) return null
  const regions = parseRegions(o.regions)
  return {
    schemaVersion: 2,
    ppu: o.ppu,
    sprites,
    faces: {
      ...(top ? { top } : {}),
      ...(front ? { front } : {}),
      ...(entry ? { entry } : {}),
    },
    ...(regions ? { regions } : {}),
  }
}

function parseFace(raw: unknown): FaceRule | null {
  if (!raw || typeof raw !== 'object') return null
  const f = raw as Record<string, unknown>
  if (typeof f.basePieces !== 'number' || f.basePieces < 0) return null
  if (!f.map || typeof f.map !== 'object') return null
  if (!validateMap(f.map as Record<string, unknown>)) return null
  const variantIdxs = Array.isArray(f.variantIdxs)
    && f.variantIdxs.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
    ? (f.variantIdxs as number[])
    : undefined
  const variantWeights = parseVariantWeights(f.variantWeights, variantIdxs?.length)
  const variants = parseFaceVariants(f.variants)
  const keyMode = parseFaceKeyMode(f.keyMode)
  const randomRules = parseRandomRules(f.randomRules, variantIdxs, variantWeights)
  const blockVariants = parseFaceBlockVariants(f.blockVariants)
  return {
    basePieces: f.basePieces,
    map: f.map as Record<string, number>,
    ...(randomRules ? { randomRules } : {}),
    ...(keyMode ? { keyMode } : {}),
    ...(variantIdxs ? { variantIdxs } : {}),
    ...(variantWeights ? { variantWeights } : {}),
    ...(variants ? { variants } : {}),
    ...(blockVariants ? { blockVariants } : {}),
  }
}

function parseFaceKeyMode(raw: unknown): FaceKeyMode | undefined {
  if (raw === 'edgeDist2' || raw === 'edgeDist4' || raw === 'adjacent8') return raw
  return undefined
}

function parseFaceBlockVariants(raw: unknown): FaceBlockVariant | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const b = raw as Record<string, unknown>
  if (typeof b.probability !== 'number' || b.probability < 0 || b.probability > 1) return undefined
  if (!Array.isArray(b.groups)) return undefined
  const groups: number[][] = []
  for (const g of b.groups) {
    if (!Array.isArray(g) || g.length !== 9) continue
    if (!g.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)) continue
    groups.push(g as number[])
  }
  return groups.length > 0 ? { probability: b.probability, groups } : undefined
}

function parseFaceVariants(raw: unknown): FaceVariant[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: FaceVariant[] = []
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const when = parseFaceVariantWhen(r.when)
    if (!when) continue
    if (!r.map || typeof r.map !== 'object') continue
    if (!validateMap(r.map as Record<string, unknown>)) continue
    out.push({ when, map: r.map as Record<string, number> })
  }
  return out.length > 0 ? out : undefined
}

function parseFaceVariantWhen(raw: unknown): FaceVariant['when'] | null {
  if (!raw || typeof raw !== 'object') return null
  const w = raw as Record<string, unknown>
  const se = w.stateEquals as Record<string, unknown> | undefined
  if (se && typeof se === 'object') {
    if (typeof se.key !== 'string' || typeof se.value !== 'string') return null
    return { stateEquals: { key: se.key, value: se.value } }
  }
  const rc = w.regionContains as Record<string, unknown> | undefined
  if (!rc || typeof rc !== 'object') return null
  if (typeof rc.region !== 'string') return null
  if (!Array.isArray(rc.offset) || rc.offset.length !== 2) return null
  if (!rc.offset.every((n) => typeof n === 'number' && Number.isInteger(n))) return null
  return {
    regionContains: {
      region: rc.region,
      offset: [rc.offset[0] as number, rc.offset[1] as number],
    },
  }
}

function parseRegions(raw: unknown): TileRule['regions'] {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, { source: 'parent' | 'self' }> = {}
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue
    const src = (v as Record<string, unknown>).source
    if (src !== 'parent' && src !== 'self') continue
    out[name] = { source: src }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function validateMap(m: Record<string, unknown>): boolean {
  for (const v of Object.values(m)) {
    if (typeof v !== 'number') return false
  }
  return true
}

function parseVariantWeights(raw: unknown, expectedLen?: number): number[] | undefined {
  if (!Array.isArray(raw)) return undefined
  if (!raw.every((n) => typeof n === 'number' && n >= 0 && Number.isFinite(n))) return undefined
  const weights = raw as number[]
  if (weights.length === 0) return undefined
  if (expectedLen !== undefined && weights.length !== expectedLen) return undefined
  return weights
}

function parseRandomRules(
  raw: unknown,
  faceVariantIdxs?: number[],
  faceVariantWeights?: number[],
): FaceRule['randomRules'] {
  if (!Array.isArray(raw)) return undefined
  const out: NonNullable<FaceRule['randomRules']> = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const rr = r as Record<string, unknown>
    if (typeof rr.tileId !== 'number' || typeof rr.keepProbability !== 'number') continue
    const variantIdxs = Array.isArray(rr.variantIdxs)
      && rr.variantIdxs.every((n) => typeof n === 'number' && Number.isInteger(n) && n >= 0)
      ? (rr.variantIdxs as number[])
      : undefined
    const poolLen = variantIdxs?.length ?? faceVariantIdxs?.length
    const variantWeights = parseVariantWeights(rr.variantWeights, poolLen)
      ?? (variantIdxs ? undefined : faceVariantWeights)
    out.push({
      tileId: rr.tileId,
      keepProbability: rr.keepProbability,
      ...(variantIdxs?.length ? { variantIdxs } : {}),
      ...(variantWeights?.length ? { variantWeights } : {}),
    })
  }
  return out.length > 0 ? out : undefined
}

// ── Sprite-index resolution — DELEGATED to the renderer's pickFaceSpriteIndex ──
//
// The cooker holds per-template occupancy as an `occ(dx,dy,dz)` neighbour probe.
// The renderer's resolver instead consumes a `coordsByLayerIdx` map (layerIdx →
// "x,y,z" set) and reads neighbours relative to the cell. We bridge by handing
// the resolver a single synthetic layer (idx 0) whose coordinate set answers
// `has(dx,dy,dz)` exactly as `occ` does for THIS cell, so the renderer computes
// the identical neighbour key without us re-implementing any key/lookup logic.

/** Build a 1-entry coordsByLayerIdx so the renderer's neighbour probe around
 *  `(x,y,z)` returns whatever `occ(dx,dy,dz)` says (only the offsets the rule
 *  actually probes matter; we seed the local neighbourhood the faces read). */
function occToCoords(
  x: number,
  y: number,
  z: number,
  occ: (dx: number, dy: number, dz: number) => boolean,
): Map<number, Set<string>> {
  const set = new Set<string>()
  // Offsets the renderer's top (adjacent4 / adjacent8 / edgeDist2 ±2 / edgeDist4 ±2 xy) + front faces can read.
  const offsets: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, -1, 0], [0, 1, 0], [-1, 0, 0], [1, 0, 0],   // top adjacent4
    [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 1, 0], // top adjacent8 diagonals
    [0, -2, 0], [0, 2, 0],                           // top edgeDist2 (vertical ±2)
    [-2, 0, 0], [2, 0, 0],                           // top edgeDist4 (horizontal ±2)
    [0, 0, 1], [0, 0, -1],                           // front t/b (z axis)
  ]
  // front blockVariants 3×3 实心块检测:命中格可以是巨格内任意局部位置(0..2),
  // 故 anchor 相对当前 cell 最远 ±2;需 dx,dz ∈[-2,2](dy=0,同 y 层)全覆盖。
  for (let dz = -2; dz <= 2; dz++) {
    for (let dx = -2; dx <= 2; dx++) {
      offsets.push([dx, 0, dz])
    }
  }
  for (const [dx, dy, dz] of offsets) {
    if (occ(dx, dy, dz)) set.add(`${x + dx},${y + dy},${z + dz}`)
  }
  return new Map([[0, set]])
}

function faceContext(
  face: FaceRule,
  faceTag: 'top' | 'front' | 'entry',
  rule: TileRule,
  x: number,
  y: number,
  z: number,
  occ: (dx: number, dy: number, dz: number) => boolean,
  validVariantIdxs: ReadonlyArray<number>,
  regions: Map<string, Set<string>> | undefined,
  validVariantWeights?: ReadonlyArray<number>,
  validVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>,
  state?: Readonly<Record<string, unknown>>,
): PickFaceContext {
  const cell: CollectedCell = { layerIdx: 0, x, y, z, ...(state ? { state } : {}) }
  return {
    face: face as unknown as RendererFaceRule,
    faceTag,
    sprites: rule.sprites,
    validVariantIdxs,
    ...(validVariantWeights?.length ? { validVariantWeights } : {}),
    ...(validVariantPoolsByTileId?.size ? { validVariantPoolsByTileId } : {}),
    cell,
    coordsByLayerIdx: occToCoords(x, y, z, occ),
    regions: regions ?? new Map(),
  }
}

/**
 * Top-face sprite index for a cell — RESOLVED BY the renderer's
 * `pickFaceSpriteIndex` (no backend pick). `occ(dx,dy,dz)` reports same-template
 * neighbours; `validVariantIdxs` is the pixel-filtered candidate set; `regions`
 * maps region names to "x,y" sets for face.variants. Returns a valid index into
 * `rule.sprites`.
 */
export function pickTopSpriteIndex(
  rule: TileRule,
  x: number,
  y: number,
  z: number,
  occ: (dx: number, dy: number, dz: number) => boolean,
  opts?: {
    validVariantIdxs?: ReadonlyArray<number>
    validVariantWeights?: ReadonlyArray<number>
    validVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>
    validEntryVariantIdxs?: ReadonlyArray<number>
    validEntryVariantWeights?: ReadonlyArray<number>
    validEntryVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>
    regions?: Map<string, Set<string>>
    /** per-cell state (e.g. slopeDir) for face.variants when.stateEquals matching */
    state?: Readonly<Record<string, unknown>>
  },
): number {
  const entry = rule.faces.entry
  if (entry && occ) {
    const entryIdx = pickFaceSpriteIndexIfMapped(
      faceContext(entry, 'entry', rule, x, y, z, occ, opts?.validEntryVariantIdxs ?? [], opts?.regions, opts?.validEntryVariantWeights, opts?.validEntryVariantPoolsByTileId, opts?.state),
    )
    if (entryIdx !== null) return entryIdx
  }
  const face = rule.faces.top
  if (!face) return 0
  return pickFaceSpriteIndex(
    faceContext(face, 'top', rule, x, y, z, occ, opts?.validVariantIdxs ?? [], opts?.regions, opts?.validVariantWeights, opts?.validVariantPoolsByTileId, opts?.state),
  )
}

/**
 * Front-face (wall) sprite index for a voxel — RESOLVED BY the renderer's
 * `pickFaceSpriteIndex` (no backend pick). Returns a valid index into
 * `rule.sprites`, or `null` when the rule has no front face (ground-only tiles
 * draw no wall).
 */
export function pickFrontSpriteIndex(
  rule: TileRule,
  x: number,
  y: number,
  z: number,
  occ: (dx: number, dy: number, dz: number) => boolean,
  opts?: {
    validVariantIdxs?: ReadonlyArray<number>
    validVariantWeights?: ReadonlyArray<number>
    validVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>
    regions?: Map<string, Set<string>>
    /** per-cell state (e.g. slopeDir) for face.variants when.stateEquals matching */
    state?: Readonly<Record<string, unknown>>
  },
): number | null {
  const face = rule.faces.front
  if (!face) return null
  return pickFaceSpriteIndex(
    faceContext(face, 'front', rule, x, y, z, occ, opts?.validVariantIdxs ?? [], opts?.regions, opts?.validVariantWeights, opts?.validVariantPoolsByTileId, opts?.state),
  )
}

const validVariantCache = new Map<string, number[]>()
const validVariantWeightsCache = new Map<string, number[] | undefined>()
const validVariantPoolsByTileIdCache = new Map<string, Map<number, VariantPool>>()

/**
 * Resolve a rule's top-level `regions` declaration to concrete `name → Set<"x,y">`
 * exactly like the renderer's binding stage (bindings.ts). `parent` regions union
 * the xy of every layer under the same direct parent path; `self` regions use the
 * layer's own xy. The cook MUST build these and pass them to pick*SpriteIndex, or
 * region-gated face variants (e.g. wall_outer_16's inner-wall sprites) never fire
 * and the export diverges from the editor for those faces.
 */
export function resolveRuleRegions(
  rule: TileRule,
  layerXy: Set<string>,
  parentXy: Set<string>,
): Map<string, Set<string>> {
  const regions = new Map<string, Set<string>>()
  if (!rule.regions) return regions
  for (const [name, decl] of Object.entries(rule.regions)) {
    if (decl.source === 'parent') regions.set(name, parentXy)
    else if (decl.source === 'self') regions.set(name, layerXy)
  }
  return regions
}

export function computeValidTopVariantIdxs(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] {
  return computeValidFaceVariantPool(rule, rule.faces.top, 'top', sheetKey, img).idxs
}

export function computeValidEntryVariantIdxs(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] {
  return computeValidFaceVariantPool(rule, rule.faces.entry, 'entry', sheetKey, img).idxs
}

export function computeValidEntryVariantWeights(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] | undefined {
  return computeValidFaceVariantPool(rule, rule.faces.entry, 'entry', sheetKey, img).weights
}

export function computeValidEntryVariantPoolsByTileId(rule: TileRule, sheetKey: string, img: RgbaImage | null): Map<number, VariantPool> {
  return computeValidFaceVariantPoolsByTileId(rule, rule.faces.entry, 'entry', sheetKey, img)
}

export function computeValidFrontVariantIdxs(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] {
  return computeValidFaceVariantPool(rule, rule.faces.front, 'front', sheetKey, img).idxs
}

export function computeValidTopVariantWeights(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] | undefined {
  return computeValidFaceVariantPool(rule, rule.faces.top, 'top', sheetKey, img).weights
}

export function computeValidFrontVariantWeights(rule: TileRule, sheetKey: string, img: RgbaImage | null): number[] | undefined {
  return computeValidFaceVariantPool(rule, rule.faces.front, 'front', sheetKey, img).weights
}

export function computeValidTopVariantPoolsByTileId(rule: TileRule, sheetKey: string, img: RgbaImage | null): Map<number, VariantPool> {
  return computeValidFaceVariantPoolsByTileId(rule, rule.faces.top, 'top', sheetKey, img)
}

export function computeValidFrontVariantPoolsByTileId(rule: TileRule, sheetKey: string, img: RgbaImage | null): Map<number, VariantPool> {
  return computeValidFaceVariantPoolsByTileId(rule, rule.faces.front, 'front', sheetKey, img)
}

/** @deprecated alias — use computeValidTopVariantPoolsByTileId */
export function computeValidTopVariantIdxsByTileId(rule: TileRule, sheetKey: string, img: RgbaImage | null): Map<number, number[]> {
  const pools = computeValidTopVariantPoolsByTileId(rule, sheetKey, img)
  const out = new Map<number, number[]>()
  for (const [k, p] of pools) out.set(k, p.idxs)
  return out
}

// Variant opacity-filter — DELEGATED to the renderer's shared computeValidVariantIdxs
// (vendored). The renderer drops fully-transparent variant slots before randomRules
// samples, by probing the sheet's pixels; export MUST drop the SAME slots or it can
// place a transparent placeholder where the renderer shows nothing / a real variant.
// We feed the cook's decoded RGBA (RgbaImage satisfies the shared RgbaView) into the
// SAME function the renderer's bindings.ts calls — one opacity implementation, no
// headless re-derivation. Only randomRules faces need it (others have no variants).
//
// `sheetKey` MUST uniquely identify the SOURCE SHEET (the per-template asset alias),
// NOT the shared rule/tileType: many templates reuse one tileType (e.g. "common_16")
// with identical sheet dims, so a tileType+dims cache key collides across distinct
// sheets and leaks the first sheet's candidate set to the rest — exactly the
// transparent-variant divergence this filter exists to prevent.
function computeValidFaceVariantPool(
  rule: TileRule,
  face: FaceRule | undefined,
  faceTag: 'top' | 'front' | 'entry',
  sheetKey: string,
  img: RgbaImage | null,
): VariantPool {
  if (!face || !face.randomRules || face.randomRules.length === 0) return { idxs: [] }
  const cacheKey = `${sheetKey}|${img ? `${img.width}x${img.height}` : 'noimg'}|${faceTag}|pool`
  const cachedIdxs = validVariantCache.get(cacheKey)
  if (cachedIdxs) {
    return { idxs: cachedIdxs, weights: validVariantWeightsCache.get(cacheKey) }
  }
  const out = computeValidVariantPoolShared(
    face as unknown as RendererFaceRule,
    rule.sprites,
    img,
  )
  validVariantCache.set(cacheKey, out.idxs)
  validVariantWeightsCache.set(cacheKey, out.weights)
  return out
}

function computeValidFaceVariantPoolsByTileId(
  rule: TileRule,
  face: FaceRule | undefined,
  faceTag: 'top' | 'front' | 'entry',
  sheetKey: string,
  img: RgbaImage | null,
): Map<number, VariantPool> {
  if (!face || !face.randomRules || face.randomRules.length === 0) return new Map()
  const cacheKey = `${sheetKey}|${img ? `${img.width}x${img.height}` : 'noimg'}|${faceTag}|byTileId`
  const cached = validVariantPoolsByTileIdCache.get(cacheKey)
  if (cached) return cached
  const out = computeValidVariantPoolsByTileIdShared(
    face as unknown as RendererFaceRule,
    rule.sprites,
    img,
  )
  validVariantPoolsByTileIdCache.set(cacheKey, out)
  return out
}
