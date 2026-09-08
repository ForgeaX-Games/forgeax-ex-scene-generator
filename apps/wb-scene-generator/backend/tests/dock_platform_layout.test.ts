import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { dockPlatformLayout } from '../../batteries/components/basepiece/dock_platform_layout/index.js'

type Grid = number[][]
const here = dirname(fileURLToPath(import.meta.url))
const templatePath = resolve(
  here,
  '../../batteries/templates/structures/basepiece/DockPlatform/DockPlatform.json',
)

function island(): Grid {
  const grid = Array.from({ length: 21 }, () => new Array<number>(21).fill(0))
  for (let r = 5; r <= 15; r++) {
    for (let c = 5; c <= 15; c++) grid[r][c] = 1
  }
  return grid
}

function run(point: { x: number; y: number }) {
  const result = dockPlatformLayout({
    inputGrid: island(),
    point,
    width: 1,
    length: 3,
    deckWidth: 3,
    deckDepth: 2,
  })
  expect(result.error).toBeUndefined()
  return result as { outputGrid: Grid; tagGrid: Grid; stateValues: string[] }
}

describe('dock_platform_layout point positioning', () => {
  it.each([
    [{ x: 10, y: 5 }, [3, 10], [1, 10]],
    [{ x: 10, y: 15 }, [17, 10], [19, 10]],
    [{ x: 5, y: 10 }, [10, 3], [10, 1]],
    [{ x: 15, y: 10 }, [10, 17], [10, 19]],
  ] as const)('从四条直岸按局部外法线伸向水面', (point, approach, deck) => {
    const { outputGrid: output } = run(point)
    expect(output[approach[0]][approach[1]]).toBe(2)
    expect(output[deck[0]][deck[1]]).toBe(1)
  })

  it('内部 Point 自动吸附到欧氏距离最近的边界格', () => {
    const { outputGrid: output } = run({ x: 14, y: 10 })
    expect(output[10][15]).toBe(2)
    expect(output[10][17]).toBe(2)
    expect(output[10][19]).toBe(1)
    expect(output[3][14]).toBe(0)
  })

  it('区域外 Point 同样吸附到最近边界格', () => {
    const { outputGrid: output } = run({ x: 10, y: 1 })
    expect(output[5][10]).toBe(2)
    expect(output[3][10]).toBe(2)
    expect(output[1][10]).toBe(1)
  })

  it('从岸线固定向岸内延伸 4 格', () => {
    const { outputGrid } = run({ x: 10, y: 5 })
    expect(outputGrid[9][10]).toBe(2)
    expect(outputGrid[10][10]).toBe(0)
  })

  it('甲板外侧长边开口，两个短边保留栏杆标签 0', () => {
    const { tagGrid, stateValues } = run({ x: 10, y: 5 })
    expect(stateValues).toEqual(['', 'entry_h', 'entry_v'])
    expect(tagGrid[1].slice(9, 12)).toEqual([1, 1, 1])
    expect(tagGrid[2][9]).toBe(0)
    expect(tagGrid[2][11]).toBe(0)
    expect(tagGrid[9][10]).toBe(1)
  })

  it('缺少 Point 时明确报错', () => {
    const result = dockPlatformLayout({ inputGrid: island() })
    expect(result.error).toBe('point is required and must be a point2d {x,y}')
  })

  it('模板外露 Point 与单层 Z，Z 经单值 range 接到平台 grid2node', () => {
    const template = JSON.parse(readFileSync(templatePath, 'utf8')) as {
      exposedInputs: Array<Record<string, unknown>>
      edges: Array<{
        source: { nodeId: string; port: string }
        target: { nodeId: string; port: string }
      }>
    }
    expect(template.exposedInputs.find((port) => port.portName === 'in_2')).toMatchObject({
      portType: 'point2d',
      sourcePortName: 'point',
      customLabelEn: 'Point',
    })
    expect(template.exposedInputs.find((port) => port.portName === 'in_7')).toMatchObject({
      portType: 'number',
      sourceNodeId: 'node-1792000000001-zpass',
      sourcePortName: 'a',
      customLabelEn: 'Z',
    })
    expect(template.edges.some((edge) =>
      edge.source.nodeId === 'node-1792000000001-zrange' &&
      edge.source.port === 'list' &&
      edge.target.nodeId === 'node-1792000000001-tkeb1' &&
      edge.target.port === 'zRange',
    )).toBe(true)
    expect(template.edges.some((edge) =>
      edge.source.nodeId === 'node-1792000000001-h4vj0' &&
      edge.source.port === 'tagGrid' &&
      edge.target.nodeId === 'node-1792000000001-tkeb1' &&
      edge.target.port === 'stateGrid',
    )).toBe(true)
  })
})
