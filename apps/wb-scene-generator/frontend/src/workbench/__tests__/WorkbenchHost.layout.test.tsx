/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ensureSceneI18n } from '../../sceneI18n.js'

const { postMessage, contentWindow, bootstrap, editorRender } = vi.hoisted(() => {
  const postMessage = vi.fn()
  const contentWindow = { postMessage } as unknown as Window
  const bootstrap = vi.fn()
  const editorRender = vi.fn()
  return { postMessage, contentWindow, bootstrap, editorRender }
})

vi.mock('@forgeax/node-runtime-react/editor', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@forgeax/node-runtime-react/editor')>()
  const projectState = {
    viewingProjectId: 'main' as string | null,
    isSwitching: false,
    switchPhase: null as string | null,
    bootstrap,
  }
  const pipelineState = {
    outputsRefreshBusy: false,
    pipelineStatus: 'idle',
    selectedNodeIds: [] as string[],
    currentPipeline: { nodes: [] as Array<{ id: string; previewEnabled?: boolean }> },
    nodeOutputs: {} as Record<string, Record<string, unknown>>,
  }
  const useProjectStore = Object.assign(
    (selector: (s: typeof projectState) => unknown) => selector(projectState),
    {
      getState: () => projectState,
      subscribe: () => () => {},
    },
  )
  const usePipelineStore = Object.assign(
    (selector: (s: typeof pipelineState) => unknown) => selector(pipelineState),
    {
      getState: () => pipelineState,
      subscribe: () => () => {},
    },
  )
  return {
    ...mod,
    Editor: ({
      toolbarActions,
      title,
    }: {
      toolbarActions?: React.ReactNode
      title?: React.ReactNode
    }) => {
      editorRender()
      return (
        <div data-testid="editor-mock">
          <div data-testid="editor-title">{title}</div>
          <div data-testid="editor-toolbar-actions">{toolbarActions}</div>
          <button type="button">Editor focusable</button>
        </div>
      )
    },
    useProjectStore,
    usePipelineStore,
    stripTooLargeSummaries: (bag: Record<string, unknown>) => bag,
  }
})

vi.mock('../../api/HttpApiClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/HttpApiClient.js')>()
  return {
    ...actual,
    HttpApiClient: class {
    baseUrl = ''
    pipelineId = 'main'
    getSceneScriptProjectInfo = vi.fn(async () => ({
      projectId: 'main',
      canonicalModule: 'main.scene.ts',
      revision: 'rev-1',
      moduleCount: 1,
      sourceMapEntries: 0,
      updatedAt: null,
      files: [{ path: 'main.scene.ts', kind: 'module', bytes: 0, updatedAt: '' }],
    }))
    getSceneScriptModule = vi.fn(async () => ({
      file: 'main.scene.ts',
      source: '',
      revision: 'rev-1',
      state: { schemaVersion: 1, sourceRevision: 'rev-1', updatedAt: '', modules: [], sourceMap: [] },
    }))
    validateSceneScript = vi.fn(async () => ({
      valid: true,
      diagnostics: [],
      canonicalSource: '',
      sourceMap: [],
      entityCount: 0,
      operationCount: 0,
    }))
    },
  }
})

vi.mock('../paneUrls.js', () => ({
  paneUrl: () => 'about:blank',
}))

vi.mock('../../debug/syncTrace.js', () => ({
  syncTrace: vi.fn(),
  syncTraceHintOnce: vi.fn(),
  summarizeNodeOutputs: vi.fn(() => ''),
}))

import { WorkbenchHost } from '../WorkbenchHost.js'
import {
  DEFAULT_EDITOR_VISIBLE,
  LS_EDITOR,
  LS_EDITOR_INLINE_LEGACY,
  LS_RENDERER,
} from '../workbenchLayout.js'

function mountWithRendererIframe() {
  const view = render(<WorkbenchHost />)
  const iframe = view.container.querySelector('iframe')
  if (iframe) {
    Object.defineProperty(iframe, 'contentWindow', { value: contentWindow, configurable: true })
  }
  return view
}

