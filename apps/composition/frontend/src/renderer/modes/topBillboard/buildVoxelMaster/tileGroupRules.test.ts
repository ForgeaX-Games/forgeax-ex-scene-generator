// @vitest-environment jsdom
//
// Tile-group RULE validation + stretch-constraint evidence for the three new
// 瓦片组 rules (slope_9 / bridge_horizontal_9 / bridge_vertical_15).
//
// Two layers of assertion:
//   1. SCHEMA  — each vendored assets/rules/<alias>.json parses through the SAME
//      production parser the renderer uses (getOrLoadRule → parseRule). A bad
//      schema makes getOrLoadRule return null, failing the test.
//   2. BEHAVIOR — drive pickFaceSprite over a painted rectangular region and map
//      the chosen sprite back to its (col,row) atlas cell, asserting the intended
//      stretch/repeat semantics:
//        * slope_9 / bridge_horizontal_9: standard 9-slice — the CENTER cell
//          (1,1,1,1) repeats freely in BOTH axes (widen + lengthen).
//        * bridge_vertical_15: horizontal widening normal (left/center/right),
//          but VERTICAL lengthening repeats ONLY the middle band (source row 2).
//          Top two cell-rows pin to source rows 0,1; bottom two to source rows
//          3,4 (second-from-bottom = row 3, NOT the middle band); only strictly
//          interior cells repeat source row 2. Resolved via the edgeDist2 keyMode
//          (6-digit u,d,l,r,u2,d2 key). Short regions (L<4) fall back with
//          tail-precedence: L=1→[0], L=2→[0,4], L=3→[0,3,4].

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  clearAllRuleCache,
  getOrLoadRule,
  subscribeToRuleReadiness,
  type NormalizedRule,
  type RuleSprite,
} from '../../../framework/asset/ruleCache'
import { pickFaceSprite } from './pickFaceSprite'
import type { CollectedCell } from './types'

const RULES_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'assets', 'rules')

/** Async-load a vendored rule through the production parser via a stubbed fetch. */
async function loadRule(alias: string): Promise<NormalizedRule> {
  const body = readFileSync(join(RULES_DIR, `${alias}.json`), 'utf-8')
  const original = globalThis.fetch
  globalThis.fetch = (() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(body)) } as Response)) as unknown as typeof fetch
  try {
    const ready = new Promise<void>((resolve) => {
      const unsub = subscribeToRuleReadiness(() => {
        unsub()
        resolve()
      })
    })
    const first = getOrLoadRule(alias)
    if (first) return first
    await ready
    const rule = getOrLoadRule(alias)
    if (!rule) throw new Error(`rule ${alias} failed to parse/validate`)
    return rule
  } finally {
    globalThis.fetch = original
  }
}

/** Map a chosen sprite back to its (col,row) atlas cell, given 16px tiles. */
function spriteCell(rule: NormalizedRule, sprite: RuleSprite): { col: number; row: number } {
  return { col: Math.round(sprite.x / 16), row: Math.round(sprite.y / 16) }
}

interface PaintRegion {
  /** width in cells (columns, x axis) */
  w: number
  /** height in cells (rows, y axis) */
  h: number
}

/**
 * Build the per-layer coord set for a filled w×h rectangle anchored at (0,0,0),
 * then pick the top-face sprite for every cell. Returns a (col,row)-grid the
 * same shape as the region, each entry the atlas cell that cell resolved to.
 */
function bakeRegion(rule: NormalizedRule, region: PaintRegion): Array<Array<{ col: number; row: number }>> {
  const top = rule.faces.top
  if (!top) throw new Error('rule has no top face')
  const layerSet = new Set<string>()
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < region.w; x++) layerSet.add(`${x},${y},0`)
  }
  const coordsByLayerIdx = new Map<number, Set<string>>([[0, layerSet]])

  const grid: Array<Array<{ col: number; row: number }>> = []
  for (let y = 0; y < region.h; y++) {
    const rowOut: Array<{ col: number; row: number }> = []
    for (let x = 0; x < region.w; x++) {
      const cell: CollectedCell = {
        x, y, z: 0, value: 1, layerIdx: 0,
        isSelected: false, isEditorSelected: false, isMultiValue: false,
      }
      const sprite = pickFaceSprite({
        face: top, faceTag: 'top',
        sprites: rule.sprites,
        validVariantIdxs: [],
        cell, coordsByLayerIdx,
        regions: new Map(),
      })
      if (!sprite) throw new Error(`no sprite for cell ${x},${y}`)
      rowOut.push(spriteCell(rule, sprite))
    }
    grid.push(rowOut)
  }
  return grid
}

