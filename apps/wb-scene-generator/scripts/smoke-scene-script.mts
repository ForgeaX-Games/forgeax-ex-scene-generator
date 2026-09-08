import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const workspace = await mkdtemp(join(tmpdir(), 'forgeax-scene-script-'))
process.env.NODE_ENV = 'test'
process.env.FORGEAX_PROJECT_ROOT = workspace
process.env.FORGEAX_BATTERY_WATCH = '0'

const { buildApp } = await import('../backend/src/main.js')
const app = await buildApp()
const userHeaders = { 'content-type': 'application/json', 'x-forgeax-caller-kind': 'user' }
const aiHeaders = {
  'content-type': 'application/json',
  'x-forgeax-caller-kind': 'ai',
  'x-forgeax-caller-agent-id': 'scene-script-smoke',
}
const source = `
const root = emptyScene({})
const baseName = stringValue({ value: "Ground" })
const width = numberValue({ value: 24 })
const height = numberValue({ value: 18 })
const baseAsset = stringValue({ value: "Grass" })
const base = addBaseGrid({ rootScene: root, baseName, width, height, baseAsset })
sceneOutput({ scene: base.rootScene })
`

const atomicPilotSource = `
const root = emptyScene({})
const width = numberValue({ value: 12 })
const height = numberValue({ value: 8 })
const fill = numberValue({ value: 1 })
const name = stringValue({ value: "Pilot ground" })
const asset = stringValue({ value: "Grass" })
const enabled = booleanValue({ value: true })
const sceneSeed = seed({ seed: 42 })
const grid = rectangularGrid({ width, height, fillValue: fill })
const voxel = gridSceneNode({ name, grid: grid.grid, token: asset })
const composed = addSceneChildren({ scene: root, nodes: [voxel.scene] })
const pointA = manualPoint({ x: 2, y: 3 })
const pointB = manualPoint({ x: 8, y: 5 })
const points = mergePoints({ items: [pointA.point, pointB.point] })
sceneOutput({ scene: composed.scene })
`

