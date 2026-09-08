import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { scanBatteryCategories } from '../src/routes/batteryCategories.js'

let scratchDir: string

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), 'lowpoly-battery-categories-'))
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
})
