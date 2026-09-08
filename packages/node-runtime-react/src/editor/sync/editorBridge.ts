// Same-origin editor sync bridge.
//
// The editor renders across TWO separate same-origin iframes (a host app splits
// the surface into a center "canvas" pane mounting <Editor> and a side pane that
// hosts auxiliary controls). Each iframe runs its OWN copy of the kernel zustand
// singletons (uiStore / historyStore / pipelineStore), so live editor state in
// the center pane is invisible to the side pane.
//
// This module bridges the gap with a BroadcastChannel (origin-scoped, so two
// distinct plugins on different ports never cross-talk):
//   - the center <Editor> runs as the HOST: it publishes a compact snapshot of
//     the operation-history list + live status whenever those stores change, and
//     handles inbound commands (clear-history, request-state);
//   - any side pane creates a bridge on the same key, mirrors the snapshot for
//     display, and posts the occasional command back.
//
// Persisted UI prefs (langMode / theme / probeMode / …) are NOT carried here —
// those sync for free via cross-document `storage` events (see uiStore). Only
// ephemeral, non-persisted live state needs this channel.
//
// BroadcastChannel never delivers a message back to the instance that posted it;
// host and side panes live in different iframe contexts, so there is no echo to
// guard against.

import { useEffect, useRef } from 'react'

import type { PipelineStatus, NodeGroup } from '../types.js'
import type { ConnectionStatus, HistoryActionType } from '../stores/index.js'
import { useHistoryStore, usePipelineStore, useUIStore } from '../stores/index.js'
import {
  formatPortValue,
  resolveInputPortValue,
  type DomainValueFormatters,
} from '../components/canvas/nodeTooltip.js'
import { formatIdAsLabel } from '../utils/batteryLabels.js'
import { getGroupPortDisplayLabel } from '../components/canvas/groupViewUtils.js'

const CHANNEL_PREFIX = 'forgeax-editor-sync:'

/** A history row as needed for the side-pane list (snapshot payload stripped). */
export interface HistoryEntryView {
  id: string
  type: HistoryActionType
  timestamp: number
  label: string
  labelEn?: string
}

/** Live status mirrored from the center editor's pipeline + ui stores. */
export interface EditorStatusView {
  connectionStatus: ConnectionStatus
  pipelineStatus: PipelineStatus
  /** Selected node's zh display name (or null when nothing is selected). */
  selectedNodeName: string | null
  /** Selected node's battery id (for the en label, resolved on the mirror side). */
  selectedNodeBatteryId: string | null
  nodeCount: number
  edgeCount: number
}

/** Whole-canvas tallies for the side-pane "Node Info" overview. */
export interface CanvasStatsView {
  /** Real batteries on the canvas (excludes `__group__` shadow nodes). */
  batteryCount: number
  /** Wires between ports. */
  edgeCount: number
  /** Composite (group) batteries. */
  groupCount: number
  /** Free-floating text annotations. */
  annotationCount: number
  /** Bounding frames. */
  frameCount: number
  /** Nodes currently selected on the canvas (marquee or click). */
  selectedCount: number
}

/** One peer reached through a connected port of the selected node. */
export interface SelectedPortPeerView {
  /** The peer node's display name (zh). */
  nodeName: string
  /** The peer node's port name. */
  port: string
}

/** A single (visible) port of the selected node, with its live connections. */
export interface SelectedPortView {
  name: string
  type: string
  /** Localised (zh) label, when the battery/port supplies one. */
  label?: string
  /** English label (group exposed ports); plain ports use `name` in English. */
  labelEn?: string
  /** The port's current value, formatted host-side (input: resolved upstream /
   *  default; output: computed). Empty when there is no value. */
  valueText?: string
  /** Connected peers (upstream for inputs, downstream for outputs). */
  peers: SelectedPortPeerView[]
}

