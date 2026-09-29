import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setCanvas2DBackend, type Surface2D } from '../../../framework/canvas2d'
import { setServerImageResolver } from '../../../framework/asset/imageCache'
import { buildVoxelMaster } from './index'
import type { VoxelLayerInput } from './types'

type DrawImageOp = { image: { alias: string }; dx: number; dy: number; dw: number; dh: number }

let drawImageOps: DrawImageOp[] = []
let surfaces: Surface2D[] = []

const originalBackend = {
  createSurface: (w: number, h: number): Surface2D => {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h) as unknown as Surface2D
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    return c as unknown as Surface2D
  },
  devicePixelRatio: () => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1),
}

function makeRecordingSurface(width: number, height: number): Surface2D {
  const surface = {
    width,
    height,
    getContext: () => ({
      imageSmoothingEnabled: false,
      drawImage: (...args: unknown[]) => {
        const image = args[0] as { alias: string }
        const tail = args.slice(-4) as [number, number, number, number]
        drawImageOps.push({ image, dx: tail[0], dy: tail[1], dw: tail[2], dh: tail[3] })
      },
      fillRect: () => {},
      strokeRect: () => {},
      save: () => {},
      restore: () => {},
    } as unknown as CanvasRenderingContext2D),
  }
  surfaces.push(surface)
  return surface
}

function sourceAt(x: number, y: number, z: number, layerKey: string): VoxelLayerInput['source'] {
  return {
    rows: 1,
    cols: 1,
    worldOffsetX: x,
    worldOffsetY: y,
    layerKey,
    nodeId: layerKey,
    version: 1,
    isMultiValue: false,
    iterCells: (visit) => { visit({ col: 0, row: 0, z, value: 1 }) },
  }
}

function sourceFromCells(
  cells: Array<{
    x: number
    y: number
    z: number
    state?: Record<string, unknown>
  }>,
  layerKey: string,
): VoxelLayerInput['source'] {
  return {
    rows: 1,
    cols: 1,
    worldOffsetX: 0,
    worldOffsetY: 0,
    layerKey,
    nodeId: layerKey,
    version: 1,
    isMultiValue: false,
    iterCells: (visit) => {
      for (const c of cells) {
        visit({ col: c.x, row: c.y, z: c.z, value: 1, state: c.state } as never)
      }
    },
  }
}

function objectAlias(name: string, anchor = { x: 0.5, y: 0 }) {
  return {
    alias: `[0][1][${name}][3][4][5][6][asset][16][10][11][v]`,
    anchorX: anchor.x,
    anchorY: anchor.y,
  }
}

function objectInput(name: string, x: number, y: number, z: number, layerIdx: number): VoxelLayerInput {
  return {
    source: sourceAt(x, y, z, `layer-${name}`),
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    assetName: name,
    assetType: 'asset',
  }
}

function objectInputWithAlias(
  name: string,
  alias: string,
  x: number,
  y: number,
  z: number,
  layerIdx: number,
): VoxelLayerInput {
  return {
    ...objectInput(name, x, y, z, layerIdx),
    assetAlias: alias,
  } as VoxelLayerInput
}

function objectInputWithCells(
  name: string,
  cells: Array<{ x: number; y: number; z: number; state?: Record<string, unknown> }>,
  layerIdx: number,
): VoxelLayerInput {
  return {
    source: sourceFromCells(cells, `layer-${name}`),
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    assetName: name,
    assetType: 'asset',
  }
}

function tileAlias(name: string) {
  return {
    alias: `[0][1][${name}][3][4][5][6][floor][16][10][11][v]`,
    tileType: 'floor',
  }
}

function tileInput(name: string, x: number, y: number, z: number, layerIdx: number): VoxelLayerInput {
  return {
    source: sourceAt(x, y, z, `layer-${name}`),
    layerIdx,
    isSelected: false,
    isEditorSelected: false,
    assetName: name,
    assetType: 'tile',
  }
}

