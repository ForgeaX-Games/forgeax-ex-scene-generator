// Shared editor-mirror subscription for scene workbench side panes.
// One BroadcastChannel bridge per syncKey per document; multiple consumers
// (e.g. Node Info + History in the same controls panel) share a single bridge.

import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import {
  createEditorBridge,
  type EditorBridge,
  type EditorMirrorSnapshot,
} from '@forgeax/node-runtime-react/editor'

type SharedEntry = {
  bridge: EditorBridge
  refCount: number
  mirror: EditorMirrorSnapshot | null
  listeners: Set<(snapshot: EditorMirrorSnapshot) => void>
  stateUnsub: () => void
}

const sharedByKey = new Map<string, SharedEntry>()

function acquireEntry(syncKey: string): SharedEntry {
  let entry = sharedByKey.get(syncKey)
  if (!entry) {
    const bridge = createEditorBridge(syncKey)
    const listeners = new Set<(snapshot: EditorMirrorSnapshot) => void>()
    entry = {
      bridge,
      refCount: 0,
      mirror: null,
      listeners,
      stateUnsub: () => {},
    }
    entry.stateUnsub = bridge.onState((snapshot) => {
      entry!.mirror = snapshot
      for (const cb of listeners) cb(snapshot)
    })
    bridge.sendCommand({ type: 'request-state' })
    sharedByKey.set(syncKey, entry)
  }
  entry.refCount++
  return entry
}

function releaseEntry(syncKey: string): void {
  const entry = sharedByKey.get(syncKey)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    entry.stateUnsub()
    entry.listeners.clear()
    entry.bridge.close()
    sharedByKey.delete(syncKey)
  }
}

/** @internal Clears the per-document bridge registry (tests only). */
export function resetEditorMirrorRegistryForTests(): void {
  for (const [, entry] of sharedByKey) {
    entry.stateUnsub()
    entry.listeners.clear()
    entry.bridge.close()
  }
  sharedByKey.clear()
}

export function useEditorMirror(syncKey: string): {
  mirror: EditorMirrorSnapshot | null
  bridgeRef: MutableRefObject<EditorBridge | null>
} {
  const [mirror, setMirror] = useState<EditorMirrorSnapshot | null>(
    () => sharedByKey.get(syncKey)?.mirror ?? null,
  )
  const bridgeRef = useRef<EditorBridge | null>(null)

  useEffect(() => {
    const entry = acquireEntry(syncKey)
    bridgeRef.current = entry.bridge

    const onMirror = (snapshot: EditorMirrorSnapshot) => setMirror(snapshot)
    entry.listeners.add(onMirror)
    if (entry.mirror) setMirror(entry.mirror)

    return () => {
      entry.listeners.delete(onMirror)
      bridgeRef.current = null
      releaseEntry(syncKey)
    }
  }, [syncKey])

  return { mirror, bridgeRef }
}
