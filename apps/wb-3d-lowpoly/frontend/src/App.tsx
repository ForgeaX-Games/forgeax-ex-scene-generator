import { useEffect, useMemo } from 'react'
import { StandaloneWorkbenchShell, isStandaloneWorkbench } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { paneUrl } from './workbench/paneUrls.js'
import { Viewer3DSurface } from './surfaces/Viewer3DSurface.js'

// Pane router. Every surface is served from this one Vite app and selected by
// `?pane=`:
//   • viewer3d  → the three.js 3D viewer surface (static / URDF / character; embedded iframe child)
//   • left      → host sidebar: navigation/status/help, not the main canvas
//   • center    → the workbench host: kernel Editor + embedded panes
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])
  // Dispose the client (and its WebSocket) when the app tears down / HMR remounts.
  useEffect(() => () => { client.dispose() }, [client])

  if (pane === 'viewer3d') return <Viewer3DSurface client={client} />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  // No `?pane=` in the URL means nothing is laying our panes out (dev server opened
  // in a tab, or embedded by a launcher page), so the manifest's `left` pane never
  // gets mounted and the whole workbench navigation would be invisible — reproduce
  // the split here. Studio always names the pane, so its layout is untouched.
  if ((!pane || pane === 'center') && isStandaloneWorkbench()) {
    return (
      <StandaloneWorkbenchShell
        leftPaneUrl={paneUrl('left')}
        storageKey="wb-3d-lowpoly.standaloneLeftWidth"
      >
        <WorkbenchHost />
      </StandaloneWorkbenchShell>
    )
  }
  return <WorkbenchHost />
}
