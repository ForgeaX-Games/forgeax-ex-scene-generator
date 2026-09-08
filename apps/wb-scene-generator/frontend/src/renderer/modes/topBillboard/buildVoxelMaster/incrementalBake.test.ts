// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setCanvas2DBackend, type Surface2D } from '../../../framework/canvas2d'
import { setServerImageResolver } from '../../../framework/asset/imageCache'
import { buildVoxelMaster } from './index'
import { appendCellsToVoxelMaster, type AppendCell, type AppendStats } from './incrementalBake'
import type { VoxelLayerInput } from './types'

// Records ctx ops so we can assert an incremental append clears/redraws only the
// dirty region rather than the whole scene on the master surface.
type Op = { kind: 'fill' | 'clear' | 'draw'; x: number; y: number; w: number; h: number }
let opsBySurface = new WeakMap<object, Op[]>()

function makeRecordingSurface(width: number, height: number): Surface2D {
  const ops: Op[] = []
  const surface = {
    width,
    height,
    getContext: () => ({
      imageSmoothingEnabled: false,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      fillRect: (x: number, y: number, w: number, h: number) => ops.push({ kind: 'fill', x, y, w, h }),
      clearRect: (x: number, y: number, w: number, h: number) => ops.push({ kind: 'clear', x, y, w, h }),
      strokeRect: () => {},
      drawImage: (..._a: unknown[]) => ops.push({ kind: 'draw', x: 0, y: 0, w: 0, h: 0 }),
      save: () => {},
      restore: () => {},
      beginPath: () => {},
      rect: () => {},
      clip: () => {},
    } as unknown as CanvasRenderingContext2D),
  }
  opsBySurface.set(surface, ops)
  return surface as unknown as Surface2D
}

function tileSource(
  cells: Array<{ x: number; y: number; z: number }>,
  layerKey: string,
): VoxelLayerInput['source'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of cells) {
    if (c.x < minX) minX = c.x
    if (c.y < minY) minY = c.y
    if (c.x > maxX) maxX = c.x
    if (c.y > maxY) maxY = c.y
  }
  if (!Number.isFinite(minX)) { minX = 0; minY = 0; maxX = 0; maxY = 0 }
  return {
    rows: maxY - minY + 1,
    cols: maxX - minX + 1,
    worldOffsetX: minX,
    worldOffsetY: minY,
    layerKey,
    nodeId: layerKey,
    version: 1,
    isMultiValue: false,
    iterCells: (visit) => {
      for (const c of cells) visit({ col: c.x - minX, row: c.y - minY, z: c.z, value: 1 })
    },
  }
}

// A real *tile* binding requires AliasMeta.tileType to be set (that's what marks
// a cell as a 1-footprint autotile vs. an irregular object sprite). Without it,
// buildVoxelMaster treats the cell as an object and skips the incremental path.
function tileAlias(name: string) {
  return { alias: `[0][1][2][3][${name}][5][6][7][floor][16][10][11][v]`, tileType: 'floor' }
}

function tileInput(name: string, cells: Array<{ x: number; y: number; z: number }>, layerIdx: number): VoxelLayerInput {
  return {
    source: tileSource(cells, `layer-${name}`),
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    assetName: name,
    assetType: 'tile',
  }
}

function appendCell(x: number, y: number, z: number, layerIdx: number): AppendCell {
  return { x, y, z, value: 1, layerIdx, isSelected: false, isEditorSelected: false, isMultiValue: false }
}

// A non-tile *object* alias: NO tileType → buildVoxelMaster treats its cells as an
// irregular object sprite. This is what (pre-fix) poisoned the WHOLE master so
// `incremental` was dropped — forcing every tile paint elsewhere to full-rebuild.
function objectAlias(name: string) {
  return { alias: `[0][1][2][3][${name}][5][6][7][object][16][10][11][v]` }
}

function objectInput(name: string, cells: Array<{ x: number; y: number; z: number }>, layerIdx: number): VoxelLayerInput {
  const src = tileSource(cells, `obj-${name}`)
  return {
    source: {
      ...src,
      iterCells: (visit) => {
        let minX = Infinity, minY = Infinity
        for (const c of cells) { if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y }
        for (const c of cells) {
          visit({ col: c.x - minX, row: c.y - minY, z: c.z, value: 1, state: { instanceId: `${name}_inst`, role: 'anchor' } })
        }
      },
    },
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    assetName: name,
    assetType: 'object',
  }
}

const ASSET_OPTS = { drawMode: 'asset' as const, aliases: [tileAlias('Grass')] }

beforeEach(() => {
  opsBySurface = new WeakMap()
  setCanvas2DBackend({ createSurface: makeRecordingSurface, devicePixelRatio: () => 1 })
  setServerImageResolver((alias) => {
    const match = alias.match(/\[([^\]]*)\]/g)
    const name = match?.[4]?.slice(1, -1) ?? alias
    return { alias: name, width: 16, height: 16, naturalWidth: 16, naturalHeight: 16 }
  })
})

