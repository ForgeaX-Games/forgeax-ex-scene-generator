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

async function writeContract(parts: string[], source: string): Promise<void> {
  const dir = join(scratchDir, ...parts)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'scene.contract.ts'), source)
}

describe('battery category scanner', () => {
  it('uses every scan-root top-level folder as an automatic palette category', async () => {
    await writeContract(
      ['common', 'number', 'numberConst'],
      `import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  functionName: 'numberValue',
  contractVersion: '1.0.0',
  opId: 'number_const',
  canvas: { nodeType: 'number_const', hideOutputs: true },
  inputs: [],
  outputs: [],
})
`,
    )
    await writeContract(
      ['experimental', 'probe', 'inspect'],
      `import { defineAtomic } from '@forgeax/scene-authoring'
export default defineAtomic({
  functionName: 'inspectProbe',
  contractVersion: '1.0.0',
  opId: 'inspect_probe',
  inputs: [],
  outputs: [],
})
`,
    )

    const categories = await scanBatteryCategories([scratchDir])

    expect(categories.get('number_const')).toEqual({
      category: 'common/number',
      displayGroup: undefined,
      type: 'common',
      nodeType: 'number_const',
      hideOutputs: true,
      iconSvg: undefined,
      sourcePath: 'common/number/numberConst',
      sourceFiles: ['file:scene.contract.ts'],
    })
    expect(categories.get('inspect_probe')).toEqual({
      category: 'experimental/probe',
      displayGroup: undefined,
      type: 'experimental',
      nodeType: undefined,
      hideOutputs: undefined,
      iconSvg: undefined,
      sourcePath: 'experimental/probe/inspect',
      sourceFiles: ['file:scene.contract.ts'],
    })
  })
})
