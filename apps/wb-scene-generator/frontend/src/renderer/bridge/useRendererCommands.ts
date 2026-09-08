import { useEffect } from 'react'
import { pluginWsUrl } from '../../api/pluginHttp'
import { useRenderStore } from '../store'
import { isViewMode } from '../types'

// AI/Agent → renderer control bridge. Listens on /ws for the backend's
// `renderer:command` broadcast (emitted by /api/v1/agent/renderer/*) and applies
// it to the render store — the parity replacement for the legacy renderer WS
// commands set-view-mode / select-layer / open-all-sublayers. Mirrors the
// `screenshot:request` pattern in useScreenshotCapture (the renderer pane owns
// its own /ws socket for server-initiated control events).
//
// Also accepts the same commands forwarded by the workbench host as a
// `workbench:renderer-command` postMessage, so an LLM/CLI command can reach the
// store either directly (renderer's own socket) or via the host iframe hop.

type RendererCommand =
  | { kind: 'set-view-mode'; mode?: unknown }
  | { kind: 'select-layer'; layerKey?: unknown; subLayerValue?: unknown }
  | { kind: 'open-all-sublayers'; nodeId?: unknown }

function applyCommand(cmd: RendererCommand): void {
  const store = useRenderStore.getState()
  switch (cmd.kind) {
    case 'set-view-mode': {
      const mode = cmd.mode
      if (isViewMode(mode)) store.setViewMode(mode)
      break
    }
    case 'select-layer': {
      if (typeof cmd.layerKey === 'string') {
        const sub = typeof cmd.subLayerValue === 'number' ? cmd.subLayerValue : null
        store.setSelectedLayer(cmd.layerKey, sub)
      }
      break
    }
    case 'open-all-sublayers': {
      store.openAllSubLayers(typeof cmd.nodeId === 'string' ? cmd.nodeId : null)
      break
    }
  }
}

export function useRendererCommands(): void {
  useEffect(() => {
    // 1) Direct backend socket (server-initiated control events).
    let ws: WebSocket | null = null
    if (typeof WebSocket !== 'undefined' && typeof location !== 'undefined') {
      ws = new WebSocket(pluginWsUrl('/ws'))
      ws.onmessage = (ev) => {
        let msg: { event?: string; payload?: RendererCommand }
        try {
          msg = JSON.parse(ev.data as string)
        } catch {
          return
        }
        if (msg.event === 'renderer:command' && msg.payload && typeof msg.payload.kind === 'string') {
          applyCommand(msg.payload)
        }
      }
    }

    // 2) Host-forwarded command (workbench:renderer-command postMessage hop).
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; command?: RendererCommand } | null
      if (!data || data.type !== 'workbench:renderer-command' || !data.command) return
      if (typeof data.command.kind === 'string') applyCommand(data.command)
    }
    window.addEventListener('message', onMessage)

    return () => {
      ws?.close()
      window.removeEventListener('message', onMessage)
    }
  }, [])
}
