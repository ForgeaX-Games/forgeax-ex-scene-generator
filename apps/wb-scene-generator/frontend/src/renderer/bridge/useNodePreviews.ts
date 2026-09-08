import { useEffect } from 'react'
import type { HttpApiClient, SceneScriptDraftEvent } from '../../api/HttpApiClient'
import { useRenderStore } from '../store'
import { flattenWire, flattenWireList } from './flattenWire'
import type { GuidePoint, GuideStyle, MeshPayload, NameListEntry, VoxelLayer } from '../types'
import { attachGuideSources, collectControlPointsNodes, collectManualPointNodes, parseGuidePoints, parseGuideStyle } from '../framework/guidePoints'
import { type ScenePortValue } from '../../../../vendor/shared/types/scene/port.js'
import { parseScenePortFromWire } from './scenePortWire.js'
import { collectRefMeshesFromScene } from '../framework/sceneMeshHydration.js'
import { collectGuidesFromScene } from '../framework/sceneGuideHydration.js'
import { syncTrace, syncTraceHintOnce, summarizeNodeOutputs } from '../../debug/syncTrace.js'
import { beginLoadingTask, endLoadingTask, updateLoadingTask } from './loadingSignals.js'

// Project every executed node's renderable outputs into the render store so the
// preview updates live as a graph is wired up — matching the legacy behavior.
//
// Two buckets, both fed here:
//   * grid ports (ANY node) → previewLayers (dense 2D heatmaps).
//     This is the key fix: an intermediate chain (e.g. cellular_noise →
//     max_rectangle) shows up immediately, without needing a scene_output sink.
//   * voxel_layers / name_list ports (scene_output sink) → layers (voxel).
//
// The kernel exec bus carries no payloads, so output VALUES are pulled via the
// ApiClient on each exec:completed. Output PORT TYPES come from the op catalog
// (listOps), fetched once and cached. Per-node `previewEnabled` (default true)
// gates visibility, mirroring the editor's preview toggle.

type PortSpec = { name: string; type: string }

function isCanonicalSceneOp(opId: string): boolean {
  return opId === 'scene_output'
}

const MESH_SKIP_WHEN_SCENE = new Set([
  'heightfield_mesh',
  'grid_to_boxes',
  'gabled_houses',
  'mesh_to_node',
  'stroke_sweep_mesh',
])

function skipMeshPort(opId: string, hasCanonicalScene: boolean): boolean {
  if (!hasCanonicalScene) return false
  return MESH_SKIP_WHEN_SCENE.has(opId) || opId.startsWith('local/')
}

/** Sharded outputs (tree_merge etc.) are too large to inline-fetch; skip them. */
async function isShardedOutput(
  client: HttpApiClient,
  nodeId: string,
  port: string,
): Promise<boolean> {
  try {
    const meta = await client.getNodeOutputMeta(nodeId, port)
    return meta?.sharded === true
  } catch {
    return false
  }
}

/** A dense 2D grid (`number[][]`): non-empty array whose first row is a number array. */
function isGrid2D(value: unknown): value is number[][] {
  if (!Array.isArray(value) || value.length === 0) return false
  const firstRow = value[0]
  return Array.isArray(firstRow) && (firstRow.length === 0 || typeof firstRow[0] === 'number')
}

/** DataTree wire shape: `[{ path, items:[…] }, …]`. */
function isWireEntries(value: unknown): value is Array<{ items?: unknown[] }> {
  return Array.isArray(value) && value.length > 0 &&
    typeof value[0] === 'object' && value[0] !== null &&
    Array.isArray((value[0] as { items?: unknown[] }).items)
}

/**
 * Recursively collect every 2D grid (`number[][]`) reachable from a runtime
 * payload. Pass-through batteries declare dynamic outputs as `any`/`tree`, so
 * the port type is too wide to gate on; here we trust the actual data and pull
 * any grids out of the wire/array nesting so the renderer still shows layers.
 * (Faithful analog of the legacy renderer `collectGridValues`.)
 */
function collectGrids(value: unknown, out: number[][][] = []): number[][][] {
  if (isGrid2D(value)) { out.push(value); return out }
  if (isWireEntries(value)) {
    for (const item of flattenWire<unknown>(value)) collectGrids(item, out)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGrids(item, out)
  }
  return out
}

function isMeshPayload(value: unknown): value is MeshPayload {
  if (!value || typeof value !== 'object') return false
  const rec = value as { positions?: unknown; indices?: unknown }
  return Array.isArray(rec.positions) && Array.isArray(rec.indices)
}

function collectMesh(raw: unknown): MeshPayload | null {
  if (isMeshPayload(raw)) return raw
  for (const item of flattenWire(raw)) {
    if (isMeshPayload(item)) return item
  }
  return null
}

function hydrateRefMeshes(
  sourceNodeId: string,
  port: ScenePortValue,
  setMeshLayer: (
    nodeId: string,
    portName: string,
    nodeName: string,
    mesh: MeshPayload,
    instances?: import('../types').MeshInstanceXform[],
  ) => void,
): string[] {
  const keys: string[] = []
  for (const item of collectRefMeshesFromScene(port)) {
    setMeshLayer(sourceNodeId, item.portName, item.name, item.mesh, item.instances)
    keys.push(`${sourceNodeId}:${item.portName}`)
  }
  return keys
}

function hydrateSceneGuides(
  sourceNodeId: string,
  port: ScenePortValue,
  setGuideLayer: (nodeId: string, portName: string, nodeName: string, points: GuidePoint[], style?: GuideStyle) => void,
  manuals: Array<{ id: string; x: number; y: number }>,
  controlNodes: Array<{ id: string; opId: string; params?: Record<string, unknown> }>,
): string[] {
  const keys: string[] = []
  for (const item of collectGuidesFromScene(port)) {
    const points = attachGuideSources(item.points, manuals, controlNodes)
    setGuideLayer(sourceNodeId, item.portName, item.name, points, item.style)
    keys.push(`${sourceNodeId}:${item.portName}`)
  }
  return keys
}

function collectGuidePoints(raw: unknown): GuidePoint[] {
  const direct = parseGuidePoints(raw)
  if (direct.length) return direct
  for (const item of flattenWire(raw)) {
    const pts = parseGuidePoints(item)
    if (pts.length) return pts
  }
  return []
}

function debugPreviewErrors(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('wb-scene-generator.debugPreview') === 'true'
}

