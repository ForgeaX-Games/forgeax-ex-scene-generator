import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App.js'

vi.mock('../workbench/WorkbenchHost.js', () => ({
  WorkbenchHost: () => <div>Center Workbench</div>,
}))

vi.mock('../surfaces/ImagePreviewSurface.js', () => ({
  ImagePreviewSurface: () => <div>Image Preview Surface</div>,
}))

vi.mock('../surfaces/GeneratedAssetStoreSurface.js', () => ({
  GeneratedAssetStoreSurface: () => <div>Generated Asset Store Surface</div>,
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
  it('renders a dedicated asset left pane for pane=left', () => {
    const html = renderToStaticMarkup(<App pane="left" />)

    expect(html).toContain('Asset Workbench Navigation')
    expect(html).not.toContain('Center Workbench')
  })

  it('keeps pane=center on the main workbench host', () => {
    const html = renderToStaticMarkup(<App pane="center" />)

    expect(html).toContain('Center Workbench')
  })

  it('routes pane=preview to the image preview surface', () => {
    const html = renderToStaticMarkup(<App pane="preview" />)

    expect(html).toContain('Image Preview Surface')
  })

  it('keeps pane=renderer as a compatibility alias for preview', () => {
    const html = renderToStaticMarkup(<App pane="renderer" />)

    expect(html).toContain('Image Preview Surface')
  })

  it('routes pane=assetstore to generated asset folders', () => {
    const html = renderToStaticMarkup(<App pane="assetstore" />)

    expect(html).toContain('Generated Asset Store Surface')
  })
})
