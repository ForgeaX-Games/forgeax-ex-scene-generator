/**
 * Ambient types for the vendored renderer sprite resolver.
 *
 * `vendor/dist/renderer-resolve/...` is the renderer's PURE autotile resolver
 * (`pickFaceSpriteIndex` / `pickFaceSprite` / `buildTopFaceKey` /
 * `lookupWithWildcard`) compiled directly from the frontend SOURCE by
 * `scripts/build-vendor.mjs`. The scene exporter calls these — the SAME
 * functions the browser renderer uses — instead of maintaining a parallel
 * autotile re-derivation. The compiled bundle ships no `.d.ts` and its `.ts`
 * source lives outside the backend `rootDir`, so we declare the small surface
 * the cooker uses here. The shapes mirror the frontend `PickFaceContext` /
 * `RuleSprite` exactly (kept in lockstep by the renderer-parity test).
 */
declare module '*/vendor/dist/renderer-resolve/renderer/server/spriteResolver.js' {
  export interface AssetMatchAliasMeta {
    alias: string
    tileType?: string
    anchorX?: number
    anchorY?: number
    widthPx?: number
    heightPx?: number
    ppu?: number
    objectHeightPx?: number
    geometry?: unknown
  }
  export interface AssetEntry {
    assetName: string
    assetAlias?: string
    assetType?: string
  }
  export interface AssetMatch {
    primary: string
    variants: string[]
    tileType?: string
    anchor?: { x: number; y: number }
    ppu?: number
    widthPx?: number
    heightPx?: number
    objectHeightPx?: number
    geometry?: unknown
  }
  export function matchAssetEntry(
    entry: AssetEntry,
    aliases: ReadonlyArray<AssetMatchAliasMeta>,
    fuzzy: boolean,
  ): AssetMatch | null
  export interface RuleSprite {
    x: number
    y: number
    w: number
    h: number
  }
  export type FaceKeyMode = 'adjacent4' | 'adjacent8' | 'edgeDist2' | 'edgeDist4'
  export interface FaceVariant {
    when:
      | { regionContains: { region: string; offset: [number, number] } }
      | { stateEquals: { key: string; value: string } }
    map: Record<string, number>
  }
  export interface RandomRule {
    tileId: number
    keepProbability: number
    variantIdxs?: number[]
    variantWeights?: number[]
  }
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
  export interface CollectedCell {
    layerIdx: number
    x: number
    y: number
    z: number
    /** per-cell state (e.g. slopeDir) read by face.variants when.stateEquals */
    state?: Readonly<Record<string, unknown>>
    [extra: string]: unknown
  }
  export interface VariantPool {
    idxs: number[]
    weights?: number[]
  }
  export interface PickFaceContext {
    face: FaceRule
    faceTag: 'top' | 'front' | 'entry'
    sprites: ReadonlyArray<RuleSprite>
    validVariantIdxs: ReadonlyArray<number>
    validVariantWeights?: ReadonlyArray<number>
    validVariantPoolsByTileId?: ReadonlyMap<number, VariantPool>
    cell: CollectedCell
    coordsByLayerIdx: Map<number, Set<string>>
    regions: Map<string, Set<string>>
  }
  export function pickFaceSpriteIndex(ctx: PickFaceContext): number
  export function pickFaceSpriteIndexIfMapped(ctx: PickFaceContext): number | null
  export function pickFaceSprite(ctx: PickFaceContext): RuleSprite | null
  export function buildTopFaceKey(has: (dx: number, dy: number) => boolean, keyMode?: FaceKeyMode): string
  export function lookupWithWildcard(map: Record<string, number>, key: string): number | undefined
  /** Within one cell the bake draws the top cap before the front wall. */
  export type BillboardFaceOrder = 'top' | 'front' | 'object'
  export interface BillboardDrawOrderKey {
    y: number
    z: number
    layerIdx: number
    face: BillboardFaceOrder
  }
  /** The renderer's painter order: (y,z,layerIdx) ASC then top-before-front. */
  export function compareBillboardDrawOrder(a: BillboardDrawOrderKey, b: BillboardDrawOrderKey): number
  /** Minimal RGBA view (Buffer / typed-array backed); alpha at (y*width+x)*4+3. */
  export interface RgbaView {
    width: number
    height: number
    data: { readonly length: number; readonly [i: number]: number }
  }
  /** Raw variant candidate idxs (face.variantIdxs ?? sprites[basePieces..]). */
  export function rawVariantCandidates(face: FaceRule, spriteCount: number): number[]
  /** Minimum opaque pixel count for a variant slot to count as drawn. */
  export const MIN_VISIBLE_PIXELS: number
  /** True if the sprite sub-rect has ≥ MIN_VISIBLE_PIXELS alpha>0 pixels (null img → true). */
  export function spriteHasVisiblePixel(img: RgbaView | null, sprite: RuleSprite): boolean
  /** Non-transparent variant candidate idxs — the SAME filter the renderer uses. */
  export function computeValidVariantIdxs(
    face: FaceRule,
    sprites: ReadonlyArray<RuleSprite>,
    img: RgbaView | null,
  ): number[]
  export function computeValidVariantPool(
    face: FaceRule,
    sprites: ReadonlyArray<RuleSprite>,
    img: RgbaView | null,
  ): VariantPool
  export function computeValidVariantIdxsByTileId(
    face: FaceRule,
    sprites: ReadonlyArray<RuleSprite>,
    img: RgbaView | null,
  ): Map<number, number[]>
  export function computeValidVariantPoolsByTileId(
    face: FaceRule,
    sprites: ReadonlyArray<RuleSprite>,
    img: RgbaView | null,
  ): Map<number, VariantPool>
  export function pickWeightedVariant(pool: VariantPool, rngUnit: number): number
}