/** The selected node's wiring, resolved on the host side for the side pane. */
export interface SelectedNodeView {
  id: string
  name: string
  batteryId: string
  /** Catalog display name (zh) + glyph, when resolvable. */
  batteryName?: string
  /** English catalog display name (falls back to a label derived from id). */
  batteryNameEn?: string
  iconSvg?: string
  color?: string
  sceneScriptStatus?: 'legacy' | 'script-callable' | 'equivalence-verified'
  sceneScriptFunctionName?: string
  sceneScriptPassedGates?: string[]
  sceneScriptMissingGates?: string[]
  sourcePath?: string
  sourceFiles?: string[]
  inputs: SelectedPortView[]
  outputs: SelectedPortView[]
}

/** The full snapshot the host publishes to side panes. */
export interface EditorMirrorSnapshot {
  history: { entries: HistoryEntryView[]; cursor: number }
  status: EditorStatusView
  /** Whole-canvas tallies for the Node Info overview. */
  stats: CanvasStatsView
  /** Wiring of the currently selected node (null when nothing is selected). */
  selectedNode: SelectedNodeView | null
}

/** Commands a side pane posts back to the host editor. */
export type EditorBridgeCommand = { type: 'clear-history' } | { type: 'request-state' }

export interface EditorBridge {
  publishState(snapshot: EditorMirrorSnapshot): void
  onState(cb: (snapshot: EditorMirrorSnapshot) => void): () => void
  sendCommand(cmd: EditorBridgeCommand): void
  onCommand(cb: (cmd: EditorBridgeCommand) => void): () => void
  close(): void
}

type BridgeMessage =
  | { kind: 'state'; payload: EditorMirrorSnapshot }
  | { kind: 'command'; payload: EditorBridgeCommand }

/**
 * Open a bridge on `key`. Degrades to an inert no-op bridge when
 * BroadcastChannel is unavailable (SSR / old environments) — callers never need
 * to branch on support.
 */
export function createEditorBridge(key: string): EditorBridge {
  const channelName = CHANNEL_PREFIX + key
  const channel =
    typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(channelName) : null

  const stateCbs = new Set<(s: EditorMirrorSnapshot) => void>()
  const cmdCbs = new Set<(c: EditorBridgeCommand) => void>()
  let closed = false

  if (channel) {
    channel.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as BridgeMessage | null
      if (!msg || typeof msg !== 'object') return
      if (msg.kind === 'state') stateCbs.forEach((cb) => cb(msg.payload))
      else if (msg.kind === 'command') cmdCbs.forEach((cb) => cb(msg.payload))
    }
  }

  return {
    // After close() (iframe teardown / HMR dispose) the underlying channel is
    // closed; posting then throws InvalidStateError ("Channel is closed") and
    // floods the console. Guard with `closed` so post-teardown publishes are
    // silent no-ops.
    publishState: (snapshot) => {
      if (closed) return
      channel?.postMessage({ kind: 'state', payload: snapshot } satisfies BridgeMessage)
    },
    onState: (cb) => {
      stateCbs.add(cb)
      return () => stateCbs.delete(cb)
    },
    sendCommand: (cmd) => {
      if (closed) return
      channel?.postMessage({ kind: 'command', payload: cmd } satisfies BridgeMessage)
    },
    onCommand: (cb) => {
      cmdCbs.add(cb)
      return () => cmdCbs.delete(cb)
    },
    close: () => {
      closed = true
      stateCbs.clear()
      cmdCbs.clear()
      channel?.close()
    },
  }
}

const GROUP_SHADOW_BATTERY_ID = '__group__'

/** Tally the whole canvas for the side-pane overview. */
function buildCanvasStats(p: ReturnType<typeof usePipelineStore.getState>): CanvasStatsView {
  const pipe = p.currentPipeline
  const nodes = pipe?.nodes ?? []
  return {
    batteryCount: nodes.filter((n) => n.batteryId !== GROUP_SHADOW_BATTERY_ID).length,
    edgeCount: pipe?.edges.length ?? 0,
    groupCount: pipe?.groups?.length ?? 0,
    annotationCount: pipe?.annotations?.length ?? 0,
    frameCount: pipe?.frames?.length ?? 0,
    selectedCount: p.selectedNodeIds.length,
  }
}

