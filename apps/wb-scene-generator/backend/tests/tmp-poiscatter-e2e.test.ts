import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

import {
  createBatteryLoader,
  OpRegistry,
  executeGroupSubgraph,
} from '@forgeax/node-runtime'
import { resolveBatteryScanRoots } from '@forgeax/editor-host/backend'

import { grid2Node } from '../../batteries/scene/bridge/grid2node/index.js'
import { sceneOutput } from '../../batteries/scene/output/scene_output/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const TPL = resolve(repoRoot, 'batteries/templates/structures/decorations/PoiScatter/PoiScatter.json')

describe('PoiScatter e2e', () => {
  it('writes per-poi asset_name', async () => {
    const ops = new OpRegistry()
    const loader = createBatteryLoader(ops, {
      pluginId: 'test',
      scanDirs: resolveBatteryScanRoots(repoRoot),
      layout: 'flexible',
      watch: false,
    })
    const res = await loader.scan()
    console.log('loaded ops', res.added, 'errors', res.errors.length)

    const tpl = JSON.parse(readFileSync(TPL, 'utf8'))
    const nested = new Map<string, unknown>()
    for (const g of tpl._nestedGroups ?? []) nested.set(g.id, g)

    // 20x14 全 1 底面
    const W = 20, H = 14
    const grid = Array.from({ length: H }, () => new Array<number>(W).fill(1))
    const scene = (grid2Node({ name: 'ground', grid }) as { scene: unknown }).scene

    const ctx = { log: (lvl: string, m: string) => console.log(`[${lvl}] ${m}`) }

    const out = await executeGroupSubgraph(
      tpl,
      {
        in_0: scene,
        in_1: '浮萍,水草,白曼陀罗草,秧苗',
        in_2: '浮萍:1:6:4;水草:1:6:4;白曼陀罗草:1:6:4;秧苗:1:6:4;',
        in_3: 42,
      },
      ops as never,
      ctx as never,
      { getNestedGroup: (gid: string) => nested.get(gid) as never },
    )

    const entries = (v: unknown): Array<{ path: number[]; items: unknown[] }> =>
      Array.isArray(v) ? v : (v as { toJSON(): Array<{ path: number[]; items: unknown[] }> }).toJSON()
    console.log('OUT KEYS', Object.keys(out))
    const sceneOut = entries(out.out_0)[0]?.items[0]
    const bundle = sceneOutput({ scene: sceneOut }) as {
      layers: Array<{ nodePath: string; cells: unknown[] }>
      names: Array<{ id: number; name: string; type?: string }>
      error?: string
    }
    console.log('ERR', bundle.error)
    console.log('LAYERS', JSON.stringify(bundle.layers?.map((l) => ({ p: l.nodePath, n: l.cells.length }))))
    console.log('NAMES', JSON.stringify(bundle.names))
    expect(sceneOut).toBeTruthy()
  })
})
