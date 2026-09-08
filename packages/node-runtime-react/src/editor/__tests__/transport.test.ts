// Transport adapter tests — verify the editor data services map onto the
// kernel ApiClient: batteries from listOps, mutations through applyBatch,
// execution through execute, and the WS adapter forwarding graph/exec events.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GraphNode, NodeGroup as KernelNodeGroup, Op, OpSpec } from '@forgeax/node-runtime'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { applyOrder, sortSmallLabels } from '../components/sidebar/batteryGrouping.js'
import { createEditorTransport } from '../transport/index.js'
import { diffPipelineToOps } from '../transport/mappers.js'
import type { Pipeline } from '../types.js'

function spec(id: string, name: string): OpSpec {
  return { id, name, inputs: [], outputs: [], params: [], execute: () => null }
}

function categorizedSpec(id: string, name: string, category: string): OpSpec {
  return { ...spec(id, name), category } as OpSpec
}

function emptyPipeline(id = 'test-pipeline'): Pipeline {
  const now = '1970-01-01T00:00:00.000Z'
  return {
    id,
    name: id,
    description: '',
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    status: 'idle',
    createdAt: now,
    updatedAt: now,
  }
}

describe('EditorApiAdapter', () => {
  it('getBatteries derives batteries from listOps()', async () => {
    const client = createMockApiClient({
      ops: [spec('wb-scene.csg.union', 'Union'), spec('wb-scene.grid.make', 'Grid')],
    })
    const { api } = createEditorTransport(client)

    const batteries = await api.getBatteries()

    expect(batteries.map((b) => b.id)).toEqual(['wb-scene.csg.union', 'wb-scene.grid.make'])
    expect(batteries[0].name).toBe('Union')
    // Category derives from the op-id namespace.
    expect(batteries[0].category).toBe('wb-scene')
  })

  it('getBatteries preserves access metadata on static and dynamic ports', async () => {
    const client = createMockApiClient({
      ops: [{
        ...spec('wb-scene.add_child', 'Add Child'),
        inputs: [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'nodes', type: 'scene', access: 'list' },
        ],
        outputs: [
          { name: 'scene', type: 'scene', access: 'item' },
          { name: 'childPaths', type: 'string', access: 'list' },
        ],
        dynamicInputs: {
          prefix: 'item_',
          labelTemplate: '[$i]',
          minCount: 2,
          type: 'any',
          access: 'tree',
        },
      }],
    })
    const { api } = createEditorTransport(client)

    const [battery] = await api.getBatteries()

    expect(battery.inputs.find((p) => p.name === 'nodes')?.access).toBe('list')
    expect(battery.outputs.find((p) => p.name === 'childPaths')?.access).toBe('list')
    expect(battery.dynamicInputs?.access).toBe('tree')
  })

  it('getBatteries preserves inline SVG icons attached by plugin backends', async () => {
    const client = createMockApiClient({
      ops: [{
        ...categorizedSpec('toggle', 'Toggle', 'common/input'),
        iconSvg: '<svg viewBox="0 0 24 24"></svg>',
      } as OpSpec],
    })
    const { api } = createEditorTransport(client)

    const [battery] = await api.getBatteries()

    expect(battery.iconSvg).toContain('<svg')
  })

  it('getBatteries includes reusable group templates and native public contracts', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    client.listGroupTemplates = async () => [{
      id: 'terrain-template',
      name: 'Terrain Template',
      category: 'terrain',
      displayGroup: 'templates/terrain',
      sourcePath: 'templates/terrain/Terrain/Terrain.json',
      nativeDefinition: {
        functionName: 'terrainTemplate',
        kind: 'template',
        contractVersion: '1.0.0',
        description: 'Terrain template',
        inputs: [],
        outputs: [],
      },
    }]
    const { api } = createEditorTransport(client)

    const batteries = await api.getBatteries()

    expect(batteries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'terrain-template',
        type: 'group',
        category: 'terrain',
        displayGroup: 'templates/terrain',
        sourcePath: 'templates/terrain/Terrain/Terrain.json',
        nativeDefinition: expect.objectContaining({ functionName: 'terrainTemplate' }),
      }),
    ]))
  })

  it('delegates native Definition instantiation without applying a raw group batch', async () => {
    const client = createMockApiClient()
    const instantiate = vi.fn(async () => ({
      status: 'ok' as const,
      entityId: 'group-native',
      statementId: 'stmt-native',
      revision: 'rev-2',
    }))
    client.instantiateNativeDefinition = instantiate
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    await expect(api.instantiateNativeDefinition('terrainTemplate', { x: 12, y: 34 })).resolves.toEqual(
      expect.objectContaining({ entityId: 'group-native' }),
    )
    expect(instantiate).toHaveBeenCalledWith('terrainTemplate', { x: 12, y: 34 })
    expect(applySpy).not.toHaveBeenCalled()
  })

  it('routes grouping intent through canonical project commands with revisions', async () => {
    const client = createMockApiClient()
    client.getSceneAuthoringProjectInfo = vi.fn(async () => ({
      canonical: true,
      canonicalModule: 'main.scene.ts',
      projectRevision: 'project-rev-1',
      moduleRevisions: {
        'main.scene.ts': { moduleId: 'main', revision: 'module-rev-1' },
      },
    }))
    const apply = vi.fn(async () => ({
      status: 'ok' as const,
      projectRevision: 'project-rev-2',
      transaction: { applied: true, rolledBack: false, undoToken: 'undo-1' },
    }))
    client.applySceneAuthoringCommands = apply
    const { api } = createEditorTransport(client)

    expect(api.supportsSceneAuthoringCommands()).toBe(true)
    await expect(api.applySceneAuthoringCommands([
      { type: 'wrapInGroup', statementIds: ['a', 'b'] },
    ], 'Extract Definition')).resolves.toEqual(expect.objectContaining({
      projectRevision: 'project-rev-2',
      transaction: expect.objectContaining({ undoToken: 'undo-1' }),
    }))
    expect(apply).toHaveBeenCalledWith({
      expectedProjectRevision: 'project-rev-1',
      expectedModuleRevisions: { 'main.scene.ts': 'module-rev-1' },
      commands: [{ type: 'wrapInGroup', statementIds: ['a', 'b'] }],
      label: 'Extract Definition',
    })
  })

  it('getCategories groups batteries by big tag', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('b.two', 'Two')] })
    const { api } = createEditorTransport(client)

    const cats = await api.getCategories()

    expect(cats.map((c) => c.bigTag).sort()).toEqual(['a', 'b'])
  })

  it('does not treat backend category smallTags as user-saved small label order', async () => {
    const client = createMockApiClient({
      ops: [
        categorizedSpec('common.datatree', 'DataTree', 'common/datatree'),
        categorizedSpec('common.input', 'Input', 'common/input'),
        categorizedSpec('common.list', 'List', 'common/list'),
        categorizedSpec('common.number', 'Number', 'common/number'),
      ],
    })
    const { api } = createEditorTransport(client)

    const categories = await api.getCategories()
    const order = await api.getBatteryOrder()
    const commonLabels = categories.find((c) => c.bigTag === 'common')?.smallTags ?? []
    const rendered = applyOrder(order.smallLabels.common ?? [], sortSmallLabels(commonLabels, 'common'))

    expect(commonLabels).toEqual(['datatree', 'input', 'list', 'number'])
    expect(order.smallLabels.common).toBeUndefined()
    expect(rendered).toEqual(['input', 'list', 'datatree', 'number'])
  })

  it('returns an explicitly saved small label order', async () => {
    const client = createMockApiClient({
      ops: [
        categorizedSpec('common.datatree', 'DataTree', 'common/datatree'),
        categorizedSpec('common.input', 'Input', 'common/input'),
        categorizedSpec('common.list', 'List', 'common/list'),
      ],
    })
    const { api } = createEditorTransport(client)

    await api.saveBatteryOrder({
      bigLabels: ['common'],
      smallLabels: { common: ['datatree', 'input', 'list'] },
    })

    expect(await api.getBatteryOrder()).toEqual({
      bigLabels: ['common'],
      smallLabels: { common: ['datatree', 'input', 'list'] },
    })
  })

  it('updatePipeline submits the diff through applyBatch', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} })

    const res = await api.updatePipeline(desired)

    expect(res.status).toBe('ok')
    expect(applySpy).toHaveBeenCalledTimes(1)
    const ops = applySpy.mock.calls[0][0]
    expect(ops).toEqual([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    // The node is now in the kernel snapshot.
    const snap = await client.getPipeline()
    expect(snap?.nodes['n1']).toBeTruthy()
  })

  it('updatePipeline returns applyBatch diagnostics on rejection', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    vi.spyOn(client, 'applyBatch').mockResolvedValueOnce({
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: [{ opIndex: 1, severity: 'error', message: 'edge e12 does not exist' }],
    })
    const { api } = createEditorTransport(client)

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.one', name: 'Two', position: { x: 1, y: 1 }, params: {} })

    const res = await api.updatePipeline(desired)

    expect(res).toMatchObject({
      status: 'rejected',
      reason: 'op validation failed',
      diagnostics: [{ opIndex: 1, severity: 'error', message: 'edge e12 does not exist' }],
    })
  })

  it('updatePipeline with no changes does not call applyBatch', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const applySpy = vi.spyOn(client, 'applyBatch')
    const { api } = createEditorTransport(client)

    const res = await api.updatePipeline(emptyPipeline())

    expect(res.status).toBe('ok')
    expect(applySpy).not.toHaveBeenCalled()
  })

  it('executePipeline calls client.execute', async () => {
    const client = createMockApiClient()
    const execSpy = vi.spyOn(client, 'execute')
    const { api } = createEditorTransport(client)

    await api.executePipeline()
    expect(execSpy).toHaveBeenCalledWith({})

    await api.executePipeline({ startNodeId: 'n1' })
    expect(execSpy).toHaveBeenLastCalledWith({ nodeId: 'n1' })
  })

  it('stopPipeline is a no-op stub that resolves', async () => {
    const { api } = createEditorTransport(createMockApiClient())
    await expect(api.stopPipeline()).resolves.toBeUndefined()
  })

  it('saveGroup emits a createGroup op and loadGroup reads it back', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    const { api } = createEditorTransport(client)
    await api.applyOps([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.two', position: { x: 10, y: 0 }, params: {} },
    ])

    const res = await api.saveGroup({
      id: 'g1',
      name: 'My Group',
      position: { x: 5, y: 0 },
      memberNodeIds: ['n1', 'n2'],
    })

    expect(res.status).toBe('ok')
    const group = await api.loadGroup('g1')
    expect(group?.name).toBe('My Group')
    expect(group?.nodes.map((n) => n.id).sort()).toEqual(['n1', 'n2'])
  })

  it('loadGroup with scope reads the on-disk library file before a stale in-graph copy', async () => {
    const client = createMockApiClient()
    client.__state.groups.set('lib-id', {
      id: 'lib-id',
      name: 'PathConnection (1)',
      nodes: [],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
      position: { x: 0, y: 0 },
    })
    client.loadGroupTemplate = vi.fn(async () => ({
      id: 'lib-id',
      name: 'PathConnection',
      nodes: [],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
      position: { x: 0, y: 0 },
    }))
    const { api } = createEditorTransport(client)

    const group = await api.loadGroup('lib-id', { scope: 'groups' })

    expect(group?.name).toBe('PathConnection')
    expect(client.loadGroupTemplate).toHaveBeenCalledWith('lib-id', { scope: 'groups' })
  })
})

