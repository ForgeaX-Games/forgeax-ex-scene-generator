// 💡 Node-callable barrel for the renderer's PURE autotile sprite resolver.
//
// This is the single source of truth for "given a cell + its same-template
// neighbours + the rule → which sprite index does that face get". The browser
// renderer (paintCell → pickFaceSprite) and the headless scene exporter MUST
// resolve the identical sprite for any cell; they do so by calling the SAME
// functions re-exported here — NOT by maintaining parallel copies.
//
// Only PURE functions are surfaced (no canvas/DOM/fetch/lifecycle): the autotile
// neighbour-key construction (incl. `adjacent8` / `edgeDist2`), wildcard map lookup, and the
// face sprite pick (incl. variant region-map selection + randomRules). These are
// exactly the pieces the exporter previously duplicated in
// backend/src/scene-export/tileRules.ts.
//
// The scene-export backend cannot value-import frontend modules directly (its
// `tsc -b` rootDir is backend/src). Instead `scripts/build-vendor.mjs` compiles
// THIS barrel (and its pure transitive deps) into `vendor/dist/renderer-resolve/`
// so the backend imports the renderer's actual resolver as emitted .js — one
// implementation, zero drift. Keep this barrel free of any browser/DOM import so
// the vendor compile (and Node consumers) stay clean.

export { pickFaceSprite, pickFaceSpriteIndex, pickFaceSpriteIndexIfMapped, type PickFaceContext } from '../modes/topBillboard/buildVoxelMaster/pickFaceSprite'
export {
  compareBillboardDrawOrder,
  type BillboardDrawOrderKey,
  type BillboardFaceOrder,
} from '../modes/topBillboard/buildVoxelMaster/billboardDrawOrder'
export { buildTopFaceKey, lookupWithWildcard } from '../framework/asset/neighborKey'
export {
  matchAssetEntry,
  type AliasMeta as AssetMatchAliasMeta,
  type AssetEntry,
  type AssetMatch,
} from '../framework/asset/matchAssetEntry'
export {
  computeValidVariantIdxs,
  computeValidVariantPool,
  computeValidVariantIdxsByTileId,
  computeValidVariantPoolsByTileId,
  pickWeightedVariant,
  rawVariantCandidates,
  spriteHasVisiblePixel,
  type RgbaView,
  type VariantPool,
} from '../framework/asset/variantCandidates'
export type { FaceRule, RuleSprite, NormalizedRule, FaceKeyMode } from '../framework/asset/ruleCache'
export type { CollectedCell } from '../modes/topBillboard/buildVoxelMaster/types'
