/**
 * Cross-boundary access to the Geometry DSL types + the small set of runtime
 * helpers the baker needs.
 *
 * The legacy backend imported these from the `@shared/types` workspace package.
 * This repo vendors the same module under `vendor/shared/types` and compiles it
 * to `vendor/dist/shared/types` (with `.d.ts`, see `scripts/build-vendor.mjs`).
 * We re-export the real compiled module here so the baker shares a single source
 * of truth with the batteries (no hand-maintained type/runtime mirror to drift):
 *   - types `Arg` / `Statement` / `Geometry` (consumed structurally),
 *   - `reachableSubgraphSource` (subgraph-scoped bake cache key),
 *   - `listBakeableShapeOps` (registry-driven "should this op be baked").
 *
 * vendor/dist lives outside the backend tsconfig `rootDir: src`, but because it
 * ships declarations it is treated as a library reference (not a compiled input),
 * so `tsc -b` resolves it without a rootDir violation.
 */

export type { Arg, Statement, Geometry } from '../../../../vendor/dist/shared/types/index.js'
export { reachableSubgraphSource, listBakeableShapeOps } from '../../../../vendor/dist/shared/types/index.js'
