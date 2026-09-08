/**
 * poi_scatter 单条 / 批量两用回归：
 *   - poiRules 接受单条（对象、裸文本）与批量（列表、多键对象、分号分隔）
 *   - assetNames 接受单个名称与多种列表写法，按下标与规则对应
 *   - outputAssetNames 按行优先逐点输出，顺序与 alg_field2points 采样点严格一致
 */
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'

import { executeWithDataTreeDispatch, type OpSpec } from '@forgeax/node-runtime'

import { poiScatter } from '../../batteries/components/decoration/poi_scatter/index.js'
import { field2points } from '../../batteries/scenealg/points/field2points/index.js'

type Grid = number[][]

/** 全 1 的可放置区域，足够大以容纳测试用的点数。 */
function openGround(size = 20): Grid {
  return Array.from({ length: size }, () => new Array<number>(size).fill(1))
}

function run(poiRules: unknown, assetNames?: unknown) {
  const out = poiScatter({ inputGrid: openGround(), poiRules, assetNames, seed: 42 })
  expect(out.error).toBeUndefined()
  return out as {
    outputGrid: Grid
    outputNameList: Array<{ id: number; name: string }>
    outputAssetNames: string[]
    placedCount: number
  }
}

describe('poi_scatter 单条用法', () => {
  it('单条简化对象 + 单个资产名：全部点写同一个资产名', () => {
    const out = run({ 樱花树: '1:6:4' }, '樱花树')
    expect(out.placedCount).toBeGreaterThan(0)
    expect(out.outputNameList.map((e) => e.name)).toEqual(['樱花树'])
    expect(new Set(out.outputAssetNames)).toEqual(new Set(['樱花树']))
    expect(out.outputAssetNames).toHaveLength(out.placedCount)
  })

  it('单条裸文本 名称:targetValue:count:minDistance 无需包成数组', () => {
    const out = run('樱花树:1:6:4')
    expect(out.placedCount).toBeGreaterThan(0)
    expect(new Set(out.outputAssetNames)).toEqual(new Set(['樱花树']))
  })

  it('单条 JSON 字符串（外层无方括号）也可直接输入', () => {
    const out = run('{"樱花树":"1:6:4"}')
    expect(out.outputNameList.map((e) => e.name)).toEqual(['樱花树'])
  })

  it('缺省 assetNames 时资产名回落到规则名', () => {
    const out = run('[{"洞穴":"1:3:5"}]')
    expect(new Set(out.outputAssetNames)).toEqual(new Set(['洞穴']))
  })
})

describe('poi_scatter 批量用法', () => {
  const expectTwoKinds = (out: ReturnType<typeof run>, assets: [string, string]) => {
    expect(out.outputNameList).toHaveLength(2)
    expect(new Set(out.outputAssetNames)).toEqual(new Set(assets))
    expect(out.outputAssetNames).toHaveLength(out.placedCount)
  }

  it('规则列表 + 资产名 JSON 列表按下标对应', () => {
    const out = run('[{"甲":"1:4:3"},{"乙":"1:4:3"}]', '["樱花树","松树"]')
    expectTwoKinds(out, ['樱花树', '松树'])
  })

  it('资产名支持 逗号 / 中文逗号 / 分号 / 无引号方括号 写法', () => {
    const rules = '[{"甲":"1:4:3"},{"乙":"1:4:3"}]'
    for (const names of ['樱花树,松树', '樱花树，松树', '樱花树；松树', '[樱花树,松树]']) {
      expectTwoKinds(run(rules, names), ['樱花树', '松树'])
    }
  })

  it('规则支持分号分隔的裸文本列表', () => {
    const out = run('甲:1:4:3；乙:1:4:3', '樱花树,松树')
    expectTwoKinds(out, ['樱花树', '松树'])
  })

  it('规则支持多键对象一次声明多种 POI', () => {
    const out = run({ 甲: '1:4:3', 乙: '1:4:3' }, '樱花树,松树')
    expectTwoKinds(out, ['樱花树', '松树'])
  })

  it('资产名只给一个时广播到所有规则', () => {
    const out = run('[{"甲":"1:4:3"},{"乙":"1:4:3"}]', '樱花树')
    expect(new Set(out.outputAssetNames)).toEqual(new Set(['樱花树']))
  })
})

describe('outputAssetNames 与 alg_field2points 点序对齐', () => {
  it('第 i 个采样点落在写着第 i 个资产名的格上', () => {
    const out = run('[{"甲":"1:4:3"},{"乙":"1:4:3"}]', '樱花树,松树')
    const { points } = field2points({ field: out.outputGrid, threshold: 0.5 }) as { points: Grid[] }

    expect(points).toHaveLength(out.outputAssetNames.length)

    const idToAsset = new Map<number, string>()
    for (const entry of out.outputNameList) idToAsset.set(entry.id, entry.name === '甲' ? '樱花树' : '松树')

    points.forEach((point, i) => {
      let hit: number | null = null
      point.forEach((row, r) => row.forEach((v, c) => { if (v === 1) hit = out.outputGrid[r][c] }))
      expect(hit).not.toBeNull()
      expect(out.outputAssetNames[i]).toBe(idToAsset.get(hit as unknown as number))
    })
  })

  it('经 DataTree dispatcher 后两个 access:list 输出落在完全相同的分支路径上', async () => {
    const meta = (file: string): OpSpec =>
      JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')) as OpSpec

    const scattered = await executeWithDataTreeDispatch(
      meta('../../batteries/components/decoration/poi_scatter/meta.json'),
      { inputGrid: openGround(), poiRules: '[{"甲":"1:4:3"},{"乙":"1:4:3"}]', assetNames: '樱花树,松树' },
      { seed: 42 },
      poiScatter as never,
    )
    const sampled = await executeWithDataTreeDispatch(
      meta('../../batteries/scenealg/points/field2points/meta.json'),
      { field: scattered.outputGrid },
      { threshold: 0.5 },
      field2points as never,
    )

    const paths = (v: unknown): string[] =>
      (v as { toJSON(): Array<{ path: number[] }> }).toJSON().map((e) => e.path.join(';'))

    expect(paths(scattered.outputAssetNames)).toEqual(paths(sampled.points))
    expect(paths(sampled.points).length).toBeGreaterThan(1)
  })
})
