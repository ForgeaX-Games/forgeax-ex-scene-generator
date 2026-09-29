import { describe, expect, it } from 'vitest'

import { resolveLayerAlias } from '../src/scene-export/assetMatch.js'
import * as rendererResolver from '../../vendor/dist/renderer-resolve/renderer/server/spriteResolver.js'

describe('scene-export asset matching', () => {
  it('uses the preview matcher to prefer a stitch-rule sheet over duplicate taxonomy aliases', () => {
    const aliases = [
      {
        alias: '[武侠][室外][草地][草][绿][无][无][瓦片组][16][0][0][0][]',
        tileType: '瓦片组',
      },
      {
        alias: '[武侠][室外][草地][草][绿][无][无][simple_common_16][16][0][0][0][]',
        tileType: 'simple_common_16',
      },
    ]
    const shared = rendererResolver as unknown as {
      matchAssetEntry?: (
        entry: { assetName: string; assetType: string },
        pool: typeof aliases,
        fuzzy: boolean,
      ) => { primary: string; tileType?: string } | null
    }

    const match = shared.matchAssetEntry?.({ assetName: '草地', assetType: 'tile' }, aliases, false)

    expect(match).toMatchObject({
      primary: aliases[1]!.alias,
      tileType: 'simple_common_16',
    })
    expect(resolveLayerAlias({ assetName: '草地', assetType: 'tile' }, aliases))
      .toMatchObject({ alias: aliases[1]!.alias, tileType: 'simple_common_16' })
  })
})
