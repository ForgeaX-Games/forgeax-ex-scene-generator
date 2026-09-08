import { pluginFetch, pluginWsUrl } from '../../api/pluginHttp'

import { useEffect, useRef } from 'react'
import type * as THREE from 'three'
import type { UrdfSpec } from './three/urdf-parser'
import {
  exportAnimatedGlbBlob,
  exportStaticGlbBlob,
  exportSkinnedGlbBlob,
  exportCharacterGlbBlob,
} from './three/export-glb'
import { cloneObject3DForExport, disposeObject3D } from './three/three-dispose'
import { useViewerStore } from './store/viewerStore'

// Accessors into the live viewer so the agent-triggered GLB export reuses the
// exact same path as the titlebar "Export ▸ glb" button.
export interface GlbExportAccessors {
  getExportObject: () => THREE.Object3D | null
  getSpec: () => UrdfSpec | null
  /** Character (skeleton + skin) export accessor; null when not in character mode. */
  getCharacterExport: () => { root: THREE.Object3D; clips: THREE.AnimationClip[] } | null
}

// Listens on /ws for the backend's `glb:request` broadcast (emitted by
// lowpoly:export-glb → /api/v1/agent/glb/export), bakes the current URDF scene
// into a binary glTF and POSTs it back to /api/v1/agent/glb/store so the
// awaiting export request resolves and the backend writes the .glb to disk.
// The broadcast's `animated` flag selects exportAnimatedGlbBlob (joint-preview
// animation track, default) vs exportStaticGlbBlob (geometry-only). This is the
// agent-facing twin of the human titlebar export.
export function useGlbExport(accessors: GlbExportAccessors): void {
  const ref = useRef(accessors)
  ref.current = accessors

  useEffect(() => {
    if (typeof WebSocket === 'undefined' || typeof location === 'undefined') return
    // Must go through pluginWsUrl (not a bare `location.origin + '/ws'`): under
    // Studio's `/__fx/<id>/` launcher embed the raw origin path 404s. See AGENTS.md
    // "Standalone HTTP wrapper".
    const url = pluginWsUrl('/ws')
    let ws: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | null = null
    let attempts = 0
    let closed = false

    const post = (body: unknown) =>
      void pluginFetch('/api/v1/agent/glb/store', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

    const onMessage = async (ev: MessageEvent) => {
      let msg: { event?: string; payload?: { requestId?: string; name?: string; animated?: boolean; mode?: string } }
      try {
        msg = JSON.parse(ev.data as string)
      } catch {
        return
      }
      if (msg.event !== 'glb:request' || !msg.payload?.requestId) return
      const requestId = msg.payload.requestId
      // `mode` selects the export flavor: 'animated' (default) | 'static' | 'skinned'
      // | 'character'. For backward compat, `animated: false` maps to 'static' when
      // `mode` is absent. See export-glb.ts for each flavor.
      const mode: 'animated' | 'static' | 'skinned' | 'character' =
        msg.payload.mode === 'static' || msg.payload.mode === 'skinned' || msg.payload.mode === 'character'
          ? msg.payload.mode
          : msg.payload.mode === 'animated'
            ? 'animated'
            : msg.payload.animated === false ? 'static' : 'animated'
      try {
        // Character export reads the live SkinnedMesh + Skeleton container directly
        // (它自带独立几何，不像 obj/glb 需要先 clone 一份可 dispose 的 exportRoot)。
        if (mode === 'character') {
          const character = ref.current.getCharacterExport()
          if (!character) throw new Error('no character rig ready to export (switch to a skinned rig / rig_preview first)')
          const blob = await exportCharacterGlbBlob(character.root, character.clips)
          const reader = new FileReader()
          reader.onloadend = () => post({ requestId, name: msg.payload?.name, dataUrl: reader.result, bytes: blob.size })
          reader.onerror = () => post({ requestId, error: 'failed to read glb blob' })
          reader.readAsDataURL(blob)
          return
        }

        const root = ref.current.getExportObject()
        if (!root) throw new Error('no 3D object ready to export (run the pipeline first?)')
        const spec = ref.current.getSpec()
        // The URDF spec is needed to derive the joint-preview animation / skinning;
        // a static export bakes geometry-only and doesn't require it.
        if ((mode === 'animated' || mode === 'skinned') && !spec) {
          throw new Error('no URDF spec available (execute the full graph so g_to_urdf produces output)')
        }
        root.updateMatrixWorld(true)
        // Authored clip (from g_bake_animation) takes precedence over the
        // procedural joint preview when present; export-glb falls back on null.
        const authoredClip = useViewerStore.getState().authoredAnimation
        let blob: Blob
        if (mode === 'skinned') {
          // Skinned export reads the live scene directly (clones its own geometry).
          blob = await exportSkinnedGlbBlob(root, spec!, authoredClip)
        } else {
          const exportRoot = cloneObject3DForExport(root)
          try {
            blob = mode === 'animated'
              ? await exportAnimatedGlbBlob(exportRoot, spec!, authoredClip)
              : await exportStaticGlbBlob(exportRoot)
          } finally {
            // 导出克隆持有独立 geometry/material，用完即释放，避免每次 agent 导出泄漏。
            disposeObject3D(exportRoot)
          }
        }
        const reader = new FileReader()
        reader.onloadend = () => post({ requestId, name: msg.payload?.name, dataUrl: reader.result, bytes: blob.size })
        reader.onerror = () => post({ requestId, error: 'failed to read glb blob' })
        reader.readAsDataURL(blob)
      } catch (e) {
        post({ requestId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    // Auto-reconnect mirrors useScreenshotCapture so a transient WS drop never
    // leaves the exporter silently dead.
    const connect = () => {
      if (closed) return
      ws = new WebSocket(url)
      ws.onopen = () => { attempts = 0 }
      ws.onmessage = onMessage
      const scheduleReconnect = () => {
        if (closed || retry) return
        const delay = Math.min(5000, 500 * 2 ** attempts)
        attempts += 1
        retry = setTimeout(() => { retry = null; connect() }, delay)
      }
      ws.onclose = scheduleReconnect
      ws.onerror = () => { try { ws?.close() } catch { /* noop */ } }
    }
    connect()

    return () => {
      closed = true
      if (retry) clearTimeout(retry)
      try { ws?.close() } catch { /* noop */ }
    }
  }, [])
}
