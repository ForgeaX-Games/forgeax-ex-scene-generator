import { describe, expect, it } from 'vitest'

import {
  applyAuthoringCommands,
  applySceneDiagnosticFix,
  compileSceneModule,
  compileSceneGroupDefinition,
  compileSceneProject,
  hasGroupCapability,
  parseSceneModule,
  printSceneModule,
  SceneContractRegistry,
} from './index.js'
import type { NodeFunctionContract, RawTemplateGroup } from './index.js'

const template: RawTemplateGroup = {
  id: 'template_root',
  name: 'Settlement',
  nodes: [
    { id: 'inner_a', opId: 'scene_passthrough', params: {}, position: { x: 0, y: 0 } },
  ],
  edges: [],
  exposedInputs: [
    {
      portName: 'in_0',
      portType: 'scene',
      sourceNodeId: 'inner_a',
      sourcePortName: 'scene',
    },
  ],
  exposedOutputs: [
    {
      portName: 'out_0',
      portType: 'scene',
      sourceNodeId: 'inner_a',
      sourcePortName: 'scene',
    },
  ],
}

const contracts: NodeFunctionContract[] = [
  {
    functionName: 'scenePassthrough',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'scene_passthrough',
    description: 'Internal primitive.',
    agentVisible: false,
    definitionScope: 'group-body',
    inputs: [{ name: 'scene', type: 'scene' }],
    outputs: [{ name: 'scene', type: 'scene' }],
  },
  {
    functionName: 'numberValue',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'number_const',
    description: 'Create a number.',
    inputs: [{ name: 'value', type: 'number', mode: 'parameter' }],
    outputs: [{ name: 'value', type: 'number' }],
  },
  {
    functionName: 'manualPoints',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'manual_points',
    description: 'Create one point.',
    inputs: [],
    outputs: [{ name: 'points', type: 'point2d', runtimePort: 'point' }],
  },
  {
    functionName: 'placeBuilding',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'place_one_seed_on_point',
    description: 'Place a building.',
    inputs: [{ name: 'points', type: 'point2d', required: true, runtimePort: 'points' }],
    outputs: [{ name: 'scene', type: 'scene' }],
  },
  {
    functionName: 'settlement',
    kind: 'template',
    contractVersion: '1',
    definitionId: 'settlement',
    definitionVersion: '1',
    definition: template,
    description: 'Build a sealed settlement.',
    inputs: [{ name: 'base', type: 'scene', required: true, runtimePort: 'in_0' }],
    outputs: [{ name: 'scene', type: 'scene', runtimePort: 'out_0' }],
  },
  {
    functionName: 'sceneOutput',
    kind: 'atomic',
    contractVersion: '1',
    opId: 'scene_output',
    description: 'Capture the final scene.',
    inputs: [{ name: 'scene', type: 'scene', required: true }],
    outputs: [],
  },
]

function registry(): SceneContractRegistry {
  return new SceneContractRegistry(contracts)
}

