import '@forgeax/node-runtime-react/styles.css'
import '@forgeax/node-runtime-react/editor.css'
import './sceneChrome.css'
// Scene Generator — frontend entry. Routes by ?pane= for ForgeaX host iframe modes.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { ensureSceneI18n } from './sceneI18n.js'

ensureSceneI18n()

const params = new URLSearchParams(window.location.search)
const pane = params.get('pane') ?? 'center'
// Studio host encodes the current ForgeaX game slug into every plugin iframe
// URL (see StandalonePluginIframe.buildIframeSrc). Consume it here so the
// project panel can scope its list to "this game's projects" by default.
const slug = params.get('slug')
// Read-only renderer embeds can pin themselves to a task's scene project
// without changing the shared Studio workspace's currently viewed project.
const projectId = params.get('projectId')
document.body.dataset.pane = pane

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App pane={pane} slug={slug} projectId={projectId} />
  </React.StrictMode>,
)
