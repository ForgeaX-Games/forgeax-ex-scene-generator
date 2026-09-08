import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { OverlayOpRegistry, OpRegistry } from '@forgeax/node-runtime'
import { afterEach, describe, expect, it } from 'vitest'

import { compileProjectGenerators } from './generatorCompiler.js'
import { compileStoredSceneProject } from './projectCompiler.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const echoSource = `
  import { defineGenerator } from '@forgeax/project-generator'
  export const echo = defineGenerator({
    id: "echo",
    version: "1",
    inputs: { value: { type: NumberValue, defaultValue: 1 } },
    outputs: { value: { type: NumberValue } },
    run(_ctx, args: { value: number }) { return { value: args.value } },
  })
`

describe('Project Generator compile integration', () => {
  it('registers a compiled generator only on the overlay it was given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-overlay-'))
    dirs.push(root)
    await mkdir(join(root, 'scene', 'generators'), { recursive: true })
    await writeFile(join(root, 'scene', 'generators', 'echo.generator.ts'), echoSource)
    const base = new OpRegistry()
    base.register({
      id: 'control_points',
      inputs: [],
      outputs: [],
      params: [],
      execute: () => ({}),
    })
    const projectA = new OverlayOpRegistry(base)
    const projectB = new OverlayOpRegistry(base)
    const compiled = await compileProjectGenerators(root, ['generators/echo.generator.ts'], {}, projectA)
    expect(compiled.diagnostics.filter((item) => item.severity === 'error')).toEqual([])
    expect(projectA.has('local/echo')).toBe(true)
    expect(projectB.has('local/echo')).toBe(false)
    expect(projectA.has('control_points')).toBe(true)
    expect(compiled.contracts[0]?.opId).toBe('local/echo')
  })

  it('keeps last legal generator contract when a later compile fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'last-legal-'))
    dirs.push(root)
    await mkdir(join(root, 'scene', 'generators'), { recursive: true })
    await writeFile(join(root, 'scene', 'generators', 'echo.generator.ts'), echoSource)
    const first = await compileStoredSceneProject(root, {
      entryFile: 'main.scene.ts',
      entrySource: `import { echo } from "./generators/echo.generator.ts"\nconst v = echo({ value: 3 })\n`,
      projectId: 'last-legal',
      registry: { get: () => undefined, list: () => [] },
    })
    expect(first.registry.get('echo')?.opId).toBe('local/echo')
    const failed = await compileStoredSceneProject(root, {
      entryFile: 'main.scene.ts',
      entrySource: `import { echo } from "./generators/echo.generator.ts"\nconst v = echo({ value: 3 })\n`,
      sourceOverrides: {
        'generators/echo.generator.ts': 'export const broken = 1\n',
      },
      projectId: 'last-legal',
      registry: { get: () => undefined, list: () => [] },
    })
    expect(failed.diagnostics.some((item) => item.severity === 'error')).toBe(true)
    expect(first.registry.get('echo')?.opId).toBe('local/echo')
  })
})
