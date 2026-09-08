import { describe, expect, it } from 'vitest'
import { matchAssetEntry, type AliasMeta } from './matchAssetEntry'

const aliasA = '[room-a]_[室内]_[盆栽]_[木]_[无]_[西式奇幻]_[正常]_[asset]_[16]_[静态]_[]_[0]'
const aliasB = '[room-b]_[室内]_[盆栽]_[木]_[无]_[现代日常]_[正常]_[asset]_[32]_[静态]_[]_[0]'

describe('matchAssetEntry', () => {
  it('prefers an exact asset alias over duplicate display names', () => {
    const aliases: AliasMeta[] = [
      { alias: aliasA, widthPx: 16 },
      { alias: aliasB, widthPx: 32 },
    ]

    const match = matchAssetEntry({ assetName: '盆栽', assetType: 'object', assetAlias: aliasB } as never, aliases, false)

    expect(match?.primary).toBe(aliasB)
    expect(match?.widthPx).toBe(32)
  })

  it('prefers a stitchable grass alias over taxonomy 瓦片组 when names collide', () => {
    const junk = '[]_[]_[草地]_[]_[]_[中式国风]_[未裁剪]_[瓦片组]_[64]_[]_[]_[]_[]'
    const good = '[平原-森林-村庄-野外]_[室外]_[草地]_[]_[无]_[中式国风]_[正常]_[common_16]_[16]_[静态]_[无]_[0]_[平原]'
    const aliases: AliasMeta[] = [
      { alias: junk, tileType: 'common_16' },
      { alias: good, tileType: 'common_16' },
    ]
    const match = matchAssetEntry({ assetName: '草地', assetType: 'tile' }, aliases, false)
    expect(match?.primary).toBe(good)
  })
})