// ── Live direct-push projector (slider-drag fast path) ───────────────────────
// The editor pushes freshly executed output VALUES straight to this iframe via
// the `workbench:preview-data` postMessage, bypassing the WS `exec:completed` →
// `getNodeOutput` re-pull round-trip (~200ms) that is the felt slider lag. The
// push carries `nodeId → portName → value`, but the op port-type catalog and
// per-node names live here (loaded by `useNodePreviews`). So `useNodePreviews`
// registers a projector that turns a pushed outputs map into setPreviewLayer/
// setLayers calls using its in-memory catalog — no network, same projection as
// the WS path. View-only latency shortcut; the trailing exec:completed / GC
// still own eviction and the durable post-drag refresh.
type LiveProjector = (outputs: Record<string, Record<string, unknown>>) => void
let _liveProjector: LiveProjector | null = null
let _localParamEditNotifier: (() => void) | null = null

/**
 * Project a directly-pushed outputs map (`nodeId → portName → value`) into the
 * render store, identical to the WS re-pull path but with zero network. No-op
 * until `useNodePreviews` has mounted and loaded the op catalog. Safe to call
 * from the renderer's `workbench:preview-data` handler on every drag tick.
 */
export function projectLiveOutputs(outputs: Record<string, Record<string, unknown>>): void {
  syncTrace('preview:live-push', { nodes: summarizeNodeOutputs(outputs) })
  _liveProjector?.(outputs)
}

/** Explicit host pulse sent before a local slider tick mutates the graph. */
export function notifyLocalParamEdit(): void {
  _localParamEditNotifier?.()
}

