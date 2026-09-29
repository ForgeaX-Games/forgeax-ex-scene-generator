import { describe, expect, it } from 'vitest'
import {
  checkLocationNameAlignment,
  findMissingLocationNames,
  locationNamesMatch,
  normalizeLocationName,
} from '../src/lib/locationNameGate.js'

describe('normalizeLocationName / locationNamesMatch', () => {
  it('normalizes whitespace/punctuation and case for comparison', () => {
    expect(normalizeLocationName('望江客栈')).toBe('望江客栈')
    expect(normalizeLocationName(' 望江 客栈 ')).toBe('望江客栈')
    expect(normalizeLocationName('Old-Town_Inn')).toBe('oldtowninn')
  })

  it('matches bidirectionally after normalization (prefix/suffix tolerated)', () => {
    expect(locationNamesMatch('望江客栈', '望江客栈_主楼')).toBe(true)
    expect(locationNamesMatch('望江客栈', '主楼_望江客栈')).toBe(true)
    expect(locationNamesMatch('望江客栈', '望江客栈')).toBe(true)
    // Reverse direction also counts: a longer narrative name containing a shorter scene name.
    expect(locationNamesMatch('望江客栈别院', '望江客栈别院')).toBe(true)
  })

  it('does NOT match a genuinely different/generalized name', () => {
    expect(locationNamesMatch('望江客栈', '城镇')).toBe(false)
    expect(locationNamesMatch('市集', '建筑1')).toBe(false)
    expect(locationNamesMatch('灯柱', '石柱')).toBe(false)
  })

  it('never matches blank/empty names', () => {
    expect(locationNamesMatch('', '望江客栈')).toBe(false)
    expect(locationNamesMatch('望江客栈', '')).toBe(false)
  })
})

describe('findMissingLocationNames', () => {
  it('returns empty when every narrative name has a match', () => {
    const narrativeNames = ['望江客栈', '市集', '清水镇']
    const sceneNodeNames = ['望江客栈_主楼', '市集_摊位群', '清水镇', 'rest', 'block_ground']
    expect(findMissingLocationNames(narrativeNames, sceneNodeNames)).toEqual([])
  })

  it('reports a clearly missing narrative name with a structured reason', () => {
    const narrativeNames = ['望江客栈', '市集', '灯柱']
    const sceneNodeNames = ['望江客栈_主楼', '市集_摊位群'] // 灯柱 missing
    const missing = findMissingLocationNames(narrativeNames, sceneNodeNames)
    expect(missing).toHaveLength(1)
    expect(missing[0]!.name).toBe('灯柱')
    expect(missing[0]!.reason).toContain('灯柱')
    expect(missing[0]!.reason).toContain('scene_set_attribute')
  })

  it('tolerates the fuzzy-match case: narrative name embedded as a prefix in a longer scene node name', () => {
    // Exactly the case called out in the task: 望江客栈 present as 望江客栈_主楼.
    const missing = findMissingLocationNames(['望江客栈'], ['望江客栈_主楼'])
    expect(missing).toEqual([])
  })

  it('dedupes narrative names and ignores blanks', () => {
    const missing = findMissingLocationNames(['市集', '市集', '', '  '], ['市集'])
    expect(missing).toEqual([])
  })
})

describe('checkLocationNameAlignment', () => {
  it('passes (returns null) when all narrative entities are present', () => {
    const narrativeNames = ['望江客栈', '市集', '清水镇', '灯柱', '石柱', '彼岸花', '假山']
    const sceneNodeNames = [
      '望江客栈_主楼', '望江客栈_偏院', '市集_杂货铺', '市集_布庄', '市集_灯笼',
      '清水镇', '灯柱', '石柱', '彼岸花', '假山', 'rest', 'BaseNode',
    ]
    expect(checkLocationNameAlignment(narrativeNames, sceneNodeNames)).toBeNull()
  })

  it('fails with the correct missing-entity list when one narrative entity is clearly missing', () => {
    const narrativeNames = ['望江客栈', '市集', '清水镇']
    // 清水镇 never shows up anywhere in the scene graph.
    const sceneNodeNames = ['望江客栈_主楼', '市集_摊位群', 'rest', 'BaseNode']
    const rejection = checkLocationNameAlignment(narrativeNames, sceneNodeNames)
    expect(rejection).not.toBeNull()
    expect(rejection!.missing).toEqual([
      expect.objectContaining({ name: '清水镇' }),
    ])
    expect(rejection!.reason).toMatch(/location-names-not-aligned/)
    expect(rejection!.reason).toMatch(/stage3\.location_names/)
    expect(rejection!.fix).toContain('额外的补充节点')
  })

  it('tolerates fuzzy-match prefix/suffix (望江客栈 as 望江客栈_主楼) without flagging it missing', () => {
    const rejection = checkLocationNameAlignment(['望江客栈', '市集'], ['望江客栈_主楼', '市集_摊位群'])
    expect(rejection).toBeNull()
  })

  it('does NOT penalize extra supplementary/decoration nodes beyond the narrative names', () => {
    // 市集 requires elaboration (multiple buildings) per the task's requirement —
    // extra nodes must never cause a failure, only missing core names should.
    const rejection = checkLocationNameAlignment(
      ['市集'],
      ['市集_杂货铺', '市集_布庄', '市集_灯笼', '市集_招牌', 'NaturalDecoration_1', 'LocalPrecise_2'],
    )
    expect(rejection).toBeNull()
  })

  it('is a DEFAULT-OFF no-op when no narrative names are supplied', () => {
    expect(checkLocationNameAlignment([], ['whatever'])).toBeNull()
  })
})
