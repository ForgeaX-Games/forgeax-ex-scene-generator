import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from '../App.js'

vi.mock('../workbench/WorkbenchHost.js', () => ({
  WorkbenchHost: () => <div>Center Workbench</div>,
}))

vi.mock('../surfaces/Viewer3DSurface.js', () => ({
  Viewer3DSurface: () => <div>3D Viewer Surface</div>,
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
  // Standalone split shell: node env has no `window`, so the guard is false here
  // and the default route stays on the bare host (Studio's behaviour).
  StandaloneWorkbenchShell: ({ children }: { children: React.ReactNode }) => (
    <div>Standalone Shell{children}</div>
  ),
  isStandaloneWorkbench: () => false,
}))

describe('App pane routing', () => {
  it('renders a dedicated lowpoly left pane for pane=left', () => {
    const html = renderToStaticMarkup(<App pane="left" />)

    expect(html).toContain('Lowpoly Workbench Navigation')
    // Routing intent: the left pane is the nav aside, not the center workbench
    // host or the 3D viewer surface. (The pane copy legitimately mentions the
    // "character" preview mode, so don't assert on that substring.)
    expect(html).not.toContain('Center Workbench')
    expect(html).not.toContain('3D Viewer Surface')
  })

  it('keeps pane=center on the main workbench host', () => {
    const html = renderToStaticMarkup(<App pane="center" />)

    expect(html).toContain('Center Workbench')
  })
})
