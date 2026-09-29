/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { ensureSceneI18n } from '../../sceneI18n.js'
import { publishSceneScriptDiagnostics } from '../sceneScriptDiagnosticBridge.js'

const pipelineMock = vi.hoisted(() => {
  const requestSelectNodes = vi.fn<(ids: string[]) => void>()
  return {
    requestSelectNodes,
    getState: () => ({ requestSelectNodes }),
    reset: () => requestSelectNodes.mockClear(),
  }
})

vi.mock('@forgeax/node-runtime-react/editor', () => ({
  usePipelineStore: Object.assign(
    (selector: (state: { requestSelectNodes: typeof pipelineMock.requestSelectNodes }) => unknown) =>
      selector({ requestSelectNodes: pipelineMock.requestSelectNodes }),
    { getState: pipelineMock.getState },
  ),
}))

import { SceneScriptDiagnosticDock } from '../SceneScriptDiagnosticDock.js'

beforeEach(() => {
  localStorage.clear()
  ensureSceneI18n()
  pipelineMock.reset()
})

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('SceneScriptDiagnosticDock', () => {
  it('lists every error and warning and selects the authored node', () => {
    publishSceneScriptDiagnostics('p1', [
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
      {
        code: 'SCENE_GRID_STRETCH',
        phase: 'execute',
        severity: 'warning',
        message: 'grid stretched',
        graph: { authoringNodeId: 'grid' },
      },
      {
        code: 'SCENE_GEOMETRY_DEGENERATE',
        phase: 'verify',
        severity: 'error',
        message: 'zero-area polygon',
        graph: { authoringNodeId: 'region' },
      },
    ], [])

    render(<SceneScriptDiagnosticDock projectId="p1" />)
    expect(screen.getByLabelText('Scene Script diagnostics').textContent).toContain('2 errors')
    expect(screen.getByLabelText('Scene Script diagnostics').textContent).toContain('2 warnings')
    expect(screen.getAllByText('Error')).toHaveLength(2)
    expect(screen.getAllByText('Warning')).toHaveLength(2)
    expect(screen.getByText('SCENE_HOST_FAILED')).toBeTruthy()
    expect(screen.getByText('heightfield requires a Geometry plane and a height Grid')).toBeTruthy()
    expect(screen.getByText('SCENE_OUTPUT_INCOMPLETE')).toBeTruthy()
    expect(screen.getByText('SCENE_GRID_STRETCH')).toBeTruthy()
    expect(screen.getByText('SCENE_GEOMETRY_DEGENERATE')).toBeTruthy()

    const item = screen.getByText('SCENE_HOST_FAILED').closest('[role="button"]') as HTMLElement
    expect(item.tagName).not.toBe('BUTTON')
    expect(item.className).toContain('scene-diagnostic-dock__item')
    fireEvent.click(item)
    expect(pipelineMock.requestSelectNodes).toHaveBeenCalledWith(['field'])
  })

  it('does not steal a text selection when the row is clicked', () => {
    publishSceneScriptDiagnostics('p1', [{
      code: 'SCENE_HOST_FAILED',
      phase: 'execute',
      severity: 'error',
      message: 'heightfield requires a Geometry plane and a height Grid',
      graph: { authoringNodeId: 'field' },
    }], [])
    render(<SceneScriptDiagnosticDock projectId="p1" />)
    vi.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'heightfield requires' } as Selection)
    fireEvent.click(screen.getByText('SCENE_HOST_FAILED').closest('[role="button"]') as HTMLElement)
    expect(pipelineMock.requestSelectNodes).not.toHaveBeenCalled()
  })

  it('stops at the Code studio when it is open', () => {
    publishSceneScriptDiagnostics('p1', [{
      code: 'SCENE_HOST_FAILED',
      phase: 'execute',
      severity: 'error',
      message: 'needs height',
      graph: { authoringNodeId: 'field' },
    }], [])
    const layout = document.createElement('div')
    layout.className = 'scene-authoring__authoring-layout has-script'
    Object.defineProperty(layout, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, top: 0, bottom: 400, width: 1000, height: 400 }),
    })
    const editor = document.createElement('div')
    editor.className = 'scene-authoring__node-editor'
    Object.defineProperty(editor, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 1000, top: 0, bottom: 400, width: 1000, height: 400 }),
    })
    const studio = document.createElement('div')
    studio.className = 'scene-script-studio'
    Object.defineProperty(studio, 'offsetWidth', { value: 480 })
    Object.defineProperty(studio, 'getBoundingClientRect', {
      value: () => ({ left: 512, right: 992, top: 0, bottom: 400, width: 480, height: 400 }),
    })
    layout.append(editor, studio)
    document.body.append(layout)
    const { container } = render(<SceneScriptDiagnosticDock projectId="p1" />, { container: editor })
    const dock = container.querySelector('.scene-diagnostic-dock') as HTMLElement
    expect(dock.style.right).toBe('496px')
    layout.remove()
  })

  it('hides when the current project has no diagnostics', () => {
    publishSceneScriptDiagnostics('other', [{
      code: 'SCENE_HOST_FAILED',
      phase: 'execute',
      severity: 'error',
      message: 'hidden',
      graph: { authoringNodeId: 'field' },
    }], [])
    const { container } = render(<SceneScriptDiagnosticDock projectId="p1" />)
    expect(container.firstChild).toBeNull()
  })
})
