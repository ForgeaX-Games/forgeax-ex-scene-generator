import { useMemo } from 'react'
import { StandaloneWorkbenchShell, isStandaloneWorkbench } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from './api/HttpApiClient.js'
import { WorkbenchHost } from './workbench/WorkbenchHost.js'
import { WorkbenchLeftPane } from './workbench/WorkbenchLeftPane.js'
import { paneUrl } from './workbench/paneUrls.js'
import { ImagePreviewSurface } from './surfaces/ImagePreviewSurface.js'
import { GeneratedAssetStoreSurface } from './surfaces/GeneratedAssetStoreSurface.js'

// Pane router. The 2D asset generator serves every surface from this one Vite app
// and selects by `?pane=`:
//   • preview     → generated image preview surface (embedded iframe child)
//   • renderer    → compatibility alias for preview
//   • assetstore  → generated asset folder surface (embedded iframe child)
//   • left        → host sidebar: navigation/status/help, not the main canvas
//   • center      → the workbench host: kernel Editor + embedded panes on 9565
export function App({ pane }: { pane?: string }): JSX.Element {
  const client = useMemo(() => new HttpApiClient({ baseUrl: '', pipelineId: 'main' }), [])

  if (pane === 'preview' || pane === 'renderer') return <ImagePreviewSurface />
  if (pane === 'assetstore') return <GeneratedAssetStoreSurface />
  if (pane === 'left') return <WorkbenchLeftPane client={client} />
  // No `?pane=` in the URL means nothing is laying our panes out (dev server opened
  // in a tab, or embedded by a launcher page), so the manifest's `left` pane never
  // gets mounted and the whole workbench navigation would be invisible — reproduce
  // the split here. Studio always names the pane, so its layout is untouched.
  if ((!pane || pane === 'center') && isStandaloneWorkbench()) {
    return (
      <StandaloneWorkbenchShell
        leftPaneUrl={paneUrl('left')}
        storageKey="wb-2d-scene-asset-generator.standaloneLeftWidth"
      >
        <WorkbenchHost />
      </StandaloneWorkbenchShell>
    )
  }
  return <WorkbenchHost />
}
