import { describe, it, expect } from 'vitest'
import {
  aliasItemName,
  aliasPpu,
  fieldAt,
  isCutoutTypeField,
  MATERIAL_DEFAULT_OPTIONS,
  SLOT,
} from '../src/library/aliasName.js'

describe('aliasName contract', () => {
  const obj =
    '[A场景资产-家居-家具-储物]_[室内]_[木箱]_[木]_[无]_[西式奇幻]_[正常]_[asset]_[16]_[静态]_[无]_[0]_[书房]'

  it('extracts name at SLOT.name (index 2)', () => {
    expect(aliasItemName(obj)).toBe('木箱')
    expect(fieldAt(obj, SLOT.appearancePlace)).toBe('书房')
  })

  it('extracts PPU at SLOT.size (index 8)', () => {
    expect(aliasPpu(obj)).toBe(16)
  })

  it('includes expandable material defaults (纸/布/竹)', () => {
    expect(MATERIAL_DEFAULT_OPTIONS).toContain('纸')
    expect(MATERIAL_DEFAULT_OPTIONS).toContain('布')
    expect(MATERIAL_DEFAULT_OPTIONS).toContain('竹')
  })

  it('recognizes cutout type field', () => {
    expect(isCutoutTypeField('asset')).toBe(true)
    expect(isCutoutTypeField('common_16')).toBe(false)
  })
})
