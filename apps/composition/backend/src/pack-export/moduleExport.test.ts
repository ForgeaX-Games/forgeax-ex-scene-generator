import { buildBudgetDiagnostics } from './verify.js'
import { describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  mkdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportSceneModulePack } from './moduleExport.js'
import { rebuildScenePack } from './rebuild.js'
import { validatePackInputs } from './inputs.js'
import { compilePortableScene } from '@forgeax/scene'

const packageId = '01900000-0000-7000-8000-000000000202'
describe('standalone module publication', () => {
  it('reports native consumer cost separately from portable correctness', () => {
    expect(buildBudgetDiagnostics(8859)[0]).toMatchObject({
      code: 'SCENE_PACK_CONSUMER_BUDGET',
      severity: 'warning',
    })
    expect(buildBudgetDiagnostics(8859, 20000)).toEqual([])
  })
  it('publishes a selected rule, preserves unrelated files, and rebuilds edited sources after removing the original project', async () => {
    const root = mkdtempSync(join(tmpdir(), 'module-pack-test-')),
      source = join(root, 'source'),
      out = join(root, 'out')
    mkdirSync(source)
    mkdirSync(out)
    writeFileSync(join(out, 'notes.txt'), 'user notes')
    try {
      writeFileSync(
        join(source, 'house.scene.ts'),
        `import {box,sceneNode} from '@forgeax/scene'; export function house({width=4}={}) {return sceneNode({name:'house',key:'house',geometry:box({width,depth:3,height:2})})} export const unused=17;`,
      )
      writeFileSync(join(source, 'broken.scene.ts'), `import './absent.ts'`)
      const options = {
        sourceDir: source,
        entryFile: 'house.scene.ts',
        exportName: 'house',
        args: [{ width: 4 }],
        packageId,
        destination: out,
        sourceKey: 'scene/architecture/house',
      }
      const result = await exportSceneModulePack(options)
      expect(result.sceneKey).toBe('scene/architecture/house')
      expect(result.meshCount).toBe(1)
      expect(readFileSync(join(out, 'notes.txt'), 'utf8')).toBe('user notes')
      const before = readFileSync(join(out, 'build-scene.mjs'), 'utf8'),
        packBefore = readFileSync(join(out, result.packFile), 'utf8')
      await expect(
        exportSceneModulePack({ ...options, exportName: 'missing' }),
      ).rejects.toThrow()
      expect(readFileSync(join(out, result.packFile), 'utf8')).toBe(packBefore)
      rmSync(source, { recursive: true })
      const entry = join(out, 'scene/house.scene.ts')
      writeFileSync(
        entry,
        readFileSync(entry, 'utf8').replace('height:2', 'height:5'),
      )
      expect((await rebuildScenePack(out)).ok).toBe(true)
      expect(readFileSync(join(out, 'build-scene.mjs'), 'utf8')).not.toBe(before)
      expect(readFileSync(join(out, 'notes.txt'), 'utf8')).toBe('user notes')
      expect(existsSync(source)).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30000)
  it('rejects lossy arguments and unresolved parameter addresses before writing', async () => {
    expect(() => validatePackInputs([new Float32Array([1])])).toThrow(
      /portable/,
    )
    expect(() => validatePackInputs([NaN])).toThrow(/portable/)
    expect(() =>
      validatePackInputs(
        ['wide'],
        [{ name: 'width', type: 'f32', default: 'wide' }],
        { width: { argument: 0, path: [] } },
      ),
    ).toThrow(/numeric/)
    expect(() => validatePackInputs([() => 1])).toThrow(/portable/)
    expect(() =>
      validatePackInputs(
        [{ width: 4 }],
        [{ name: 'width', type: 'f32', default: 4 }],
        { width: { argument: 0, path: ['typo'] } },
      ),
    ).toThrow(/resolve/)
    await expect(
      compilePortableScene(new Map(), 'test.scene.ts', {
        projectDir: tmpdir(),
        args: [Infinity],
      }),
    ).rejects.toThrow(/portable/)
  })
})