beforeEach(() => clearAllRuleCache())
afterEach(() => clearAllRuleCache())

describe('tile-group rule schema (parse via production parser)', () => {
  it.each([
    ['slope_9', 9],
    ['bridge_horizontal_9', 9],
    ['bridge_vertical_15', 15],
  ])('%s parses to a valid v2 top-face rule with %i sprites', async (alias, spriteCount) => {
    const rule = await loadRule(alias)
    expect(rule.schemaVersion).toBe(2)
    expect(rule.name).toBe(alias)
    expect(rule.ppu).toBe(16)
    expect(rule.sprites).toHaveLength(spriteCount)
    expect(rule.faces.top).toBeTruthy()
    expect(rule.faces.top!.basePieces).toBe(spriteCount)
    // A fully-surrounded interior cell must always resolve to something. The
    // edgeDist2 rules key on 6 digits (u,d,l,r,u2,d2); adjacent4 on 4 (u,d,l,r).
    const interiorKey = rule.faces.top!.keyMode === 'edgeDist2' ? '1,1,1,1,1,1' : '1,1,1,1'
    expect(rule.faces.top!.map[interiorKey]).toBeTypeOf('number')
  })
})

describe('slope_9 / bridge_horizontal_9 — free stretch in BOTH axes', () => {
  it.each(['slope_9', 'bridge_horizontal_9'])(
    '%s: interior cells repeat the CENTER tile, widening AND lengthening freely',
    async (alias) => {
      const rule = await loadRule(alias)

      // A 5×5 region: every non-border cell is interior (1,1,1,1) and must map
      // to the center atlas cell (col 1, row 1) — repeated across both axes.
      const grid = bakeRegion(rule, { w: 5, h: 5 })
      for (let y = 1; y < 4; y++) {
        for (let x = 1; x < 4; x++) {
          expect(grid[y][x]).toEqual({ col: 1, row: 1 })
        }
      }
      // Corners use the 4 corner atlas cells (top/bottom × left/right).
      expect(grid[0][0]).toEqual({ col: 0, row: 0 })
      expect(grid[0][4]).toEqual({ col: 2, row: 0 })
      expect(grid[4][0]).toEqual({ col: 0, row: 2 })
      expect(grid[4][4]).toEqual({ col: 2, row: 2 })
      // Edge midpoints use the edge atlas cells.
      expect(grid[0][2]).toEqual({ col: 1, row: 0 }) // top edge
      expect(grid[4][2]).toEqual({ col: 1, row: 2 }) // bottom edge
      expect(grid[2][0]).toEqual({ col: 0, row: 1 }) // left edge
      expect(grid[2][4]).toEqual({ col: 2, row: 1 }) // right edge

      // Lengthening: a tall 3×9 strip — every interior row keeps the center band.
      const tall = bakeRegion(rule, { w: 3, h: 9 })
      for (let y = 1; y < 8; y++) expect(tall[y][1]).toEqual({ col: 1, row: 1 })
      // Widening: a wide 9×3 strip — every interior column keeps the center band.
      const wide = bakeRegion(rule, { w: 9, h: 3 })
      for (let x = 1; x < 8; x++) expect(wide[1][x]).toEqual({ col: 1, row: 1 })
    },
  )
})