/**
 * Resolve the selected node's visible ports + their connected peers, so the
 * side pane can redraw the node's wiring without its own pipeline store. Group
 * shadow nodes resolve their exposed ports; plain nodes use the catalog battery
 * (plus any dynamic output ports the runtime expanded).
 */
function buildSelectedNodeView(
  p: ReturnType<typeof usePipelineStore.getState>,
  formatters: DomainValueFormatters,
): SelectedNodeView | null {
  const sel = p.selectedNode
  const pipe = p.currentPipeline
  if (!sel || !pipe) return null

  // Inside a group view the selected inner node's wiring lives in the active
  // group's own nodes/edges, not the root pipeline. Resolve the active edge/node
  // container from the group-view stack (deepest first, searching nested
  // snapshots) so peers + values still resolve for inner batteries.
  const activeGroupId = p.groupViewStack.length > 0 ? p.groupViewStack[p.groupViewStack.length - 1] : null
  const findGroup = (gid: string): NodeGroup | undefined => {
    const flat = pipe.groups ?? []
    const direct = flat.find((g) => g.id === gid)
    if (direct) return direct
    for (const g of flat) {
      const nested = (g._nestedGroups ?? []).find((ng) => ng.id === gid)
      if (nested) return nested
    }
    return undefined
  }
  const activeGroup = activeGroupId ? findGroup(activeGroupId) : undefined
  // Use the active group container only when it actually owns the selected node
  // (so a stale stack never hides root-level wiring).
  const inGroupView = !!activeGroup && activeGroup.nodes.some((n) => n.id === sel.id)
  const ctxNodes = inGroupView && activeGroup ? activeGroup.nodes : pipe.nodes
  const ctxEdges = inGroupView && activeGroup ? activeGroup.edges : pipe.edges

  // Parent container of the active group (where its `__group__` node + the
  // external edges live), so an inner node's exposed ports can surface their
  // "External Input/Output" connections.
  const parentContainer = ((): { nodes: typeof pipe.nodes; edges: typeof pipe.edges; groupNodeId: string } | null => {
    if (!inGroupView || !activeGroup) return null
    const stackIndex = p.groupViewStack.lastIndexOf(activeGroup.id)
    const parentGroupId = stackIndex > 0 ? p.groupViewStack[stackIndex - 1] : null
    const parentGroup = parentGroupId ? findGroup(parentGroupId) : undefined
    const nodes = parentGroup?.nodes ?? pipe.nodes
    const edges = parentGroup?.edges ?? pipe.edges
    const groupNodeId = nodes.find((n) => n.batteryId === GROUP_SHADOW_BATTERY_ID && n.params?.groupId === activeGroup.id)?.id
      ?? activeGroup.id
    return { nodes, edges, groupNodeId }
  })()

  const nameOf = (nodeId: string): string =>
    ctxNodes.find((n) => n.id === nodeId)?.name ?? nodeId

  // External-boundary peers for an inner node's port: an exposed input/output of
  // the active group whose `sourceNodeId/sourcePortName` is this inner port and
  // whose parent-side edge is wired, surfaced as an "External Input/Output" peer
  // naming the outside node it connects to.
  const boundaryInputPeers = (portName: string): SelectedPortPeerView[] => {
    if (!inGroupView || !activeGroup || !parentContainer) return []
    return (activeGroup.exposedInputs ?? [])
      .filter((ep) => ep.sourceNodeId === sel.id && ep.sourcePortName === portName)
      .flatMap((ep) =>
        parentContainer.edges
          .filter((e) => e.target.nodeId === parentContainer.groupNodeId && e.target.port === ep.portName)
          .map((e) => ({
            nodeName: parentContainer.nodes.find((n) => n.id === e.source.nodeId)?.name ?? e.source.nodeId,
            port: e.source.port,
          })),
      )
  }
  const boundaryOutputPeers = (portName: string): SelectedPortPeerView[] => {
    if (!inGroupView || !activeGroup || !parentContainer) return []
    return (activeGroup.exposedOutputs ?? [])
      .filter((ep) => ep.sourceNodeId === sel.id && ep.sourcePortName === portName)
      .flatMap((ep) =>
        parentContainer.edges
          .filter((e) => e.source.nodeId === parentContainer.groupNodeId && e.source.port === ep.portName)
          .map((e) => ({
            nodeName: parentContainer.nodes.find((n) => n.id === e.target.nodeId)?.name ?? e.target.nodeId,
            port: e.target.port,
          })),
      )
  }

  const inputPeers = (portName: string): SelectedPortPeerView[] => [
    ...ctxEdges
      .filter((e) => e.target.nodeId === sel.id && e.target.port === portName)
      .map((e) => ({ nodeName: nameOf(e.source.nodeId), port: e.source.port })),
    ...boundaryInputPeers(portName),
  ]

  const outputPeers = (portName: string): SelectedPortPeerView[] => [
    ...ctxEdges
      .filter((e) => e.source.nodeId === sel.id && e.source.port === portName)
      .map((e) => ({ nodeName: nameOf(e.target.nodeId), port: e.target.port })),
    ...boundaryOutputPeers(portName),
  ]

  // Live value of a port, formatted for display. Inputs resolve from the
  // upstream output (or the node default); outputs read the computed cache.
  const fmt = (value: unknown): string | undefined => {
    if (value === undefined || value === null) return undefined
    const text = formatPortValue(value, formatters)
    return text === '—' ? undefined : text
  }
  // Resolve an input port's value against the active container: upstream output
  // value when wired, else the node's own param. Inside a group view this uses
  // the group's edges + nodeOutputs (keyed by inner node id) just like root.
  const resolveCtxInputValue = (portName: string): unknown => {
    const edge = ctxEdges.find((e) => e.target.nodeId === sel.id && e.target.port === portName)
    if (edge) {
      const up = p.nodeOutputs[edge.source.nodeId]?.[edge.source.port]
      if (up !== undefined) return up
    }
    // Fed from outside via an exposed input: follow the parent-side edge into the
    // group node and read the external upstream's output value.
    if (activeGroup && parentContainer) {
      const ep = (activeGroup.exposedInputs ?? []).find(
        (x) => x.sourceNodeId === sel.id && x.sourcePortName === portName,
      )
      if (ep) {
        const extEdge = parentContainer.edges.find(
          (e) => e.target.nodeId === parentContainer.groupNodeId && e.target.port === ep.portName,
        )
        if (extEdge) {
          const up = p.nodeOutputs[extEdge.source.nodeId]?.[extEdge.source.port]
          if (up !== undefined) return up
        }
      }
    }
    const node = ctxNodes.find((n) => n.id === sel.id)
    return node?.params?.[portName]
  }
  const inputValue = (portName: string): string | undefined =>
    fmt(inGroupView ? resolveCtxInputValue(portName) : resolveInputPortValue(sel.id, portName))
  const outputValue = (portName: string): string | undefined =>
    fmt(p.nodeOutputs[sel.id]?.[portName])

  let inputs: SelectedPortView[] = []
  let outputs: SelectedPortView[] = []
  let batteryName: string | undefined
  let batteryNameEn: string | undefined
  let iconSvg: string | undefined
  let color: string | undefined
  let sceneScriptStatus: SelectedNodeView['sceneScriptStatus']
  let sceneScriptFunctionName: string | undefined
  let sceneScriptPassedGates: string[] | undefined
  let sceneScriptMissingGates: string[] | undefined
  let sourcePath: string | undefined
  let sourceFiles: string[] | undefined

  if (sel.batteryId === GROUP_SHADOW_BATTERY_ID) {
    const groupId = typeof sel.params?.groupId === 'string' ? sel.params.groupId : sel.id
    const group = (pipe.groups ?? []).find((g) => g.id === groupId)
    batteryName = group?.name
    batteryNameEn = group?.nameEn ?? group?.name
    if (typeof sel.params?.__sceneScriptFunctionName === 'string') {
      sceneScriptFunctionName = sel.params.__sceneScriptFunctionName
      sceneScriptStatus = sel.params.__sceneScriptStatus === 'equivalence-verified'
        ? 'equivalence-verified'
        : 'script-callable'
      sourcePath = typeof sel.params.__sceneScriptDefinitionId === 'string'
        ? sel.params.__sceneScriptDefinitionId
        : undefined
      sourceFiles = typeof sel.params.__sceneScriptSourceFile === 'string'
        ? [`file:${sel.params.__sceneScriptSourceFile}`]
        : undefined
    }
    inputs = (group?.exposedInputs ?? [])
      .filter((ep) => !ep.hidden)
      .map((ep) => ({
        name: ep.portName,
        type: ep.portType,
        label: getGroupPortDisplayLabel(ep, false),
        labelEn: getGroupPortDisplayLabel(ep, true),
        valueText: inputValue(ep.portName),
        peers: inputPeers(ep.portName),
      }))
    outputs = (group?.exposedOutputs ?? [])
      .filter((ep) => !ep.hidden)
      .map((ep) => ({
        name: ep.portName,
        type: ep.portType,
        label: getGroupPortDisplayLabel(ep, false),
        labelEn: getGroupPortDisplayLabel(ep, true),
        valueText: outputValue(ep.portName),
        peers: outputPeers(ep.portName),
      }))
  } else {
    const battery = p.batteries.find((b) => b.id === sel.batteryId)
    batteryName = battery?.name
    batteryNameEn = battery?.nameEn ?? formatIdAsLabel(sel.batteryId)
    iconSvg = battery?.iconSvg
    color = battery?.color
    sceneScriptStatus = battery?.sceneScriptStatus
    sceneScriptFunctionName = battery?.sceneScriptFunctionName
    sceneScriptPassedGates = battery?.sceneScriptPassedGates
    sceneScriptMissingGates = battery?.sceneScriptMissingGates
    sourcePath = battery?.sourcePath
    sourceFiles = battery?.sourceFiles
    inputs = (battery?.inputs ?? [])
      .filter((port) => !port.hidden)
      .map((port) => ({
        name: port.name,
        type: port.type,
        label: port.label,
        // Fall back to the catalog default so unconnected, unedited ports still
        // show their effective value (mirrors the canvas port tooltip).
        valueText: inputValue(port.name) ?? fmt(port.default),
        peers: inputPeers(port.name),
      }))
    outputs = (battery?.outputs ?? [])
      .filter((port) => !port.hidden)
      .map((port) => ({
        name: port.name,
        type: port.type,
        label: port.label,
        valueText: outputValue(port.name),
        peers: outputPeers(port.name),
      }))
    for (const dyn of p.dynamicOutputPorts[sel.id] ?? []) {
      if (outputs.some((o) => o.name === dyn.name)) continue
      outputs.push({
        name: dyn.name,
        type: dyn.type,
        label: dyn.label,
        valueText: outputValue(dyn.name),
        peers: outputPeers(dyn.name),
      })
    }
  }

  return {
    id: sel.id,
    name: sel.name,
    batteryId: sel.batteryId,
    batteryName,
    batteryNameEn,
    iconSvg,
    color,
    sceneScriptStatus,
    sceneScriptFunctionName,
    sceneScriptPassedGates,
    sceneScriptMissingGates,
    sourcePath,
    sourceFiles,
    inputs,
    outputs,
  }
}

