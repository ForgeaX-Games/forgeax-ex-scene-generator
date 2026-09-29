/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useEffect } from 'react'

import type { HttpApiClient, SceneScriptDiagnostic } from '../../api/HttpApiClient.js'

const projectState = { viewingProjectId: 'p1' as string | null }

vi.mock('@forgeax/node-runtime-react/editor', () => ({
  useProjectStore: Object.assign(
    (selector: (state: typeof projectState) => unknown) => selector(projectState),
    { getState: () => projectState },
  ),
}))

import { publishSceneScriptDiagnostics } from '../sceneScriptDiagnosticBridge.js'
import { usePublishSceneRunDiagnostics } from '../usePublishSceneRunDiagnostics.js'

function Host({ client }: { client: HttpApiClient }) {
  usePublishSceneRunDiagnostics(client)
  useEffect(() => () => {}, [])
  return null
}

beforeEach(() => {
  localStorage.clear()
  projectState.viewingProjectId = 'p1'
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('usePublishSceneRunDiagnostics', () => {
  it('publishes every execute diagnostic even when Code is closed', async () => {
    const diagnostics: SceneScriptDiagnostic[] = [
      {
        code: 'SCENE_HOST_FAILED',
        phase: 'execute',
        severity: 'error',
        message: 'heightfield requires a Geometry plane and a height Grid',
        graph: { authoringNodeId: 'field' },
      },
      {
        code: 'SCENE_OUTPUT_INCOMPLETE',
        phase: 'execute',
        severity: 'warning',
        message: 'Entry finished without sceneOutput',
      },
    ]
    const client = {
      execute: vi.fn(async () => ({
        executionId: 'e1',
        status: 'error',
        outputs: {},
        durationMs: 1,
        diagnostics,
      })),
      applyBatch: vi.fn(async () => ({ status: 'ok' })),
    } as unknown as HttpApiClient

    render(<Host client={client} />)
    await client.execute()

    const stored = JSON.parse(localStorage.getItem('scene-generator.scene-script-diagnostics') ?? '{}') as {
      entries: Array<{ items: Array<{ code: string; message: string }> }>
    }
    expect(stored.entries.flatMap((entry) => entry.items).map((item) => item.code)).toEqual([
      'SCENE_HOST_FAILED',
      'SCENE_OUTPUT_INCOMPLETE',
    ])
  })

  it('clears stale execute diagnostics when the next run is clean', async () => {
    publishSceneScriptDiagnostics('p1', [{
      code: 'SCENE_HOST_FAILED',
      phase: 'execute',
      severity: 'error',
      message: 'old',
      graph: { authoringNodeId: 'field' },
    }], [])
    const client = {
      execute: vi.fn(async () => ({
        executionId: 'e2',
        status: 'completed',
        outputs: {},
        durationMs: 1,
      })),
      applyBatch: vi.fn(async () => ({ status: 'ok' })),
    } as unknown as HttpApiClient

    render(<Host client={client} />)
    await client.execute()

    const stored = JSON.parse(localStorage.getItem('scene-generator.scene-script-diagnostics') ?? '{}') as {
      entries: unknown[]
    }
    expect(stored.entries).toEqual([])
  })
})