describe('WsAdapter', () => {
  it('forwards graph:applied from the graph channel to editor listeners', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()

    const seen: Array<{ batchId: string; newHash: string }> = []
    ws.on('graph:applied', (p) => seen.push(p))

    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])

    expect(seen).toHaveLength(1)
    expect(seen[0].newHash).toBeTruthy()
  })

  it('forwards execution events (started / node output / completed)', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])

    const kinds: string[] = []
    ws.on('exec:started', () => kinds.push('started'))
    ws.on('node:output', () => kinds.push('output'))
    ws.on('exec:completed', () => kinds.push('completed'))

    await client.execute()

    expect(kinds).toEqual(['started', 'output', 'completed'])
  })

  it('dispose() stops forwarding events', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { ws } = createEditorTransport(client)
    ws.connect()
    const seen: unknown[] = []
    ws.on('graph:applied', (p) => seen.push(p))
    ws.dispose()

    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    expect(seen).toHaveLength(0)
  })
})

describe('diffPipelineToOps', () => {
  beforeEach(() => {
    /* pure function — no shared state */
  })

  it('emits createNode + connect for new graph, disconnect/deleteNode for removals', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One'), spec('a.two', 'Two')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.two', name: 'Two', position: { x: 1, y: 1 }, params: {} })
    // n1 dropped, n2 added.

    const ops = diffPipelineToOps(desired, current)
    const types = ops.map((o) => o.type).sort()
    expect(types).toEqual(['createNode', 'deleteNode'])
  })

  it('emits updateNode only when params or position change', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: { k: 1 } },
    ])
    const current = await client.getPipeline()

    const same = emptyPipeline()
    same.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: { k: 1 } })
    expect(diffPipelineToOps(same, current)).toEqual([])

    const changed = emptyPipeline()
    changed.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: { k: 2 } })
    const ops = diffPipelineToOps(changed, current)
    expect(ops).toEqual([{ type: 'updateNode', nodeId: 'n1', params: { k: 2 } }])
  })

  it('emits createGroup instead of deleting grouped members during persist', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({
      id: 'g1',
      batteryId: '__group__',
      name: 'Group Node',
      position: { x: 50, y: 0 },
      params: { groupId: 'g1' },
    })
    desired.groups = [{
      id: 'g1',
      name: 'Group Node',
      position: { x: 50, y: 0 },
      nodes: [
        { id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} },
        { id: 'n2', batteryId: 'a.one', name: 'One', position: { x: 100, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      exposedInputs: [],
      exposedOutputs: [{ portName: 'out__n2__out', portType: 'any', sourceNodeId: 'n2', sourcePortName: 'out' }],
    }]

    const ops = diffPipelineToOps(desired, current)

    expect(ops).toEqual([
      {
        type: 'createGroup',
        groupId: 'g1',
        name: 'Group Node',
        nameEn: undefined,
        position: { x: 50, y: 0 },
        memberNodeIds: ['n1', 'n2'],
        // Authoritative contract: the stable portName + its inner mapping. The
        // kernel honours the name verbatim instead of re-deriving from node ids.
        exposedPorts: {
          outputs: [{ portName: 'out__n2__out', portType: 'any', sourceNodeId: 'n2', sourcePortName: 'out' }],
        },
      },
    ])
  })

  it('select-nodes→group with external in/out edges keeps the group wired after persist', async () => {
    // Repro of the user-reported bug: grouping a battery that is ALREADY wired
    // (src -> A -> dst). The frontend (useCanvasGroup) deletes the originals and
    // adds redirect edges with NEW ids (`${id}_redir`) pointing at the group's
    // stable ports. The kernel must still end up with a group whose boundary
    // edges connect src -> g1/in_0 and g1/out_0 -> dst, with exposed ports typed
    // from the inner op (not `any`) — otherwise the group shows "any / no result"
    // and ungroup can't map the ports back.
    const client = createMockApiClient({
      ops: [{ id: 'a.io', name: 'IO', inputs: [{ name: 'in', type: 'scene' }], outputs: [{ name: 'out', type: 'scene' }], params: [], execute: () => null } as OpSpec],
    })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'src', opId: 'a.io', position: { x: -100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'A', opId: 'a.io', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'dst', opId: 'a.io', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'eSrcA', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'A', port: 'in' } },
      { type: 'connect', edgeId: 'eAdst', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'dst', port: 'in' } },
    ])
    const current = await client.getPipeline()

    // Desired = exactly what useCanvasGroup writes into the store: originals gone,
    // redirect edges with `_redir` ids onto the group's stable ports.
    const desired = emptyPipeline()
    desired.nodes.push({ id: 'src', batteryId: 'a.io', name: 'IO', position: { x: -100, y: 0 }, params: {} })
    desired.nodes.push({ id: 'dst', batteryId: 'a.io', name: 'IO', position: { x: 100, y: 0 }, params: {} })
    desired.nodes.push({ id: 'g1', batteryId: '__group__', name: 'Group Node', position: { x: 0, y: 0 }, params: { groupId: 'g1' } })
    desired.edges.push({ id: 'eSrcA_redir', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'g1', port: 'in_0' } })
    desired.edges.push({ id: 'eAdst_redir', source: { nodeId: 'g1', port: 'out_0' }, target: { nodeId: 'dst', port: 'in' } })
    desired.groups = [{
      id: 'g1', name: 'Group Node', position: { x: 0, y: 0 },
      nodes: [{ id: 'A', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} }],
      edges: [],
      exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'A', sourcePortName: 'in' }],
      exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'A', sourcePortName: 'out' }],
    }]

    const ops = diffPipelineToOps(desired, current)
    await client.applyBatch(ops)

    // The group's exposed ports must carry the correct inner mapping. (portType
    // is resolved by the real kernel's resolveBoundaryPort; the mock hardcodes
    // 'any', so we assert mapping + name here and leave type to the kernel test.)
    const group = await client.getGroup('g1')
    expect(group?.exposedInputs.map((p) => ({ portName: p.portName, sourceNodeId: p.sourceNodeId, sourcePortName: p.sourcePortName })))
      .toEqual([{ portName: 'in_0', sourceNodeId: 'A', sourcePortName: 'in' }])
    expect(group?.exposedOutputs.map((p) => ({ portName: p.portName, sourceNodeId: p.sourceNodeId, sourcePortName: p.sourcePortName })))
      .toEqual([{ portName: 'out_0', sourceNodeId: 'A', sourcePortName: 'out' }])

    // The kernel graph must still have boundary edges connecting the group to
    // src/dst — i.e. the group is NOT orphaned after persist.
    const reloaded = await client.getPipeline()
    const edgeList = Array.isArray(reloaded.edges) ? reloaded.edges : Object.values(reloaded.edges)
    const inEdge = edgeList.find((e) => e.target.nodeId === 'g1' && e.target.port === 'in_0')
    const outEdge = edgeList.find((e) => e.source.nodeId === 'g1' && e.source.port === 'out_0')
    expect(inEdge?.source).toEqual({ nodeId: 'src', port: 'out' })
    expect(outEdge?.target).toEqual({ nodeId: 'dst', port: 'in' })
  })

  it('ungroup emits a kernel `ungroup` op (not deleteGroup) and keeps boundary edges wired', async () => {
    // Repro of the user-reported ungroup-disconnect bug: a wired group
    // (src -> [A] -> dst) is expanded. The editor restores the inner node + the
    // boundary edges (ids = the kernel edge ids, `_redir` stripped). The diff
    // must emit the kernel-native `ungroup` (which restores inner nodes/edges and
    // rewrites boundary edges back to the inner ports IN PLACE) — NOT deleteGroup,
    // whose cascade would drop the boundary edges while the diff skipped re-adding
    // them (their ids already existed), leaving src/dst disconnected.
    const client = createMockApiClient({
      ops: [{ id: 'a.io', name: 'IO', inputs: [{ name: 'in', type: 'scene' }], outputs: [{ name: 'out', type: 'scene' }], params: [], execute: () => null } as OpSpec],
    })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'src', opId: 'a.io', position: { x: -100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'A', opId: 'a.io', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'dst', opId: 'a.io', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'eSrcA', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'A', port: 'in' } },
      { type: 'connect', edgeId: 'eAdst', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'dst', port: 'in' } },
      {
        type: 'createGroup', groupId: 'g1', name: 'Group Node', position: { x: 0, y: 0 }, memberNodeIds: ['A'],
        exposedPorts: {
          inputs: [{ portName: 'in_0', sourceNodeId: 'A', sourcePortName: 'in' }],
          outputs: [{ portName: 'out_0', sourceNodeId: 'A', sourcePortName: 'out' }],
        },
      },
    ])
    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()

    // Desired = what useCanvasGroup.ungroupNode writes: group gone, inner node A
    // restored top-level, boundary edges restored with the kernel ids.
    const desired = emptyPipeline()
    desired.nodes.push({ id: 'src', batteryId: 'a.io', name: 'IO', position: { x: -100, y: 0 }, params: {} })
    desired.nodes.push({ id: 'A', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} })
    desired.nodes.push({ id: 'dst', batteryId: 'a.io', name: 'IO', position: { x: 100, y: 0 }, params: {} })
    desired.edges.push({ id: 'eSrcA', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'A', port: 'in' } })
    desired.edges.push({ id: 'eAdst', source: { nodeId: 'A', port: 'out' }, target: { nodeId: 'dst', port: 'in' } })
    desired.groups = []

    const ops = diffPipelineToOps(desired, current, currentGroups)
    expect(ops).toContainEqual({ type: 'ungroup', groupId: 'g1' })
    expect(ops.some((o) => o.type === 'deleteGroup')).toBe(false)
    // No redundant createNode for the restored inner node, no redundant connect
    // for boundary edges (the kernel ungroup restores/rewrites them in place).
    expect(ops.some((o) => o.type === 'createNode' && o.nodeId === 'A')).toBe(false)
    expect(ops.some((o) => o.type === 'connect')).toBe(false)

    await client.applyBatch(ops)

    const reloaded = await client.getPipeline()
    const edgeList = Array.isArray(reloaded.edges) ? reloaded.edges : Object.values(reloaded.edges)
    // Boundary edges now point directly at the restored inner node A.
    expect(edgeList.find((e) => e.target.nodeId === 'A' && e.target.port === 'in')?.source).toEqual({ nodeId: 'src', port: 'out' })
    expect(edgeList.find((e) => e.source.nodeId === 'A' && e.source.port === 'out')?.target).toEqual({ nodeId: 'dst', port: 'in' })
    // The group is gone.
    expect(await client.getGroup('g1')).toBeNull()
  })

  it('ungrouping an outer group does NOT re-emit createGroup/createNode for a restored NESTED shadow', async () => {
    // Repro of the nested-ungroup collision: g_outer contains a plain node P and
    // a NESTED group shadow g_inner. At create time the kernel deleted g_inner
    // from the top-level graph (it lives inside g_outer.nodes). When the user
    // ungroups g_outer, the kernel `ungroup` op restores both P and the g_inner
    // shadow as top-level nodes — and g_inner's flat-registry entry persists.
    // Because g_inner is absent from the top-level `current.nodes` snapshot, the
    // classification loop must NOT mistake it for a brand-new group and emit a
    // redundant `createGroup g_inner` (the kernel rejects it as already-exists).
    const client = createMockApiClient({ ops: [spec('a.io', 'IO')] })

    // Hand-build the kernel snapshot: only g_outer is a top-level node. g_inner
    // is a nested shadow inside g_outer's group.nodes, NOT a top-level node.
    const st = client.__state
    st.nodes.set('g_outer', { id: 'g_outer', opId: '__group__', name: 'Outer', position: { x: 0, y: 0 }, params: {} })
    // Flat registry: g_outer references g_inner via the nested shadow; g_inner is
    // a first-class sub-group entry that survives ungroup of g_outer.
    st.groups.set('g_outer', {
      id: 'g_outer',
      name: 'Outer',
      position: { x: 0, y: 0 },
      nodes: [
        { id: 'P', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} },
        { id: 'g_inner', batteryId: '__group__', name: 'Inner', position: { x: 20, y: 0 }, params: { groupId: 'g_inner' } },
      ] as unknown as GraphNode[],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
    } as unknown as KernelNodeGroup)
    st.groups.set('g_inner', {
      id: 'g_inner',
      name: 'Inner',
      position: { x: 20, y: 0 },
      nodes: [
        { id: 'Q', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} },
      ] as unknown as GraphNode[],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
    } as unknown as KernelNodeGroup)

    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()
    // Sanity: g_inner is genuinely absent from the top-level node snapshot.
    expect(current?.nodes['g_inner']).toBeUndefined()
    expect(current?.nodes['g_outer']?.opId).toBe('__group__')

    // Desired = what ungroupNode writes when the user ungroups g_outer: g_outer
    // shadow is gone; its members (P + the g_inner shadow) are promoted to
    // top-level desired nodes. g_inner's group entry remains; g_outer's does not.
    const desired = emptyPipeline()
    desired.nodes.push({ id: 'P', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} })
    desired.nodes.push({ id: 'g_inner', batteryId: '__group__', name: 'Inner', position: { x: 20, y: 0 }, params: { groupId: 'g_inner' } })
    desired.groups = [{
      id: 'g_inner',
      name: 'Inner',
      nameEn: undefined,
      position: { x: 20, y: 0 },
      nodes: [
        { id: 'Q', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} },
      ],
      edges: [],
      exposedInputs: [],
      exposedOutputs: [],
    }]

    const ops = diffPipelineToOps(desired, current, currentGroups)

    // The outer group is expanded via the kernel-native `ungroup` op.
    expect(ops).toContainEqual({ type: 'ungroup', groupId: 'g_outer' })
    // THE BUG: no redundant createGroup for the restored nested shadow.
    expect(ops.some((o) => o.type === 'createGroup' && o.groupId === 'g_inner')).toBe(false)
    // …and no redundant createNode for the nested shadow either.
    expect(ops.some((o) => o.type === 'createNode' && o.nodeId === 'g_inner')).toBe(false)
    // …nor for the other restored plain member P (kernel ungroup restores it).
    expect(ops.some((o) => o.type === 'createNode' && o.nodeId === 'P')).toBe(false)
  })

  it('nesting two EXISTING groups into a new parent does NOT deleteGroup the children', async () => {
    // Repro of the "nest group batteries → op validation failed / no result" bug.
    // The canvas holds two existing group shadows (c1, c2). The user selects them
    // and groups them into a new parent P. P's members are the two child shadows.
    //
    // THE BUG: the deleted-group pass saw c1/c2 absent from the top-level desired
    // nodes (they now live inside P.group.nodes) and emitted `deleteGroup c1/c2`
    // BEFORE the parent's `createGroup` — so by the time createGroup P ran, its
    // members no longer existed → "member c1 does not exist". Nesting must instead
    // PRESERVE the children (flat registry keeps their entries; P references them).
    const client = createMockApiClient({ ops: [spec('a.io', 'IO')] })
    const st = client.__state
    for (const cid of ['c1', 'c2']) {
      st.nodes.set(cid, { id: cid, opId: '__group__', name: cid, position: { x: 0, y: 0 }, params: { groupId: cid } } as unknown as GraphNode)
      st.groups.set(cid, {
        id: cid,
        name: cid,
        position: { x: 0, y: 0 },
        nodes: [{ id: `${cid}_inner`, batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} }] as unknown as GraphNode[],
        edges: [],
        exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: `${cid}_inner`, sourcePortName: 'in' }],
        exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: `${cid}_inner`, sourcePortName: 'out' }],
      } as unknown as KernelNodeGroup)
    }

    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()

    // Desired = the two child shadows nested as members of a brand-new parent P.
    const desired = emptyPipeline()
    desired.nodes.push({ id: 'P', batteryId: '__group__', name: 'Parent', position: { x: 0, y: 0 }, params: { groupId: 'P' } })
    desired.groups = [
      // The children's own entries survive (flat registry, nesting by reference).
      { id: 'c1', name: 'c1', position: { x: 0, y: 0 }, nodes: [{ id: 'c1_inner', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} }], edges: [], exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'c1_inner', sourcePortName: 'in' }], exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'c1_inner', sourcePortName: 'out' }] },
      { id: 'c2', name: 'c2', position: { x: 0, y: 0 }, nodes: [{ id: 'c2_inner', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: {} }], edges: [], exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'c2_inner', sourcePortName: 'in' }], exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'c2_inner', sourcePortName: 'out' }] },
      // The new parent wrapping both child shadows.
      {
        id: 'P', name: 'Parent', position: { x: 0, y: 0 },
        nodes: [
          { id: 'c1', batteryId: '__group__', name: 'c1', position: { x: 0, y: 0 }, params: { groupId: 'c1' } },
          { id: 'c2', batteryId: '__group__', name: 'c2', position: { x: 0, y: 0 }, params: { groupId: 'c2' } },
        ],
        edges: [],
        exposedInputs: [
          { portName: 'in_0', portType: 'scene', sourceNodeId: 'c1', sourcePortName: 'in_0' },
          { portName: 'in_1', portType: 'scene', sourceNodeId: 'c2', sourcePortName: 'in_0' },
        ],
        exposedOutputs: [
          { portName: 'out_0', portType: 'scene', sourceNodeId: 'c1', sourcePortName: 'out_0' },
          { portName: 'out_1', portType: 'scene', sourceNodeId: 'c2', sourcePortName: 'out_0' },
        ],
      },
    ]

    const ops = diffPipelineToOps(desired, current, currentGroups)

    // THE BUG: the children must NOT be deleted — they become nested members.
    expect(ops.some((o) => o.type === 'deleteGroup' && (o.groupId === 'c1' || o.groupId === 'c2'))).toBe(false)
    // The parent group is created, referencing the existing child shadows.
    const createP = ops.find((o) => o.type === 'createGroup' && o.groupId === 'P')
    expect(createP).toBeTruthy()
    expect((createP as Extract<Op, { type: 'createGroup' }>).memberNodeIds).toEqual(['c1', 'c2'])

    // And the batch validates cleanly against the real kernel (member exists).
    const res = await client.applyBatch(ops)
    expect(res.status).toBe('ok')
  })

  it('persists a NESTED group (dropped template) child-first so its sub-graph survives in the flat registry', async () => {
    // Drop-a-template-with-nested-children path. The parent P is brand-new (no
    // kernel shadow yet) and one of its MEMBERS is a __group__ shadow C that is
    // ALSO brand-new — C lives only in desired.groups, with NO top-level shadow
    // of its own (its shadow sits inside P.nodes). The kernel flat registry must
    // end up holding BOTH P and C: the inner view resolves a member group
    // strictly by params.groupId against that registry, so if C is never
    // createGroup'd it renders as nothing inside P (the reported template bug).
    // The diff must emit a child-first createGroup (C before P), mirroring the
    // backend buildTemplateOps.
    const client = createMockApiClient({ ops: [spec('a.io', 'IO')] })
    const current = await client.getPipeline() // empty kernel
    const currentGroups = await client.listGroups() // []

    const desired = emptyPipeline()
    // Only the ROOT gets a top-level shadow; the child shadow lives inside P.nodes.
    desired.nodes.push({ id: 'P', batteryId: '__group__', name: 'Parent', position: { x: 0, y: 0 }, params: { groupId: 'P' } })
    desired.groups = [
      // Child group C — kernel invariant: its member shadow id === C's group id.
      {
        id: 'C', name: 'Child', position: { x: 0, y: 0 },
        nodes: [{ id: 'c_inner', batteryId: 'a.io', name: 'IO', position: { x: 0, y: 0 }, params: { k: 1 } }],
        edges: [],
        exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'c_inner', sourcePortName: 'in' }],
        exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'c_inner', sourcePortName: 'out' }],
      },
      // Parent P wraps the child shadow C as a member.
      {
        id: 'P', name: 'Parent', position: { x: 0, y: 0 },
        nodes: [{ id: 'C', batteryId: '__group__', name: 'Child', position: { x: 0, y: 0 }, params: { groupId: 'C' } }],
        edges: [],
        exposedInputs: [{ portName: 'in_0', portType: 'scene', sourceNodeId: 'C', sourcePortName: 'in_0' }],
        exposedOutputs: [{ portName: 'out_0', portType: 'scene', sourceNodeId: 'C', sourcePortName: 'out_0' }],
      },
    ]

    const ops = diffPipelineToOps(desired, current, currentGroups)

    // Child-first: createGroup C must precede createGroup P.
    const idxC = ops.findIndex((o) => o.type === 'createGroup' && o.groupId === 'C')
    const idxP = ops.findIndex((o) => o.type === 'createGroup' && o.groupId === 'P')
    expect(idxC).toBeGreaterThanOrEqual(0)
    expect(idxP).toBeGreaterThan(idxC)
    // The child shadow must NOT be created as a plain node (that would strand its
    // sub-graph with no group entry).
    expect(ops.some((o) => o.type === 'createNode' && o.nodeId === 'C')).toBe(false)
    // The parent references the child shadow by id as a member.
    expect((ops.find((o) => o.type === 'createGroup' && o.groupId === 'P') as Extract<Op, { type: 'createGroup' }>).memberNodeIds).toEqual(['C'])

    // Applying the batch registers BOTH groups in the flat registry, so the
    // inner view's lookup-by-groupId now succeeds for the nested child.
    const res = await client.applyBatch(ops)
    expect(res.status).toBe('ok')
    const ids = (await client.listGroups()).map((g) => g.id).sort()
    expect(ids).toContain('C')
    expect(ids).toContain('P')
  })

  it('carries the authoritative exposed-port contract in createGroup when a saved group is dropped', async () => {
    // Simulate dragging a saved group template back onto the canvas: the group
    // arrives with a persisted overlay (hidden/order/customLabel), a custom
    // name, and STABLE portNames (minted once at the group's birth — they do
    // NOT encode the inner node id, so they survive the id remap unchanged).
    // The emitted createGroup must hand the kernel that stable portName as the
    // boundary identity together with the (remapped) inner mapping, so boundary
    // edges / overlay / exec all line up — the fix for the drop-a-saved-group
    // "ports disconnect / no result" bug.
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'src', opId: 'a.one', position: { x: -100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'dst', opId: 'a.one', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
      { type: 'connect', edgeId: 'es1', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'n1', port: 'in' } },
      { type: 'connect', edgeId: 'e2d', source: { nodeId: 'n2', port: 'out' }, target: { nodeId: 'dst', port: 'in' } },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({
      id: 'src', batteryId: 'a.one', name: 'One', position: { x: -100, y: 0 }, params: {},
    })
    desired.nodes.push({
      id: 'dst', batteryId: 'a.one', name: 'One', position: { x: 200, y: 0 }, params: {},
    })
    desired.nodes.push({
      id: 'g1',
      batteryId: '__group__',
      name: 'My Custom Group',
      position: { x: 50, y: 0 },
      params: { groupId: 'g1' },
    })
    // Canvas edges reference the STABLE portNames (in_0 / out_0) — exactly the
    // names carried on the exposed ports. They never need re-keying. Use fresh
    // edge ids (not present in the kernel) to mirror drag-out + connect.
    desired.edges.push({ id: 'e_bound_in', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'g1', port: 'in_0' } })
    desired.edges.push({ id: 'e_bound_out', source: { nodeId: 'g1', port: 'out_0' }, target: { nodeId: 'dst', port: 'in' } })
    desired.groups = [{
      id: 'g1',
      name: 'My Custom Group',
      nameEn: 'My Custom Group',
      position: { x: 50, y: 0 },
      nodes: [
        { id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} },
        { id: 'n2', batteryId: 'a.one', name: 'One', position: { x: 100, y: 0 }, params: {} },
      ],
      edges: [{ id: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } }],
      // Stable portName + correct inner mapping + overlay.
      exposedInputs: [
        { portName: 'in_0', portType: 'any', sourceNodeId: 'n1', sourcePortName: 'in', hidden: true, customLabel: '隐藏槽' },
      ],
      exposedOutputs: [
        { portName: 'out_0', portType: 'any', sourceNodeId: 'n2', sourcePortName: 'out', order: 3 },
      ],
    }]

    const ops = diffPipelineToOps(desired, current)
    const createOp = ops.find((o) => o.type === 'createGroup')
    expect(createOp).toMatchObject({
      type: 'createGroup',
      groupId: 'g1',
      name: 'My Custom Group',
      nameEn: 'My Custom Group',
      exposedPorts: {
        inputs: [{ portName: 'in_0', sourceNodeId: 'n1', sourcePortName: 'in', hidden: true, customLabel: '隐藏槽' }],
        outputs: [{ portName: 'out_0', sourceNodeId: 'n2', sourcePortName: 'out', order: 3 }],
      },
    })
    // Boundary wires must survive the same persist as the brand-new group shadow
    // (emitted after createGroup, not skipped by the upfront edge loop).
    expect(ops).toEqual(
      expect.arrayContaining([
        { type: 'connect', edgeId: 'e_bound_in', source: { nodeId: 'src', port: 'out' }, target: { nodeId: 'g1', port: 'in_0' } },
        { type: 'connect', edgeId: 'e_bound_out', source: { nodeId: 'g1', port: 'out_0' }, target: { nodeId: 'dst', port: 'in' } },
      ]),
    )

    // Apply through the mock kernel; the contract's stable names + overlay must
    // land — proving the round-trip restores wiring + hide/label/order + name.
    await client.applyBatch(ops)
    const group = await client.getGroup('g1')
    expect(group?.name).toBe('My Custom Group')
    const inPort = group?.exposedInputs.find((p) => p.portName === 'in_0')
    expect(inPort?.hidden).toBe(true)
    expect(inPort?.customLabel).toBe('隐藏槽')
    expect(group?.exposedOutputs.find((p) => p.portName === 'out_0')?.order).toBe(3)
  })

  it('persists a renamed group through diff -> updateGroup even when the shadow node name is stale', async () => {
    // Real "save group as ttt" path: GroupSaveDialog calls renameGroup(groupId,
    // name), which updates ONLY currentPipeline.groups[].name — the `__group__`
    // shadow node keeps its old `name` (e.g. the default "Group Node"). On the
    // next persist the diff must treat the NodeGroup as the name authority (SSOT)
    // and emit updateGroup({ name }); otherwise the live kernel group keeps the
    // stale name and a later drag-out (loadGroup -> getGroup) shows "Group Node".
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createGroup', groupId: 'g1', name: 'Group Node', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()

    // Desired = post-rename editor state: group.name = 'ttt', shadow node.name
    // still the stale default (renameGroup never touches the shadow node).
    const desired = emptyPipeline()
    desired.nodes.push({ id: 'g1', batteryId: '__group__', name: 'Group Node', position: { x: 50, y: 0 }, params: { groupId: 'g1' } })
    desired.groups = [{ ...(currentGroups[0]!), name: 'ttt' }]

    const ops = diffPipelineToOps(desired, current, currentGroups)
    expect(ops).toEqual([{ type: 'updateGroup', groupId: 'g1', name: 'ttt' }])

    // Round-trip: the live kernel group now reads back the custom name, so a
    // drag-out via loadGroup -> getGroup would surface 'ttt', not 'Group Node'.
    await client.applyBatch(ops)
    const reloaded = await client.getGroup('g1')
    expect(reloaded?.name).toBe('ttt')
  })

  it('emits deleteGroup when an existing group shadow is removed', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createGroup', groupId: 'g1', name: 'Group Node', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.groups = []

    expect(diffPipelineToOps(desired, current)).toEqual([{ type: 'deleteGroup', groupId: 'g1' }])
  })

  it('emits updateGroup(exposedPorts) when a group port overlay changes vs current', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'sink', opId: 'a.one', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
      { type: 'connect', edgeId: 'e2s', source: { nodeId: 'n2', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
      { type: 'createGroup', groupId: 'g1', name: 'G', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const current = await client.getPipeline()
    const currentGroups = await client.listGroups()
    const liveGroup = currentGroups[0]!
    const outName = liveGroup.exposedOutputs[0]!.portName

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'g1', batteryId: '__group__', name: 'G', position: { x: 50, y: 0 }, params: { groupId: 'g1' } })
    desired.nodes.push({ id: 'sink', batteryId: 'a.one', name: 'One', position: { x: 200, y: 0 }, params: {} })
    desired.edges.push({ id: 'e2s', source: { nodeId: 'g1', port: outName }, target: { nodeId: 'sink', port: 'in' } })
    desired.groups = [{
      ...liveGroup,
      exposedOutputs: liveGroup.exposedOutputs.map((p) => ({ ...p, hidden: true, order: 5 })),
    }]

    const ops = diffPipelineToOps(desired, current, currentGroups)
    expect(ops).toEqual([
      { type: 'updateGroup', groupId: 'g1', exposedPorts: { outputs: [{ portName: outName, hidden: true, order: 5 }] } },
    ])
  })

  it('skips updateGroup when the group port overlay is unchanged vs current', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'sink', opId: 'a.one', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
      { type: 'connect', edgeId: 'e2s', source: { nodeId: 'n2', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
      { type: 'createGroup', groupId: 'g1', name: 'G', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const currentGroups = await client.listGroups()
    // Apply a hide once so current already carries the overlay.
    const outName = currentGroups[0]!.exposedOutputs[0]!.portName
    await client.applyBatch([
      { type: 'updateGroup', groupId: 'g1', exposedPorts: { outputs: [{ portName: outName, hidden: true }] } },
    ])
    const groupsAfter = await client.listGroups()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'g1', batteryId: '__group__', name: 'G', position: { x: 50, y: 0 }, params: { groupId: 'g1' } })
    desired.nodes.push({ id: 'sink', batteryId: 'a.one', name: 'One', position: { x: 200, y: 0 }, params: {} })
    desired.edges.push({ id: 'e2s', source: { nodeId: 'g1', port: outName }, target: { nodeId: 'sink', port: 'in' } })
    desired.groups = [{ ...groupsAfter[0]! }]

    expect(diffPipelineToOps(desired, await client.getPipeline(), groupsAfter)).toEqual([])
  })

  it('group port overlay round-trips through updatePipeline → getGroup', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { api } = createEditorTransport(client)
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'sink', opId: 'a.one', position: { x: 200, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
      { type: 'connect', edgeId: 'e2s', source: { nodeId: 'n2', port: 'out' }, target: { nodeId: 'sink', port: 'in' } },
      { type: 'createGroup', groupId: 'g1', name: 'G', position: { x: 50, y: 0 }, memberNodeIds: ['n1', 'n2'] },
    ])
    const live = (await client.listGroups())[0]!
    const outName = live.exposedOutputs[0]!.portName

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'g1', batteryId: '__group__', name: 'G', position: { x: 50, y: 0 }, params: { groupId: 'g1' } })
    desired.nodes.push({ id: 'sink', batteryId: 'a.one', name: 'One', position: { x: 200, y: 0 }, params: {} })
    desired.edges.push({ id: 'e2s', source: { nodeId: 'g1', port: outName }, target: { nodeId: 'sink', port: 'in' } })
    desired.groups = [{ ...live, exposedOutputs: live.exposedOutputs.map((p) => ({ ...p, hidden: true })) }]

    const res = await api.updatePipeline(desired)
    expect(res.status).toBe('ok')

    const reloaded = await client.getGroup('g1')
    expect(reloaded!.exposedOutputs.find((p) => p.portName === outName)!.hidden).toBe(true)
  })

  it('emits setMetadata for annotations when they change', () => {
    const desired = emptyPipeline()
    desired.annotations = [
      { id: 'ann1', text: 'Hello', position: { x: 10, y: 20 }, width: 200, height: 80 },
    ]

    const ops = diffPipelineToOps(desired, null)
    const metaOps = ops.filter((o) => o.type === 'setMetadata') as Array<
      Extract<(typeof ops)[number], { type: 'setMetadata' }>
    >
    const annOp = metaOps.find((o) => o.key === 'annotations')
    expect(annOp).toBeDefined()
    expect(annOp!.value).toEqual([
      { id: 'ann1', text: 'Hello', position: { x: 10, y: 20 }, width: 200, height: 80 },
    ])
  })

  it('annotations round-trip through updatePipeline → getPipeline', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const { api } = createEditorTransport(client)

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} })
    desired.annotations = [
      { id: 'ann1', text: 'Note A', position: { x: 10, y: 20 }, width: 300, height: 60 },
      { id: 'ann2', text: 'Note B', position: { x: 50, y: 80 } },
    ]

    const res = await api.updatePipeline(desired)
    expect(res.status).toBe('ok')

    const loaded = await api.getPipeline()
    expect(loaded).not.toBeNull()
    expect(loaded!.annotations).toEqual([
      { id: 'ann1', text: 'Note A', position: { x: 10, y: 20 }, width: 300, height: 60 },
      { id: 'ann2', text: 'Note B', position: { x: 50, y: 80 } },
    ])
  })

  it('skips setMetadata when annotations are unchanged', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    const annotations = [{ id: 'ann1', text: 'Stable', position: { x: 0, y: 0 } }]

    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'setMetadata', key: 'annotations', value: annotations },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n1', batteryId: 'a.one', name: 'One', position: { x: 0, y: 0 }, params: {} })
    desired.annotations = annotations

    expect(diffPipelineToOps(desired, current)).toEqual([])
  })

  it('does not disconnect edges that deleteNode already removes by cascade', async () => {
    const client = createMockApiClient({ ops: [spec('a.one', 'One')] })
    await client.applyBatch([
      { type: 'createNode', nodeId: 'n1', opId: 'a.one', position: { x: 0, y: 0 }, params: {} },
      { type: 'createNode', nodeId: 'n2', opId: 'a.one', position: { x: 100, y: 0 }, params: {} },
      { type: 'connect', edgeId: 'e12', source: { nodeId: 'n1', port: 'out' }, target: { nodeId: 'n2', port: 'in' } },
    ])
    const current = await client.getPipeline()

    const desired = emptyPipeline()
    desired.nodes.push({ id: 'n2', batteryId: 'a.one', name: 'Two', position: { x: 100, y: 0 }, params: {} })

    expect(diffPipelineToOps(desired, current)).toEqual([{ type: 'deleteNode', nodeId: 'n1' }])
  })
})
