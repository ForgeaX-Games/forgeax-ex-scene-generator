import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanBatteryCategories } from '../src/routes/batteryCategories.js'

let scratchDir: string

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'scene-battery-categories-'))
})

afterEach(async () => {
  await rm(scratchDir, { recursive: true, force: true })
})

async function writeMeta(parts: string[], meta: Record<string, unknown>): Promise<void> {
  const dir = join(scratchDir, ...parts)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'meta.json'), JSON.stringify(meta))
}

describe('battery category scanner', () => {
  it('uses every scan-root top-level folder as an automatic palette category', async () => {
    await writeMeta(['common', 'number', 'numberConst'], {
      id: 'number_const',
      frontend: { nodeType: 'number_const', hideOutputs: true },
    })
    await writeMeta(['experimental', 'probe', 'inspect'], {
      id: 'inspect_probe',
      frontend: { displayGroup: 'Labs/Probe' },
    })

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('number_const')).toEqual({
      category: 'common/number',
      displayGroup: undefined,
      type: 'common',
      nodeType: 'number_const',
      hideOutputs: true,
    })
    expect(categories.get('inspect_probe')).toEqual({
      category: 'experimental/probe',
      displayGroup: 'Labs/Probe',
      type: 'experimental',
      nodeType: undefined,
      hideOutputs: undefined,
    })
  })

  it('routes any battery with an image output port to the preview node, regardless of big tag', async () => {
    await writeMeta(['image', 'processing', 'image_resize'], {
      id: 'image_resize',
      outputs: [{ name: 'image', type: 'image' }],
    })
    // Different big tag (grayscale), still gets the preview frame because it
    // emits an `image` output.
    await writeMeta(['grayscale', 'house', 'house_footprint'], {
      id: 'house_footprint',
      outputs: [
        { name: 'image', type: 'image' },
        { name: 'error', type: 'string' },
      ],
    })

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('image_resize')).toMatchObject({
      category: 'image/processing',
      type: 'image',
      nodeType: 'asset2d_image_battery',
    })
    expect(categories.get('house_footprint')).toMatchObject({
      category: 'grayscale/house',
      type: 'grayscale',
      nodeType: 'asset2d_image_battery',
    })
  })

  it('leaves batteries without an image output unframed (unless explicit nodeType)', async () => {
    await writeMeta(['helper', 'data_transform', 'grid_json_to_size'], {
      id: 'grid_json_to_size',
      outputs: [
        { name: 'width', type: 'number' },
        { name: 'height', type: 'number' },
      ],
    })

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('grid_json_to_size')).toMatchObject({
      category: 'helper/data_transform',
      type: 'helper',
      nodeType: undefined,
    })
  })

  it('routes local AI batteries to the built-in AI node UI', async () => {
    await writeMeta(['ai', 'providers', 'ImageGen'], {
      id: 'image_gen',
    })

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('image_gen')).toMatchObject({
      category: 'ai/providers',
      type: 'ai',
      nodeType: 'ai_battery',
    })
  })

  it('routes non-API AI batteries to the plain battery node (no run button)', async () => {
    await writeMeta(['ai', 'relevant', 'promptDealer'], { id: 'prompt_dealer' })
    await writeMeta(['ai', 'data_trans', 'grid_value_to_mask'], { id: 'grid_value_to_mask' })
    await writeMeta(['ai', 'relevant', 'name_list_gen'], { id: 'name_list_gen' })

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('prompt_dealer')).toMatchObject({ type: 'ai', nodeType: 'battery' })
    expect(categories.get('grid_value_to_mask')).toMatchObject({ type: 'ai', nodeType: 'battery' })
    expect(categories.get('name_list_gen')).toMatchObject({ type: 'ai', nodeType: 'battery' })
  })
})
