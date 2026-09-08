/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const requestSelectNodes = vi.fn()
vi.mock('@forgeax/node-runtime-react/editor', () => ({
  usePipelineStore: { getState: () => ({ requestSelectNodes }) },
}))

import type { HttpApiClient } from '../../api/HttpApiClient.js'
import { SceneWorkGraphOverlay } from '../SceneWorkGraphOverlay.js'

afterEach(() => {
  cleanup()
  requestSelectNodes.mockClear()
})

describe('SceneWorkGraphOverlay', () => {
  it('keeps work node types separate and bridges targets to authoring selection', async () => {
    const onClose = vi.fn()
    const client = {
      getSceneAgentWorkGraph: vi.fn(async () => ({
        version: 1,
        projectId: 'p1',
        payload: 'bounded-work-overlay' as const,
        nodes: [{
          id: 'work-1',
          kind: 'critic' as const,
          status: 'blocked' as const,
          targetIds: ['authoring-1'],
          scope: ['module.main'],
          artifacts: {
            workOrder: 'work-order.json',
            result: 'result.json',
            astPatch: 'ast-patch.json',
            semanticDiff: 'semantic-diff.json',
            verification: 'verification.json',
            progress: 'progress.json',
            checkpoint: 'checkpoint.json',
          },
          diagnostics: [],
          checkpoint: { id: 'cp-1', projectRevision: 'rev-1', createdAt: '' },
          humanGate: { required: true, reasons: ['important-deletion'] },
          budget: { retries: 0, maxRetries: 2, stopped: false, circuitOpen: false },
          updatedAt: '',
        }],
      })),
    } as unknown as HttpApiClient

    render(<SceneWorkGraphOverlay client={client} projectId="p1" open onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('critic')).toBeTruthy())
    expect(screen.getByLabelText('Work Graph summary').textContent).toContain('1 total')
    expect(screen.getByLabelText('Work Graph summary').textContent).toContain('1 gated')
    const workNode = screen.getByText('critic').closest('li')
    expect(workNode?.getAttribute('data-work-node-kind')).toBe('critic')
    expect(screen.getByText('important-deletion')).toBeTruthy()
    fireEvent.click(screen.getByText('critic').closest('button')!)
    expect(requestSelectNodes).toHaveBeenCalledWith(['authoring-1'])
    fireEvent.click(screen.getByRole('button', { name: 'Close Work Graph' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