/** Build the current snapshot from the live kernel stores (host side). */
function buildSnapshot(formatters: DomainValueFormatters): EditorMirrorSnapshot {
  const h = useHistoryStore.getState()
  const p = usePipelineStore.getState()
  const ui = useUIStore.getState()
  return {
    history: {
      entries: h.entries.map((e) => ({
        id: e.id,
        type: e.type,
        timestamp: e.timestamp,
        label: e.label,
        labelEn: e.labelEn,
      })),
      cursor: h.cursor,
    },
    status: {
      connectionStatus: ui.connectionStatus,
      pipelineStatus: p.pipelineStatus,
      selectedNodeName: p.selectedNode?.name ?? null,
      selectedNodeBatteryId: p.selectedNode?.batteryId ?? null,
      nodeCount: p.currentPipeline?.nodes.length ?? 0,
      edgeCount: p.currentPipeline?.edges.length ?? 0,
    },
    stats: buildCanvasStats(p),
    selectedNode: buildSelectedNodeView(p, formatters),
  }
}

/**
 * Host-side broadcaster. Mounted by <Editor> when `editorSyncKey` is set:
 * republishes (rAF-debounced) on every history / pipeline / ui store change so a
 * side pane mirrors the editor live, and answers `request-state` from a
 * late-mounting side pane plus `clear-history` commands. No-op when key is unset.
 */
