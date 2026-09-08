import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { cosmosZoneMarker } from '../../batteries/scene30/minecraft/cosmos_zone_marker/index.js'
import { riverLakeGen } from '../../batteries/components/elements/river_lake_gen/index.js'

/**
 * Regression coverage for the "cosmos_zone_marker" class of purity bug (see
 * scene-v3-refactor-spec canvas, Phase 5 §1 & §3): a battery held a
 * module-level memo table keyed by the LAST seed it saw, so its output
 * secretly depended on which unrelated invocation happened to run before it
 * in the same process — not just on its own input.
 *
 * Both batteries below now rebuild their permutation table fresh, as a local
 * value, on every call (no top-level mutable state) — see
 * `scripts/lint-battery-purity.mjs` for the static/AST version of this same
 * guarantee across all 317 battery entry files.
 *
 * This test proves the *runtime* invariant that static check can't see: an
 * invocation's result must be identical regardless of what other,
 * differently-seeded invocations of the SAME battery ran immediately before
 * it, interleaved in an arbitrary order.
 */

function smallGrid(size: number): number[][] {
  return Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => ((x + y) % 3 === 0 ? 1 : 0)))
}

describe('battery purity regression: invocation-order independence', () => {
  it('cosmos_zone_marker: result for a given seed is unaffected by interleaved calls with other seeds', () => {
    const grid = smallGrid(24)
    const callWith = (seed: number) => cosmosZoneMarker({ terrainGrid: grid, seed })

    const baseline = callWith(42)
    // Interleave calls with several unrelated seeds in between.
    callWith(1)
    callWith(999)
    callWith(7)
    const repeat = callWith(42)

    expect(repeat).toEqual(baseline)

    // And the reverse: shuffling which seed runs FIRST must not change any
    // individual seed's own result either.
    const forwardOrder = [1, 2, 3].map((s) => callWith(s))
    const reverseOrder = [3, 2, 1].map((s) => callWith(s)).reverse()
    expect(reverseOrder).toEqual(forwardOrder)
  })

  it('river_lake_gen: result for a given seed is unaffected by interleaved calls with other seeds', () => {
    const grid = smallGrid(20).map((row) => row.map(() => 0))
    const callWith = (seed: number) =>
      riverLakeGen({ inputGrid: grid, riverCount: 1, lakeCount: 1, algorithm: 'branching', seed })

    const baseline = callWith(1234)
    callWith(1)
    callWith(999999)
    const repeat = callWith(1234)

    expect(repeat).toEqual(baseline)
  })

  it('static guard: no battery entry file holds top-level mutable state (scripts/lint-battery-purity.mjs)', () => {
    const appRoot = resolve(import.meta.dirname, '..', '..')
    expect(() =>
      execFileSync('node', ['scripts/lint-battery-purity.mjs'], { cwd: appRoot, stdio: 'pipe' }),
    ).not.toThrow()
  })
})