describe('Scene Script', () => {
  it('parses, prints, and lowers a restricted native group definition', () => {
    const source = `export const Wrapper = defineGroup(
  {
    id: "wrapper",
    version: "1.0.0",
    inputs: { value: { type: NumberValue, runtimePort: "in_2", access: "item", required: true, mode: "parameter", label: "Value", order: 2, defaultValue: 3 } },
    outputs: { value: { type: NumberValue, runtimePort: "out_1", access: "item", hidden: true, label: "Result", description: "Wrapped numeric result.", order: 1 } },
  },
  ({ value }) => {
    const inner = numberValue({ value })
    return { value: inner.value }
  },
)`
    const parsed = parseSceneModule(source, { file: 'groups/wrapper.scene.ts', registry: registry() })
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.module.definitions).toHaveLength(1)
    const printed = printSceneModule(parsed.module)
    const reparsed = parseSceneModule(printed, { file: 'groups/wrapper.scene.ts', registry: registry() })
    expect(reparsed.diagnostics).toEqual([])
    expect(reparsed.module.definitions[0].meta).toEqual(parsed.module.definitions[0].meta)
    const result = compileSceneGroupDefinition(parsed.module.definitions[0], registry())
    expect(result.diagnostics).toEqual([])
    expect(result.contract?.definition?.exposedInputs?.[0]).toEqual(expect.objectContaining({
      portName: 'in_2',
      order: 2,
      customLabel: 'Value',
    }))
    expect(result.contract?.inputs[0].parameterTarget).toEqual(expect.objectContaining({
      templateNodeId: expect.any(String),
      param: 'value',
    }))
    expect(result.contract?.definition?.exposedOutputs?.[0]).toEqual(expect.objectContaining({
      portName: 'out_1',
      hidden: true,
      order: 1,
      customLabel: 'Result',
    }))
    expect(result.contract?.outputs[0].description).toBe('Wrapped numeric result.')
    const invocationRegistry = new SceneContractRegistry([...contracts, result.contract!])
    const invocation = parseSceneModule('const wrapped = Wrapper({ value: 7 })', {
      file: 'main.scene.ts',
      registry: invocationRegistry,
    })
    const compiled = compileSceneModule(invocation.module, invocationRegistry)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'createNode',
        params: expect.objectContaining({ value: 7 }),
      }),
    ]))
  })

  it('compiles Group array literals as DataTrees according to item/list/tree contracts', () => {
    const definitionRegistry = new SceneContractRegistry([
      {
        functionName: 'gridNames',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'grid2node',
        description: 'Area-partition-style item consumer.',
        definitionScope: 'group-body',
        inputs: [
          { name: 'name', type: 'string', access: 'item', mode: 'parameter' },
          { name: 'label', type: 'string', access: 'item', mode: 'parameter' },
        ],
        outputs: [{ name: 'scene', type: 'scene', access: 'tree' }],
      },
      {
        functionName: 'assetNames',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'asset_names',
        description: 'Area-partition-style list consumer.',
        definitionScope: 'group-body',
        inputs: [{ name: 'assets', type: 'string', access: 'list', mode: 'parameter' }],
        outputs: [{ name: 'scene', type: 'scene', access: 'tree' }],
      },
    ])
    const source = `export const AreaLike = defineGroup(
  {
    id: "scene.template.area-like",
    version: "1.0.0",
    inputs: {
      zoneNames: { type: StringValue, access: "tree", mode: "parameter" },
      zoneAssets: { type: StringList, access: "list", mode: "parameter" },
      label: { type: StringValue, access: "item", mode: "parameter" },
    },
    outputs: { scene: { type: Scene, access: "tree" } },
  },
  ({ zoneNames, zoneAssets, label }) => {
    const grids = gridNames({ name: zoneNames, label })
    const assets = assetNames({ assets: zoneAssets })
    return { scene: assets.scene }
  },
)`
    const parsedDefinition = parseSceneModule(source, {
      file: 'groups/area-like.scene.ts',
      registry: definitionRegistry,
    })
    expect(parsedDefinition.diagnostics).toEqual([])
    const lowered = compileSceneGroupDefinition(parsedDefinition.module.definitions[0]!, definitionRegistry)
    expect(lowered.diagnostics).toEqual([])

    const invocationRegistry = new SceneContractRegistry([
      ...definitionRegistry.list(),
      lowered.contract!,
    ])
    const invocation = parseSceneModule(
      `const result = AreaLike({
  zoneNames: ["plaza", "harbor"],
  zoneAssets: ["stone", "water"],
  label: "districts",
})`,
      { file: 'main.scene.ts', registry: invocationRegistry },
    )
    expect(invocation.diagnostics).toEqual([])
    const compiled = compileSceneModule(invocation.module, invocationRegistry)
    expect(compiled.diagnostics).toEqual([])

    const createdNodes = compiled.ops.filter(
      (op): op is Extract<(typeof compiled.ops)[number], { type: 'createNode' }> => op.type === 'createNode',
    )
    expect(createdNodes.find((op) => op.opId === 'grid2node')?.params).toEqual({
      name: [
        { path: [0, 0], items: ['plaza'] },
        { path: [0, 1], items: ['harbor'] },
      ],
      label: 'districts',
    })
    expect(createdNodes.find((op) => op.opId === 'asset_names')?.params.assets).toEqual([
      { path: [0, 0], items: ['stone'] },
      { path: [0, 1], items: ['water'] },
    ])
    const groupOp = compiled.ops.find(
      (op): op is Extract<(typeof compiled.ops)[number], { type: 'createGroup' }> => op.type === 'createGroup',
    )
    expect(groupOp?.exposedPorts?.inputs?.map((port) => [port.portName, port.access])).toEqual([
      ['zoneNames', 'tree'],
      ['zoneAssets', 'list'],
      ['label', 'item'],
    ])
  })

  it('rejects raw graph payloads in Definitions', () => {
    const source = `export const generated = defineGroup({
  id: "native.generated",
  version: "1.0.0",
  inputs: { root: { type: Scene, runtimeType: "scene", runtimePort: "in_0", access: "tree", order: 2, labelEn: "Root" } },
  outputs: { result: { type: Any, runtimeType: "custom", runtimePort: "out_0", hidden: true } },
  rawDefinition: ${JSON.stringify(template)},
})`
    const parsed = parseSceneModule(source, { file: 'generated.scene.ts', registry: registry() })
    expect(parsed.module.definitions).toEqual([])
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({ code: 'SCENE_DEFINE_RAW_FORBIDDEN' }),
    ])
  })

  it('rejects compiler-only primitives at scene top level', () => {
    const parsed = parseSceneModule('const result = scenePassthrough({ scene: root.scene })', {
      file: 'main.scene.ts',
      registry: registry(),
    })
    const compiled = compileSceneModule(parsed.module, registry())
    expect(compiled.diagnostics.some((item) => item.code === 'SCENE_COMPILE_DEFINITION_SCOPE')).toBe(true)
  })
  it('parses and canonically prints stable statement anchors', () => {
    const parsed = parseSceneModule(
      `const points = manualPoints({ x: 1, y: 2 })\nconst placed = placeBuilding({ points })\nsceneOutput({ scene: placed })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    expect(parsed.diagnostics).toEqual([])
    const printed = printSceneModule(parsed.module)
    expect(printed).toContain('@scene-id')
    const reparsed = parseSceneModule(printed, { file: 'main.scene.ts', registry: registry() })
    expect(reparsed.module.statements.map((item) => item.statementId)).toEqual(
      parsed.module.statements.map((item) => item.statementId),
    )
  })

  it('compiles typed value lineage into stable nodes and edges', () => {
    const parsed = parseSceneModule(
      `const points = manualPoints({ x: 1, y: 2 })\nconst placed = placeBuilding({ points })\nconst town = settlement({ base: placed })\nsceneOutput({ scene: town })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const compiled = compileSceneModule(parsed.module, registry())
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.entityIds).toHaveLength(4)
    expect(compiled.resultEntityIds).toHaveLength(1)
    expect(compiled.ops.filter((op) => op.type === 'createGroup')).toHaveLength(1)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(3)
    expect(compileSceneModule(parsed.module, registry()).ops).toEqual(compiled.ops)
  })

  it('seals template internals from agents', () => {
    const contract = registry().get('settlement')!
    expect(hasGroupCapability(contract, 'agent', 'configure')).toBe(true)
    expect(hasGroupCapability(contract, 'agent', 'editInstanceOverride')).toBe(false)
    expect(hasGroupCapability(contract, 'user', 'editInstanceOverride')).toBe(true)
  })

  it('applies scoped authoring commands but rejects agent access to sealed internals', () => {
    const parsed = parseSceneModule(
      `const root = placeBuilding({ points: missing })\nconst town = settlement({ base: root })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const town = parsed.module.statements[1]!
    const edited = applyAuthoringCommands(
      parsed.module,
      [
        {
          type: 'updateArguments',
          statementId: town.statementId,
          set: { label: { kind: 'literal', value: 'Harbor' } },
        },
        {
          type: 'editSealedInternal',
          statementId: town.statementId,
          runtimeNodeId: 'inner_a',
          patch: { params: { seed: 2 } },
        },
      ],
      { actor: 'agent', registry: registry() },
    )
    expect(edited.applied).toBe(1)
    expect(edited.module.statements[1]?.args.label).toEqual({ kind: 'literal', value: 'Harbor' })
    expect(edited.diagnostics[0]?.code).toBe('SCENE_CAPABILITY_SEALED_INTERNAL')
  })

  it('compiles recursively imported modules as one complete authoring graph', () => {
    const points = parseSceneModule(`export const points = manualPoints({ x: 4, y: 8 })\n`, {
      file: 'parts/points.scene.ts',
      moduleId: 'parts/points.scene.ts',
      registry: registry(),
    }).module
    const main = parseSceneModule(
      `import { points } from "./parts/points.scene.ts"\nconst placed = placeBuilding({ points })\nsceneOutput({ scene: placed })\n`,
      { file: 'main.scene.ts', moduleId: 'main.scene.ts', registry: registry() },
    ).module
    const compiled = compileSceneProject(
      {
        entryModuleId: 'main.scene.ts',
        modules: { 'main.scene.ts': main, 'parts/points.scene.ts': points },
      },
      registry(),
      (_from, specifier) => specifier.replace(/^\.\//, ''),
    )
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.entityIds).toHaveLength(3)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(2)
  })

  it('writes back multiple list connections and disconnects one reference without data loss', () => {
    const parsed = parseSceneModule(
      `const first = manualPoints({ x: 1, y: 2 })
const second = manualPoints({ x: 3, y: 4 })
const placed = placeBuilding({})
`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const first = parsed.module.statements[0]!
    const second = parsed.module.statements[1]!
    const placed = parsed.module.statements[2]!
    const connected = applyAuthoringCommands(parsed.module, [
      { type: 'connectValue', statementId: placed.statementId, input: 'points', sourceStatementId: first.statementId, append: true },
      { type: 'connectValue', statementId: placed.statementId, input: 'points', sourceStatementId: second.statementId, append: true },
    ], { actor: 'user', registry: registry() })
    expect(connected.module.statements[2]?.args.points).toMatchObject({
      kind: 'array',
      items: [{ binding: 'first' }, { binding: 'second' }],
    })
    const disconnected = applyAuthoringCommands(connected.module, [
      { type: 'disconnectValue', statementId: placed.statementId, input: 'points', sourceStatementId: first.statementId },
    ], { actor: 'user', registry: registry() })
    expect(disconnected.module.statements[2]?.args.points).toMatchObject({
      kind: 'array',
      items: [{ binding: 'second' }],
    })
  })

  it('applies a structured ReplaceReference fix through canonical commands', () => {
    const parsed = parseSceneModule(
      `const first = manualPoints({})\nconst second = manualPoints({})\nconst placed = placeBuilding({ points: first })\n`,
      { file: 'main.scene.ts', registry: registry() },
    )
    const fixed = applySceneDiagnosticFix(parsed.module, {
      fixId: 'use-second',
      title: 'Use second points',
      edits: [{
        type: 'ReplaceReference',
        statementId: parsed.module.statements[2].statementId,
        argument: 'points',
        sourceStatementId: parsed.module.statements[1].statementId,
      }],
    }, { actor: 'agent', registry: registry() })
    expect(fixed.diagnostics).toEqual([])
    expect(fixed.applied).toBe(1)
    expect(fixed.module.statements[2].args.points).toEqual({ kind: 'reference', binding: 'second' })
  })

  it('rejects untyped or mismatched Any values at a spatial protocol boundary', () => {
    const spatialRegistry = new SceneContractRegistry([
      {
        functionName: 'untypedValue',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'untyped',
        description: 'Untyped payload.',
        inputs: [],
        outputs: [{ name: 'value', type: 'any' }],
      },
      {
        functionName: 'regionValue',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'region',
        description: 'Region payload.',
        inputs: [],
        outputs: [{ name: 'value', type: 'any', runtimeType: 'region-set' }],
      },
      {
        functionName: 'basePlane',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'base-plane',
        description: 'Plane payload.',
        inputs: [],
        outputs: [{ name: 'plane', type: 'any', runtimeType: 'plane' }],
      },
      {
        functionName: 'workGrid',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'work-grid',
        description: 'Grid from plane.',
        inputs: [{ name: 'plane', type: 'any', runtimeType: 'plane', required: true, mode: 'value' }],
        outputs: [{ name: 'grid', type: 'any', runtimeType: 'work-grid' }],
      },
    ])
    const compile = (binding: string) => {
      const parsed = parseSceneModule(
        `const source = ${binding}({})\nconst grid = workGrid({ plane: source.value })\n`,
        { file: 'main.scene.ts', registry: spatialRegistry },
      )
      return compileSceneModule(parsed.module, spatialRegistry)
    }
    expect(compile('untypedValue').diagnostics[0]).toEqual(expect.objectContaining({
      code: 'SCENE_TYPE_PROTOCOL_MISMATCH',
      expected: { type: 'any', runtimeType: 'plane' },
      actual: { type: 'any' },
    }))
    expect(compile('regionValue').diagnostics[0]).toEqual(expect.objectContaining({
      code: 'SCENE_TYPE_PROTOCOL_MISMATCH',
    }))

    const valid = parseSceneModule(
      'const plane = basePlane({})\nconst grid = workGrid({ plane: plane.plane })\n',
      { file: 'main.scene.ts', registry: spatialRegistry },
    )
    expect(compileSceneModule(valid.module, spatialRegistry).diagnostics).toEqual([])
  })

  it('parses, prints, and lowers repeat into one stable grouped entity', () => {
    const builtinRegistry = new SceneContractRegistry([
      {
        functionName: 'regionSeed',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'region_seed',
        description: 'Region seed.',
        inputs: [],
        outputs: [{ name: 'state', type: 'any', runtimeType: 'region-set', access: 'item' }],
      },
      {
        functionName: 'advanceRegion',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'advance_region',
        description: 'Advance one region state.',
        inputs: [
          { name: 'state', type: 'any', runtimeType: 'region-set', access: 'item', required: true, mode: 'value' },
          { name: 'index', type: 'number', access: 'item', required: true, mode: 'value' },
        ],
        outputs: [{ name: 'state', type: 'any', runtimeType: 'region-set', access: 'item' }],
        deterministic: true,
      },
      {
        functionName: 'regionSink',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'region_sink',
        description: 'Consume a region.',
        inputs: [{ name: 'state', type: 'any', runtimeType: 'region-set', access: 'item', required: true, mode: 'value' }],
        outputs: [],
      },
    ])
    const parsed = parseSceneModule(
      `const seed = regionSeed({})
const result = repeat({ count: 3, initial: seed.state, step: advanceRegion })
regionSink({ state: result.state })
`,
      { file: 'repeat.scene.ts', registry: builtinRegistry },
    )
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.module.statements[1].args.step).toEqual({ kind: 'callable', functionName: 'advanceRegion' })
    const printed = printSceneModule(parsed.module)
    expect(printed).toContain('step: advanceRegion')
    expect(parseSceneModule(printed, { file: 'repeat.scene.ts', registry: builtinRegistry }).diagnostics).toEqual([])

    const compiled = compileSceneModule(parsed.module, builtinRegistry)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.entityIds).toHaveLength(3)
    const repeatMap = compiled.sourceMap.find((item) => item.statementId === parsed.module.statements[1].statementId)!
    expect(repeatMap.runtimeNodeIds).toHaveLength(7)
    expect(compiled.ops.filter((op) => op.type === 'createNode' && op.opId === 'advance_region')).toHaveLength(3)
    expect(compiled.ops.filter((op) => op.type === 'createNode' && op.opId === 'number_const')).toHaveLength(3)
    expect(compiled.ops.filter((op) => op.type === 'createGroup')).toHaveLength(1)
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(7)
    expect(compileSceneModule(parsed.module, builtinRegistry).ops).toEqual(compiled.ops)
  })

  it('rejects invalid repeat bounds and non-state-preserving steps', () => {
    const builtinRegistry = new SceneContractRegistry([
      {
        functionName: 'numberSeed',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'number_seed',
        description: 'Number seed.',
        inputs: [],
        outputs: [{ name: 'state', type: 'number' }],
      },
      {
        functionName: 'badStep',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'bad_step',
        description: 'Changes state type.',
        inputs: [{ name: 'state', type: 'number', required: true, mode: 'value' }],
        outputs: [{ name: 'state', type: 'string' }],
      },
    ])
    const bounds = parseSceneModule(
      'const seed = numberSeed({})\nconst result = repeat({ count: 17, initial: seed.state, step: badStep })',
      { file: 'repeat.scene.ts', registry: builtinRegistry },
    )
    expect(compileSceneModule(bounds.module, builtinRegistry).diagnostics).toEqual([
      expect.objectContaining({
        code: 'SCENE_REPEAT_COUNT',
        howToFix: expect.arrayContaining(['Use a static integer count from 1 through 16; larger iteration belongs in a project Generator.']),
      }),
    ])
    const type = parseSceneModule(
      'const seed = numberSeed({})\nconst result = repeat({ count: 2, initial: seed.state, step: badStep })',
      { file: 'repeat.scene.ts', registry: builtinRegistry },
    )
    expect(compileSceneModule(type.module, builtinRegistry).diagnostics).toEqual([
      expect.objectContaining({ code: 'SCENE_REPEAT_STATE_TYPE' }),
    ])
  })

  it('lowers choose to an eager ordinary runtime node with dynamic branch protocol', () => {
    const builtinRegistry = new SceneContractRegistry([
      {
        functionName: 'condition',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'condition',
        description: 'Condition.',
        inputs: [],
        outputs: [{ name: 'value', type: 'bool' }],
      },
      {
        functionName: 'regionA',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'region_a',
        description: 'Region A.',
        inputs: [],
        outputs: [{ name: 'value', type: 'any', runtimeType: 'region-set' }],
      },
      {
        functionName: 'regionB',
        kind: 'atomic',
        contractVersion: '1',
        opId: 'region_b',
        description: 'Region B.',
        inputs: [],
        outputs: [{ name: 'value', type: 'any', runtimeType: 'region-set' }],
      },
    ])
    const parsed = parseSceneModule(
      `const when = condition({})
const left = regionA({})
const right = regionB({})
const selected = choose({ when, then: left.value, otherwise: right.value })
`,
      { file: 'choose.scene.ts', registry: builtinRegistry },
    )
    expect(parsed.diagnostics).toEqual([])
    const compiled = compileSceneModule(parsed.module, builtinRegistry)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'createNode', opId: 'scene_choose' }),
    ]))
    expect(compiled.ops.filter((op) => op.type === 'connect')).toHaveLength(3)
    expect(compiled.sourceMap.at(-1)?.runtimeNodeIds).toHaveLength(1)
  })

  it('keeps ordinary for and if statements outside the restricted language', () => {
    const parsed = parseSceneModule(
      `if (true) { numberValue({ value: 1 }) }
for (let index = 0; index < 2; index += 1) { numberValue({ value: index }) }
`,
      { file: 'control-flow.scene.ts', registry: registry() },
    )
    expect(parsed.module.statements).toEqual([])
    expect(parsed.diagnostics.filter((item) => item.code === 'SCENE_PARSE_STATEMENT')).toHaveLength(2)
  })
})
