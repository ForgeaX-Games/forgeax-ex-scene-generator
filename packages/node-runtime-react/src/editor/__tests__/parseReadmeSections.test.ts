import { describe, expect, it } from 'vitest'
import { parseReadmeSections } from '../components/sidebar/parseReadmeSections.js'

describe('parseReadmeSections', () => {
  it('splits on # and ## into title + content sections', () => {
    const md = [
      '# PoiScatter（随机POI分布 · 场景版）',
      '',
      '> templateId: `PoiScatter`',
      '',
      '把 poi_scatter 封装为 scene 流水线。',
      '',
      '## 内部算法链（固定操作）',
      '',
      '```',
      'Scene → poi_scatter',
      '```',
      '',
      '## 主要可见端口',
      '',
      '| 方向 | portName |',
      '|---|---|',
      '| IN | `in_0` |',
    ].join('\n')

    const sections = parseReadmeSections(md)
    expect(sections).toHaveLength(3)
    expect(sections[0]).toMatchObject({
      title: 'PoiScatter（随机POI分布 · 场景版）',
      level: 1,
    })
    expect(sections[0]!.content).toContain('templateId')
    expect(sections[0]!.content).toContain('封装为 scene 流水线')
    expect(sections[1]).toMatchObject({
      title: '内部算法链（固定操作）',
      level: 2,
    })
    expect(sections[1]!.content).toContain('Scene → poi_scatter')
    expect(sections[2]).toMatchObject({
      title: '主要可见端口',
      level: 2,
    })
    expect(sections[2]!.content).toContain('| IN | `in_0` |')
  })

  it('keeps preamble before the first heading as level 0', () => {
    const sections = parseReadmeSections('note\n\n# Title\n\nbody')
    expect(sections[0]).toEqual({ title: '', level: 0, content: 'note' })
    expect(sections[1]).toEqual({ title: 'Title', level: 1, content: 'body' })
  })
})
