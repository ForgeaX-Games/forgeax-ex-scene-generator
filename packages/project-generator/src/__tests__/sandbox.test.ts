import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { compileGeneratorFile, writeGeneratorArtifact } from '../compile.js'
import { runGeneratorSandbox } from '../sandbox/host.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function compileDouble(root: string): Promise<string> {
  await mkdir(join(root, 'generators'), { recursive: true })
  await writeFile(join(root, 'generators', 'double.generator.ts'), `
    import { defineGenerator } from '@forgeax/project-generator'
    export const doubleValue = defineGenerator({
      id: "double-value",
      version: "1.0.0",
      inputs: { value: { type: NumberValue, defaultValue: 2 }, seed: { type: NumberValue, defaultValue: 1 } },
      outputs: { value: { type: NumberValue } },
      run(ctx, args: { value: number; seed: number }) {
        const n = ctx.random(args.seed)
        return { value: args.value * 2, roll: n }
      },
    })
  `)
  const compiled = await compileGeneratorFile(root, 'generators/double.generator.ts')
  expect(compiled.artifacts[0]).toBeTruthy()
  await writeGeneratorArtifact(root, compiled.artifacts[0]!)
  return join(root, 'state', 'generators', 'double-value', 'bundle.js')
}

describe('Generator sandbox', () => {
  it('returns the same output for the same seed and input', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-sandbox-'))
    dirs.push(root)
    const bundlePath = await compileDouble(root)
    const first = await runGeneratorSandbox({ bundlePath, exportName: 'doubleValue', args: { value: 3, seed: 7 }, seed: 7 })
    const second = await runGeneratorSandbox({ bundlePath, exportName: 'doubleValue', args: { value: 3, seed: 7 }, seed: 7 })
    expect(first.ok).toBe(true)
    expect(first.value).toEqual(second.value)
    expect((first.value as { value: number }).value).toBe(6)
  })

  it('advances ctx.random() as a seed stream and keeps one-shot salts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-random-stream-'))
    dirs.push(root)
    await mkdir(join(root, 'generators'), { recursive: true })
    await writeFile(join(root, 'generators', 'stream.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      export const streamRandom = defineGenerator({
        id: "stream-random",
        inputs: {},
        outputs: { first: NumberValue, second: NumberValue, salted: NumberValue },
        run(ctx) {
          return { first: ctx.random(), second: ctx.random(), salted: ctx.random(9) }
        },
      })
    `)
    const compiled = await compileGeneratorFile(root, 'generators/stream.generator.ts')
    expect(compiled.artifacts[0]).toBeTruthy()
    await writeGeneratorArtifact(root, compiled.artifacts[0]!)
    const bundlePath = join(root, 'state', 'generators', 'stream-random', 'bundle.js')
    const first = await runGeneratorSandbox({ bundlePath, exportName: 'streamRandom', args: {}, seed: 11 })
    const second = await runGeneratorSandbox({ bundlePath, exportName: 'streamRandom', args: {}, seed: 11 })
    expect(first.ok).toBe(true)
    expect(first.value).toEqual(second.value)
    const rolls = first.value as { first: number; second: number; salted: number }
    expect(rolls.first).not.toBe(rolls.second)
    expect(rolls.first).toBeGreaterThanOrEqual(0)
    expect(rolls.first).toBeLessThan(1)
  })

  it('fails Math.random and filesystem reads inside the child', async () => {
    const root = await mkdtemp(join(tmpdir(), 'generator-sandbox-deny-'))
    dirs.push(root)
    await mkdir(join(root, 'generators'), { recursive: true })
    await writeFile(join(root, 'generators', 'rand.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      export const badRandom = defineGenerator({
        id: "bad-random",
        version: "1",
        inputs: {},
        outputs: { value: { type: NumberValue } },
        run() { return { value: Math.random() } },
      })
    `)
    const compiled = await compileGeneratorFile(root, 'generators/rand.generator.ts')
    await writeGeneratorArtifact(root, compiled.artifacts[0]!)
    const result = await runGeneratorSandbox({
      bundlePath: join(root, 'state', 'generators', 'bad-random', 'bundle.js'),
      exportName: 'badRandom',
      args: {},
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Math\.random is forbidden/)
  })
})
