import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { allSceneFiles, computeSourceProjectRevision, isAllowedSceneSourcePath, readSceneModule, sourceFileKind, writeSceneProjectTransaction } from '../src/scene-script/persist/store.js'
const dirs: string[] = []
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
describe('ordinary TypeScript source helpers', () => {
  it('uses source classification for both source admission and named module roles', () => {
    expect(sourceFileKind('buildings/house-options.ts')).toBe('helper')
    expect(isAllowedSceneSourcePath('buildings/house-options.ts')).toBe(true)
    expect(sourceFileKind('house.scene.ts')).toBe('module')
    expect(sourceFileKind('floor.generator.ts')).toBe('generator')
    expect(sourceFileKind('timber.material.ts')).toBe('material')
    expect(isAllowedSceneSourcePath('../outside.ts')).toBe(false)
    expect(isAllowedSceneSourcePath('photo.png')).toBe(false)
  })
  it('persists helper imports and invalidates the source revision for helper-only edits', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scene-helpers-')); dirs.push(dir)
    await writeSceneProjectTransaction(dir, 'main.scene.ts', [
      { file: 'main.scene.ts', source: "import { width } from './buildings/options.ts';\nexport default function main() { return width }\n" },
      { file: 'buildings/options.ts', source: 'export const width = 5.6\n' },
    ], [])
    expect(await allSceneFiles(dir)).toEqual(['buildings/options.ts', 'main.scene.ts'])
    expect((await readSceneModule(dir, 'buildings/options.ts')).source).toContain('5.6')
    const before = await computeSourceProjectRevision(dir)
    await writeFile(join(dir, 'scene/buildings/options.ts'), 'export const width = 7.2\n')
    expect(await computeSourceProjectRevision(dir)).not.toBe(before)
  })
})
