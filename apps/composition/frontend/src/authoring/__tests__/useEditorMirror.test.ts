/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { EditorBridge, EditorMirrorSnapshot } from '@forgeax/node-runtime-react/editor'

const SNAP: EditorMirrorSnapshot = {
  history: { entries: [], cursor: 0 },
  status: {
    connectionStatus: 'connected',
    pipelineStatus: 'idle',
    selectedNodeName: null,
    selectedNodeBatteryId: null,
    nodeCount: 0,
    edgeCount: 0,
  },
  stats: {
    batteryCount: 2,
    edgeCount: 1,
    groupCount: 0,
    annotationCount: 0,
    frameCount: 0,
    selectedCount: 0,
  },
  selectedNode: null,
}

const createdBridges: EditorBridge[] = []
let stateHandler: ((snapshot: EditorMirrorSnapshot) => void) | null = null

vi.mock('@forgeax/node-runtime-react/editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@forgeax/node-runtime-react/editor')>()
  return {
    ...mod,
    createEditorBridge: vi.fn(() => {
      const bridge: EditorBridge = {
        publishState: vi.fn(),
        onState: vi.fn((cb) => {
          stateHandler = cb
          return () => {
            if (stateHandler === cb) stateHandler = null
          }
        }),
        sendCommand: vi.fn(),
        onCommand: vi.fn(() => () => {}),
        close: vi.fn(),
      }
      createdBridges.push(bridge)
      return bridge
    }),
  }
})

import { resetEditorMirrorRegistryForTests, useEditorMirror } from '../useEditorMirror.js'

beforeEach(() => {
  createdBridges.length = 0
  stateHandler = null
  resetEditorMirrorRegistryForTests()
})

afterEach(() => {
  cleanup()
  resetEditorMirrorRegistryForTests()
})

describe('useEditorMirror', () => {
  it('requests state on first subscription', () => {
    renderHook(() => useEditorMirror('mirror-test-key'))
    expect(createdBridges).toHaveLength(1)
    expect(createdBridges[0]?.sendCommand).toHaveBeenCalledWith({ type: 'request-state' })
  })

  it('shares one bridge when multiple hooks use the same syncKey', () => {
    const first = renderHook(() => useEditorMirror('mirror-shared'))
    const second = renderHook(() => useEditorMirror('mirror-shared'))

    expect(createdBridges).toHaveLength(1)
    expect(first.result.current.bridgeRef.current).toBe(second.result.current.bridgeRef.current)

    first.unmount()
    expect(createdBridges[0]?.close).not.toHaveBeenCalled()

    second.unmount()
    expect(createdBridges[0]?.close).toHaveBeenCalledTimes(1)
  })

  it('creates separate bridges for different sync keys', () => {
    const a = renderHook(() => useEditorMirror('mirror-a'))
    const b = renderHook(() => useEditorMirror('mirror-b'))

    expect(createdBridges).toHaveLength(2)
    expect(a.result.current.bridgeRef.current).not.toBe(b.result.current.bridgeRef.current)

    a.unmount()
    b.unmount()
    expect(createdBridges[0]?.close).toHaveBeenCalledTimes(1)
    expect(createdBridges[1]?.close).toHaveBeenCalledTimes(1)
  })

  it('delivers mirror snapshots to subscribers', async () => {
    const { result } = renderHook(() => useEditorMirror('mirror-snap'))
    expect(result.current.mirror).toBeNull()

    stateHandler?.(SNAP)

    await waitFor(() => {
      expect(result.current.mirror?.stats.batteryCount).toBe(2)
    })
  })
})