beforeEach(() => {
  localStorage.clear()
  ensureSceneI18n()
  postMessage.mockReset()
  bootstrap.mockReset()
  editorRender.mockReset()
  vi.stubGlobal('location', { ...window.location, origin: 'http://localhost' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkbenchHost layout controls', () => {
  it('keeps Renderer, node editor, and Scene Script Studio in one workbench', async () => {
    const view = mountWithRendererIframe()
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost',
      source: contentWindow,
      data: { type: 'workbench:toggle-editor' },
    }))

    await screen.findByRole('complementary', { name: 'Scene Script Studio' })
    expect(view.container.querySelector('iframe')).toBeTruthy()
    expect(screen.getByTestId('editor-mock')).toBeTruthy()
    expect(view.container.querySelector('.scene-workbench__authoring-layout.has-script')).toBeTruthy()
    expect(view.container.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Expand Scene Script editor' }))
    expect(view.container.querySelector('.scene-workbench__authoring-layout.is-script-expanded')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restore split Scene Script view' })).toBeTruthy()
  })

  it('labels the expanded editor as Node Editor instead of Scene Generator', () => {
    localStorage.setItem(LS_EDITOR, 'true')
    mountWithRendererIframe()

    expect(screen.getByTestId('editor-title').textContent).toBe('Node Editor')
  })

  it('exposes an accessible opacity slider on the floating editor toolbar', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'true')

    mountWithRendererIframe()
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost',
      source: contentWindow,
      data: { type: 'workbench:toggle-editor' },
    }))

    const slider = await screen.findByRole('slider', { name: 'Opacity' }) as HTMLInputElement
    expect(slider.min).toBe('20')
    expect(slider.value).toBe('20')
    expect(document.querySelector('.scene-workbench__editor')?.getAttribute('style'))
      .toContain('--editor-surface-opacity: 0.2')

    fireEvent.change(slider, { target: { value: '20' } })
    await waitFor(() => expect(slider.value).toBe('20'))
    expect(localStorage.getItem('wb-scene-generator.editorSurfaceOpacity')).toBeNull()
  })

  it('does not keep editor focusables in the tab order when the card is hidden', () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'false')

    mountWithRendererIframe()

    expect(screen.getByTestId('editor-mock')).toBeTruthy()
    const editor = document.querySelector('.scene-workbench__editor')
    expect(editor?.classList.contains('is-collapsed')).toBe(true)
    expect(editor?.hasAttribute('inert')).toBe(true)
    expect(editor?.getAttribute('aria-hidden')).toBe('true')
  })

  it('restores default workspace and notifies the renderer iframe', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'true')
    localStorage.setItem(LS_EDITOR_INLINE_LEGACY, 'true')

    mountWithRendererIframe()

    fireEvent.click(screen.getByRole('button', { name: 'Restore workspace' }))

    await waitFor(() => {
      expect(localStorage.getItem(LS_RENDERER)).toBe('true')
      expect(localStorage.getItem(LS_EDITOR)).toBe(String(DEFAULT_EDITOR_VISIBLE))
    })

    expect(postMessage).toHaveBeenCalledWith(
      { type: 'workbench:restore-layout' },
      'http://localhost',
    )
    expect(screen.queryByRole('button', { name: 'Restore workspace' })).toBeNull()
    expect(screen.getByTestId('editor-mock')).toBeTruthy()
    expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(true)
  })
})

describe('workbench editor visibility protocol', () => {
  it('answers query-editor-visibility from the renderer iframe', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'true')
    mountWithRendererIframe()

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost',
      source: contentWindow,
      data: { type: 'workbench:query-editor-visibility' },
    }))

    await waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { type: 'workbench:editor-visibility-changed', visible: false },
        'http://localhost',
      )
    })
  })

  it('toggles editor visibility when the renderer requests it', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'false')
    mountWithRendererIframe()
    const rendersBeforeToggle = editorRender.mock.calls.length
    const onResize = vi.fn()
    window.addEventListener('resize', onResize)

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost',
      source: contentWindow,
      data: { type: 'workbench:toggle-editor' },
    }))

    await waitFor(() => {
      expect(localStorage.getItem(LS_EDITOR)).toBe('false')
      expect(screen.getByTestId('editor-mock')).toBeTruthy()
      expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(false)
    })
    expect(editorRender).toHaveBeenCalledTimes(rendersBeforeToggle)
    expect(onResize).not.toHaveBeenCalled()
    window.removeEventListener('resize', onResize)
  })

  it('keeps the editor open when pinned and closes it when unpinned', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'true')
    mountWithRendererIframe()

    const dispatchRendererMessage = (type: string) => {
      window.dispatchEvent(new MessageEvent('message', {
        origin: 'http://localhost',
        source: contentWindow,
        data: { type },
      }))
    }

    dispatchRendererMessage('workbench:toggle-editor')
    await waitFor(() => {
      expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(false)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Pin node editor' }))
    expect(screen.getByRole('button', { name: 'Unpin node editor' }).getAttribute('aria-pressed')).toBe('true')

    dispatchRendererMessage('workbench:request-close-editor')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(false)

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost',
      source: contentWindow,
      data: { type: 'workbench:request-close-editor', force: true },
    }))
    await waitFor(() => {
      expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(true)
    })

    dispatchRendererMessage('workbench:toggle-editor')
    await waitFor(() => {
      expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(false)
    })
    expect(screen.getByRole('button', { name: 'Pin node editor' }).getAttribute('aria-pressed')).toBe('false')

    dispatchRendererMessage('workbench:request-close-editor')
    await waitFor(() => {
      expect(document.querySelector('.scene-workbench__editor')?.classList.contains('is-collapsed')).toBe(true)
    })
  })

  it('rejects postMessage from an unexpected origin', async () => {
    localStorage.setItem(LS_RENDERER, 'true')
    localStorage.setItem(LS_EDITOR, 'true')
    mountWithRendererIframe()
    postMessage.mockClear()

    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://evil.example',
      source: contentWindow,
      data: { type: 'workbench:toggle-editor' },
    }))

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(localStorage.getItem(LS_EDITOR)).toBe('true')
    expect(postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'workbench:editor-visibility-changed', visible: false }),
      expect.anything(),
    )
  })
})
