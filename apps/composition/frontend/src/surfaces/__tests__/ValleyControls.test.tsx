// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import type { HttpApiClient } from '../../api/HttpApiClient.js'
import { ValleyControls, type CollectedControl } from '../ValleyControls.js'
import { registerGuideParamCommit } from '../../renderer/bridge/guideParamBridge.js'
import { ensureSceneI18n } from '../../sceneI18n.js'

function fakeClient(): HttpApiClient {
  return {
    subscribe: () => () => {},
    subscribeRaw: () => () => {},
    async ensureViewingProject() { return 'main' },
    async listOps() { return [] },
    async listNodes() { return [] },
    async getSceneScriptContracts() { return { version: '0.1', functions: [] } },
  } as unknown as HttpApiClient
}

const plotCount: CollectedControl = {
  id: 'n_plots:count',
  nodeId: 'n_plots',
  nodeName: 'plots',
  opId: 'points_along_polyline',
  key: 'count',
  label: 'Plot count',
  type: 'number',
  value: 6,
  min: 1,
  max: 24,
  step: 1,
}

describe('ValleyControls sliders', () => {
  beforeEach(() => {
    ensureSceneI18n()
  })
  afterEach(() => {
    cleanup()
    registerGuideParamCommit(null)
  })

  it('commits a slider on pointerup, not on every input event', () => {
    const commit = vi.fn()
    registerGuideParamCommit(commit)
    const { getByLabelText } = render(
      <ValleyControls client={fakeClient()} controls={[plotCount]} />,
    )
    const slider = getByLabelText('Plot count') as HTMLInputElement
    fireEvent.pointerDown(slider)
    fireEvent.change(slider, { target: { value: '8' } })
    fireEvent.change(slider, { target: { value: '10' } })
    expect(commit).not.toHaveBeenCalled()
    fireEvent.pointerUp(slider)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('n_plots', 'count', 10, false)
  })
})
