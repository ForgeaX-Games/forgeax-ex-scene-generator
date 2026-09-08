import { describe, expect, it } from 'vitest'

import {
  compileSceneProject,
  applyProjectAuthoringCommands,
  parseSceneModule,
  SceneContractRegistry,
  type NodeFunctionContract,
  type SceneModuleAst,
} from './index.js'

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
    functionName: 'consumeNumber',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'number_consumer',
    description: 'Consume one number.',
    inputs: [{ name: 'value', type: 'number', required: true }],
    outputs: [],
  },
]

const registry = new SceneContractRegistry(contracts)

function parse(source: string, file: string): SceneModuleAst {
  const result = parseSceneModule(source, { file, registry })
  expect(result.diagnostics).toEqual([])
  return result.module
}

function resolver(mapping: Record<string, string>) {
  return (_from: string, specifier: string): string => mapping[specifier] ?? specifier
}

describe('Scene Project module semantics', () => {
  it('isolates same-named private bindings and resolves value import aliases', () => {
    const a = parse(`// @scene-module-id module.a
// @scene-id a-private
const privateValue = numberValue({ value: 1 })
// @scene-id a-public
export const published = numberValue({ value: privateValue.value })
`, 'old/a.scene.ts')
    const b = parse(`// @scene-module-id module.b
// @scene-id b-private
const privateValue = numberValue({ value: 2 })
// @scene-id b-public
export const published = numberValue({ value: privateValue.value })
`, 'old/b.scene.ts')
    const main = parse(`// @scene-module-id module.main
import { published as fromA } from "./a.scene.ts"
import { published as fromB } from "./b.scene.ts"
// @scene-id consume-a
consumeNumber({ value: fromA.value })
// @scene-id consume-b
consumeNumber({ value: fromB.value })
`, 'main.scene.ts')
    const compiled = compileSceneProject(
      {
        entryModuleId: main.moduleId,
        modules: { [main.moduleId]: main, [a.moduleId]: a, [b.moduleId]: b },
      },
      registry,
      resolver({ './a.scene.ts': a.moduleId, './b.scene.ts': b.moduleId }),
    )

    expect(compiled.diagnostics).toEqual([])
    expect(new Set(compiled.entityIds).size).toBe(6)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(4)
    expect(compiled.sourceMap).toEqual(expect.arrayContaining([
      expect.objectContaining({ moduleId: 'module.a', file: 'old/a.scene.ts', statementId: 'a-private' }),
      expect.objectContaining({ moduleId: 'module.b', file: 'old/b.scene.ts', statementId: 'b-private' }),
    ]))
  })

  it('keeps entity and runtime identities stable across file moves', () => {
    const source = `// @scene-module-id stable.module
// @scene-id stable-value
export const value = numberValue({ value: 7 })
// @scene-id stable-consumer
consumeNumber({ value: value.value })
`
    const before = parse(source, 'before/value.scene.ts')
    const after = parse(source, 'after/nested/value.scene.ts')
    const compile = (module: SceneModuleAst) => compileSceneProject(
      { entryModuleId: module.moduleId, modules: { [module.moduleId]: module } },
      registry,
    )
    const first = compile(before)
    const moved = compile(after)

    expect(moved.entityIds).toEqual(first.entityIds)
    expect(moved.ops).toEqual(first.ops)
    expect(moved.sourceMap.map((item) => item.runtimeNodeIds)).toEqual(
      first.sourceMap.map((item) => item.runtimeNodeIds),
    )
    expect(moved.sourceMap.every((item) => item.file === 'after/nested/value.scene.ts')).toBe(true)
  })

  it('diagnoses cycles, unknown modules, and non-exported imports', () => {
    const cycleA = parse('// @scene-module-id cycle.a\nimport {} from "./b.scene.ts"\n', 'a.scene.ts')
    const cycleB = parse('// @scene-module-id cycle.b\nimport {} from "./a.scene.ts"\n', 'b.scene.ts')
    const cycle = compileSceneProject(
      {
        entryModuleId: cycleA.moduleId,
        modules: { [cycleA.moduleId]: cycleA, [cycleB.moduleId]: cycleB },
      },
      registry,
      resolver({ './a.scene.ts': cycleA.moduleId, './b.scene.ts': cycleB.moduleId }),
    )
    expect(cycle.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_RESOLVE_IMPORT_CYCLE' }),
    ]))

    const unknown = parse('// @scene-module-id unknown.entry\nimport {} from "./missing.scene.ts"\n', 'main.scene.ts')
    expect(compileSceneProject(
      { entryModuleId: unknown.moduleId, modules: { [unknown.moduleId]: unknown } },
      registry,
    ).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_RESOLVE_MODULE' }),
    ]))

    const privateModule = parse(`// @scene-module-id private.module
// @scene-id hidden
const hidden = numberValue({ value: 1 })
`, 'private.scene.ts')
    const importer = parse(`// @scene-module-id private.importer
import { hidden as forbidden } from "./private.scene.ts"
// @scene-id forbidden-use
consumeNumber({ value: forbidden.value })
`, 'main.scene.ts')
    const nonExported = compileSceneProject(
      {
        entryModuleId: importer.moduleId,
        modules: {
          [importer.moduleId]: importer,
          [privateModule.moduleId]: privateModule,
        },
      },
      registry,
      resolver({ './private.scene.ts': privateModule.moduleId }),
    )
    expect(nonExported.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'SCENE_RESOLVE_IMPORT_EXPORT' }),
      expect.objectContaining({ code: 'SCENE_RESOLVE_BINDING' }),
    ]))
  })

  it('preserves stable identities over generated module-name cases', () => {
    for (let index = 0; index < 16; index += 1) {
      const moduleId = `property.module.${index}`
      const statementId = `property-statement-${index}`
      const source = `// @scene-module-id ${moduleId}
// @scene-id ${statementId}
export const local = numberValue({ value: ${index} })
`
      const first = parse(source, `left/${index}.scene.ts`)
      const second = parse(source, `right/deeper/${index}.scene.ts`)
      const compile = (module: SceneModuleAst) => compileSceneProject(
        { entryModuleId: moduleId, modules: { [moduleId]: module } },
        registry,
      )
      expect(compile(second).entityIds).toEqual(compile(first).entityIds)
    }
  })

  it('routes one atomic command transaction across modules and imported connections', () => {
    const source = parse(`// @scene-module-id module.source
// @scene-id source-value
export const value = numberValue({ value: 1 })
`, 'source.scene.ts')
    const target = parse(`// @scene-module-id module.target
import { value as importedValue } from "./source.scene.ts"
// @scene-id target-consumer
consumeNumber({ value: 0 })
`, 'target.scene.ts')
    const result = applyProjectAuthoringCommands(
      {
        entryModuleId: target.moduleId,
        modules: { [source.moduleId]: source, [target.moduleId]: target },
      },
      [
        {
          type: 'updateArguments',
          moduleId: source.moduleId,
          statementId: 'source-value',
          set: { value: { kind: 'literal', value: 2 } },
        },
        {
          type: 'connectValue',
          moduleId: target.moduleId,
          statementId: 'target-consumer',
          input: 'value',
          sourceStatementId: 'source-value',
        },
      ],
      {
        actor: 'user',
        registry,
        resolveImport: (_from, specifier) => specifier === './source.scene.ts' ? source.moduleId : specifier,
      },
    )

    expect(result.diagnostics).toEqual([])
    expect(result.applied).toBe(2)
    expect(result.changedModuleIds).toEqual(['module.source', 'module.target'])
    expect(result.project.modules['module.target'].statements[0].args.value).toEqual({
      kind: 'reference',
      binding: 'importedValue',
    })
  })
})
