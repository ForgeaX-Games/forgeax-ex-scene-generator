import '@forgeax/node-runtime-react/styles.css'
import '@forgeax/node-runtime-react/editor.css'
// 全局设计 token（颜色/间距/圆角，见 theme.ts 的 JS 对照）——无条件引入，三个 ?pane=
// 文档（left / center / viewer3d）共用同一份 :root 变量，保证视觉规范一致（见
// design-tokens.css 顶部注释）。
import './design-tokens.css'
// 3D Lowpoly Generator — frontend entry. Routes by ?pane= for ForgeaX host iframe modes.
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