try {
  const committed = await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/main/scene-script',
    headers: userHeaders,
    payload: { source, label: 'Scene Script smoke golden' },
  })
  assert.equal(committed.statusCode, 200, committed.body)
  const commitBody = committed.json()
  assert.equal(commitBody.status, 'ok')
  assert.equal(commitBody.entityCount, 7)
  const projectInfo = await app.inject({
    method: 'GET',
    url: '/api/v1/projects/main/scene-script/project-info',
    headers: userHeaders,
  })
  assert.equal(projectInfo.statusCode, 200, projectInfo.body)
  assert(projectInfo.json().files.some((file: { path: string }) => file.path === 'main.scene.ts'))

  const pipelineResponse = await app.inject({ method: 'GET', url: '/api/v1/projects/main/pipeline' })
  assert.equal(pipelineResponse.statusCode, 200, pipelineResponse.body)
  const pipeline = pipelineResponse.json()
  const nodes = Object.values(pipeline.nodes) as Array<{ id: string; opId: string; params: Record<string, unknown> }>
  const widthNode = nodes.find((node) => node.opId === 'number_const' && node.params.value === 24)
  assert(widthNode, 'compiled width node missing')
  const baseNameNode = nodes.find((node) => node.opId === 'type_string' && node.params.value === 'Ground')
  assert(baseNameNode, 'compiled base-name node missing')
  const group = nodes.find((node) => node.opId === '__group__' && node.params.groupId)
  assert(group, 'compiled AddBaseGrid group missing')
  const executed = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/execute',
    headers: userHeaders,
    payload: {},
  })
  assert.equal(executed.statusCode, 200, executed.body)
  const execution = executed.json()
  assert.equal(execution.status, 'completed', JSON.stringify(execution.error))
  assert(execution.outputs[group.id]?.out_2, 'compiled AddBaseGrid public rootScene output missing')

  const uiEdit = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/batch',
    headers: userHeaders,
    payload: {
      ops: [
        {
          type: 'updateNode',
          nodeId: widthNode.id,
          params: { value: 32 },
          position: { x: 240, y: 120 },
        },
      ],
      opts: { actor: 'ui', label: 'Resize from visual node editor' },
    },
  })
  assert.equal(uiEdit.statusCode, 200, uiEdit.body)
  const sourceAfterUi = await app.inject({ method: 'GET', url: '/api/v1/projects/main/scene-script' })
  assert.match(sourceAfterUi.json().source, /value:\s*32/)

  const afterUiPipeline = (await app.inject({ method: 'GET', url: '/api/v1/projects/main/pipeline' })).json()
  const afterUiNodes = Object.values(afterUiPipeline.nodes) as Array<{ id: string; opId: string; params: Record<string, unknown> }>
  const heightNode = afterUiNodes.find((node) => node.opId === 'number_const' && node.params.value === 18)
  assert(heightNode, 'compiled height node missing')
  const sourceBeforeRejectedGroupEdits = sourceAfterUi.json().source
  const groupedValues = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/batch',
    headers: userHeaders,
    payload: {
      ops: [
        {
          type: 'createGroup',
          groupId: 'ui_dimensions',
          name: 'Dimensions',
          memberNodeIds: [widthNode.id, heightNode.id],
          position: { x: 260, y: 140 },
          exposedPorts: {
            outputs: [
              {
                portName: 'out_0',
                portType: 'number',
                sourceNodeId: widthNode.id,
                sourcePortName: 'value',
                customLabelEn: 'Width',
              },
              {
                portName: 'out_1',
                portType: 'number',
                sourceNodeId: heightNode.id,
                sourcePortName: 'value',
                customLabelEn: 'Height',
              },
            ],
          },
        },
      ],
      opts: { actor: 'ui', label: 'Group values from visual editor' },
    },
  })
  assert.equal(groupedValues.statusCode, 409, groupedValues.body)
  assert.equal(groupedValues.json().code, 'scene-authoring-confirmation-required')
  assert.equal(groupedValues.json().confirmations?.[0]?.kind, 'extract-definition')
  assert.equal(groupedValues.json().transaction?.applied, false)
  assert.equal(groupedValues.json().transaction?.rolledBack, true)
  const groupOverride = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/batch',
    headers: userHeaders,
    payload: {
      ops: [{ type: 'updateGroup', groupId: group.id, nodes: [] }],
      opts: { actor: 'ui', label: 'Edit group internals from visual editor' },
    },
  })
  assert.equal(groupOverride.statusCode, 422, groupOverride.body)
  assert.equal(groupOverride.json().code, 'scene-authoring-sealed-internal')
  const ungrouped = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/batch',
    headers: userHeaders,
    payload: {
      ops: [{ type: 'ungroup', groupId: group.id }],
      opts: { actor: 'ui', label: 'Ungroup from visual editor' },
    },
  })
  assert.equal(ungrouped.statusCode, 422, ungrouped.body)
  assert.equal(ungrouped.json().diagnostics?.[0]?.code, 'SCENE_CAPABILITY_SEALED_INTERNAL', ungrouped.body)
  const sourceAfterUngroup = await app.inject({ method: 'GET', url: '/api/v1/projects/main/scene-script' })
  assert.equal(sourceAfterUngroup.json().source, sourceBeforeRejectedGroupEdits)

  const opened = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/open',
    headers: aiHeaders,
    payload: {},
  })
  assert.equal(opened.statusCode, 200, opened.body)
  const directGraphEdit = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/batch',
    headers: aiHeaders,
    payload: { ops: [{ type: 'updateNode', nodeId: widthNode.id, params: { value: 999 } }], opts: { actor: 'ai:sino' } },
  })
  assert.equal(directGraphEdit.statusCode, 409)
  assert.equal(directGraphEdit.json().code, 'scene-script-is-canonical')
  const directTemplateInstantiation = await app.inject({
    method: 'POST',
    url: '/api/v1/group-templates/AddBaseGrid/instantiate',
    headers: aiHeaders,
    payload: { projectId: 'main' },
  })
  assert.equal(directTemplateInstantiation.statusCode, 410)
  assert.equal(directTemplateInstantiation.json().code, 'legacy-template-instantiate-removed')
  const directGraphImport = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/pipeline/import',
    headers: aiHeaders,
    payload: { format: 'kernel', graph: { nodes: {}, edges: {} } },
  })
  assert.equal(directGraphImport.statusCode, 410)
  assert.equal(directGraphImport.json().code, 'runtime-graph-authoring-removed')

  const latest = sourceAfterUngroup.json()
  const baseNameMap = latest.state.sourceMap.find((entry: { entityId: string }) => entry.entityId === baseNameNode.id)
  assert(baseNameMap, 'base-name source-map entry missing')
  const lens = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/main/scene-script/lens?entityId=${encodeURIComponent(baseNameNode.id)}`,
    headers: aiHeaders,
  })
  assert.equal(lens.statusCode, 200, lens.body)
  const lensBody = lens.json()
  const commandEdit = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/scene-script/commands',
    headers: aiHeaders,
    payload: {
      expectedRevision: lensBody.revision,
      commands: [
        {
          type: 'updateArguments',
          statementId: baseNameMap.statementId,
          set: { value: { kind: 'literal', value: 'Foundation' } },
        },
      ],
      label: 'Agent local semantic resize',
    },
  })
  assert.equal(commandEdit.statusCode, 200, commandEdit.body)
  assert.match(Object.values(commandEdit.json().sources ?? {}).join('\n'), /value:\s*"Foundation"/)

  const groupLens = await app.inject({
    method: 'GET',
    url: `/api/v1/projects/main/scene-script/lens?entityId=${encodeURIComponent(group.id)}`,
    headers: aiHeaders,
  })
  assert.equal(groupLens.statusCode, 200, groupLens.body)
  const sealedEdit = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/scene-script/commands',
    headers: aiHeaders,
    payload: {
      expectedRevision: groupLens.json().revision,
      commands: [
        {
          type: 'editSealedInternal',
          statementId: groupLens.json().target.statementId,
          runtimeNodeId: 'forbidden',
          patch: { params: { seed: 7 } },
        },
      ],
    },
  })
  assert.equal(sealedEdit.statusCode, 422)
  assert.equal(sealedEdit.json().diagnostics[0].code, 'SCENE_CAPABILITY_SEALED_INTERNAL')

  const atomicCommitted = await app.inject({
    method: 'PUT',
    url: '/api/v1/projects/main/scene-script',
    headers: userHeaders,
    payload: { source: atomicPilotSource, label: 'Atomic Scene Script pilot' },
  })
  assert.equal(atomicCommitted.statusCode, 200, atomicCommitted.body)
  const atomicPipeline = await app.inject({ method: 'GET', url: '/api/v1/projects/main/pipeline' })
  assert.equal(atomicPipeline.statusCode, 200, atomicPipeline.body)
  const atomicPositions = Object.values(atomicPipeline.json().nodes) as Array<{ position: { x: number; y: number } }>
  assert.equal(
    new Set(atomicPositions.map((node) => `${node.position.x}:${node.position.y}`)).size,
    atomicPositions.length,
    'Scene Script initial layout must not stack nodes at one coordinate',
  )
  const atomicExecuted = await app.inject({
    method: 'POST',
    url: '/api/v1/projects/main/execute',
    headers: userHeaders,
    payload: {},
  })
  assert.equal(atomicExecuted.statusCode, 200, atomicExecuted.body)
  assert.equal(atomicExecuted.json().status, 'completed', atomicExecuted.body)

  console.log('Scene Script smoke passed: source ↔ graph, Edit Lens, sealed capability')
} finally {
  await app.close()
  await rm(workspace, { recursive: true, force: true })
}
process.exit(0)
