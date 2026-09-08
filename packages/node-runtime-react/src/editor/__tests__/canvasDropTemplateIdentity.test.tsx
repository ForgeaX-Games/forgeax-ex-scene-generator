// Drop-path identity tests.
//
// Regression: `batteries/groups/` (develop copy) and `batteries/templates/`
// (published copy) are physically separate files that legitimately share a
// group id, so the catalog holds two rows under that id. The palette shipped
// only the bare id through `dataTransfer`, and the drop resolved it with a
// `find(b => b.id === …)` that returned whichever row sorted first — always the
// groups one. The dropped node then loaded the develop copy's graph, lost the
// template lock, and rendered teal instead of purple.
//
// These pin the fix: the drag carries `catalogBatteryKey` (the sourcePath) so
// the drop resolves the exact row the user dragged.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { Node, ReactFlowInstance } from '../xyflow.js'

import { createMockApiClient } from '../../test/mockApiClient.js'
import { configureEditorTransport, createEditorTransport } from '../transport/index.js'
import { usePipelineStore } from '../stores/pipelineStore.js'
import { useHistoryStore } from '../stores/historyStore.js'
import { createEmptyPipeline } from '../stores/pipelineStore.helpers.js'
import { useCanvasDrop } from '../components/canvas/useCanvasDrop.js'
import type { Battery } from '../types.js'

const DUP_ID = 'group_dup_id'

const groupsRow: Battery = {
  id: DUP_ID,
  name: 'PathConnection',
  type: 'group',
  category: 'scene',
  displayGroup: 'groups/scene',
  description: '',
  version: '1.0.0',
  inputs: [],
  outputs: [],
  params: [],
  sourcePath: 'batteries/groups/scene/PathConnection/PathConnection.json',
}

const templatesRow: Battery = {
  ...groupsRow,
  category: 'structures',
  displayGroup: 'templates/structures',
  sourcePath: 'batteries/templates/structures/path/PathConnection/PathConnection.json',
}

let loadGroupTemplate: ReturnType<typeof vi.fn>

beforeEach(() => {
  loadGroupTemplate = vi.fn(async (groupId: string) => ({
    id: groupId,
    name: 'PathConnection',
    nodes: [],
    edges: [],
    position: { x: 0, y: 0 },
    exposedInputs: [],
    exposedOutputs: [],
  }))
  const client = createMockApiClient({ ops: [] })
  client.loadGroupTemplate = loadGroupTemplate as unknown as typeof client.loadGroupTemplate
  configureEditorTransport(createEditorTransport(client))
  usePipelineStore.setState({
    // Catalog order mirrors the backend sort (category A→Z), which puts the
    // groups row first for every colliding id under `scene`.
    batteries: [groupsRow, templatesRow],
    currentPipeline: createEmptyPipeline(),
    selectedNode: null,
    selectedNodeIds: [],
    groupViewStack: [],
    logs: [],
    nodeOutputs: {},
  })
  useHistoryStore.setState({ entries: [], cursor: 0, _redoTip: null })
})

afterEach(() => {
  usePipelineStore.setState({ currentPipeline: null })
})

function dropEvent(payload: Record<string, string>): React.DragEvent {
  return {
    preventDefault: () => {},
    stopPropagation: () => {},
    timeStamp: Math.random(),
    clientX: 100,
    clientY: 100,
    dataTransfer: { getData: (key: string) => payload[key] ?? '' },
  } as unknown as React.DragEvent
}

async function drop(payload: Record<string, string>): Promise<Node[]> {
  let nodes: Node[] = []
  const setNodes = (updater: Node[] | ((n: Node[]) => Node[])) => {
    nodes = typeof updater === 'function' ? (updater as (n: Node[]) => Node[])(nodes) : updater
  }
  const reactFlowInstance = {
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
  } as unknown as ReactFlowInstance

  const { result } = renderHook(() =>
    useCanvasDrop({ reactFlowInstance, setNodes: setNodes as React.Dispatch<React.SetStateAction<Node[]>> }),
  )
  await act(async () => {
    result.current.onDrop(dropEvent(payload))
    await Promise.resolve()
    await Promise.resolve()
  })
  return nodes
}

describe('drop resolves the exact catalog row that was dragged', () => {
  it('a templates row wins over a same-id groups row that sorts first', async () => {
    const nodes = await drop({
      'application/battery-id': DUP_ID,
      'application/battery-key': templatesRow.sourcePath!,
    })

    expect(loadGroupTemplate).toHaveBeenCalledWith(DUP_ID, { scope: 'templates' })
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.data?.isTemplate).toBe(true)
  })

  it('a groups row still resolves to the develop copy', async () => {
    const nodes = await drop({
      'application/battery-id': DUP_ID,
      'application/battery-key': groupsRow.sourcePath!,
    })

    expect(loadGroupTemplate).toHaveBeenCalledWith(DUP_ID, { scope: 'groups' })
    expect(nodes[0]?.data?.isTemplate).toBe(false)
  })

  it('falls back to the id when the drag carries no key (legacy payload)', async () => {
    const nodes = await drop({ 'application/battery-id': DUP_ID })

    expect(loadGroupTemplate).toHaveBeenCalledWith(DUP_ID, { scope: 'groups' })
    expect(nodes).toHaveLength(1)
  })
})
