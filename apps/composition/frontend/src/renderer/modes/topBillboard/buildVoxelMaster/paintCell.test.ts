import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { VoxelBbox } from '../../../framework/geometry/topBillboard'
import { getRegisteredAssetUrl, setServerImageResolver } from '../../../framework/asset/imageCache'
import type { CollectedCell, LayerAssetBinding } from './types'
import { objectFootprintAnchorPoint, objectSpriteGridRect, objectSpritePainterSortY, paintCell } from './paintCell'

type Op =
  | { type: 'drawImage'; args: unknown[] }
  | { type: 'fillRect'; args: number[] }
  | { type: 'strokeRect'; args: number[] }
  | { type: 'save' }
  | { type: 'restore' }

function makeCtx(ops: Op[]): CanvasRenderingContext2D {
  return {
    drawImage: (...args: unknown[]) => { ops.push({ type: 'drawImage', args }) },
    fillRect: (...args: number[]) => { ops.push({ type: 'fillRect', args }) },
    strokeRect: (...args: number[]) => { ops.push({ type: 'strokeRect', args }) },
    save: () => { ops.push({ type: 'save' }) },
    restore: () => { ops.push({ type: 'restore' }) },
  } as unknown as CanvasRenderingContext2D
}

function makeCell(isSelected: boolean): CollectedCell {
  return {
    x: 0,
    y: 0,
    z: 0,
    value: 1,
    layerIdx: 0,
    isSelected,
    isEditorSelected: false,
    isMultiValue: false,
  }
}

function makeBinding(): LayerAssetBinding {
  return {
    match: {
      primary: 'grass',
      variants: ['grass'],
      tileType: 'tilemap',
      ppu: 4,
    },
    rule: null,
    imgUrl: getRegisteredAssetUrl('grass'),
    validVariantIdxs: { top: [], front: [], entry: [] },
    validVariantWeights: { top: undefined, front: undefined, entry: undefined },
    validVariantPoolsByTileId: { top: new Map(), front: new Map(), entry: new Map() },
    regions: new Map(),
  }
}

const bbox: VoxelBbox = {
  cols: 1,
  rows: 2,
  worldOffsetX: 0,
  worldOffsetY: -1,
}

