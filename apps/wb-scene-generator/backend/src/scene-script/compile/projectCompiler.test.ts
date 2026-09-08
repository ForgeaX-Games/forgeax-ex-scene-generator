import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SceneContractRegistry, type NodeFunctionContract } from '@forgeax/scene-authoring'
import { afterEach, describe, expect, it } from 'vitest'

import { compileStoredSceneProject } from './projectCompiler.js'

const projects: string[] = []

afterEach(async () => {
  await Promise.all(projects.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function platformRegistry(): SceneContractRegistry {
  const contracts: NodeFunctionContract[] = [
    {
      functionName: 'numberValue',
      kind: 'atomic',
      contractVersion: '1',
      opId: 'number_const',
      description: 'Number value.',
      inputs: [{ name: 'value', type: 'number', mode: 'parameter' }],
      outputs: [{ name: 'value', type: 'number' }],
    },
    {
      functionName: 'presetThing',
      kind: 'group',
      contractVersion: '1',
      definitionId: 'platform.preset-thing',
      definitionVersion: '1',
      description: 'Sealed platform Definition.',
      inputs: [{ name: 'value', type: 'number', runtimePort: 'in_0' }],
      outputs: [{ name: 'value', type: 'number', runtimePort: 'out_0' }],
      definition: {
        id: 'platform.preset-thing',
        nodes: [{ id: 'value', opId: 'number_const' }],
        edges: [],
        exposedInputs: [{ portName: 'in_0', portType: 'number', sourceNodeId: 'value', sourcePortName: 'value' }],
        exposedOutputs: [{ portName: 'out_0', portType: 'number', sourceNodeId: 'value', sourcePortName: 'value' }],
      },
    },
  ]
  return new SceneContractRegistry(contracts)
}

describe('compileStoredSceneProject Definition boundaries', () => {
  it('rejects a project Definition that shadows a sealed platform Definition', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-project-compiler-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'groups'), { recursive: true })
    await writeFile(
      join(projectDir, 'scene', 'groups', 'preset.scene.ts'),
      `export const presetThing = defineGroup(
  { id: "project.preset-thing", version: "1", inputs: { value: NumberValue }, outputs: { value: NumberValue } },
  ({ value }) => {
    const result = numberValue({ value })
    return { value: result.value }
  },
)
`,
    )
    const entrySource = `import { presetThing } from "./groups/preset.scene.ts"
const value = numberValue({ value: 1 })
const result = presetThing({ value: value.value })
`

    const result = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource,
      projectId: 'test',
      registry: platformRegistry(),
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'SCENE_DEFINE_CONFLICT',
        message: expect.stringContaining('platform.preset-thing'),
      }),
    ]))
  })

  it('resolves imported Definition aliases and preserves runtime ids after moving its file', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-project-compiler-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'groups'), { recursive: true })
    await mkdir(join(projectDir, 'scene', 'moved'), { recursive: true })
    const definition = `// @scene-module-id stable.builder.module
// @scene-id stable-builder-definition
export const Builder = defineGroup(
  { id: "project.stable-builder", version: "1", inputs: { value: NumberValue }, outputs: { value: NumberValue } },
  ({ value }) => {
    // @scene-id stable-builder-inner
    const result = numberValue({ value })
    return { value: result.value }
  },
)
`
    await writeFile(join(projectDir, 'scene', 'groups', 'builder.scene.ts'), definition)
    const entry = (path: string) => `// @scene-module-id stable.entry.module
import { Builder as RenamedBuilder } from "${path}"
// @scene-id stable-input
const input = numberValue({ value: 3 })
// @scene-id stable-instance
const result = RenamedBuilder({ value: input.value })
`
    const first = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: entry('./groups/builder.scene.ts'),
      projectId: 'test',
      registry: platformRegistry(),
    })
    expect(first.diagnostics).toEqual([])

    await writeFile(join(projectDir, 'scene', 'moved', 'builder.scene.ts'), definition)
    const moved = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: entry('./moved/builder.scene.ts'),
      projectId: 'test',
      registry: platformRegistry(),
    })

    expect(moved.diagnostics).toEqual([])
    expect(moved.compiled.entityIds).toEqual(first.compiled.entityIds)
    expect(moved.compiled.ops).toEqual(first.compiled.ops)
    expect(moved.compiled.sourceMap).toEqual(expect.arrayContaining([
      expect.objectContaining({
        moduleId: 'stable.entry.module',
        file: 'main.scene.ts',
        statementId: 'stable-instance',
      }),
    ]))
  })

  it('invalidates a changed deep module and only its dependent closure', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-project-compiler-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'parts'), { recursive: true })
    await writeFile(
      join(projectDir, 'scene', 'parts', 'leaf.scene.ts'),
      '// @scene-module-id module.leaf\n// @scene-id leaf-value\nexport const leaf = numberValue({ value: 1 })\n',
    )
    await writeFile(
      join(projectDir, 'scene', 'parts', 'middle.scene.ts'),
      '// @scene-module-id module.middle\nimport { leaf } from "./leaf.scene.ts"\nexport { leaf }\n',
    )
    await writeFile(
      join(projectDir, 'scene', 'parts', 'unrelated.scene.ts'),
      '// @scene-module-id module.unrelated\n// @scene-id unrelated-value\nexport const unrelated = numberValue({ value: 9 })\n',
    )
    const entry = `// @scene-module-id module.entry
import { leaf } from "./parts/middle.scene.ts"
import { unrelated } from "./parts/unrelated.scene.ts"
// @scene-id consume-leaf
const one = numberValue({ value: leaf.value })
// @scene-id consume-unrelated
const two = numberValue({ value: unrelated.value })
`
    const first = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: entry,
      projectId: 'incremental',
      registry: platformRegistry(),
    })
    const unrelatedBefore = first.compiled.sourceMap.find((item) => item.statementId === 'unrelated-value')
    const second = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: entry,
      sourceOverrides: {
        'parts/leaf.scene.ts': '// @scene-module-id module.leaf\n// @scene-id leaf-value\nexport const leaf = numberValue({ value: 2 })\n',
      },
      projectId: 'incremental',
      registry: platformRegistry(),
    })

    expect(second.incremental.reparsedModuleIds).toEqual(['module.leaf'])
    expect(second.incremental.invalidatedModuleIds).toEqual([
      'module.entry',
      'module.leaf',
      'module.middle',
    ])
    expect(second.incremental.invalidatedModuleIds).not.toContain('module.unrelated')
    expect(second.compiled.sourceMap.find((item) => item.statementId === 'unrelated-value')).toEqual(unrelatedBefore)
  })

  it('compiles a scene that imports a project-local Generator', async () => {
    const projectDir = await mkdtemp(join(tmpdir(), 'scene-project-compiler-'))
    projects.push(projectDir)
    await mkdir(join(projectDir, 'scene', 'generators'), { recursive: true })
    await writeFile(join(projectDir, 'scene', 'generators', 'double.generator.ts'), `
      import { defineGenerator } from '@forgeax/project-generator'
      export const doubleValue = defineGenerator({
        id: "double-value",
        version: "1.0.0",
        inputs: { value: { type: NumberValue, defaultValue: 2 } },
        outputs: { value: { type: NumberValue } },
        run(_ctx, args: { value: number }) { return { value: args.value * 2 } },
      })
    `)
    const result = await compileStoredSceneProject(projectDir, {
      entryFile: 'main.scene.ts',
      entrySource: `// @scene-module-id module.gen
import { doubleValue } from "./generators/double.generator.ts"
const doubled = doubleValue({ value: 4 })
`,
      projectId: 'generator-compile',
      registry: platformRegistry(),
    })
    expect(result.diagnostics.filter((item) => item.severity === 'error' && item.code !== 'SCENE_RESULT_CAPTURE_REQUIRED')).toEqual([])
    expect(result.registry.get('doubleValue')?.opId).toBe('local/double-value')
    expect(result.compiled.ops.some((op) => op.type === 'createNode' && op.opId === 'local/double-value')).toBe(true)
  })
})