describe('buildVoxelMaster object sprite ordering and bounds', () => {
  beforeEach(() => {
    drawImageOps = []
    surfaces = []
    setCanvas2DBackend({
      createSurface: makeRecordingSurface,
      devicePixelRatio: () => 1,
    })
    setServerImageResolver((alias) => {
      const match = alias.match(/\[([^\]]*)\]/g)
      const name = match?.[2]?.slice(1, -1) ?? alias
      return { alias: name, width: 32, height: 64, naturalWidth: 32, naturalHeight: 64 }
    })
  })

  afterEach(() => {
    setCanvas2DBackend(originalBackend)
    setServerImageResolver(null)
  })

  it('sorts non-tile objects by 3D footprint depth rather than projected screen y', () => {
    buildVoxelMaster(
      [
        objectInput('HighTree', 0, 2, 2, 0),
        objectInput('FrontTree', 0, 1, 0, 1),
      ],
      { drawMode: 'asset', aliases: [objectAlias('HighTree'), objectAlias('FrontTree')] },
    )

    expect(drawImageOps.map(op => op.image.alias)).toEqual(['FrontTree', 'HighTree'])
  })

  it('renders the exact selected alias when display names collide', () => {
    const aliasA = objectAlias('盆栽').alias
    const aliasB = '[0][1][盆栽][3][4][5][6][asset][32][10][11][v]'

    buildVoxelMaster(
      [objectInputWithAlias('盆栽', aliasB, 0, 0, 0, 0)],
      {
        drawMode: 'asset',
        aliases: [
          { alias: aliasA, widthPx: 16, heightPx: 16 },
          { alias: aliasB, widthPx: 64, heightPx: 32 },
        ],
      },
    )

    expect(drawImageOps.map(op => op.image.alias)).toEqual(['盆栽'])
    expect(drawImageOps[0].dw).toBe(16)
  })

  it('sorts non-tile objects by footprint anchor depth rather than sprite rectangle bottom', () => {
    buildVoxelMaster(
      [
        objectInput('AnchoredBackObject', 0, 0, 0, 0),
        objectInput('FrontObject', 0, 1, 0, 1),
      ],
      {
        drawMode: 'asset',
        aliases: [
          objectAlias('AnchoredBackObject', { x: 0.5, y: 0.5 }),
          objectAlias('FrontObject', { x: 0.5, y: 0 }),
        ],
      },
    )

    expect(drawImageOps.map(op => op.image.alias)).toEqual(['AnchoredBackObject', 'FrontObject'])
  })

  it('draws an elevated object after the same footprint ground tile', () => {
    buildVoxelMaster(
      [
        objectInput('Tree', 0, 0, 1, 0),
        tileInput('Grass', 0, 0, 0, 1),
      ],
      { drawMode: 'asset', aliases: [objectAlias('Tree'), tileAlias('Grass')] },
    )

    expect(drawImageOps.map(op => op.image.alias)).toEqual(['Grass', 'Grass', 'Tree'])
  })

  it('draws one sprite for grouped object instance cells on the same layer', () => {
    const groupedCells = [
      {
        x: 0,
        y: 0,
        z: 0,
        state: {
          instanceId: 'inst_tree',
          role: 'column',
          footprintDx: 0,
          footprintDy: 0,
          columnDz: 0,
          columnHeight: 2,
          footprintOrigin: { x: 0, y: 0, z: 0 },
        },
      },
      {
        x: 1,
        y: 0,
        z: 0,
        state: {
          instanceId: 'inst_tree',
          role: 'anchor',
          footprintDx: 1,
          footprintDy: 0,
          columnDz: 0,
          columnHeight: 2,
          footprintOrigin: { x: 0, y: 0, z: 0 },
        },
      },
      {
        x: 0,
        y: 0,
        z: 1,
        state: {
          instanceId: 'inst_tree',
          role: 'column',
          footprintDx: 0,
          footprintDy: 0,
          columnDz: 1,
          columnHeight: 2,
          footprintOrigin: { x: 0, y: 0, z: 0 },
        },
      },
    ]

    buildVoxelMaster(
      [
        objectInputWithCells('Tree', groupedCells, 0),
        objectInput('LegacyRock', 4, 4, 0, 1),
      ],
      { drawMode: 'asset', aliases: [objectAlias('Tree'), objectAlias('LegacyRock')] },
    )

    expect(drawImageOps.filter(op => op.image.alias === 'Tree')).toHaveLength(1)
    expect(drawImageOps.filter(op => op.image.alias === 'LegacyRock')).toHaveLength(1)
  })

  it('draws one sprite for voxel-mass object layer without instanceId', () => {
    const footprint = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ]

    buildVoxelMaster(
      [objectInputWithCells('四合院', footprint, 0)],
      { drawMode: 'asset', aliases: [objectAlias('四合院')] },
    )

    expect(drawImageOps.filter(op => op.image.alias === '四合院')).toHaveLength(1)
  })

  it('sorts grouped object instances by their occupied column depth', () => {
    buildVoxelMaster(
      [
        objectInput('FrontObject', 0, 2, 0, 0),
        objectInputWithCells('TallColumn', [
          {
            x: 0,
            y: 0,
            z: 0,
            state: {
              instanceId: 'inst_column',
              role: 'anchor',
              footprintDx: 0,
              footprintDy: 0,
              columnDz: 0,
              columnHeight: 2,
              footprintOrigin: { x: 0, y: 0, z: 0 },
            },
          },
          {
            x: 0,
            y: 3,
            z: 1,
            state: {
              instanceId: 'inst_column',
              role: 'column',
              footprintDx: 0,
              footprintDy: 3,
              columnDz: 1,
              columnHeight: 2,
              footprintOrigin: { x: 0, y: 0, z: 0 },
            },
          },
        ], 1),
      ],
      { drawMode: 'asset', aliases: [objectAlias('FrontObject'), objectAlias('TallColumn')] },
    )

    expect(drawImageOps.map(op => op.image.alias)).toEqual(['FrontObject', 'TallColumn'])
  })

  it('expands the master bounds to retain tall object sprites above the terrain', () => {
    const master = buildVoxelMaster(
      [
        objectInputWithCells('TallTree', [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
          { x: 1, y: 1, z: 0 },
        ], 0),
      ],
      { drawMode: 'asset', aliases: [objectAlias('TallTree')] },
    )

    expect(master).not.toBeNull()
    expect(master?.bbox.worldOffsetY).toBeLessThan(-1)
    expect(surfaces[0].height).toBeGreaterThan(16)
    expect(drawImageOps[0]).toMatchObject({ dw: 16, dh: 32 })
    expect(Number.isInteger(drawImageOps[0].dx)).toBe(true)
    expect(Number.isInteger(drawImageOps[0].dy)).toBe(true)
  })

  it('keeps tile draw coordinates on integer pixels when fractional object bounds expand the master', () => {
    buildVoxelMaster(
      [
        objectInput('OffsetAnchorObject', 0, 0, 0, 0),
        tileInput('Grass', 2, 2, 0, 1),
      ],
      {
        drawMode: 'asset',
        aliases: [
          objectAlias('OffsetAnchorObject', { x: 0.4947061659414557, y: 0.05762042274957968 }),
          tileAlias('Grass'),
        ],
      },
    )

    const grassOps = drawImageOps.filter(op => op.image.alias === 'Grass')
    expect(grassOps.length).toBeGreaterThan(0)
    for (const op of grassOps) {
      expect(Number.isInteger(op.dx)).toBe(true)
      expect(Number.isInteger(op.dy)).toBe(true)
    }
  })
})
