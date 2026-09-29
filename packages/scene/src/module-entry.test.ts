import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runSceneModule, evaluateSceneBundle } from './runner.js'
import { compilePortableScene, assertPortableInputs } from './portable.js'
import { inspectModuleImports } from '@forgeax/scene-authoring'
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true })
})
async function project() {
  const dir = await mkdtemp(join(tmpdir(), 'scene-entry-'))
  dirs.push(dir)
  return dir
}
describe('independent scene module entry', () => {
  it('invokes a named async export with arguments and ignores an unused broken scene', async () => {
    const dir = await project()
    await writeFile(
      join(dir, 'house.scene.ts'),
      `import { box } from '@forgeax/scene'; export async function house(n:number) { await Promise.resolve(); return box({width:n}); }`,
    )
    await writeFile(
      join(dir, 'unused.scene.ts'),
      `import './missing.scene.ts'; throw Error('unused');`,
    )
    const result = await runSceneModule({
      projectDir: dir,
      entryFile: 'house.scene.ts',
      exportName: 'house',
      args: [42],
      purpose: 'build',
      implementations: { box: ({ width }: any) => ({ geometry: width }) },
    })
    expect(result.ok).toBe(true)
    expect(result.output).toBe(42)
    expect(Object.keys(result.files)).toEqual(['house.scene.ts'])
    expect(Object.keys(result.graph.nodes)).toHaveLength(0)
  })
  it('makes repeated and concurrent portable builds independent, including module state', async () => {
    const dir = await project()
    const files = new Map([
      [
        'scene/house.scene.ts',
        `import {next} from './helper.ts'; export async function house(n:number) {await Promise.resolve();return {height:n, counter:next()}}`,
      ],
      ['scene/helper.ts', `let count=0;export const next=()=>++count;`],
      [
        'platform/outputs.ts',
        `export function collectedScene(){throw Error('No selected scene output')}`,
      ],
    ])
    const source = await compilePortableScene(files, 'house.scene.ts', {
      projectDir: dir,
      exportName: 'house',
    })
    const program = await evaluateSceneBundle(source)
    const build = program.generateScene as (args: number[]) => Promise<unknown>
    expect(await build([10])).toEqual({ height: 10, counter: 1 })
    expect(await build([20])).toEqual({ height: 20, counter: 1 })
    expect(await Promise.all([build([10]), build([30])])).toEqual([
      { height: 10, counter: 1 },
      { height: 30, counter: 1 },
    ])
    expect(source).not.toContain(dir)
  })
  it('leaves ordinary object arguments untouched and loads local JSON data', async () => {
    const dir = await project()
    await writeFile(join(dir, 'shape.json'), JSON.stringify({ width: 7 }))
    await writeFile(
      join(dir, 'plain.scene.ts'),
      `import shape from './shape.json'; function inspect(x:object){return Object.keys(x)} export const value={keys:inspect({width:shape.width}),shape}`,
    )
    const result = await runSceneModule({
      projectDir: dir,
      entryFile: 'plain.scene.ts',
      exportName: 'value',
      purpose: 'build',
      implementations: {},
    })
    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ keys: ['width'], shape: { width: 7 } })
    expect(() => assertPortableInputs([{ bad: undefined }])).toThrow(/portable/)
  })
  it('parses side effects, reexports and static dynamic imports without reading comments or strings', () => {
    const source = `// import 'fake'\nconst x="from 'false'"; import './side.ts'; export {a} from './a.ts'; const y=import('./b.ts'); import type {T} from './t.ts';`
    expect(
      inspectModuleImports(source).imports.map((i) => i.specifier),
    ).toEqual(['./side.ts', './a.ts', './b.ts', './t.ts'])
  })
})