export function useEditorBroadcastHost(
  key: string | undefined,
  formatters: DomainValueFormatters = [],
): void {
  // Latest formatters read via ref so changing them never re-subscribes stores.
  const formattersRef = useRef(formatters)
  formattersRef.current = formatters

  useEffect(() => {
    if (!key) return
    const bridge = createEditorBridge(key)

    let scheduled = false
    let lastPipelineSig = ''
    let lastSelectedOutputRef: Record<string, unknown> | undefined
    let lastUiSig = ''
    const publish = (): void => bridge.publishState(buildSnapshot(formattersRef.current))
    const schedule = (): void => {
      if (scheduled) return
      scheduled = true
      const run = (): void => {
        scheduled = false
        publish()
      }
      if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run)
      else setTimeout(run, 16)
    }
    const scheduleIfPipelineChanged = (): void => {
      const p = usePipelineStore.getState()
      const selId = p.selectedNode?.id
      const outputRef = selId ? p.nodeOutputs[selId] : undefined
      const sig = [
        p.pipelineRevision,
        p.pipelineStatus,
        p.outputsRefreshBusy ? 1 : 0,
        p.selectedNodeIds.join(','),
        selId ?? '',
        p.currentPipeline?.nodes.length ?? 0,
        p.currentPipeline?.edges.length ?? 0,
      ].join('|')
      const outputChanged = outputRef !== lastSelectedOutputRef
      if (sig === lastPipelineSig && !outputChanged) return
      lastPipelineSig = sig
      lastSelectedOutputRef = outputRef
      schedule()
    }
    const scheduleIfUiChanged = (): void => {
      const ui = useUIStore.getState()
      const sig = `${ui.connectionStatus}|${ui.langMode}|${ui.showDevNoteCount ? 1 : 0}`
      if (sig === lastUiSig) return
      lastUiSig = sig
      schedule()
    }

    const unsubs = [
      useHistoryStore.subscribe(schedule),
      usePipelineStore.subscribe(scheduleIfPipelineChanged),
      useUIStore.subscribe(scheduleIfUiChanged),
    ]
    const offCmd = bridge.onCommand((cmd) => {
      if (cmd.type === 'clear-history') useHistoryStore.getState().clearHistory()
      else if (cmd.type === 'request-state') publish()
    })

    publish() // seed any side pane already listening

    return () => {
      unsubs.forEach((u) => u())
      offCmd()
      bridge.close()
    }
  }, [key])
}