describe('topBillboard paintCell asset selection highlight', () => {
  beforeEach(() => {
    setServerImageResolver(() => ({ width: 8, height: 8, naturalWidth: 8, naturalHeight: 8 }))
  })

  afterEach(() => {
    setServerImageResolver(null)
  })

  it('draws a subtle highlight on selected asset cells without replacing the texture', () => {
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(true), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    const fillOps = ops.filter((op) => op.type === 'fillRect')
    const strokeOps = ops.filter((op) => op.type === 'strokeRect')

    expect(drawOps).toHaveLength(2)
    expect(fillOps).toHaveLength(2)
    expect(strokeOps).toHaveLength(2)
    expect(ops.findIndex((op) => op.type === 'fillRect')).toBeGreaterThan(
      ops.findIndex((op) => op.type === 'drawImage'),
    )
  })

  it('does not draw asset highlight strokes for unselected cells', () => {
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    expect(ops.filter((op) => op.type === 'drawImage')).toHaveLength(2)
    expect(ops.some((op) => op.type === 'strokeRect')).toBe(false)
  })

  it('draws object sprites at image pixels divided by global PPU', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const binding = makeBinding()
    binding.match.tileType = undefined
    binding.match.ppu = 4
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(1)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 24])
  })

  it('anchors object footprint at the AABB front-bottom (maxY), not center', () => {
    const column = Array.from({ length: 6 }, (_, i) => ({
      ...makeCell(false),
      x: 10,
      y: 20,
      z: i + 1,
    }))
    const pt = objectFootprintAnchorPoint(column)
    expect(pt).toEqual({ x: 10.5, y: 20 - 1 + 0.5 })
  })

  it('anchors siheyuan 18×18 voxel-mass at front minZ bottom (z=1 = ground top)', () => {
    const cells = []
    for (let x = 21; x <= 38; x++) {
      for (let y = 21; y <= 38; y++) {
        for (let z = 1; z <= 6; z++) {
          cells.push({ ...makeCell(false), x, y, z })
        }
      }
    }
    expect(objectFootprintAnchorPoint(cells)).toEqual({ x: 30, y: 37.5 })
  })

  it('draws objects at fixed 16 PPU with bottom anchor on voxel bottom point', () => {
    const img = { width: 192, height: 96, naturalWidth: 192, naturalHeight: 96 } as HTMLImageElement
    const anchorPoint = { x: 11, y: 15.5 }
    const rect = objectSpriteGridRect(makeCell(false), img, { x: 0.5, y: 0.01 }, anchorPoint)
    expect(rect.w).toBe(12)
    expect(rect.h).toBe(6)
    expect(rect.y + rect.h).toBeCloseTo(anchorPoint.y, 5)
    expect(rect.x + rect.w / 2).toBeCloseTo(anchorPoint.x, 5)
  })

  it('does not scale large sprites down to fit voxel footprint', () => {
    const img = { width: 288, height: 288, naturalWidth: 288, naturalHeight: 288 } as HTMLImageElement
    const anchorPoint = { x: 5.5, y: 10.5 }
    const rect = objectSpriteGridRect(makeCell(false), img, { x: 0.5, y: 0.007 }, anchorPoint)
    expect(rect.w).toBe(18)
    expect(rect.h).toBe(18)
    expect(rect.y + rect.h).toBeCloseTo(anchorPoint.y, 4)
  })

  it('sorts objects after ground tiles south of the footprint', () => {
    const column = Array.from({ length: 4 }, (_, i) => ({
      ...makeCell(false),
      x: 10,
      y: 50,
      z: i + 1,
    }))
    const anchorPoint = objectFootprintAnchorPoint(column)
    const img = { width: 192, height: 192, naturalWidth: 192, naturalHeight: 192 } as HTMLImageElement
    const rect = objectSpriteGridRect(column[0], img, { x: 0.5, y: 1 }, anchorPoint)
    const painterY = objectSpritePainterSortY(rect, 50)
    expect(painterY).toBeGreaterThanOrEqual(50)
    expect(rect.y + rect.h).toBeCloseTo(anchorPoint.y, 5)
  })

  it('aligns asymmetric object sprite anchors horizontally only', () => {
    const rect = objectSpriteGridRect(
      { ...makeCell(false), x: 10, y: 20 },
      { width: 64, height: 64, naturalWidth: 64, naturalHeight: 64 } as HTMLImageElement,
      { x: 0.75, y: 0.5 },
      { x: 12, y: 20.5 },
    )

    expect(rect).toMatchObject({
      x: 9,
      y: 16.5,
      w: 4,
      h: 4,
    })
    expect(rect.y + rect.h).toBeCloseTo(20.5, 5)
  })

  it('draws tile fallback images at source pixels divided by global PPU', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const bindings = new Map<number, LayerAssetBinding | null>([[0, makeBinding()]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(2)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 24])
    expect(drawOps[1].args.slice(-2)).toEqual([16, 24])
  })

  it('draws rule sprites at sprite pixels divided by global PPU', () => {
    const ops: Op[] = []
    const binding = makeBinding()
    binding.rule = {
      schemaVersion: 2,
      ppu: 32,
      sprites: [{ x: 0, y: 0, w: 32, h: 16 }],
      faces: { top: { basePieces: 1, map: { '0,0,0,0': 0 } } },
    }
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(false), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const drawOps = ops.filter((op) => op.type === 'drawImage')
    expect(drawOps).toHaveLength(1)
    expect(drawOps[0].args.slice(-2)).toEqual([16, 8])
  })

  it('uses subtle selected highlight over the true PPU-sized asset bounds', () => {
    setServerImageResolver(() => ({ width: 32, height: 48, naturalWidth: 32, naturalHeight: 48 }))
    const ops: Op[] = []
    const binding = makeBinding()
    binding.match.tileType = undefined
    binding.match.ppu = 4
    const bindings = new Map<number, LayerAssetBinding | null>([[0, binding]])

    paintCell(makeCtx(ops), makeCell(true), bbox, 8, 'asset', bindings, new Map([[0, new Set(['0,0,0'])]]))

    const fillOps = ops.filter((op) => op.type === 'fillRect')
    const strokeOps = ops.filter((op) => op.type === 'strokeRect')
    expect(fillOps).toHaveLength(1)
    expect(fillOps[0].args.slice(-2)).toEqual([16, 24])
    expect(strokeOps).toHaveLength(1)
    expect(strokeOps[0].args.slice(-2)).toEqual([15, 23])
  })
})
