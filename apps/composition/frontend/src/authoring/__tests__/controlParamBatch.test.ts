import { describe, expect, it, vi } from 'vitest'
import { applyControlParamBatch, type ControlParamStore } from '../controlParamBatch'

function storeWith(
  nodes: Array<{ id: string; params: Record<string, unknown> }>,
  execute: ControlParamStore['incrementalExecute'],
): ControlParamStore & { pipeline: { nodes: typeof nodes } } {
  const pipeline = { nodes }
  return {
    pipeline,
    get currentPipeline() { return pipeline },
    updateNodeParam: (nodeId, key, value) => {
      const node = pipeline.nodes.find((n) => n.id === nodeId)
      if (node) node.params[key] = value
    },
    incrementalExecute: execute,
  }
}

describe('applyControlParamBatch', () => {
  it('persists every touched node then runs one full pipeline', async () => {
    const execute = vi.fn(async () => ({
      executionId: 'e',
      status: 'completed' as const,
      outputs: {},
      durationMs: 1,
    }))
    const persistNodes = vi.fn(async () => {})
    const store = storeWith([
      { id: 'heightfield', params: { seed: 79 } },
      { id: 'river', params: { points: [[1, 2]] } },
    ], execute)

    const result = await applyControlParamBatch(store, [
      { nodeId: 'heightfield', key: 'seed', value: 27 },
      { nodeId: 'river', key: 'points', value: [[0, 52]] },
    ], { persistNodes })

    expect(result.ok).toBe(true)
    expect(store.pipeline.nodes[0]!.params.seed).toBe(27)
    expect(store.pipeline.nodes[1]!.params.points).toEqual([[0, 52]])
    expect(persistNodes).toHaveBeenCalledTimes(1)
    expect(persistNodes.mock.calls[0]![0]).toEqual([
      { id: 'heightfield', params: { seed: 27 } },
      { id: 'river', params: { points: [[0, 52]] } },
    ])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('heightfield', true, { persist: false, localParamEdit: true })
  })

  it('rolls every key back and re-runs the full pipeline when execute fails', async () => {
    const execute = vi.fn(async () => undefined)
    const persistNodes = vi.fn(async () => {})
    const store = storeWith([
      { id: 'heightfield', params: { seed: 79 } },
      { id: 'river', params: { points: [[1, 2]] } },
    ], execute)

    const result = await applyControlParamBatch(store, [
      { nodeId: 'heightfield', key: 'seed', value: 27 },
      { nodeId: 'river', key: 'points', value: [[0, 52]] },
    ], { persistNodes })

    expect(result.ok).toBe(false)
    expect(result.error).toBe('This edit failed. The previous value was restored.')
    expect(store.pipeline.nodes[0]!.params.seed).toBe(79)
    expect(store.pipeline.nodes[1]!.params.points).toEqual([[1, 2]])
    expect(persistNodes).toHaveBeenCalledTimes(2)
    expect(persistNodes.mock.calls[1]![0]).toEqual([
      { id: 'heightfield', params: { seed: 79 } },
      { id: 'river', params: { points: [[1, 2]] } },
    ])
    expect(execute).toHaveBeenCalledTimes(2)
  })
})
