import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  deleteSceneModuleFile,
  layoutKey,
  moveSceneModuleFile,
  readAuthoringLayout,
  readAuthoringState,
  resolveCanonicalEntryFile,
  SceneModuleInUseError,
  writeAuthoringLayout,
  writeSceneModule,
  writeSceneProjectTransaction,
} from './store.js'

const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('Scene Script authoring state', () => {
  it('persists the complete transitive relative import closure', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'groups', 'nested'), { recursive: true })
    await writeFile(
      join(projectDir, 'scene', 'groups', 'nested', 'leaf.scene.ts'),
      'export const leaf = defineGroup({ id: "leaf", version: "1", inputs: {}, outputs: {} }, () => ({ }))\n',
    )
    await writeFile(
      join(projectDir, 'scene', 'groups', 'middle.scene.ts'),
      'import { leaf } from "./nested/leaf.scene.ts"\nexport { leaf }\n',
    )

    const stored = await writeSceneModule(
      projectDir,
      'main.scene.ts',
      'import { leaf } from "./groups/middle.scene.ts"\n',
      [],
    )

    expect(stored.state?.modules).toEqual([
      'groups/middle.scene.ts',
      'groups/nested/leaf.scene.ts',
      'main.scene.ts',
    ])
    expect(stored.state?.entryFile).toBe('main.scene.ts')
  })

  it('persists canonical entryFile even when generators sort first', async () => {
    expect(resolveCanonicalEntryFile(
      ['generators/lake-basin.generator.ts', 'main.scene.ts', 'terrain.scene.ts'],
    )).toBe('main.scene.ts')

    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-entry-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'generators'), { recursive: true })
    await writeSceneProjectTransaction(
      projectDir,
      'main.scene.ts',
      [
        {
          file: 'generators/lake-basin.generator.ts',
          source: 'export const lakeBasin = 1\n',
        },
        {
          file: 'terrain.scene.ts',
          source: 'import { lakeBasin } from "./generators/lake-basin.generator.ts"\nexport const terrain = lakeBasin\n',
        },
        {
          file: 'main.scene.ts',
          source: 'import { terrain } from "./terrain.scene.ts"\nsceneOutput({ scene: terrain })\n',
        },
      ],
      [],
    )
    const state = await readAuthoringState(projectDir)
    expect(state?.modules[0]).toBe('generators/lake-basin.generator.ts')
    expect(state?.entryFile).toBe('main.scene.ts')
  })

  it('keeps the module anchor and layout identity across a file move', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'parts'), { recursive: true })
    const moduleSource = '// @scene-module-id stable.part\n// @scene-id stable-statement\nexport const value = numberValue({ value: 1 })\n'
    await writeFile(join(projectDir, 'scene', 'parts', 'value.scene.ts'), moduleSource)
    await writeFile(
      join(projectDir, 'scene', 'main.scene.ts'),
      '// @scene-module-id stable.main\nimport { value } from "./parts/value.scene.ts"\n',
    )
    await writeSceneModule(projectDir, 'main.scene.ts', await readFile(join(projectDir, 'scene', 'main.scene.ts'), 'utf8'), [])
    await writeAuthoringLayout(projectDir, { [layoutKey('stable.part', 'stable-statement')]: { x: 12, y: 34 } })

    await moveSceneModuleFile(projectDir, 'parts/value.scene.ts', 'moved/value.scene.ts')

    expect(await readFile(join(projectDir, 'scene', 'moved', 'value.scene.ts'), 'utf8')).toBe(moduleSource)
    expect(await readFile(join(projectDir, 'scene', 'main.scene.ts'), 'utf8')).toContain('./moved/value.scene.ts')
    expect(await readAuthoringLayout(projectDir)).toEqual({
      [layoutKey('stable.part', 'stable-statement')]: { x: 12, y: 34 },
    })
  })

  it('rejects deleting an imported module with structured impact', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene'), { recursive: true })
    await writeFile(join(projectDir, 'scene', 'part.scene.ts'), '// @scene-module-id part\n')
    await writeFile(join(projectDir, 'scene', 'main.scene.ts'), 'import {} from "./part.scene.ts"\n')

    await expect(deleteSceneModuleFile(projectDir, 'part.scene.ts')).rejects.toMatchObject({
      code: 'SCENE_MODULE_IN_USE',
      importers: [{ file: 'main.scene.ts', specifier: './part.scene.ts' }],
    } satisfies Partial<SceneModuleInUseError>)
  })

  it('rolls back every module when a project transaction write fails', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene'), { recursive: true })
    await writeFile(join(projectDir, 'scene', 'main.scene.ts'), 'const before = 1\n')
    await writeFile(join(projectDir, 'scene', 'blocker'), 'not a directory')

    await expect(writeSceneProjectTransaction(
      projectDir,
      'main.scene.ts',
      [
        { file: 'main.scene.ts', source: 'const changed = 2\n' },
        { file: 'blocker/invalid.scene.ts', source: 'const invalid = 3\n' },
      ],
      [],
    )).rejects.toThrow()
    expect(await readFile(join(projectDir, 'scene', 'main.scene.ts'), 'utf8')).toBe('const before = 1\n')
  })

  it('reads and lists generator and helper sources, and refuses in-use delete', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-store-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'generators', 'lib'), { recursive: true })
    await writeFile(join(projectDir, 'scene', 'generators', 'lib', 'rng.generator-lib.ts'), 'export const one = 1\n')
    await writeFile(
      join(projectDir, 'scene', 'generators', 'coast.generator.ts'),
      'import { one } from "./lib/rng.generator-lib.ts"\nexport const coast = one\n',
    )
    const stored = await writeSceneModule(
      projectDir,
      'main.scene.ts',
      'import { coast } from "./generators/coast.generator.ts"\n',
      [],
    )
    expect(stored.state?.modules).toEqual([
      'generators/coast.generator.ts',
      'generators/lib/rng.generator-lib.ts',
      'main.scene.ts',
    ])
    await expect(deleteSceneModuleFile(projectDir, 'generators/coast.generator.ts')).rejects.toMatchObject({
      code: 'SCENE_MODULE_IN_USE',
    })
    await expect(writeSceneModule(projectDir, 'secret.txt', 'nope', [])).rejects.toThrow(/invalid Scene Script module path/)
  })
})
