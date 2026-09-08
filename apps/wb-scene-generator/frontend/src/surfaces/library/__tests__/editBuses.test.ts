// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { readPaintAsset, writePaintAsset, subscribePaintAsset, aliasItemName, aliasPpu } from '../paintAssetBus'
import {
  readSelectedLayer,
  writeSelectedLayer,
  subscribeSelectedLayer,
  type SelectedLayerInfo,
} from '../selectedLayerBus'
import {
  readEditMode,
  writeEditMode,
  subscribeEditMode,
  readBrushMode,
  writeBrushMode,
  subscribeBrushMode,
  readEditTool,
  writeEditTool,
  subscribeEditTool,
  readEditZ,
  writeEditZ,
  subscribeEditZ,
} from '../editToolbarBus'

beforeEach(() => localStorage.clear())

describe('paintAsset bus', () => {
  it('round-trips and clears', () => {
    expect(readPaintAsset()).toBeNull()
    writePaintAsset({ alias: 'grass.png', name: 'grass.png', type: 'tile' })
    expect(readPaintAsset()?.alias).toBe('grass.png')
    writePaintAsset(null)
    expect(readPaintAsset()).toBeNull()
  })

  it('notifies subscribers on a cross-document storage event', () => {
    const seen: (string | undefined)[] = []
    const unsub = subscribePaintAsset((a) => seen.push(a?.alias))
    localStorage.setItem('wb-scene-generator.assetstore.paintAsset', JSON.stringify({ alias: 'x', name: 'x' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.assetstore.paintAsset' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(seen).toEqual(['x'])
    unsub()
  })
})

describe('alias field extraction', () => {
  // 13-field asset-store contract: idx2 = name, idx8 = size/PPU.
  const obj = '[A场景资产-家居-家具-储物]_[室内]_[木箱]_[木]_[无]_[西式奇幻]_[正常]_[asset]_[16]_[静态]_[无]_[0]_[].png'
  const tile = '[T地形块-自然]_[室外]_[森林]_[]_[无]_[国风仙侠]_[正常]_[forest_16]_[32]_[静态]_[无]_[]_[].png'
  it('aliasItemName reads field index 2 (item name), falls back to the raw string', () => {
    expect(aliasItemName(obj)).toBe('木箱')
    expect(aliasItemName(tile)).toBe('森林')
    expect(aliasItemName('no-brackets-here')).toBe('no-brackets-here')
  })
  it('aliasPpu reads field index 8, null when absent/invalid', () => {
    expect(aliasPpu(obj)).toBe(16)
    expect(aliasPpu(tile)).toBe(32)
    expect(aliasPpu('[a]_[b]')).toBeNull()
  })
})

describe('selectedLayer bus', () => {
  const info: SelectedLayerInfo = {
    kind: 'baked', nodePath: '/Floor', nodeName: 'Floor', assetName: 'grass', assetType: 'tile', cellCount: 3,
  }
  it('round-trips and clears', () => {
    expect(readSelectedLayer()).toBeNull()
    writeSelectedLayer(info)
    expect(readSelectedLayer()).toMatchObject({ kind: 'baked', nodePath: '/Floor', cellCount: 3 })
    writeSelectedLayer(null)
    expect(readSelectedLayer()).toBeNull()
  })

  it('notifies subscribers cross-document for the key only', () => {
    const seen: (string | undefined)[] = []
    const unsub = subscribeSelectedLayer((i) => seen.push(i?.nodePath))
    writeSelectedLayer(info)
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.selectedLayers' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }))
    expect(seen).toEqual(['/Floor'])
    unsub()
  })
})

describe('editToolbar bus', () => {
  it('editMode defaults to false, round-trips, and notifies its key only', () => {
    expect(readEditMode()).toBe(false)
    writeEditMode(true)
    expect(readEditMode()).toBe(true)
    const seen: boolean[] = []
    const unsub = subscribeEditMode((v) => seen.push(v))
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.editMode' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(seen).toEqual([true])
    unsub()
  })

  it('editMode notifies same-window subscribers immediately on write', () => {
    const seen: boolean[] = []
    const unsub = subscribeEditMode((v) => seen.push(v))
    writeEditMode(true)
    writeEditMode(false)
    expect(seen).toEqual([true, false])
    unsub()
  })

  it('brushMode defaults to free, round-trips, and notifies its key only', () => {
    expect(readBrushMode()).toBe('free')
    writeBrushMode('box')
    expect(readBrushMode()).toBe('box')
    const seen: string[] = []
    const unsub = subscribeBrushMode((m) => seen.push(m))
    writeBrushMode('free')
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.brushMode' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(seen).toEqual(['free'])
    unsub()
  })

  it('editTool defaults to paint, round-trips, and notifies its key only', () => {
    expect(readEditTool()).toBe('paint')
    writeEditTool('erase')
    expect(readEditTool()).toBe('erase')
    const seen: string[] = []
    const unsub = subscribeEditTool((tool) => seen.push(tool))
    writeEditTool('eyedropper')
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.editTool' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(seen).toEqual(['eyedropper'])
    unsub()
  })

  it('editTool supports the SELECT tool (round-trips, normalizes unknowns to paint)', () => {
    writeEditTool('select')
    expect(readEditTool()).toBe('select')
    // An unknown / legacy value falls back to paint.
    localStorage.setItem('wb-scene-generator.preview.editTool', 'bogus')
    expect(readEditTool()).toBe('paint')
  })

  it('editZ defaults to 0, round-trips integer layers, and notifies its key only', () => {
    expect(readEditZ()).toBe(0)
    writeEditZ(2)
    expect(readEditZ()).toBe(2)
    writeEditZ(2.8)
    expect(readEditZ()).toBe(2)
    const seen: number[] = []
    const unsub = subscribeEditZ((z) => seen.push(z))
    writeEditZ(-1)
    window.dispatchEvent(new StorageEvent('storage', { key: 'wb-scene-generator.preview.editZ' }))
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }))
    expect(seen).toEqual([-1])
    unsub()
  })
})
