import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App.js'

vi.mock('../workbench/WorkbenchHost.js', () => ({
  WorkbenchHost: () => <div>Center Workbench</div>,
}))

vi.mock('../surfaces/RendererSurface.js', () => ({
  RendererSurface: () => <div>Renderer Surface</div>,
}))

// The left pane now mounts the kernel <ProjectPanel> from the editor barrel,
// which transitively loads the canvas (touches `document` at import). This
// pane-routing test runs in a node env, so stub the barrel — its intent is
// routing, not the project panel internals.
vi.mock('@forgeax/node-runtime-react/editor', () => ({
  ProjectPanel: () => <div>Project Panel</div>,
  EditorControlsPanel: () => <div>Editor Controls</div>,
  configureEditorTransport: () => {},
  createEditorTransport: () => ({ dispose: () => {} }),
  useProjectStore: Object.assign(() => undefined, {
    getState: () => ({ fetchProjects: () => {}, subscribeProjectActivation: () => () => {} }),
  }),
  // The left pane's default group mounts <SceneGeneratorControlsPanel>, which
  // pulls these from the same barrel. Stub them so the routing test (node env,
  // intent = routing only) doesn't crash on the controls panel internals.
  useUIStore: (selector: (s: { langMode: string }) => unknown) => selector({ langMode: 'en' }),
  createEditorBridge: () => ({ onState: () => () => {}, sendCommand: () => {}, close: () => {} }),
  SettingsHistoryPanel: () => <div>History</div>,
  SettingsDataTypesPanel: () => <div>Data Types</div>,
  // Standalone split shell: node env has no `window`, so the guard is false here
  // and the default route stays on the bare host (Studio's behaviour).
  StandaloneWorkbenchShell: ({ children }: { children: React.ReactNode }) => (
    <div>Standalone Shell{children}</div>
  ),
  isStandaloneWorkbench: () => false,
}))

describe('App pane routing', () => {
  it('renders a dedicated scene left pane for pane=left', () => {
    const html = renderToStaticMarkup(<App pane="left" />)

    expect(html).toContain('aria-label="Scene Workbench Navigation"')
    expect(html).not.toContain('scene-left-pane__hero')
    expect(html).not.toContain('Center Workbench')
  })

  it('keeps pane=center on the main workbench host', () => {
    const html = renderToStaticMarkup(<App pane="center" />)

    expect(html).toContain('Center Workbench')
    expect(html).not.toContain('Standalone Shell')
  })

  it('never wraps an explicit pane in the standalone shell', () => {
    const html = renderToStaticMarkup(<App pane="renderer" />)

    expect(html).toContain('Renderer Surface')
    expect(html).not.toContain('Standalone Shell')
  })

  it('does not expose AssetStore as a standalone pane', () => {
    const html = renderToStaticMarkup(<App pane="assetstore" />)

    expect(html).toContain('Center Workbench')
    expect(html).not.toContain('Asset Store Surface')
  })
})
