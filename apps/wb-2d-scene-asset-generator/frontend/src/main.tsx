import '@forgeax/node-runtime-react/styles.css'
import '@forgeax/node-runtime-react/editor.css'
// 2D Scene Asset Generator — frontend entry. Routes by ?pane= for ForgeaX host iframe modes.
import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'

const params = new URLSearchParams(window.location.search)
const pane = params.get('pane') ?? 'center'
document.body.dataset.pane = pane

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App pane={pane} />
  </React.StrictMode>,
)
