import { useEffect, useRef } from 'react'
import { StandaloneExtensionShell, isStandaloneExtension } from '@forgeax/node-runtime-react/editor'
import { HttpApiClient } from './api/HttpApiClient.js'
import { AuthoringHost } from './authoring/AuthoringHost.js'
import { AuthoringLeftPane } from './authoring/AuthoringLeftPane.js'
import { paneUrl } from './authoring/paneUrls.js'
import { RendererSurface } from './surfaces/RendererSurface.js'

// Pane router. The scene generator serves every surface from this one Vite app
// and selects by `?pane=`:
//   • renderer    → the faithful render preview surface (embedded iframe child)
//   • left        → host sidebar: navigation/status/help, not the main canvas
//   • center      → the authoring host: kernel Editor + embedded preview on 9555
export function App({
  pane,
  slug,
  projectId,
}: {
  pane?: string
  slug?: string | null
  projectId?: string | null
}): JSX.Element {
  const clientRef = useRef<{ key: string; client: HttpApiClient } | null>(null)
  const clientKey = projectId ?? ''
  if (!clientRef.current || clientRef.current.key !== clientKey) {
    clientRef.current?.client.dispose()
    clientRef.current = {
      key: clientKey,
      client: new HttpApiClient({
        baseUrl: '',
        pipelineId: 'main',
        projectId: projectId ?? undefined,
      }),
    }
  }
  const client = clientRef.current.client
  useEffect(() => () => {
    clientRef.current?.client.dispose()
    clientRef.current = null
  }, [clientKey])

  if (pane === 'renderer') return <RendererSurface client={client} gameSlug={slug} />
  if (pane === 'left') return <AuthoringLeftPane client={client} slug={slug} />
  // No `?pane=` in the URL means nothing is laying our panes out (dev server opened
  // in a tab, or embedded by a launcher page), so the manifest's `left` pane never
  // gets mounted and the whole authoring navigation would be invisible — reproduce
  // the split here. Studio always names the pane, so its layout is untouched.
  if ((!pane || pane === 'center') && isStandaloneExtension()) {
    return (
      <StandaloneExtensionShell
        leftPaneUrl={paneUrl('left')}
        storageKey="scene-generator.standaloneLeftWidth"
      >
        <AuthoringHost />
      </StandaloneExtensionShell>
    )
  }
  return <AuthoringHost />
}