export function useNodePreviews(client: HttpApiClient): void {
  const setLayers = useRenderStore((s) => s.setLayers)
  const setLayersVisibleForNode = useRenderStore((s) => s.setLayersVisibleForNode)
  const retainVoxelNodes = useRenderStore((s) => s.retainVoxelNodes)
  const setPreviewLayer = useRenderStore((s) => s.setPreviewLayer)
  const setPreviewLayersVisibleForNode = useRenderStore((s) => s.setPreviewLayersVisibleForNode)
  const retainPreviewLayers = useRenderStore((s) => s.retainPreviewLayers)
  const setMeshLayer = useRenderStore((s) => s.setMeshLayer)
  const setMeshLayersVisibleForNode = useRenderStore((s) => s.setMeshLayersVisibleForNode)
  const retainMeshLayers = useRenderStore((s) => s.retainMeshLayers)
  const setGuideLayer = useRenderStore((s) => s.setGuideLayer)
  const setGuideLayersVisibleForNode = useRenderStore((s) => s.setGuideLayersVisibleForNode)
  const retainGuideLayers = useRenderStore((s) => s.retainGuideLayers)

  useEffect(() => {
    syncTraceHintOnce()
    let cancelled = false
    // Bumped on every project switch (project:viewing WS event or
    // workbench:project-changed postMessage). `client.viewingProjectId` is a
    // single mutable field read fresh by every `projectPrefix()` call, so a
    // refresh() already in flight for the OLD project can have its LATER
    // `getNodeOutput` awaits silently redirected to the NEW project mid-loop
    // once the switch flips that field — painting the new project's data under
    // the old project's node ids (near-identical demo templates share node-id
    // schemes, so this doesn't even 404, it just shows the wrong content).
    // Every refresh() captures the revision at start and re-checks it after
    // every await; a mismatch means a switch happened underneath it, so it
    // bails without touching the store (a fresh refresh for the new project is
    // already scheduled by the same handler that bumped the revision).
    let projectRevision = 0
    let currentProjectId: string | null = null
    const draftCursors = new Map<string, {
      generation: number
      previewRevision: string | null
      projectRevision: string | null
    }>()
    const postPreviewStatus = (
      executionStatus: 'idle' | 'running' | 'completed' | 'error',
      executionId?: string,
    ) => {
      if (typeof window === 'undefined' || window.parent === window) return
      const state = useRenderStore.getState()
      const digest = [
        Object.keys(state.layers).length,
        Object.keys(state.previewLayers).length,
        Object.keys(state.meshLayers).length,
        Object.keys(state.guideLayers).length,
        executionId ?? '',
      ].join(':')
      window.parent.postMessage({
        type: 'workbench:preview-status',
        viewingProjectId: currentProjectId,
        executionId: executionId ?? null,
        executionStatus,
        voxelLayers: Object.keys(state.layers).length,
        gridLayers: Object.keys(state.previewLayers).length,
        meshLayers: Object.keys(state.meshLayers).length,
        guideLayers: Object.keys(state.guideLayers).length,
        frameTimestamp: new Date().toISOString(),
        frameDigest: digest,
      }, window.location.origin)
    }
    // opId → output port specs, fetched lazily once (the catalog is static for a
    // session). A failed fetch leaves the cache null so a later run can retry.
    let opOutputs: Map<string, PortSpec[]> | null = null
    // nodeId → { opId, name }, refreshed from every listNodes() pass. The live
    // direct-push projector reads this (instead of re-fetching listNodes per
    // tick) to map a pushed (nodeId, port) value to its port types + label.
    const nodeMeta = new Map<string, { opId: string; name: string; params?: Record<string, unknown> }>()
    let lastManuals: Array<{ id: string; x: number; y: number }> = []
    let lastControlNodes: Array<{ id: string; opId: string; params?: Record<string, unknown> }> = []
    // `nodeId\0portId` → the `executedHash` whose VALUE we last projected, plus
    // the grid layer keys that value produced. A param edit re-executes a
    // handful of nodes, but a full refresh collects every renderable port in
    // the graph; re-pulling all of them re-reads and re-serializes the whole
    // graph's outputs from disk on every tick, which dominates preview latency.
    // Keyed by hash so an unchanged port can be skipped entirely — its layers
    // are already in the store, and the remembered grid keys are replayed into
    // the GC's desired set so nothing gets evicted. Same contract as the editor
    // store's `_outputMetaByPort`.
    const portCache = new Map<string, { hash: string; gridKeys: string[] }>()
    // A network refresh can start before an execute response is pushed directly
    // from the editor, then finish afterwards with an older cached value. Track
    // the latest live write per node so that stale fetches cannot paint over it.
    let liveProjectionRevision = 0
    const liveNodeRevisions = new Map<string, number>()
    async function ensureOpOutputs(): Promise<Map<string, PortSpec[]>> {
      if (opOutputs) return opOutputs
      const ops = await client.listOps()
      opOutputs = new Map(
        ops.map((o) => [o.id, ((o.outputs ?? []) as PortSpec[]).map((p) => ({ name: p.name, type: p.type }))]),
      )
      return opOutputs
    }

    // Project the grid/voxel buckets for ONE node from already-resolved values.
    // Shared by the WS re-pull path (`refresh`, values from getNodeOutput) and the
    // live direct-push projector (values from the postMessage). `getValue` returns
    // the resolved wire value for a port; voxel pulls (list-valued) stay async via
    // the WS path's getValue, while the push path only carries grids (sync). The
    // function returns the grid keys it set so the caller can drive GC.
    const desiredGridKeysFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
    ): string[] => {
      const ports = (opOutputs?.get(opId)) ?? []
      const keys: string[] = []
      if (!previewEnabled) {
        // Hide, don't drop: the node might come right back (re-enable), and the
        // backend's output cache is short-lived — a delete-then-refetch on
        // re-enable can race an evicted cache and never come back (see
        // setLayersVisibleForNode's doc).
        setPreviewLayersVisibleForNode(nodeId, false)
        return keys
      }
      setPreviewLayersVisibleForNode(nodeId, true)
      const gridPorts = ports.filter((p) =>
        p.type === 'grid' || p.type === 'any' || p.type === 'array' || p.type === 'list')
      for (const port of gridPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const isDeclaredGrid = port.type === 'grid'
        const grids = isDeclaredGrid
          ? flattenWire<number[][]>(raw).filter(isGrid2D)
          : collectGrids(raw)
        if (grids.length === 0) continue
        grids.forEach((grid, i) => {
          const portKey = grids.length > 1 ? `${port.name}[${i}]` : port.name
          setPreviewLayer(nodeId, portKey, nodeName, grid)
          keys.push(`${nodeId}:${portKey}`)
        })
      }
      return keys
    }

    const projectMeshFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
    ): string[] => {
      const ports = (opOutputs?.get(opId)) ?? []
      const keys: string[] = []
      if (!previewEnabled) {
        setMeshLayersVisibleForNode(nodeId, false)
        return keys
      }
      setMeshLayersVisibleForNode(nodeId, true)
      for (const port of ports.filter((p) => p.type === 'mesh')) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const mesh = collectMesh(raw)
        if (!mesh) continue
        setMeshLayer(nodeId, port.name, nodeName, mesh)
        keys.push(`${nodeId}:${port.name}`)
      }
      return keys
    }

    const projectGuideFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
      manuals: Array<{ id: string; x: number; y: number }>,
      controlNodes?: Array<{ id: string; opId: string; params?: Record<string, unknown> }>,
      styleRaw?: unknown,
    ): string[] => {
      const keys: string[] = []
      if (opId !== 'points_to_node') return keys
      if (!previewEnabled) {
        setGuideLayersVisibleForNode(nodeId, false)
        return keys
      }
      setGuideLayersVisibleForNode(nodeId, true)
      const ports = (opOutputs?.get(opId)) ?? []
      const style = parseGuideStyle(styleRaw)
      for (const port of ports.filter((p) => p.type === 'point2d' || p.name === 'points')) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const points = attachGuideSources(collectGuidePoints(raw), manuals, controlNodes)
        if (points.length === 0) continue
        setGuideLayer(nodeId, port.name, nodeName, points, style)
        keys.push(`${nodeId}:${port.name}`)
      }
      return keys
    }

    const projectVoxelLayersFor = (
      nodeId: string,
      opId: string,
      previewEnabled: boolean,
      getValue: (portName: string) => unknown,
    ): void => {
      const ports = (opOutputs?.get(opId)) ?? []
      const voxelPort = ports.find((p) => p.type === 'voxel_layers')
      const scenePort = ports.find((p) => p.type === 'scene' || p.name === 'scene')
      if (scenePort && previewEnabled && isCanonicalSceneOp(opId)) {
        const rawScene = getValue(scenePort.name)
        const parsed = parseScenePortFromWire(rawScene)
        if (parsed) {
          useRenderStore.getState().setScenePort(nodeId, parsed)
          hydrateRefMeshes(nodeId, parsed, setMeshLayer)
          hydrateSceneGuides(nodeId, parsed, setGuideLayer, lastManuals, lastControlNodes)
        }
      }
      if (!voxelPort) return
      if (!previewEnabled) {
        // Hide, don't drop — see setLayersVisibleForNode's doc.
        setLayersVisibleForNode(nodeId, false)
        return
      }
      setLayersVisibleForNode(nodeId, true)
      const raw = getValue(voxelPort.name)
      if (raw === undefined) return
      const layers = flattenWireList<VoxelLayer>(raw)
      const namePort = ports.find((p) => p.type === 'name_list')
      const names = namePort
        ? flattenWireList<NameListEntry>(getValue(namePort.name))
        : []
      if (layers.length) setLayers(nodeId, opId, layers, names)
    }

    // Register the live direct-push projector: the editor forwards freshly
    // executed outputs over `workbench:preview-data`; we paint them straight into
    // the render store using the cached catalog/meta, with zero network. Grids
    // AND voxel_layers sinks (scene_output) ride this path so param edits on the
    // root graph update the preview in the same frame as the wire probe.
    _liveProjector = (outputs) => {
      // A direct output push is authoritative evidence that the editor already
      // has this execution's values. Suppress the redundant WS→GET refresh even
      // if the preceding activity pulse was delayed or dropped.
      _localParamEditNotifier?.()
      const overrides = useRenderStore.getState().previewOverrides
      let missingMeta = false
      for (const [nodeId, ports] of Object.entries(outputs)) {
        liveNodeRevisions.set(nodeId, ++liveProjectionRevision)
        const meta = nodeMeta.get(nodeId)
        if (!meta) {
          missingMeta = true
          continue
        }
        const override = overrides[nodeId]
        const previewEnabled = override !== undefined ? override : true
        projectVoxelLayersFor(nodeId, meta.opId, previewEnabled, (portName) => ports[portName])
        desiredGridKeysFor(nodeId, meta.opId, meta.name, previewEnabled, (portName) => ports[portName])
        projectMeshFor(nodeId, meta.opId, meta.name, previewEnabled, (portName) => ports[portName])
        projectGuideFor(nodeId, meta.opId, meta.name, previewEnabled, (portName) => ports[portName], lastManuals, lastControlNodes, meta.params?.style)
      }
      if (missingMeta) scheduleRefresh()
    }

    async function refresh(onlyNodeIds?: ReadonlySet<string>): Promise<void> {
      const revision = projectRevision
      const liveRevisionAtStart = liveProjectionRevision
      const __t0 = performance.now()
      syncTrace('preview:refresh-start', { narrowed: onlyNodeIds?.size ?? 'full' })
      const viewingProjectId = await client.ensureViewingProject()
      currentProjectId = viewingProjectId || currentProjectId
      const __t1 = performance.now()
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh ABORTED after ensureViewingProject (stale revision) +${(__t1 - __t0).toFixed(1)}ms`)
        return
      }
      useRenderStore.getState().loadOutputLayerOrder(viewingProjectId)
      const [allNodes, specs] = await Promise.all([client.listNodes(), ensureOpOutputs()])
      const __t2 = performance.now()
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh ABORTED after listNodes/ops (stale revision) +${(__t2 - __t1).toFixed(1)}ms`)
        return
      }
      // Refresh the node meta cache used by the live push projector.
      nodeMeta.clear()
      for (const n of allNodes) nodeMeta.set(n.id, { opId: n.opId, name: n.name ?? n.id, params: n.params })
      const manuals = collectManualPointNodes(allNodes)
      lastManuals = manuals
      const controlNodes = collectControlPointsNodes(allNodes)
      lastControlNodes = controlNodes
      // Keep the race guard bounded across long editing sessions.
      for (const nodeId of liveNodeRevisions.keys()) {
        if (!nodeMeta.has(nodeId)) liveNodeRevisions.delete(nodeId)
      }

      // Narrowed re-pull (drag-tick fast path): a high-frequency `exec:completed`
      // only needs the nodes this execution actually touched (collected from the
      // `exec:node:output` events), not every node in the graph. This cuts the
      // per-tick fan-out from O(graph) `getNodeOutput` calls down to the handful
      // downstream of the dragged slider — the iframe preview can then keep up
      // with the drag. Generic: purely a projection scope, no computation moves
      // here. GC is skipped on a narrowed pass (it needs the full node set); the
      // graph:applied / initial full refresh owns eviction.
      const hasCanonicalScene = allNodes.some((n) => isCanonicalSceneOp(n.opId))
      const narrowed = onlyNodeIds !== undefined && onlyNodeIds.size > 0
      // Narrowed exec refresh (param-drag fast path): re-pull only nodes touched
      // this run — EXCEPT voxel_layers sinks (scene_output). Upstream group /
      // const edits always change the final scene even when the sink did not emit
      // exec:node:output in a partial frame; always re-fetch sinks so preview ==
      // probe == manual wiring.
      const nodes = narrowed
        ? allNodes.filter((n) => {
            if (onlyNodeIds!.has(n.id)) return true
            const ports = specs.get(n.opId) ?? []
            return ports.some((p) => p.type === 'voxel_layers')
          })
        : allNodes

      if (!narrowed) updateLoadingTask('previews', { total: nodes.length })

      const desiredGridKeys = new Set<string>()
      const desiredMeshKeys = new Set<string>()
      const desiredGuideKeys = new Set<string>()
      const nodeIds = new Set<string>()
      // Editor preview toggles ride the `workbench:preview-change` postMessage,
      // not the backend graph, so consult the client-side override first; only
      // fall back to the backend `previewEnabled` when a node has no override.
      const overrides = useRenderStore.getState().previewOverrides

      // Phase 1 (sync, no network): classify every node and fire the
      // zero-cost visibility flips immediately; collect the ones that need a
      // network fetch into task lists.
      type VoxelTask = { node: typeof nodes[number]; voxelPort: PortSpec; namePort?: PortSpec; scenePort?: PortSpec }
      type GridTask = { node: typeof nodes[number]; port: PortSpec }
      const voxelTasks: VoxelTask[] = []
      const gridTasks: GridTask[] = []
      const meshTasks: GridTask[] = []
      const guideTasks: GridTask[] = []

      for (const node of nodes) {
        nodeIds.add(node.id)
        const ports = specs.get(node.opId) ?? []
        const override = overrides[node.id]
        const previewEnabled =
          override !== undefined ? override : (node as { previewEnabled?: boolean }).previewEnabled !== false

        // ── voxel layers (scene_output sink): replace this node's voxel bucket ──
        const voxelPort = ports.find((p) => p.type === 'voxel_layers')
        const scenePort = ports.find((p) => p.type === 'scene' || p.name === 'scene')
        const previewScene = scenePort && isCanonicalSceneOp(node.opId)
        if (voxelPort || previewScene) {
          if (previewEnabled) {
            // Restore visibility synchronously (no network wait) so re-enabling
            // is instant and immune to the backend output-cache race below: if
            // the fetch comes back empty (cache already evicted since this node
            // was hidden), the cached cells stay visible instead of vanishing.
            if (voxelPort) setLayersVisibleForNode(node.id, true)
            const namePort = ports.find((p) => p.type === 'name_list')
            voxelTasks.push({
              node,
              voxelPort: voxelPort ?? { name: 'layers', type: 'voxel_layers' },
              ...(namePort ? { namePort } : {}),
              ...(previewScene ? { scenePort } : {}),
            })
          } else {
            // Hide, don't drop — see setLayersVisibleForNode's doc. Dropping
            // here was the "enable preview" bug: re-fetching after re-enable
            // can race an evicted backend cache and come back empty forever.
            if (voxelPort) setLayersVisibleForNode(node.id, false)
            useRenderStore.getState().removeScenePort(node.id)
          }
        }

        // ── grid previews (any node) ──
        // grid ports are declared dense previews; any/array/list ports (e.g.
        // pass-through batteries with dynamic `any`/`tree` outputs) may still
        // carry grid payloads at runtime, so include them and trust the data.
        const gridPorts = ports.filter((p) =>
          p.type === 'grid' || p.type === 'any' || p.type === 'array' || p.type === 'list')
        const meshPorts = ports.filter((p) => p.type === 'mesh')
        if (!previewEnabled) {
          setPreviewLayersVisibleForNode(node.id, false)
          setMeshLayersVisibleForNode(node.id, false)
          setGuideLayersVisibleForNode(node.id, false)
          continue
        }
        setPreviewLayersVisibleForNode(node.id, true)
        setMeshLayersVisibleForNode(node.id, true)
        setGuideLayersVisibleForNode(node.id, true)
        if (!(hasCanonicalScene && node.opId.startsWith('local/'))) {
          for (const port of gridPorts) gridTasks.push({ node, port })
        }
        if (!skipMeshPort(node.opId, hasCanonicalScene)) {
          for (const port of meshPorts) meshTasks.push({ node, port })
        }
        if (node.opId === 'points_to_node') {
          const guidePorts = ports.filter((p) => p.type === 'point2d' || p.name === 'points')
          for (const port of guidePorts) guideTasks.push({ node, port })
        }
      }

      // Phase 2 (async): previously each node's port(s) were fetched with
      // sequential `await`s — an O(nodes × ports) chain of network round trips
      // that is the direct cause of the felt "slow switching" lag on any graph
      // with more than a handful of nodes. Collapse the WHOLE wave (voxel +
      // name + grid ports, across every task) into a SINGLE batched HTTP POST
      // when the transport supports it; fall back to per-port parallel GETs
      // otherwise (e.g. the unit-test fake client).
      const __t3 = performance.now()
      const portKey = (nodeId: string, portId: string): string => `${nodeId}\u0000${portId}`

      // Phase 2a (cheap): ask for output METADATA only, then re-pull values just
      // for the ports whose `executedHash` moved. A single param edit re-executes
      // a handful of nodes, but the task lists above span every renderable port
      // in the graph — and a value pull makes the backend reassemble each sharded
      // port from disk and serialize it. Skipping unchanged ports is what lets a
      // param edit repaint promptly instead of re-paying for the whole graph.
      // A metaOnly pass is a stat + tiny-JSON read per port, so this extra round
      // trip is orders of magnitude cheaper than what it elides.
      const allPorts: Array<{ nodeId: string; portId: string }> = []
      for (const t of voxelTasks) {
        allPorts.push({ nodeId: t.node.id, portId: t.voxelPort.name })
        if (t.namePort) allPorts.push({ nodeId: t.node.id, portId: t.namePort.name })
        if (t.scenePort) allPorts.push({ nodeId: t.node.id, portId: t.scenePort.name })
      }
      for (const t of gridTasks) allPorts.push({ nodeId: t.node.id, portId: t.port.name })
      for (const t of meshTasks) allPorts.push({ nodeId: t.node.id, portId: t.port.name })
      for (const t of guideTasks) allPorts.push({ nodeId: t.node.id, portId: t.port.name })

      let hashByPort: Map<string, string> | null = null
      if (typeof client.getNodeOutputsBatch === 'function' && allPorts.length > 0) {
        try {
          const metaRes = await client.getNodeOutputsBatch(allPorts, { metaOnly: true })
          if (metaRes) {
            hashByPort = new Map()
            for (const r of metaRes) {
              const hash = r.meta?.valid === true ? r.meta.executedHash : undefined
              if (hash) hashByPort.set(portKey(r.nodeId, r.portId), hash)
            }
          }
        } catch {
          // Metadata unavailable (older backend / network hiccup): fall through
          // with hashByPort=null, which re-pulls everything exactly as before.
          hashByPort = null
        }
      }
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh ABORTED after meta pre-check (stale revision)`)
        return
      }

      // A port is unchanged when the backend reports the same executedHash we
      // already projected a value for. Its layers are still in the store.
      const isUnchanged = (nodeId: string, portId: string): boolean => {
        if (!hashByPort) return false
        const hash = hashByPort.get(portKey(nodeId, portId))
        if (!hash) return false
        return portCache.get(portKey(nodeId, portId))?.hash === hash
      }

      const staleVoxelTasks = voxelTasks.filter((t) => !isUnchanged(t.node.id, t.voxelPort.name))
      const staleGridTasks: GridTask[] = []
      for (const t of gridTasks) {
        if (!isUnchanged(t.node.id, t.port.name)) {
          staleGridTasks.push(t)
          continue
        }
        for (const key of portCache.get(portKey(t.node.id, t.port.name))?.gridKeys ?? []) {
          desiredGridKeys.add(key)
        }
      }
      const staleMeshTasks: GridTask[] = []
      for (const t of meshTasks) {
        if (!isUnchanged(t.node.id, t.port.name)) {
          staleMeshTasks.push(t)
          continue
        }
        for (const key of portCache.get(portKey(t.node.id, t.port.name))?.gridKeys ?? []) {
          desiredMeshKeys.add(key)
        }
      }
      const staleGuideTasks: GridTask[] = []
      for (const t of guideTasks) {
        if (!isUnchanged(t.node.id, t.port.name)) {
          staleGuideTasks.push(t)
          continue
        }
        for (const key of portCache.get(portKey(t.node.id, t.port.name))?.gridKeys ?? []) {
          desiredGuideKeys.add(key)
        }
      }

      const __voxelFetchCount = staleVoxelTasks.length * 2 // voxel port + optional name port (upper bound)
      const __gridFetchCount = staleGridTasks.length
      const __skipped = (voxelTasks.length - staleVoxelTasks.length) + (gridTasks.length - staleGridTasks.length)
      let batchValues: Map<string, unknown> | null = null
      if (typeof client.getNodeOutputsBatch === 'function') {
        const batchPorts: Array<{ nodeId: string; portId: string }> = []
        for (const t of staleVoxelTasks) {
          batchPorts.push({ nodeId: t.node.id, portId: t.voxelPort.name })
          if (t.namePort) batchPorts.push({ nodeId: t.node.id, portId: t.namePort.name })
          if (t.scenePort) batchPorts.push({ nodeId: t.node.id, portId: t.scenePort.name })
        }
        for (const t of staleGridTasks) batchPorts.push({ nodeId: t.node.id, portId: t.port.name })
        for (const t of staleMeshTasks) batchPorts.push({ nodeId: t.node.id, portId: t.port.name })
        for (const t of staleGuideTasks) batchPorts.push({ nodeId: t.node.id, portId: t.port.name })
        if (batchPorts.length > 0) {
          try {
            const res = await client.getNodeOutputsBatch(batchPorts)
            batchValues = new Map(res.map((r) => [portKey(r.nodeId, r.portId), r.value]))
          } catch {
            batchValues = null // network hiccup — fall back to the per-port path below
          }
        }
      }
      const getPortValue = (nodeId: string, portId: string): Promise<unknown> | unknown =>
        batchValues ? batchValues.get(portKey(nodeId, portId)) : client.getNodeOutput(nodeId, portId)
      const [voxelResults, gridResults, meshResults, guideResults] = await Promise.all([
        Promise.all(staleVoxelTasks.map(async (t) => {
          const layers = flattenWireList<VoxelLayer>(await getPortValue(t.node.id, t.voxelPort.name))
          const names = t.namePort
            ? flattenWireList<NameListEntry>(await getPortValue(t.node.id, t.namePort.name))
            : []
          const scenePortValue = t.scenePort
            ? parseScenePortFromWire(await getPortValue(t.node.id, t.scenePort.name))
            : null
          return { node: t.node, layers, names, scenePortValue }
        })),
        Promise.all(staleGridTasks.map(async (t) => {
          const raw = await getPortValue(t.node.id, t.port.name)
          return { node: t.node, port: t.port, raw }
        })),
        Promise.all(staleMeshTasks.map(async (t) => {
          const raw = await getPortValue(t.node.id, t.port.name)
          return { node: t.node, port: t.port, raw }
        })),
        Promise.all(staleGuideTasks.map(async (t) => {
          const raw = await getPortValue(t.node.id, t.port.name)
          return { node: t.node, port: t.port, raw }
        })),
      ])

      const __t4 = performance.now()
      console.log(
        `[switch-trace] preview:refresh nodes=${allNodes.length} skippedUnchanged=${__skipped} voxelTasks=${staleVoxelTasks.length}(~${__voxelFetchCount}req) gridTasks=${__gridFetchCount}req ` +
          `ensureViewingProject=${(__t1 - __t0).toFixed(1)}ms listNodes+ops=${(__t2 - __t1).toFixed(1)}ms ` +
          `classify=${(__t3 - __t2).toFixed(1)}ms fetchWave(parallel)=${(__t4 - __t3).toFixed(1)}ms TOTAL=${(__t4 - __t0).toFixed(1)}ms`,
      )
      // Single staleness check AFTER the fetch wave settles — if a project
      // switch happened while any of these were in flight, `client`'s shared
      // viewingProjectId (read fresh by every getNodeOutput call) may have
      // drifted mid-fetch, so the results above could belong to the WRONG
      // project. Discard them wholesale rather than risk painting mismatched
      // content; the switch handler that bumped the revision already
      // scheduled a fresh refresh for the project actually being viewed now.
      if (cancelled || revision !== projectRevision) {
        console.log(`[switch-trace] preview:refresh DISCARDED after fetch wave (stale revision) — results thrown away`)
        return
      }

      // Index the current layer keys once per refresh. A live push may have
      // landed during the fetch wave, so build this after the awaits. This keeps
      // stale/empty-output retention O(grid ports + preview layers), rather than
      // rescanning every preview layer for every affected port.
      const existingGridKeysByPort = new Map<string, string[]>()
      const gridPortIndexKey = (nodeId: string, portName: string): string =>
        `${nodeId}\u0000${portName}`
      for (const { node, port } of gridTasks) {
        existingGridKeysByPort.set(gridPortIndexKey(node.id, port.name), [])
      }
      for (const [key, layer] of Object.entries(useRenderStore.getState().previewLayers)) {
        const exactIndexKey = gridPortIndexKey(layer.nodeId, layer.portName)
        let bucket = existingGridKeysByPort.get(exactIndexKey)
        if (!bucket) {
          const multiValueMatch = /^(.*)\[\d+\]$/.exec(layer.portName)
          if (multiValueMatch) {
            bucket = existingGridKeysByPort.get(gridPortIndexKey(layer.nodeId, multiValueMatch[1]))
          }
        }
        bucket?.push(key)
      }
      const retainExistingGridKeys = (nodeId: string, portName: string) => {
        for (const key of existingGridKeysByPort.get(gridPortIndexKey(nodeId, portName)) ?? []) {
          desiredGridKeys.add(key)
        }
      }

      // Remember the hash we just projected so the next pass can skip this port.
      // Only ports we actually fetched are recorded, and only when the backend
      // gave a hash — a port with no valid cache entry stays uncached so it is
      // retried, never silently pinned.
      const rememberHash = (nodeId: string, portId: string, gridKeys: string[]): void => {
        const hash = hashByPort?.get(portKey(nodeId, portId))
        if (hash) portCache.set(portKey(nodeId, portId), { hash, gridKeys })
      }

      for (const { node, layers, names, scenePortValue } of voxelResults) {
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) continue
        if (layers.length) setLayers(node.id, node.opId, layers, names)
        if (scenePortValue) {
          useRenderStore.getState().setScenePort(node.id, scenePortValue)
          for (const key of hydrateRefMeshes(node.id, scenePortValue, setMeshLayer)) {
            desiredMeshKeys.add(key)
          }
          for (const key of hydrateSceneGuides(node.id, scenePortValue, setGuideLayer, manuals, controlNodes)) {
            desiredGuideKeys.add(key)
          }
        }
        // empty payload: keep the last good frame. Param-drag emits
        // graph:applied (cache invalidated) BEFORE execute finishes, so
        // clearing here would black out the preview until rerun.
      }
      for (const t of staleVoxelTasks) {
        rememberHash(t.node.id, t.voxelPort.name, [])
        if (t.namePort) rememberHash(t.node.id, t.namePort.name, [])
        if (t.scenePort) rememberHash(t.node.id, t.scenePort.name, [])
      }

      for (const { node, port, raw } of gridResults) {
        // The editor's direct push is newer than this fetch wave. Keep its keys
        // and discard the stale network result instead of visibly jumping back.
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) {
          retainExistingGridKeys(node.id, port.name)
          continue
        }
        // Declared grid ports: one flattened item == one dense grid. Wider
        // (any/array/list) ports: recursively pull grids out of the payload.
        const isDeclaredGrid = port.type === 'grid'
        const grids = isDeclaredGrid
          ? flattenWire<number[][]>(raw).filter(isGrid2D)
          : collectGrids(raw)
        if (grids.length === 0) {
          // Output caches are briefly empty between graph:applied and execute.
          // A declared grid cannot change runtime type, so retain its last good
          // frame; node deletion, port removal and preview-off are still GC'd.
          if (isDeclaredGrid) retainExistingGridKeys(node.id, port.name)
          continue
        }
        const producedKeys: string[] = []
        grids.forEach((grid, i) => {
          const layerPort = grids.length > 1 ? `${port.name}[${i}]` : port.name
          setPreviewLayer(node.id, layerPort, node.name ?? node.id, grid)
          const key = `${node.id}:${layerPort}`
          desiredGridKeys.add(key)
          producedKeys.push(key)
        })
        rememberHash(node.id, port.name, producedKeys)
      }

      for (const { node, port, raw } of meshResults) {
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().meshLayers[key]) desiredMeshKeys.add(key)
          continue
        }
        const mesh = collectMesh(raw)
        if (!mesh) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().meshLayers[key]) desiredMeshKeys.add(key)
          continue
        }
        setMeshLayer(node.id, port.name, node.name ?? node.id, mesh)
        const key = `${node.id}:${port.name}`
        desiredMeshKeys.add(key)
        rememberHash(node.id, port.name, [key])
      }

      for (const { node, port, raw } of guideResults) {
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().guideLayers[key]) desiredGuideKeys.add(key)
          continue
        }
        const points = attachGuideSources(collectGuidePoints(raw), manuals, controlNodes)
        if (points.length === 0) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().guideLayers[key]) desiredGuideKeys.add(key)
          continue
        }
        setGuideLayer(node.id, port.name, node.name ?? node.id, points, parseGuideStyle(node.params?.style))
        const key = `${node.id}:${port.name}`
        desiredGuideKeys.add(key)
        rememberHash(node.id, port.name, [key])
      }

      // GC layers whose source node/port vanished (deleted node, removed list
      // item, or a disconnect that left a node with no renderable output). This
      // is the faithful analog of the legacy `clearStale*` / `removePreviewLayer`
      // eviction — `listNodes()` is the post-mutation source of truth, so any
      // layer keyed off a node/port that is gone (or now empty) is pruned.
      // Skip on a NARROWED pass: it only inspected a subset of nodes, so its
      // desired sets are incomplete and would wrongly evict live layers belonging
      // to untouched nodes. Full refreshes (graph:applied, mount) own the GC.
      if (!narrowed) {
        for (const [nodeId, port] of Object.entries(useRenderStore.getState().scenePorts)) {
          if (!nodeIds.has(nodeId)) continue
          for (const key of hydrateRefMeshes(nodeId, port, setMeshLayer)) desiredMeshKeys.add(key)
          for (const key of hydrateSceneGuides(nodeId, port, setGuideLayer, manuals, controlNodes)) {
            desiredGuideKeys.add(key)
          }
        }
        retainPreviewLayers(desiredGridKeys)
        retainMeshLayers(desiredMeshKeys)
        retainGuideLayers(desiredGuideKeys)
        retainVoxelNodes(nodeIds)
        useRenderStore.getState().retainScenePorts(nodeIds)
      }
      syncTrace('preview:refresh-done', {
        voxelNodes: nodeIds.size,
        gridKeys: desiredGridKeys.size,
        narrowed,
      })
      postPreviewStatus(executionsInFlight.size ? 'running' : 'completed')
    }

    // Coalesce bursts (a delete can fire graph:applied, and downstream re-exec
    // can fire exec:completed) into a single refresh, and never overlap two
    // in-flight refreshes; if a trigger lands mid-flight, run exactly one more.
    let refreshTimer: ReturnType<typeof setTimeout> | null = null
    let graphRefreshTimer: ReturnType<typeof setTimeout> | null = null
    let localParamSettleTimer: ReturnType<typeof setTimeout> | null = null
    const GRAPH_REFRESH_DEBOUNCE_MS = 400
    const LOCAL_PARAM_SETTLE_MS = 190
    let localParamEditUntil = 0
    const executionsInFlight = new Set<string>()
    let inFlight = false
    let pending = false
    let pendingNarrow: Set<string> | null = null
    async function runRefresh(): Promise<void> {
      if (inFlight) { pending = true; return }
      inFlight = true
      const scope = pendingNarrow
      pendingNarrow = null
      // Only surface the loading indicator for FULL refreshes (project switch /
      // mount / graph:applied) — narrowed slider-drag re-pulls are high-frequency
      // and would just make the progress panel flicker for no user benefit.
      const isFullRefresh = scope === null
      if (isFullRefresh) beginLoadingTask('previews')
      try {
        await refresh(scope ?? undefined)
      } catch (err) {
        syncTrace('preview:refresh-error', { error: String(err) })
        // Refresh can race graph edits while outputs are temporarily unavailable.
        // Keep the bridge quiet by default; opt in with localStorage when debugging.
        if (debugPreviewErrors()) {
          console.warn('[useNodePreviews] refresh failed:', err)
        }
      } finally {
        inFlight = false
        if (isFullRefresh) endLoadingTask('previews')
        if (pending && !cancelled) { pending = false; scheduleRefresh() }
      }
    }
    // `narrowTo` carries the affected-node scope for a coalesced exec refresh. A
    // full refresh (undefined) wins over a narrowed one when both coalesce into
    // the same window (structural changes must re-pull everything).
    function scheduleRefresh(narrowTo?: ReadonlySet<string>): void {
      if (narrowTo === undefined) {
        pendingNarrow = null
      } else if (pendingNarrow !== null) {
        for (const id of narrowTo) pendingNarrow.add(id)
      } else {
        pendingNarrow = new Set(narrowTo)
      }
      if (cancelled || refreshTimer) return
      refreshTimer = setTimeout(() => {
        refreshTimer = null
        void runRefresh()
      }, 30)
    }

    // Local slider batches invalidate output caches before their execute
    // completes. Direct workbench preview-data pushes own the live frames; one
    // cache refresh after both the drag and the final execute settle owns GC.
    const scheduleLocalParamSettle = (): void => {
      if (localParamSettleTimer) clearTimeout(localParamSettleTimer)
      const wait = Math.max(30, localParamEditUntil - Date.now())
      localParamSettleTimer = setTimeout(() => {
        localParamSettleTimer = null
        if (executionsInFlight.size > 0 || Date.now() < localParamEditUntil) {
          scheduleLocalParamSettle()
          return
        }
        scheduleRefresh()
      }, wait)
    }
    _localParamEditNotifier = () => {
      // Cover slow group execution as well as the pointermove cadence. Every
      // pulse extends the window; the settle callback also waits for all known
      // executions, so this does not delay the final durable refresh.
      localParamEditUntil = Date.now() + 600
      if (refreshTimer) {
        clearTimeout(refreshTimer)
        refreshTimer = null
      }
      if (graphRefreshTimer) {
        clearTimeout(graphRefreshTimer)
        graphRefreshTimer = null
      }
      scheduleLocalParamSettle()
    }

    // Refresh on execution completion (live output values) AND on any graph
    // mutation. The latter is the fix for stale previews: deleting a node that
    // has no downstream triggers NO execution, so without a graph trigger the
    // GC never runs. The backend emits `graph:applied` on every applyBatch and
    // broadcasts it over WS, so the renderer iframe (subscribed to the 'graph'
    // channel) re-runs the GC and the orphaned grid/voxel layers vanish.
    const unsubExec = client.subscribe('execution', (e) => {
      if (e.kind === 'exec:started') {
        executionsInFlight.add(e.executionId)
        if (graphRefreshTimer) {
          clearTimeout(graphRefreshTimer)
          graphRefreshTimer = null
        }
        postPreviewStatus('running', e.executionId)
        return
      }
      if (e.kind === 'exec:error') {
        executionsInFlight.delete(e.executionId)
      }
      // Always full refresh after execute — scene_output must re-pull even when
      // upstream-only exec:node:output events fired. Narrow scope caused stale
      // sinks; racing graph:applied before exec caused empty cache → black preview.
      if (e.kind === 'exec:completed') {
        executionsInFlight.delete(e.executionId)
        syncTrace('preview:exec-completed', {})
        if (graphRefreshTimer) {
          clearTimeout(graphRefreshTimer)
          graphRefreshTimer = null
        }
        if (Date.now() < localParamEditUntil || localParamSettleTimer) {
          scheduleLocalParamSettle()
        } else {
          scheduleRefresh()
        }
      }
    })
    const unsubGraph = client.subscribe('graph', (e) => {
      // Ephemeral param-drag batches emit graph:applied BEFORE execute lands;
      // debounce so exec:completed owns the live refresh and we don't pull an
      // invalidated (empty) scene_output mid-flight. Structural edits still GC
      // after the debounce window (delete/disconnect with no exec).
      if (e.kind === 'graph:applied') {
        if (e.batchId.startsWith('editor-param-')) {
          localParamEditUntil = Date.now() + LOCAL_PARAM_SETTLE_MS
          if (graphRefreshTimer) {
            clearTimeout(graphRefreshTimer)
            graphRefreshTimer = null
          }
          scheduleLocalParamSettle()
          return
        }
        if (executionsInFlight.size > 0) {
          syncTrace('preview:graph-applied-deferred', { reason: 'execute-in-flight' })
          return
        }
        syncTrace('preview:graph-applied-debounced', {})
        if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
        graphRefreshTimer = setTimeout(() => {
          graphRefreshTimer = null
          scheduleRefresh()
        }, GRAPH_REFRESH_DEBOUNCE_MS)
      }
      if (e.kind === 'project:viewing' || e.kind === 'project:activated') {
        const projectId = (e as { projectId?: string }).projectId
        if (projectId) {
          projectRevision += 1
          currentProjectId = projectId
          draftCursors.clear()
          // The render store is reset for the new project, so the hashes we
          // recorded no longer describe anything on screen — keeping them would
          // skip re-pulling ports whose layers were just thrown away.
          portCache.clear()
          client.syncViewingProjectId(projectId)
          scheduleRefresh()
        }
      }
    })
    const onWorkbenchMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'workbench:project-changed') return
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      if (!projectId) return
      projectRevision += 1
      currentProjectId = projectId
      draftCursors.clear()
      portCache.clear()
      client.syncViewingProjectId(projectId)
      scheduleRefresh()
    }
    window.addEventListener('message', onWorkbenchMessage)
    const unsubDraft = typeof client.subscribeRaw === 'function'
      ? client.subscribeRaw('scene-script:draft', (payload) => {
          const event = payload as Partial<SceneScriptDraftEvent> | null
          if (
            !event
            || typeof event.draftId !== 'string'
            || typeof event.generation !== 'number'
            || event.status !== 'visible'
            || event.valid !== true
          ) return
          // A successful isolated draft is an explicit request to preview that
          // project. Pin this renderer client to the draft project before
          // projecting its self-contained render payload; otherwise an old UI
          // selection silently drops the event and the Agent captures a black
          // frame from an unrelated project.
          if (event.projectId && event.projectId !== currentProjectId) {
            projectRevision += 1
            currentProjectId = event.projectId
            draftCursors.clear()
            portCache.clear()
            client.syncViewingProjectId(event.projectId)
            useRenderStore.getState().loadOutputLayerOrder(event.projectId)
          }

          const previewRevision = event.previewRevision ?? event.sync?.previewRevision ?? null
          const eventProjectRevision = event.projectRevision ?? event.sync?.projectRevision ?? null
          const cursor = draftCursors.get(event.draftId)
          if (cursor && event.generation < cursor.generation) return
          if (
            cursor
            && event.generation === cursor.generation
            && (
              (cursor.previewRevision && previewRevision && cursor.previewRevision !== previewRevision)
              || (cursor.projectRevision && eventProjectRevision && cursor.projectRevision !== eventProjectRevision)
            )
          ) return
          draftCursors.set(event.draftId, {
            generation: event.generation,
            previewRevision,
            projectRevision: eventProjectRevision,
          })
          portCache.clear()
          if (event.render) {
            opOutputs = new Map(event.render.ops.map((op) => [
              op.id,
              ((op.outputs ?? []) as PortSpec[]).map((port) => ({ name: port.name, type: port.type })),
            ]))
            nodeMeta.clear()
            const desiredGridKeys = new Set<string>()
            const desiredMeshKeys = new Set<string>()
            const desiredGuideKeys = new Set<string>()
            const nodeIds = new Set<string>()
            for (const node of event.render.graph.nodes) {
              nodeIds.add(node.id)
              nodeMeta.set(node.id, {
                opId: node.opId,
                name: node.name ?? node.id,
                params: node.params,
              })
            }
            for (const [nodeId, ports] of Object.entries(event.render.outputs)) {
              const meta = nodeMeta.get(nodeId)
              if (!meta) continue
              const override = useRenderStore.getState().previewOverrides[nodeId]
              const previewEnabled = override !== undefined ? override : true
              projectVoxelLayersFor(nodeId, meta.opId, previewEnabled, (portName) => ports[portName])
              for (const key of desiredGridKeysFor(
                nodeId,
                meta.opId,
                meta.name,
                previewEnabled,
                (portName) => ports[portName],
              )) desiredGridKeys.add(key)
              for (const key of projectMeshFor(
                nodeId,
                meta.opId,
                meta.name,
                previewEnabled,
                (portName) => ports[portName],
              )) desiredMeshKeys.add(key)
              for (const key of projectGuideFor(
                nodeId,
                meta.opId,
                meta.name,
                previewEnabled,
                (portName) => ports[portName],
                lastManuals,
                lastControlNodes,
                meta.params?.style,
              )) desiredGuideKeys.add(key)
            }
            retainPreviewLayers(desiredGridKeys)
            retainMeshLayers(desiredMeshKeys)
            retainGuideLayers(desiredGuideKeys)
            retainVoxelNodes(nodeIds)
            useRenderStore.getState().retainScenePorts(nodeIds)
            postPreviewStatus('completed', event.sync?.executionId ?? undefined)
          } else {
            scheduleRefresh()
          }
        })
      : () => {}
    // Re-project when the editor's preview toggles arrive (override map changes),
    // so flipping a node's preview off/on adds/removes its layers immediately
    // without waiting for a graph mutation or re-execution. Compare by CONTENT
    // (not object identity): a `reset()` mints a fresh empty map but must not
    // trigger a spurious refresh when the override set is effectively unchanged.
    const overrideKey = (m: Record<string, boolean>): string =>
      Object.keys(m).sort().map((k) => `${k}=${m[k] ? 1 : 0}`).join(',')
    let lastOverrideKey = overrideKey(useRenderStore.getState().previewOverrides)
    const unsubOverrides = useRenderStore.subscribe((state) => {
      const key = overrideKey(state.previewOverrides)
      if (key !== lastOverrideKey) {
        lastOverrideKey = key
        scheduleRefresh()
      }
    })
    void runRefresh()
    return () => {
      cancelled = true
      _liveProjector = null
      _localParamEditNotifier = null
      if (refreshTimer) clearTimeout(refreshTimer)
      if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
      if (localParamSettleTimer) clearTimeout(localParamSettleTimer)
      unsubExec()
      unsubGraph()
      unsubDraft()
      unsubOverrides()
      window.removeEventListener('message', onWorkbenchMessage)
    }
  }, [client, setLayers, setLayersVisibleForNode, retainVoxelNodes, setPreviewLayer, setPreviewLayersVisibleForNode, retainPreviewLayers])
}
