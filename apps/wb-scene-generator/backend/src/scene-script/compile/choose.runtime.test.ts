import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBatteryLoader, OpRegistry } from '@forgeax/node-runtime'
import { describe, expect, it } from 'vitest'

import { sceneChoose } from '../../../../batteries/scene/control/choose/index.js'

describe('scene_choose runtime battery', () => {
  it('selects an already-evaluated branch without invoking either value', () => {
    const thenValue = { branch: 'then' }
    const otherwiseValue = { branch: 'otherwise' }
    expect(sceneChoose({ when: true, then: thenValue, otherwise: otherwiseValue })).toEqual({ value: thenValue })
    expect(sceneChoose({ when: false, then: thenValue, otherwise: otherwiseValue })).toEqual({ value: otherwiseValue })
  })

  it('loads and executes as the ordinary scene_choose runtime op', async () => {
    const registry = new OpRegistry()
    const loader = createBatteryLoader(registry, {
      pluginId: '@forgeax-plugin/wb-scene-generator',
      scanDirs: [resolve(dirname(fileURLToPath(import.meta.url)), '../../../../batteries/scene/control/choose')],
      layout: 'flexible',
    })
    expect(await loader.scan()).toEqual(expect.objectContaining({ added: 1, errors: [] }))
    const op = registry.get('scene_choose')!
    const result = await op.execute!(
      {
        pipelineId: 'choose-test',
        log: () => undefined,
        signal: new AbortController().signal,
      },
      { when: true, then: 'left', otherwise: 'right' },
    )
    expect(result).toEqual({ value: 'left' })
  })
})
