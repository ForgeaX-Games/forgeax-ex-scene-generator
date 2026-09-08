// Group-view inner-param sink + inner-output probe coalescing. Module-level
// sink / in-flight map are shared (never duplicated).

import { getEditorTransport } from '../transport/index.js'
import { makeGroupBoundaryNodeId, makeGroupContextNodeId } from '../components/canvas/groupBoundaryIds.js'
import type { PipelineGet } from './pipelineStore.types.js'

// Group-view inner param-edit sink. While the canvas shows a group's INTERNAL
// view, inner nodes live in the group-view hook's live refs (flushed back to the
// store group on exit), NOT in `currentPipeline.nodes`. A param edit (text panel
// content, slider/toggle value, resize) is issued by a node component calling
// `updateNodeParam` directly, so without this bridge it would map over the ROOT
// nodes (where the inner node is absent) and be lost — the group never turns
// `unsaved*`. The group-view hook registers this sink while a group view is
// active (clears on exit); `updateNodeParam` routes through it. Returns whether
// the id was handled (false for non-inner ids → store falls back to root path).
// Node ADD is handled separately at the drop hook (placeBattery), not here, so
// other root `addNode` callers (paste / ctrl-drag) are left untouched.
type GroupInnerParamSink = (nodeId: string, key: string, value: unknown) => boolean
let _groupInnerSink: GroupInnerParamSink | null = null
export function setGroupInnerSink(sink: GroupInnerParamSink | null): void {
  _groupInnerSink = sink
}

export function tryGroupInnerParam(nodeId: string, key: string, value: unknown): boolean {
  return _groupInnerSink ? _groupInnerSink(nodeId, key, value) : false
}

// Per-group in-flight guard for the inner-view probe. exec:completed can fire in
// quick succession (e.g. a group Run followed by its incremental downstream
// pass); without this, each event would launch an overlapping probeGroupInner
// GET. We collapse concurrent probes of the SAME group to a single in-flight
// request so the backend is never hammered with redundant read-only re-runs.
const _groupProbeInFlight = new Map<string, Promise<void>>()

// Mirror the real last-run values onto the inner view's synthetic boundary
// (shell) + external context node ids. The inner canvas renders a group's
// exposed-port shell and its external up/downstream nodes under prefixed ids
// distinct from the real node ids that carry the cached outputs, so without this
// alias their ports/wires read empty even though the data exists. Pure store
// reads/writes; no re-execution. Handles nesting via the parent-group container.
export function hydrateGroupBoundaryAliases(get: PipelineGet, groupId: string): void {
  const state = get()
  const pipeline = state.currentPipeline
  if (!pipeline) return
  const group = (pipeline.groups ?? []).find((g) => g.id === groupId)
  if (!group) return

  // Container = the level that instantiates this group: the parent group when
  // nested (one level up the active view stack), else the root pipeline.
  const stack = state.groupViewStack
  const idx = stack.lastIndexOf(groupId)
  const parentGroupId = idx > 0 ? stack[idx - 1] : null
  const parentGroup = parentGroupId ? (pipeline.groups ?? []).find((g) => g.id === parentGroupId) : undefined
  const containerNodes = parentGroup?.nodes ?? pipeline.nodes
  const containerEdges = parentGroup?.edges ?? pipeline.edges
  const shadowNodeId =
    containerNodes.find((n) => n.batteryId === '__group__' && n.params?.groupId === groupId)?.id ?? groupId

  const outputs = get().nodeOutputs
  const shellInId = makeGroupBoundaryNodeId('in', groupId)
  const shellOutId = makeGroupBoundaryNodeId('out', groupId)
  const exposedInNames = new Set(group.exposedInputs.map((p) => p.portName))

  // External inputs: each container edge feeding the shadow node carries the live
  // input value on the real upstream node. Surface it on the shell input port
  // (under the exposed port name) and on the external context-in node (mirroring
  // the whole upstream output bag so every shown handle resolves).
  for (const e of containerEdges) {
    if (e.target.nodeId !== shadowNodeId || !exposedInNames.has(e.target.port)) continue
    const srcBag = outputs[e.source.nodeId]
    if (!srcBag) continue
    const v = srcBag[e.source.port]
    if (v !== undefined) get().setNodeOutput(shellInId, e.target.port, v)
    const ctxInId = makeGroupContextNodeId('in', e.source.nodeId)
    for (const [port, val] of Object.entries(srcBag)) {
      if (val !== undefined) get().setNodeOutput(ctxInId, port, val)
    }
  }

  // Exposed outputs: the group's boundary outputs are cached on the shadow node
  // (written by the real run). Surface them on the shell output port.
  const shadowBag = outputs[shadowNodeId]
  if (shadowBag) {
    for (const ep of group.exposedOutputs) {
      const v = shadowBag[ep.portName]
      if (v !== undefined) get().setNodeOutput(shellOutId, ep.portName, v)
    }
  }

  // External downstream context-out nodes mirror their real output bag so their
  // own ports (if any) show real values too.
  for (const e of containerEdges) {
    if (e.source.nodeId !== shadowNodeId) continue
    const tgtBag = outputs[e.target.nodeId]
    if (!tgtBag) continue
    const ctxOutId = makeGroupContextNodeId('out', e.target.nodeId)
    for (const [port, val] of Object.entries(tgtBag)) {
      if (val !== undefined) get().setNodeOutput(ctxOutId, port, val)
    }
  }
}

export function createProbeGroupInnerOutputs(get: PipelineGet): (groupId: string) => Promise<void> {
  return async (groupId) => {
    const { api } = getEditorTransport()
    if (!api.probeGroupInner) return
    // Coalesce concurrent probes of the same group into one in-flight request so
    // bursty exec:completed events can't stack overlapping backend re-runs.
    const existing = _groupProbeInFlight.get(groupId)
    if (existing) return existing
    const run = (async () => {
      let inner: Record<string, Record<string, unknown>> | null = null
      try {
        inner = await api.probeGroupInner!(groupId)
      } catch {
        // Probe is best-effort; a failure just leaves the internal view as-is.
        return
      }
      if (!inner) return
      for (const [innerNodeId, bag] of Object.entries(inner)) {
        for (const [port, value] of Object.entries(bag)) {
          if (value !== undefined) get().setNodeOutput(innerNodeId, port, value)
        }
      }
      // Alias the real last-run values onto the inner view's synthetic boundary /
      // context node ids so the SHELL ports + external up/downstream nodes also
      // reflect actual data flow (they render under prefixed ids, not the real
      // node ids that carry the cached values). All values are already in the
      // store: external inputs sit on the real upstream node, and the group's
      // exposed outputs sit on the group shadow node (written by the run).
      hydrateGroupBoundaryAliases(get, groupId)
    })().finally(() => {
      _groupProbeInFlight.delete(groupId)
    })
    _groupProbeInFlight.set(groupId, run)
    return run
  }
}