describe('bridge_vertical_15 — widen freely, but vertical repeat is the MIDDLE row only', () => {
  it('vertical lengthening: caps 0/4, inner caps 1/3, only STRICT interior repeats row 2', async () => {
    const rule = await loadRule('bridge_vertical_15')

    // A 1-wide, 7-tall deck: head cap 0, head-inner 1, repeated middle 2,
    // tail-inner 3, tail cap 4.
    const grid = bakeRegion(rule, { w: 1, h: 7 })
    const rows = grid.map((r) => r[0].row)

    expect(rows).toEqual([0, 1, 2, 2, 2, 3, 4])
    // Head cap = source row 0 (no up-neighbour); tail cap = source row 4.
    expect(rows[0]).toBe(0)
    expect(rows[rows.length - 1]).toBe(4)
    // Strict interior (excluding the two inner caps) repeats EXACTLY row 2.
    for (let y = 2; y < rows.length - 2; y++) expect(rows[y]).toBe(2)

    // Growing taller only adds more row-2 cells in the middle; the four pinned
    // rows (0,1 at head, 3,4 at tail) stay fixed.
    const taller = bakeRegion(rule, { w: 1, h: 12 }).map((r) => r[0].row)
    expect(taller.slice(0, 2)).toEqual([0, 1])
    expect(taller.slice(-2)).toEqual([3, 4])
    expect(new Set(taller.slice(2, -2))).toEqual(new Set([2]))
  })

  // The core regression this rule fixes: with the old adjacent4 key the
  // second-from-bottom cell collided with the middle band (resolved to row 2),
  // dropping the tail's upper row. edgeDist2 must put it at source row 3.
  it.each([
    // L : expected source-row sequence top→bottom
    [1, [0]],
    [2, [0, 4]],
    [3, [0, 3, 4]],
    [4, [0, 1, 3, 4]],
    [5, [0, 1, 2, 3, 4]],
    [8, [0, 1, 2, 2, 2, 2, 3, 4]],
  ])('vertical length L=%i → source rows %j (tail-precedence, 2nd-from-bottom=row 3)', async (h, expected) => {
    const rule = await loadRule('bridge_vertical_15')
    const rows = bakeRegion(rule, { w: 1, h: h as number }).map((r) => r[0].row)
    expect(rows).toEqual(expected)
  })

  it('for L>=4 the second-from-bottom cell resolves to source row 3, NOT row 2', async () => {
    const rule = await loadRule('bridge_vertical_15')
    for (const h of [4, 5, 6, 8, 12]) {
      const rows = bakeRegion(rule, { w: 1, h }).map((r) => r[0].row)
      expect(rows[rows.length - 2]).toBe(3) // second-from-bottom
      expect(rows[1]).toBe(1) // second-from-top (head inner)
      expect(rows[0]).toBe(0)
      expect(rows[rows.length - 1]).toBe(4)
    }
  })

  it('horizontal widening uses left/center/right columns; center column tiles', async () => {
    const rule = await loadRule('bridge_vertical_15')

    // A wide 5-col × 7-row deck. Within each horizontal band the columns must be
    // left(0)/center(1)/right(2), and the center column repeats across the width.
    const grid = bakeRegion(rule, { w: 5, h: 7 })

    // Pick an interior row (middle band, source row 2).
    const midY = 3
    expect(grid[midY].map((c) => c.row).every((r) => r === 2)).toBe(true)
    expect(grid[midY][0].col).toBe(0) // left
    for (let x = 1; x < 4; x++) expect(grid[midY][x].col).toBe(1) // center repeats
    expect(grid[midY][4].col).toBe(2) // right

    // Head band (row 0) and tail band (row 4) widen the same way.
    expect(grid[0].map((c) => c.row).every((r) => r === 0)).toBe(true)
    expect(grid[0][0].col).toBe(0)
    for (let x = 1; x < 4; x++) expect(grid[0][x].col).toBe(1)
    expect(grid[0][4].col).toBe(2)

    expect(grid[6].map((c) => c.row).every((r) => r === 4)).toBe(true)

    // The fixed inner rows (1 = head-inner, 3 = tail-inner) also widen correctly.
    expect(grid[1].map((c) => c.row).every((r) => r === 1)).toBe(true)
    expect(grid[1][0].col).toBe(0)
    expect(grid[1][4].col).toBe(2)
    expect(grid[5].map((c) => c.row).every((r) => r === 3)).toBe(true)
    expect(grid[5][0].col).toBe(0)
    expect(grid[5][4].col).toBe(2)
  })

  it('a single isolated cell (L=1, W=1) resolves to the head cap (source row 0)', async () => {
    const rule = await loadRule('bridge_vertical_15')
    const grid = bakeRegion(rule, { w: 1, h: 1 })
    expect(grid[0][0].row).toBe(0)
  })
})
