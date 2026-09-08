import { describe, expect, it } from 'vitest'

import {
  applyProjectAuthoringCommands,
  parseSceneModule,
  printSceneModule,
  SceneContractRegistry,
  type NodeFunctionContract,
  type SceneModuleAst,
  type SceneProjectAst,
} from './index.js'

const contracts: NodeFunctionContract[] = [
  {
    functionName: 'source',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'source',
    description: 'Two-output source.',
    inputs: [],
    outputs: [{ name: 'left', type: 'number' }, { name: 'right', type: 'number' }],
  },
  {
    functionName: 'transform',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'transform',
    description: 'Transform.',
    inputs: [{ name: 'value', type: 'number', required: true }],
    outputs: [{ name: 'value', type: 'number' }],
  },
  {
    functionName: 'consume',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'consume',
    description: 'Consume.',
    inputs: [{ name: 'value', type: 'number', required: true }],
    outputs: [],
  },
  {
    functionName: 'stateStep',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'state_step',
    description: 'Repeatable state transform.',
    inputs: [{ name: 'state', type: 'number', required: true }],
    outputs: [{ name: 'state', type: 'number' }],
  },
]
const registry = new SceneContractRegistry(contracts)

function parse(source: string, file = 'main.scene.ts'): SceneModuleAst {
  const result = parseSceneModule(source, { file, registry })
  expect(result.diagnostics).toEqual([])
  return result.module
}

function project(module: SceneModuleAst, extras: SceneModuleAst[] = []): SceneProjectAst {
  return {
    entryModuleId: module.moduleId,
    modules: Object.fromEntries([module, ...extras].map((item) => [item.moduleId, item])),
  }
}

