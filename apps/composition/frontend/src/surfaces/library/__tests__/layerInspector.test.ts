import { describe, it, expect } from 'vitest'
import {
  buildLayerInspectorViewModel,
  commonPathPrefix,
  computeVoxelStats,
  mergeTemplateAttributes,
  parseAttrInput,
  type SelectedLayerSnapshot,
} from '../layerInspector.js'
import { ATTRIBUTE_TEMPLATES } from '../attributeTemplates.js'

function snap(partial: Partial<SelectedLayerSnapshot> & Pick<SelectedLayerSnapshot, 'kind' | 'nodePath'>): SelectedLayerSnapshot {
  return {
    layerKey: `${partial.kind}:${partial.nodePath}`,
    nodeName: partial.nodeName ?? partial.nodePath.split('/').pop() ?? '/',
    value: partial.value ?? 1,
    assetName: partial.assetName ?? '',
    attributes: partial.attributes ?? {},
    voxelStats: partial.voxelStats ?? computeVoxelStats([]),
    ...partial,
  }
}

describe('computeVoxelStats', () => {
  it('summarizes bounds and token count', () => {
    const stats = computeVoxelStats([
      { x: 1, y: 2, z: 0, token: 'a' },
      { x: 3, y: 4, z: 1, token: 'b' },
      { x: 3, y: 4, z: 1, token: 'b' },
    ])
    expect(stats).toMatchObject({ cellCount: 3, xMin: 1, xMax: 3, tokenCount: 2 })
  })
})

describe('buildLayerInspectorViewModel', () => {
  it('shows shared custom attrs and marks mixed values non-editable', () => {
    const vm = buildLayerInspectorViewModel([
      snap({ kind: 'baked', nodePath: '/A', attributes: { terrain_kind: 'sand', walkable: true } }),
      snap({ kind: 'baked', nodePath: '/B', attributes: { terrain_kind: 'rock', walkable: true } }),
    ])
    const terrain = vm.customAttrs.find((r) => r.key === 'terrain_kind')
    expect(terrain?.value).toBe('mixed')
    expect(terrain?.editable).toBe(false)
    const walk = vm.customAttrs.find((r) => r.key === 'walkable')
    expect(walk?.value).toBe('true')
    expect(walk?.editable).toBe(true)
  })

  it('keeps reserved attrs read-only in the view model', () => {
    const vm = buildLayerInspectorViewModel([
      snap({ kind: 'baked', nodePath: '/X', attributes: { asset_name: 'grass', asset_alias: 'grass-alias', asset_type: 'tile', biome: 'forest' } }),
    ])
    expect(vm.reservedAttrs.map((r) => r.key).sort()).toEqual(['asset_alias', 'asset_name', 'asset_type'])
    expect(vm.customAttrs.some((r) => r.key === 'biome')).toBe(true)
  })
})

describe('commonPathPrefix', () => {
  it('finds longest shared prefix', () => {
    expect(commonPathPrefix(['/House/Roof', '/House/Wall'])).toBe('/House')
  })
})

describe('mergeTemplateAttributes', () => {
  it('preserves existing custom keys by default', () => {
    const out = mergeTemplateAttributes({ biome: 'desert' }, { biome: 'forest', walkable: true }, false)
    expect(out.biome).toBe('desert')
    expect(out.walkable).toBe(true)
  })

  it('keeps renderer-reserved keys out while allowing export metadata keys', () => {
    const out = mergeTemplateAttributes(
      { asset_name: 'grass', terrain_type: 'old' },
      { asset_name: 'stone', export_role: 'terrain', terrain_type: 'base', area_L0: 'Demo' },
      true,
    )
    expect(out.asset_name).toBe('grass')
    expect(out.export_role).toBe('terrain')
    expect(out.terrain_type).toBe('base')
    expect(out.area_L0).toBe('Demo')
  })
})

describe('ATTRIBUTE_TEMPLATES', () => {
  it('includes scene export terrain and object templates', () => {
    expect(ATTRIBUTE_TEMPLATES.map((template) => template.id)).toEqual(
      expect.arrayContaining(['scene-export-terrain', 'scene-export-object']),
    )
  })
})

describe('parseAttrInput', () => {
  it('parses booleans and numbers', () => {
    expect(parseAttrInput('true')).toBe(true)
    expect(parseAttrInput('42')).toBe(42)
  })
})