afterEach(() => {
  setCanvas2DBackend({
    createSurface: (w: number, h: number) =>
      ({ width: w, height: h, getContext: () => null } as unknown as Surface2D),
    devicePixelRatio: () => 1,
  })
  setServerImageResolver(null)
})

describe('appendCellsToVoxelMaster (incremental dirty-region bake)', () => {
  it('attaches incremental state to a tile-only master bake', () => {
    const master = buildVoxelMaster(
      [tileInput('Grass', [{ x: 0, y: 0, z: 0 }], 0)],
      ASSET_OPTS,
    )
    expect(master).not.toBeNull()
    expect(master!.incremental).toBeDefined()
    expect(master!.incremental!.drawMode).toBe('asset')
    expect(master!.incremental!.cells).toHaveLength(1)
  })

  it('REAL composite config: keeps incremental snapshot even when ANOTHER layer has an object sprite', () => {
    // The user's repro: a composite/multi-layer ASSET scene where one layer is an
    // ordinary autotile TILE and another layer contains a non-tile OBJECT sprite.
    // Pre-fix, the presence of ANY object sprite anywhere dropped `incremental`
    // for the WHOLE master (hasObjectSprites), so every tile paint full-rebuilt
    // (~960ms, `hasIncremental=false`). The snapshot must now survive.
    const ASSET_OPTS_BOTH = { drawMode: 'asset' as const, aliases: [tileAlias('Grass'), objectAlias('Tree')] }
    const master = buildVoxelMaster(
      [
        tileInput('Grass', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 0),
        objectInput('Tree', [{ x: 8, y: 8, z: 0 }], 1),
      ],
      ASSET_OPTS_BOTH,
    )
    expect(master).not.toBeNull()
    // The KEY assertion that fails pre-fix: snapshot present despite the object.
    expect(master!.incremental).toBeDefined()
    expect(master!.incremental!.drawMode).toBe('asset')

    // A 2nd tile paint FAR from the object must take the append/grow path (no full
    // rebuild) — i.e. appendCellsToVoxelMaster returns non-null.
    const next = appendCellsToVoxelMaster(master!, [appendCell(2, 0, 0, 0)], ASSET_OPTS_BOTH)
    expect(next).not.toBeNull()
    expect(next!.incremental).toBeDefined()
  })

  it('composite: a tile paint FAR from an object only clears a small dirty rect (object untouched)', () => {
    const ASSET_OPTS_BOTH = { drawMode: 'asset' as const, aliases: [tileAlias('Grass'), objectAlias('Tree')] }
    const master = buildVoxelMaster(
      [
        tileInput('Grass', [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], 0),
        objectInput('Tree', [{ x: 40, y: 40, z: 0 }], 1),
      ],
      ASSET_OPTS_BOTH,
    )
    expect(master).not.toBeNull()
    const surface = master!.canvas
    const ops = opsBySurface.get(surface as unknown as object)!
    ops.length = 0

    const next = appendCellsToVoxelMaster(master!, [appendCell(2, 0, 0, 0)], ASSET_OPTS_BOTH)
    expect(next).not.toBeNull()
    const clears = ops.filter((o) => o.kind === 'clear')
    expect(clears.length).toBeGreaterThan(0)
    // The cleared area near the painted tile must stay small — NOT span to the
    // distant object (which would mean we conservatively repaint the whole scene).
    const clearedArea = clears.reduce((a, o) => a + o.w * o.h, 0)
    expect(clearedArea).toBeLessThan(surface.width * surface.height)
  })

  it('reuses the master canvas and clears only the bounded dirty region for an in-bounds append', () => {
    // Leave a gap at x=2 so the appended cell lands inside the existing bbox.
    const baseCells = [0, 1, 3, 4].map((x) => ({ x, y: 0, z: 0 }))
    const master = buildVoxelMaster([tileInput('Grass', baseCells, 0)], ASSET_OPTS)
    expect(master).not.toBeNull()
    const surface = master!.canvas
    const ops = opsBySurface.get(surface as unknown as object)!
    ops.length = 0

    const next = appendCellsToVoxelMaster(master!, [appendCell(2, 0, 0, 0)], ASSET_OPTS)
    expect(next).not.toBeNull()
    expect(next!.canvas).toBe(surface) // no new surface allocated → no full rebuild
    expect(next!.incremental!.cells.length).toBe(baseCells.length + 1)

    const clears = ops.filter((o) => o.kind === 'clear')
    expect(clears).toHaveLength(1)
    // The cleared region must be a small fraction of the whole canvas (a couple
    // of columns), proving we did NOT clear/redraw the full scene.
    const clearedArea = clears[0].w * clears[0].h
    const fullArea = surface.width * surface.height
    expect(clearedArea).toBeLessThan(fullArea)
  })

  it('GROWS the master canvas (incremental, not null) when a new cell falls outside the current bbox', () => {
    const master = buildVoxelMaster([tileInput('Grass', [{ x: 0, y: 0, z: 0 }], 0)], ASSET_OPTS)
    expect(master).not.toBeNull()
    const oldArea = master!.canvas.width * master!.canvas.height
    const oldBbox = master!.bbox

    // Painting far outside the tight initial bbox previously returned null
    // (forcing a full O(N) rebuild on EVERY click as the user paints across the
    // canvas). It must now take the incremental bbox-grow path instead.
    const next = appendCellsToVoxelMaster(master!, [appendCell(9, 9, 0, 0)], ASSET_OPTS)
    expect(next).not.toBeNull()
    // A larger surface was allocated to cover the grown bbox…
    expect(next!.canvas).not.toBe(master!.canvas)
    expect(next!.canvas.width * next!.canvas.height).toBeGreaterThan(oldArea)
    // …the bbox grew to include the far cell…
    expect(next!.bbox.cols).toBeGreaterThan(oldBbox.cols)
    expect(next!.bbox.rows).toBeGreaterThan(oldBbox.rows)
    // …and the new cell is now part of the incremental snapshot.
    expect(next!.incremental!.cells.length).toBe(2)
  })

  it('bails on asset object instance cells (irregular sprite footprints)', () => {
    const master = buildVoxelMaster([tileInput('Grass', [{ x: 0, y: 0, z: 0 }], 0)], ASSET_OPTS)
    const next = appendCellsToVoxelMaster(
      master!,
      [{ ...appendCell(0, 0, 0, 0), state: { instanceId: 'obj_1', role: 'anchor' } }],
      ASSET_OPTS,
    )
    expect(next).toBeNull()
  })

  it('bails on color drawMode (occlusion culling is not dirty-region safe)', () => {
    const master = buildVoxelMaster([tileInput('Grass', [{ x: 0, y: 0, z: 0 }], 0)], ASSET_OPTS)
    const next = appendCellsToVoxelMaster(master!, [appendCell(1, 0, 0, 0)], { drawMode: 'color' })
    expect(next).toBeNull()
  })

  it('returns null when there is no prior master to append onto', () => {
    const next = appendCellsToVoxelMaster(null, [appendCell(0, 0, 0, 0)], ASSET_OPTS)
    expect(next).toBeNull()
  })

  it('is a no-op (returns the same master) when re-stamping an existing cell', () => {
    const master = buildVoxelMaster([tileInput('Grass', [{ x: 0, y: 0, z: 0 }], 0)], ASSET_OPTS)
    const next = appendCellsToVoxelMaster(master!, [appendCell(0, 0, 0, 0)], ASSET_OPTS)
    expect(next).toBe(master)
  })

  // ── O(k) scaling: per-paint cost must NOT grow with scene size N ──────────
  // Build a big scene, then count how many cells the dirty-region repaint loop
  // actually DRAWS for a single tile paint. With the old `for (const c of
  // mergedCells)` loop + full re-sort this was O(N); with the spatial bucket
  // index it must stay tiny (a constant handful) regardless of N.
  function bigGrid(side: number): Array<{ x: number; y: number; z: number }> {
    const cells: Array<{ x: number; y: number; z: number }> = []
    for (let x = 0; x < side; x++) for (let y = 0; y < side; y++) cells.push({ x, y, z: 0 })
    return cells
  }

  it('visits O(k) cells per append regardless of scene size N (no O(N) repaint scan)', () => {
    const visited: number[] = []
    const ns: number[] = []
    // Paint at the SAME fixed interior cell across all scene sizes, so the dirty
    // neighborhood is identical and any growth in `cellsVisited` could only come
    // from an O(N) scan — which the spatial index eliminates.
    const HOLE = { x: 10, y: 10 }
    for (const side of [22, 50, 70]) { // ~484, 2500, 4900 cells
      const base = bigGrid(side).filter((c) => !(c.x === HOLE.x && c.y === HOLE.y))
      const master = buildVoxelMaster([tileInput('Grass', base, 0)], ASSET_OPTS)
      expect(master).not.toBeNull()
      const stats: AppendStats = { n: 0, cellsVisited: 0, cellsPainted: 0, dirtyPx: 0 }
      const next = appendCellsToVoxelMaster(
        master!, [appendCell(HOLE.x, HOLE.y, 0, 0)], ASSET_OPTS, undefined, stats,
      )
      expect(next).not.toBeNull()
      expect(stats.n).toBe(base.length + 1) // really is a big scene
      visited.push(stats.cellsVisited)
      ns.push(stats.n)
    }
    // N grows ~10× across the runs…
    expect(Math.max(...ns) / Math.min(...ns)).toBeGreaterThan(8)
    // …but the repaint loop visits a CONSTANT tiny neighborhood (the OLD loop
    // scanned all N → visited would track N). Identical here since the paint cell
    // and its bucket neighborhood are the same in every run.
    expect(new Set(visited).size).toBe(1)
    for (const v of visited) expect(v).toBeLessThan(200)
    expect(Math.min(...visited)).toBeGreaterThan(0)
  })
})