describe('structural Scene Authoring Commands', () => {
  it('renames a declaration and all module-local references without changing identity', () => {
    const main = parse(`// @scene-module-id main
// @scene-id source-id
const oldName = source({})
// @scene-id use-id
consume({ value: oldName.right })
`)
    const result = applyProjectAuthoringCommands(project(main), [
      { type: 'renameBinding', statementId: 'source-id', binding: 'renamed' },
    ], { actor: 'user', registry })

    expect(result.diagnostics).toEqual([])
    expect(result.project.modules.main.statements[0]).toMatchObject({ statementId: 'source-id', binding: 'renamed' })
    expect(result.project.modules.main.statements[1].args.value).toEqual({
      kind: 'reference',
      binding: 'renamed',
      output: 'right',
    })
  })

  it('reorders in-module and moves across modules while preserving statementId and wiring imports', () => {
    const sourceModule = parse(`// @scene-module-id source-module
// @scene-id dependency
export const dependency = source({})
// @scene-id moving
const moving = transform({ value: dependency.left })
`, 'source.scene.ts')
    const targetModule = parse(`// @scene-module-id target-module
// @scene-id existing
consume({ value: 0 })
`, 'target.scene.ts')
    const result = applyProjectAuthoringCommands(project(targetModule, [sourceModule]), [
      {
        type: 'moveStatement',
        statementId: 'moving',
        targetModuleId: 'target-module',
        afterStatementId: 'existing',
      },
    ], { actor: 'user', registry })

    expect(result.diagnostics).toEqual([])
    expect(result.changedModuleIds).toEqual(['source-module', 'target-module'])
    expect(result.project.modules['target-module'].statements[1]).toMatchObject({
      statementId: 'moving',
      binding: 'moving',
    })
    expect(printSceneModule(result.project.modules['target-module'])).toContain(
      'import { dependency } from "./source.scene.ts"',
    )
  })

  it('proposes confirmation metadata, then extracts a closed subgraph with external and multiple outputs', () => {
    const main = parse(`// @scene-module-id main
// @scene-id roots
const roots = source({})
// @scene-id left-transform
const left = transform({ value: roots.left })
// @scene-id right-transform
const right = transform({ value: roots.right })
// @scene-id left-use
consume({ value: left.value })
// @scene-id right-use
consume({ value: right.value })
`)
    const proposed = applyProjectAuthoringCommands(project(main), [{
      type: 'wrapInGroup',
      statementIds: ['left-transform', 'right-transform'],
    }], { actor: 'user', registry })
    expect(proposed.applied).toBe(0)
    expect(proposed.confirmations[0]?.meta).toMatchObject({
      name: 'ExtractedGroup',
      file: 'groups/extracted-group.scene.ts',
      seal: true,
      confirmed: false,
    })
    expect(proposed.confirmations[0]?.meta.inputs).toHaveLength(2)
    expect(proposed.confirmations[0]?.meta.outputs).toHaveLength(2)

    const extracted = applyProjectAuthoringCommands(project(main), [{
      type: 'extractDefinition',
      statementIds: ['left-transform', 'right-transform'],
      meta: {
        name: 'SplitTransform',
        file: 'groups/split-transform.scene.ts',
        seal: true,
        confirmed: true,
      },
    }], { actor: 'user', registry })
    expect(extracted.diagnostics).toEqual([])
    expect(extracted.applied).toBe(1)
    const definitionModule = Object.values(extracted.project.modules)
      .find((item) => item.file === 'groups/split-transform.scene.ts')!
    expect(definitionModule.definitions[0].body.map((item) => item.statementId)).toEqual([
      'left-transform',
      'right-transform',
    ])
    expect(Object.keys(definitionModule.definitions[0].meta.outputs)).toHaveLength(2)
    expect(extracted.project.modules.main.statements.map((item) => item.statementId)).not.toContain('left-transform')
    expect(parseSceneModule(printSceneModule(definitionModule), {
      file: definitionModule.file,
      moduleId: definitionModule.moduleId,
      registry,
    }).diagnostics).toEqual([])
  })

  it('inlines only the selected shared instance and rejects sealed agent access', () => {
    const definitionModule = parse(`// @scene-module-id defs
// @scene-id shared-definition
export const Shared = defineGroup(
  {
    id: "shared",
    version: "1",
    inputs: { value: NumberValue },
    outputs: { value: NumberValue },
    sealed: true,
  },
  ({ value }) => {
    // @scene-id inner-transform
    const inner = transform({ value })
    return { value: inner.value }
  },
)
`, 'groups/shared.scene.ts')
    const main = parse(`// @scene-module-id main
import { Shared } from "./groups/shared.scene.ts"
// @scene-id roots
const roots = source({})
// @scene-id instance-a
const a = Shared({ value: roots.left })
// @scene-id instance-b
const b = Shared({ value: roots.right })
// @scene-id use-a
consume({ value: a.value })
// @scene-id use-b
consume({ value: b.value })
`)
    const resolveImport = (_from: string, specifier: string) => specifier === './groups/shared.scene.ts' ? 'defs' : specifier
    const denied = applyProjectAuthoringCommands(project(main, [definitionModule]), [
      { type: 'ungroup', statementId: 'instance-a' },
    ], { actor: 'agent', registry, resolveImport })
    expect(denied.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_CAPABILITY_SEALED_INTERNAL' }),
    ]))
    expect(denied.project).toBeDefined()

    const inlined = applyProjectAuthoringCommands(project(main, [definitionModule]), [
      { type: 'inlineDefinition', statementId: 'instance-a', strategy: 'current-instance' },
    ], { actor: 'user', registry, resolveImport })
    expect(inlined.diagnostics).toEqual([])
    expect(inlined.project.modules.main.statements.some((item) => item.statementId === 'instance-b')).toBe(true)
    expect(inlined.project.modules.main.statements.some((item) => item.statementId === 'instance-a')).toBe(false)
    expect(inlined.project.modules.main.statements.some((item) =>
      item.statementId !== 'inner-transform' && item.functionName === 'transform')).toBe(true)
  })

  it('reports external platform Definitions as sealed instead of retryable missing source', () => {
    const externalRegistry = new SceneContractRegistry([
      ...contracts,
      {
        functionName: 'ExternalGroup',
        kind: 'group',
        contractVersion: '1',
        opId: '__group__',
        definitionId: 'platform.external-group',
        definitionVersion: '1',
        definition: {
          id: 'platform.external-group',
          nodes: [],
          edges: [],
          exposedOutputs: [],
        },
        description: 'Platform-owned sealed group.',
        inputs: [],
        outputs: [{ name: 'value', type: 'number' }],
      },
    ])
    const parsed = parseSceneModule(`// @scene-module-id main
// @scene-id external-instance
const external = ExternalGroup({})
`, { file: 'main.scene.ts', registry: externalRegistry })
    expect(parsed.diagnostics).toEqual([])

    const result = applyProjectAuthoringCommands(project(parsed.module), [
      { type: 'ungroup', statementId: 'external-instance' },
    ], { actor: 'user', registry: externalRegistry })

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'SCENE_CAPABILITY_SEALED_INTERNAL',
        phase: 'capability',
        retryable: false,
        escalation: 'none',
      }),
    ])
  })

  it('sets a captured multi-output reference through the same transaction', () => {
    const main = parse(`// @scene-module-id main
// @scene-id roots
const roots = source({})
// @scene-id capture
consume({ value: roots.left })
`)
    const result = applyProjectAuthoringCommands(project(main), [{
      type: 'setCapturedOutput',
      statementId: 'capture',
      sourceStatementId: 'roots',
      input: 'value',
      output: 'right',
    }], { actor: 'user', registry })
    expect(result.diagnostics).toEqual([])
    expect(result.project.modules.main.statements[1].args.value).toEqual({
      kind: 'reference',
      binding: 'roots',
      output: 'right',
    })
  })

  it('keeps cross-module consumers valid when an exported statement is extracted', () => {
    const values = parse(`// @scene-module-id values
// @scene-id exported-source
export const published = source({})
`, 'values.scene.ts')
    const main = parse(`// @scene-module-id main
import { published } from "./values.scene.ts"
// @scene-id cross-consumer
consume({ value: published.right })
`)
    const result = applyProjectAuthoringCommands(project(main, [values]), [{
      type: 'extractDefinition',
      moduleId: 'values',
      statementIds: ['exported-source'],
      meta: {
        name: 'PublishedSource',
        file: 'groups/published-source.scene.ts',
        seal: true,
        confirmed: true,
      },
    }], {
      actor: 'user',
      registry,
      resolveImport: (_from, specifier) => specifier === './values.scene.ts' ? 'values' : specifier,
    })

    expect(result.diagnostics).toEqual([])
    expect(result.changedModuleIds).toEqual(expect.arrayContaining(['values', 'main']))
    expect(result.project.modules.values.exports[0]).toMatchObject({
      exported: 'published',
    })
    expect(result.project.modules.main.statements[0].args.value).toMatchObject({
      kind: 'reference',
      binding: 'published',
      output: 'published_right',
    })
  })

  it('rewrites repeat value references while preserving callable references and semantic round trips', () => {
    const main = parse(`// @scene-module-id main
// @scene-id seed
const original = source({})
// @scene-id repeated
const result = repeat({ count: 2, initial: original.left, step: stateStep })
`)
    const result = applyProjectAuthoringCommands(project(main), [
      { type: 'renameBinding', statementId: 'seed', binding: 'renamed' },
    ], { actor: 'user', registry })

    expect(result.diagnostics).toEqual([])
    expect(result.project.modules.main.statements[1].args.initial).toEqual({
      kind: 'reference',
      binding: 'renamed',
      output: 'left',
    })
    expect(result.project.modules.main.statements[1].args.step).toEqual({
      kind: 'callable',
      functionName: 'stateStep',
    })
    expect(parseSceneModule(printSceneModule(result.project.modules.main), {
      file: 'main.scene.ts',
      moduleId: 'main',
      registry,
    }).diagnostics).toEqual([])
  })
})
