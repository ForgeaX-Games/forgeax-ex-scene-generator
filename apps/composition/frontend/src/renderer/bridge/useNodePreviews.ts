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
import type { WorldCurveFrame, WorldCurveKind, WorldPlaneFrame, WorldPointFrame, WorldSpace } from '../framework/worldFrame.js'
import type { Plane } from '../../../../vendor/shared/types/scene/spatial.js'
import { asPlane } from '../../../../vendor/shared/types/scene/spatial.js'
import { meshFromHeightfieldPacket } from './previewHeightfield'
import { drapeWorldCurves, drapeWorldPoints } from './drapeWorldGeometry'
import { unwrapHeightfield } from '../../../../vendor/shared/types/scene/heightfieldField.js'
import { splineStrokePoints, splineStrokePoints3d } from './operatingCurveStroke'
import { syncTrace, syncTraceHintOnce, summarizeNodeOutputs } from '../../debug/syncTrace.js'
import { beginLoadingTask, endLoadingTask, updateLoadingTask } from './loadingSignals.js'
import {
  PARAM_EDIT_ACTIVITY_MS,
  PARAM_EDIT_SETTLE_MS,
  STRUCTURAL_GRAPH_DEBOUNCE_MS,
  cancelStructuralDebounceOnExecStart,
  execCompletedRefresh,
  graphAppliedAction,
} from './previewRefreshPolicy.js'

// Project every host-call (@scene-id) renderable output into the render store.
// Values come from OutputCache keyed by scene-id after runSceneModule, not from GraphStore execute.
//
// Two lanes (see previewRefreshPolicy.ts):
//   structural — add/delete/connect. GET + GC, including empty worldPlanes.
//   param-drag — slider ticks. Live preview-data owns the frame; GET waits.
//
// Buckets:
//   * grid ports → previewLayers
//   * mesh / Geometry mesh ports → meshLayers
//   * heightfield packet → meshLayers from packet.geometry after the last run
//   * Geometry plane → worldPlanes
//   * Geometry point2d → worldPoints (draped onto the last Heightfield)
//   * Geometry point3d → worldPoints at authored Z (not re-draped)
//   * Geometry polyline / spline / polygon / network → worldCurves (draped)
//   * Geometry *3d curves → worldCurves at authored Z (not re-draped)
//   * voxel_layers (scene_output) → layers


type PortSpec = { name: string; type: string }

function isCanonicalSceneOp(opId: string): boolean {
  return opId === 'scene_output'
}

function storedLayerKeys(
  layers: Record<string, { nodeId: string; key: string }>,
  nodeId: string,
): string[] {
  const keys: string[] = []
  for (const layer of Object.values(layers)) {
    if (layer.nodeId === nodeId) keys.push(layer.key)
  }
  return keys
}

const MESH_SKIP_WHEN_SCENE = new Set([
  'grid_to_boxes',
  'gabled_houses',
  'mesh_to_node',
  'stroke_sweep_mesh',
  'geometry_to_mesh',
  'road_network_mesh',
])

function skipMeshPort(opId: string, hasCanonicalScene: boolean): boolean {
  if (!hasCanonicalScene) return false
  return MESH_SKIP_WHEN_SCENE.has(opId) || opId.startsWith('local/')
}

/** Sharded OutputCache blobs are too large to inline-fetch; skip them. */
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

function collectRenderableMesh(raw: unknown): MeshPayload | null {
  return collectMesh(raw) ?? meshFromHeightfieldPacket(raw)
}

function isHeightfieldPort(port: { type?: string; name?: string }): boolean {
  return port.type === 'heightfield' || port.name === 'heightfield'
}

function isMeshLikePort(port: PortSpec): boolean {
  if (port.type === 'point2d') return false
  return port.type === 'mesh'
    || port.type === 'geometry'
    || port.type === 'heightfield'
    || port.name === 'geometry'
    || port.name === 'heightfield'
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

function isPlaneObj(value: unknown): value is Plane {
  return asPlane(value) !== null
}

function isGeometryMesh(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const rec = value as { kind?: unknown; positions?: unknown; indices?: unknown }
  return rec.kind === 'mesh' || (Array.isArray(rec.positions) && Array.isArray(rec.indices))
}

export function parsePlanePayload(raw: unknown): { plane: Plane } | null {
  if (raw && typeof raw === 'object' && (raw as { kind?: unknown }).kind === 'mesh') return null
  const fromProtocol = asPlane(raw)
  if (fromProtocol) return { plane: fromProtocol }
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.geometry && typeof rec.geometry === 'object') {
    const nested = parsePlanePayload(rec.geometry)
    if (nested) return nested
  }
  if (rec.kind === 'plane' && isPlaneObj(rec)) {
    return { plane: rec as Plane }
  }
  for (const item of flattenWire(raw)) {
    const nested = parsePlanePayload(item)
    if (nested) return nested
  }
  return null
}

export function convertToWorldPlaneFrames(
  items: Array<{ nodeId: string; name: string; opId: string; plane: Plane }>,
): WorldPlaneFrame[] {
  if (items.length === 0) return []

  const frames: WorldPlaneFrame[] = []
  const seenIds = new Set<string>()

  for (const it of items) {
    if (seenIds.has(it.nodeId)) continue
    seenIds.add(it.nodeId)

    const plane = it.plane
    const origin: [number, number] = [plane.origin[0] ?? 0, plane.origin[1] ?? 0]
    const extent: [number, number] = [plane.width, plane.height]
    const center: [number, number] = [origin[0] + plane.width / 2, origin[1] + plane.height / 2]
    const yaw = ((plane.rotationDeg ?? 0) * Math.PI) / 180

    frames.push({
      id: it.nodeId,
      nodeId: it.nodeId,
      name: it.name || it.nodeId,
      origin,
      extent,
      center,
      yaw,
      role: 'geometry',
    })
  }

  return frames
}

export function parsePoint2dPayload(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.geometry && typeof rec.geometry === 'object') {
    const nested = parsePoint2dPayload(rec.geometry)
    if (nested) return nested
  }
  if (rec.kind === 'point2d') {
    const x = Number(rec.x)
    const y = Number(rec.y)
    if ([x, y].every(Number.isFinite)) return { x, y }
  }
  for (const item of flattenWire(raw)) {
    const nested = parsePoint2dPayload(item)
    if (nested) return nested
  }
  return null
}

export function parsePoint3dPayload(raw: unknown): { x: number; y: number; z: number } | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.geometry && typeof rec.geometry === 'object') {
    const nested = parsePoint3dPayload(rec.geometry)
    if (nested) return nested
  }
  if (rec.kind === 'point3d') {
    const x = Number(rec.x)
    const y = Number(rec.y)
    const z = Number(rec.z)
    if ([x, y, z].every(Number.isFinite)) return { x, y, z }
  }
  for (const item of flattenWire(raw)) {
    const nested = parsePoint3dPayload(item)
    if (nested) return nested
  }
  return null
}

export function convertToWorldPointFrames(
  items: Array<{ nodeId: string; name: string; x: number; y: number; z?: number; space?: WorldSpace }>,
): WorldPointFrame[] {
  const frames: WorldPointFrame[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.nodeId)) continue
    seen.add(item.nodeId)
    frames.push({
      id: item.nodeId,
      nodeId: item.nodeId,
      name: item.name || item.nodeId,
      x: item.x,
      y: item.y,
      ...(item.z !== undefined ? { z: item.z } : {}),
      ...(item.space ? { space: item.space } : {}),
    })
  }
  return frames
}

const GEOMETRY2D_PORT_TYPES = new Set([
  'geometry',
  'point2d',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
])

const GEOMETRY2D_OP_IDS = new Set([
  'base_plane',
  'point2d',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
  'lift_to_surface',
])

function asAuthoringXY(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0])
    const y = Number(value[1])
    return [x, y].every(Number.isFinite) ? [x, y] : null
  }
  if (value && typeof value === 'object') {
    const rec = value as { kind?: unknown; geometry?: unknown; x?: unknown; y?: unknown }
    if (rec.geometry !== undefined) return asAuthoringXY(rec.geometry)
    if (rec.kind === 'point2d' || rec.x !== undefined || rec.y !== undefined) {
      const x = Number(rec.x)
      const y = Number(rec.y)
      return [x, y].every(Number.isFinite) ? [x, y] : null
    }
  }
  return null
}

function asAuthoringXYList(value: unknown): Array<[number, number]> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const points: Array<[number, number]> = []
  for (const item of value) {
    const point = asAuthoringXY(item)
    if (!point) return null
    points.push(point)
  }
  return points
}

function asAuthoringXYZ(value: unknown): [number, number, number] | null {
  if (Array.isArray(value) && value.length >= 3) {
    const x = Number(value[0])
    const y = Number(value[1])
    const z = Number(value[2])
    return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
  }
  if (value && typeof value === 'object') {
    const rec = value as { kind?: unknown; geometry?: unknown; x?: unknown; y?: unknown; z?: unknown }
    if (rec.geometry !== undefined) return asAuthoringXYZ(rec.geometry)
    if (rec.kind === 'point3d' || rec.z !== undefined) {
      const x = Number(rec.x)
      const y = Number(rec.y)
      const z = Number(rec.z)
      return [x, y, z].every(Number.isFinite) ? [x, y, z] : null
    }
  }
  return null
}

function asAuthoringXYZList(value: unknown): Array<[number, number, number]> | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const points: Array<[number, number, number]> = []
  for (const item of value) {
    const point = asAuthoringXYZ(item)
    if (!point) return null
    points.push(point)
  }
  return points
}

function parseOperatingCurveRecord(rec: Record<string, unknown>): Omit<WorldCurveFrame, 'id' | 'name' | 'nodeId'> | null {
  const kind = rec.kind
  if (kind === 'polyline3d' || kind === 'spline3d') {
    const points = asAuthoringXYZList(rec.points)
    if (!points || points.length < 2) return null
    const stroke = splineStrokePoints3d(rec, points)
    return {
      kind: kind === 'spline3d' ? 'spline' : 'polyline',
      space: 'world3d',
      strokes: [{ points: stroke }],
      ...(kind === 'spline3d' ? { vertices: points } : {}),
    }
  }
  if (kind === 'polygon3d') {
    const points = asAuthoringXYZList(rec.points)
    if (!points || points.length < 3) return null
    const strokes = [{ points, closed: true }]
    if (Array.isArray(rec.holes)) {
      for (const ring of rec.holes) {
        const hole = asAuthoringXYZList(ring)
        if (hole && hole.length >= 3) strokes.push({ points: hole, closed: true })
      }
    }
    return { kind: 'polygon', space: 'world3d', strokes }
  }
  if (kind === 'network3d') {
    const nodes = asAuthoringXYZList(rec.nodes)
    if (!nodes || nodes.length === 0) return null
    const strokes: WorldCurveFrame['strokes'] = []
    if (Array.isArray(rec.edges)) {
      for (const edge of rec.edges) {
        if (!edge || typeof edge !== 'object') continue
        const item = edge as { from?: unknown; to?: unknown; curve?: { kind?: unknown; points?: unknown; degree?: unknown } }
        const curvePts = asAuthoringXYZList(item.curve?.points)
        if (curvePts && curvePts.length >= 2) {
          strokes.push({ points: splineStrokePoints3d(item.curve ?? {}, curvePts) })
          continue
        }
        const from = Number(item.from)
        const to = Number(item.to)
        const a = Number.isInteger(from) ? nodes[from] : null
        const b = Number.isInteger(to) ? nodes[to] : null
        if (a && b) strokes.push({ points: [a, b] })
      }
    }
    return { kind: 'network', space: 'world3d', strokes, vertices: nodes }
  }
  if (kind === 'polyline' || kind === 'spline') {
    const points = asAuthoringXYList(rec.points)
    if (!points || points.length < 2) return null
    const stroke = splineStrokePoints(rec, points)
    return {
      kind,
      strokes: [{ points: stroke }],
      ...(kind === 'spline' ? { vertices: points } : {}),
    }
  }
  if (kind === 'polygon') {
    const points = asAuthoringXYList(rec.points)
    if (!points || points.length < 3) return null
    const strokes = [{ points, closed: true }]
    if (Array.isArray(rec.holes)) {
      for (const ring of rec.holes) {
        const hole = asAuthoringXYList(ring)
        if (hole && hole.length >= 3) strokes.push({ points: hole, closed: true })
      }
    }
    return { kind, strokes }
  }
  if (kind === 'network') {
    const nodes = asAuthoringXYList(rec.nodes)
    if (!nodes || nodes.length === 0) return null
    const strokes: WorldCurveFrame['strokes'] = []
    if (Array.isArray(rec.edges)) {
      for (const edge of rec.edges) {
        if (!edge || typeof edge !== 'object') continue
        const item = edge as { from?: unknown; to?: unknown; curve?: { kind?: unknown; points?: unknown; degree?: unknown } }
        const curvePts = asAuthoringXYList(item.curve?.points)
        if (curvePts && curvePts.length >= 2) {
          strokes.push({ points: splineStrokePoints(item.curve ?? {}, curvePts) })
          continue
        }
        const from = Number(item.from)
        const to = Number(item.to)
        const a = Number.isInteger(from) ? nodes[from] : null
        const b = Number.isInteger(to) ? nodes[to] : null
        if (a && b) strokes.push({ points: [a, b] })
      }
    }
    return { kind, strokes, vertices: nodes }
  }
  return null
}

export function parseOperatingCurvePayload(raw: unknown): Omit<WorldCurveFrame, 'id' | 'name' | 'nodeId'> | null {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  if (rec.geometry && typeof rec.geometry === 'object') {
    const nested = parseOperatingCurvePayload(rec.geometry)
    if (nested) return nested
  }
  const direct = parseOperatingCurveRecord(rec)
  if (direct) return direct
  for (const item of flattenWire(raw)) {
    const nested = parseOperatingCurvePayload(item)
    if (nested) return nested
  }
  return null
}

export function convertToWorldCurveFrames(
  items: Array<{ nodeId: string; name: string; kind: WorldCurveKind; strokes: WorldCurveFrame['strokes']; vertices?: WorldCurveFrame['vertices']; space?: WorldSpace }>,
): WorldCurveFrame[] {
  const frames: WorldCurveFrame[] = []
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.nodeId)) continue
    seen.add(item.nodeId)
    frames.push({
      id: item.nodeId,
      nodeId: item.nodeId,
      name: item.name || item.nodeId,
      kind: item.kind,
      strokes: item.strokes,
      ...(item.vertices ? { vertices: item.vertices } : {}),
      ...(item.space ? { space: item.space } : {}),
    })
  }
  return frames
}

function debugPreviewErrors(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem('scene-generator.debugPreview') === 'true'
}

// ── Live projector (param-drag lane + structural execute shortcut) ──────────
// Slider ticks need the frame in the same animation; drop execute can paint
// Geometry before listNodes knows the compiled id. This is not a param-drag
// signal — that is authoring:param-edit-active / editor-param-* batches.
type LiveProjector = (outputs: Record<string, Record<string, unknown>>) => void
let _liveProjector: LiveProjector | null = null
let _localParamEditNotifier: (() => void) | null = null

/**
 * Project a directly-pushed outputs map (`nodeId → portName → value`) into the
 * render store, identical to the WS re-pull path but with zero network. No-op
 * until `useNodePreviews` has mounted and loaded the op catalog. Safe to call
 * from the renderer's `authoring:preview-data` handler on every drag tick.
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
    // authoring:project-changed postMessage). `client.viewingProjectId` is a
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
        type: 'authoring:preview-status',
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
    const spatialPlanesByNode = new Map<string, { nodeId: string; name: string; opId: string; plane: Plane }>()
    const spatialPointsByNode = new Map<string, { nodeId: string; name: string; x: number; y: number; z?: number; space?: WorldSpace }>()
    const spatialCurvesByNode = new Map<string, { nodeId: string; name: string; kind: WorldCurveKind; strokes: WorldCurveFrame['strokes']; vertices?: WorldCurveFrame['vertices']; space?: WorldSpace }>()
    let lastDrapeField: ReturnType<typeof unwrapHeightfield> = null

    const rememberTerrainPacket = (raw: unknown): void => {
      const field = unwrapHeightfield(raw)
      if (field) lastDrapeField = field
    }

    const forgetDrapeFieldIfNoTerrain = (): void => {
      const layers = useRenderStore.getState().meshLayers
      for (const layer of Object.values(layers)) {
        if (layer.mesh?.role === 'terrain') return
      }
      lastDrapeField = null
    }
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
        // setLayersVisibleForNode's doc). Return existing keys so retain* GC
        // does not delete the hidden frame.
        setPreviewLayersVisibleForNode(nodeId, false)
        return storedLayerKeys(useRenderStore.getState().previewLayers, nodeId)
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
        return storedLayerKeys(useRenderStore.getState().meshLayers, nodeId)
      }
      setMeshLayersVisibleForNode(nodeId, true)
      const declared = ports.filter(isMeshLikePort)
      const targetPorts = declared.length > 0
        ? declared
        : [
            { name: 'geometry', type: 'geometry' },
            { name: 'heightfield', type: 'heightfield' },
          ]
      for (const port of targetPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        if (port.type === 'geometry' && !isGeometryMesh(raw) && !collectRenderableMesh(raw)) continue
        const mesh = collectRenderableMesh(raw)
        if (!mesh) continue
        if (mesh.role === 'terrain') rememberTerrainPacket(raw)
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
        return storedLayerKeys(useRenderStore.getState().guideLayers, nodeId)
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

    const projectPlanesFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      getValue: (portName: string) => unknown,
    ): { nodeId: string; name: string; opId: string; plane: Plane } | null => {
      const ports = (opOutputs?.get(opId)) ?? []
      const spatialPorts = ports.filter((p) => GEOMETRY2D_PORT_TYPES.has(p.type) || p.name === 'geometry')
      const targetPorts = spatialPorts.length > 0
        ? spatialPorts
        : [{ name: 'geometry', type: 'geometry' }]
      for (const port of targetPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const parsed = parsePlanePayload(raw)
        if (parsed) {
          return {
            nodeId,
            name: nodeName || nodeId,
            opId,
            plane: parsed.plane,
          }
        }
      }
      return null
    }

    const projectPointsFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      getValue: (portName: string) => unknown,
    ): { nodeId: string; name: string; x: number; y: number; z?: number; space?: WorldSpace } | null => {
      const ports = (opOutputs?.get(opId)) ?? []
      const spatialPorts = ports.filter((p) => GEOMETRY2D_PORT_TYPES.has(p.type) || p.name === 'geometry')
      const targetPorts = spatialPorts.length > 0
        ? spatialPorts
        : [{ name: 'geometry', type: 'geometry' }]
      for (const port of targetPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const parsed3d = parsePoint3dPayload(raw)
        if (parsed3d) return { nodeId, name: nodeName || nodeId, ...parsed3d, space: 'world3d' }
        const parsed = parsePoint2dPayload(raw)
        if (parsed) return { nodeId, name: nodeName || nodeId, ...parsed }
      }
      return null
    }

    const projectCurvesFor = (
      nodeId: string,
      opId: string,
      nodeName: string,
      getValue: (portName: string) => unknown,
    ): { nodeId: string; name: string; kind: WorldCurveKind; strokes: WorldCurveFrame['strokes']; vertices?: WorldCurveFrame['vertices']; space?: WorldSpace } | null => {
      const ports = (opOutputs?.get(opId)) ?? []
      const spatialPorts = ports.filter((p) => GEOMETRY2D_PORT_TYPES.has(p.type) || p.name === 'geometry')
      const targetPorts = spatialPorts.length > 0
        ? spatialPorts
        : [{ name: 'geometry', type: 'geometry' }]
      for (const port of targetPorts) {
        const raw = getValue(port.name)
        if (raw === undefined) continue
        const parsed = parseOperatingCurvePayload(raw)
        if (parsed) return { nodeId, name: nodeName || nodeId, ...parsed }
      }
      return null
    }

    // Register the live direct-push projector: the editor forwards freshly
    // executed outputs over `authoring:preview-data`; we paint them straight into
    // the render store using the cached catalog/meta, with zero network. Grids
    // AND voxel_layers sinks (scene_output) ride this path so param edits on the
    // root graph update the preview in the same frame as the wire probe.
    const publishWorldPlanes = (gcToNodeIds?: ReadonlySet<string>): void => {
      if (gcToNodeIds) {
        for (const id of spatialPlanesByNode.keys()) {
          if (!gcToNodeIds.has(id)) spatialPlanesByNode.delete(id)
        }
      }
      useRenderStore.getState().setWorldPlanes(
        convertToWorldPlaneFrames(Array.from(spatialPlanesByNode.values())),
      )
    }

    const publishWorldPoints = (gcToNodeIds?: ReadonlySet<string>): void => {
      if (gcToNodeIds) {
        for (const id of spatialPointsByNode.keys()) {
          if (!gcToNodeIds.has(id)) spatialPointsByNode.delete(id)
        }
      }
      useRenderStore.getState().setWorldPoints(
        drapeWorldPoints(convertToWorldPointFrames(Array.from(spatialPointsByNode.values())), lastDrapeField),
      )
    }

    const publishWorldCurves = (gcToNodeIds?: ReadonlySet<string>): void => {
      if (gcToNodeIds) {
        for (const id of spatialCurvesByNode.keys()) {
          if (!gcToNodeIds.has(id)) spatialCurvesByNode.delete(id)
        }
      }
      useRenderStore.getState().setWorldCurves(
        drapeWorldCurves(convertToWorldCurveFrames(Array.from(spatialCurvesByNode.values())), lastDrapeField),
      )
    }

    _liveProjector = (outputs) => {
      // Live frames are a latency shortcut only. They must not call the
      // param-drag notifier: that lane is `editor-param-*` +
      // `authoring:param-edit-active`. Structural execute hydrates paint here
      // and still let graph:applied GET+GC.
      const overrides = useRenderStore.getState().previewOverrides
      let missingMeta = false
      for (const [nodeId, ports] of Object.entries(outputs)) {
        liveNodeRevisions.set(nodeId, ++liveProjectionRevision)
        const meta = nodeMeta.get(nodeId)
        const getValue = (portName: string) => ports[portName]
        if (!meta) {
          missingMeta = true
          projectMeshFor(nodeId, '', nodeId, true, getValue)
          const planeItem = projectPlanesFor(nodeId, '', nodeId, getValue)
          if (planeItem) {
            spatialPlanesByNode.set(nodeId, {
              nodeId,
              name: planeItem.name,
              opId: planeItem.opId,
              plane: planeItem.plane,
            })
          }
          const pointItem = projectPointsFor(nodeId, '', nodeId, getValue)
          if (pointItem) spatialPointsByNode.set(nodeId, pointItem)
          const curveItem = projectCurvesFor(nodeId, '', nodeId, getValue)
          if (curveItem) spatialCurvesByNode.set(nodeId, curveItem)
          continue
        }
        const override = overrides[nodeId]
        const previewEnabled = override !== undefined ? override : true
        projectVoxelLayersFor(nodeId, meta.opId, previewEnabled, getValue)
        desiredGridKeysFor(nodeId, meta.opId, meta.name, previewEnabled, getValue)
        projectMeshFor(nodeId, meta.opId, meta.name, previewEnabled, getValue)
        projectGuideFor(nodeId, meta.opId, meta.name, previewEnabled, getValue, lastManuals, lastControlNodes, meta.params?.style)
        const planeItem = projectPlanesFor(nodeId, meta.opId, meta.name, getValue)
        if (planeItem) {
          spatialPlanesByNode.set(nodeId, {
            nodeId,
            name: planeItem.name,
            opId: planeItem.opId,
            plane: planeItem.plane,
          })
        }
        const pointItem = projectPointsFor(nodeId, meta.opId, meta.name, getValue)
        if (pointItem) spatialPointsByNode.set(nodeId, pointItem)
        const curveItem = projectCurvesFor(nodeId, meta.opId, meta.name, getValue)
        if (curveItem) spatialCurvesByNode.set(nodeId, curveItem)
      }
      publishWorldPlanes()
      publishWorldPoints()
      publishWorldCurves()
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
      // Editor preview toggles ride the `authoring:preview-change` postMessage,
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
      const spatialTasks: GridTask[] = []

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
        const meshPorts = ports.filter(isMeshLikePort)
        if (!previewEnabled) {
          setPreviewLayersVisibleForNode(node.id, false)
          setMeshLayersVisibleForNode(node.id, false)
          setGuideLayersVisibleForNode(node.id, false)
          const stored = useRenderStore.getState()
          for (const key of storedLayerKeys(stored.previewLayers, node.id)) desiredGridKeys.add(key)
          for (const key of storedLayerKeys(stored.meshLayers, node.id)) desiredMeshKeys.add(key)
          for (const key of storedLayerKeys(stored.guideLayers, node.id)) desiredGuideKeys.add(key)
          continue
        }
        setPreviewLayersVisibleForNode(node.id, true)
        setMeshLayersVisibleForNode(node.id, true)
        setGuideLayersVisibleForNode(node.id, true)
        // Intermediate Grids stay off until the user opens that node's preview.
        // Default does not fetch or persist them.
        if (overrides[node.id] === true && !(hasCanonicalScene && node.opId.startsWith('local/'))) {
          for (const port of gridPorts) gridTasks.push({ node, port })
        }
        // Always collect declared mesh ports. Intermediate leftover mesh ops
        // used to be skipped whenever a scene_output node existed, even when
        // the sink emitted no scene port / no hydrated meshes. That flashed
        // Terrain from the live push, then GC'd it down to leftover voxel-only frames.
        for (const port of meshPorts) {
          if (hasCanonicalScene && isHeightfieldPort(port)) continue
          meshTasks.push({ node, port })
        }
        if (node.opId === 'points_to_node') {
          const guidePorts = ports.filter((p) => p.type === 'point2d' || p.name === 'points')
          for (const port of guidePorts) guideTasks.push({ node, port })
        }

        const isSpatialOp = GEOMETRY2D_OP_IDS.has(node.opId)
        const spatialPorts = ports.filter((p) => GEOMETRY2D_PORT_TYPES.has(p.type) || p.name === 'geometry')
        const targetSpatial = spatialPorts.length > 0
          ? spatialPorts
          : (isSpatialOp ? [{ name: 'geometry', type: 'geometry' }] : [])
        for (const port of targetSpatial) spatialTasks.push({ node, port })
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
      for (const t of spatialTasks) allPorts.push({ nodeId: t.node.id, portId: t.port.name })

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
        // Heightfield pose is the packet from the last TypeScript run. Do not
        // skip it on executedHash — that hash used to ignore origin-only edits.
        if (!isUnchanged(t.node.id, t.port.name) || isHeightfieldPort(t.port)) {
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
      const staleSpatialTasks: GridTask[] = []
      for (const t of spatialTasks) {
        if (!isUnchanged(t.node.id, t.port.name)) {
          staleSpatialTasks.push(t)
        }
      }

      const __voxelFetchCount = staleVoxelTasks.length * 2 // voxel port + optional name port (upper bound)
      const __gridFetchCount = staleGridTasks.length
      const __skipped = (voxelTasks.length - staleVoxelTasks.length) + (gridTasks.length - staleGridTasks.length)
      if (staleGridTasks.length > 0 && typeof client.materializeNodeOutputs === 'function') {
        try {
          await client.materializeNodeOutputs(
            staleGridTasks.map((t) => ({ nodeId: t.node.id, portId: t.port.name })),
          )
        } catch {
          // Last-run memory is gone; the batch GET stays a deferred stub.
        }
      }
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
        for (const t of staleSpatialTasks) batchPorts.push({ nodeId: t.node.id, portId: t.port.name })
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
      const [voxelResults, gridResults, meshResults, guideResults, spatialResults] = await Promise.all([
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
        Promise.all(staleSpatialTasks.map(async (t) => {
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

      let hydratedSceneMeshCount = 0
      for (const { node, layers, names, scenePortValue } of voxelResults) {
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) continue
        if (layers.length) setLayers(node.id, node.opId, layers, names)
        if (scenePortValue) {
          useRenderStore.getState().setScenePort(node.id, scenePortValue)
          const meshKeys = hydrateRefMeshes(node.id, scenePortValue, setMeshLayer)
          hydratedSceneMeshCount += meshKeys.length
          for (const key of meshKeys) desiredMeshKeys.add(key)
          for (const key of hydrateSceneGuides(node.id, scenePortValue, setGuideLayer, manuals, controlNodes)) {
            desiredGuideKeys.add(key)
          }
        }
        // empty payload: keep the last good voxel frame. The param-drag lane
        // invalidates cache before execute finishes; clearing here would black
        // out visible Default layers until the slider settled. Structural GC
        // still drops layers whose source node is gone (listNodes).
      }
      if (hydratedSceneMeshCount > 0) {
        for (const key of [...desiredMeshKeys]) {
          const nodeId = key.slice(0, key.indexOf(':'))
          const meta = nodeMeta.get(nodeId)
          if (meta && skipMeshPort(meta.opId, true)) desiredMeshKeys.delete(key)
        }
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
          // frame. Preview-off already added its keys above; node deletion and
          // port removal still GC because those keys never enter desired*.
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
        if (hydratedSceneMeshCount > 0 && skipMeshPort(node.opId, true)) continue
        if ((liveNodeRevisions.get(node.id) ?? 0) > liveRevisionAtStart) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().meshLayers[key]) desiredMeshKeys.add(key)
          continue
        }
        const mesh = collectRenderableMesh(raw)
        if (!mesh) {
          const key = `${node.id}:${port.name}`
          if (useRenderStore.getState().meshLayers[key]) desiredMeshKeys.add(key)
          continue
        }
        if (mesh.role === 'terrain') rememberTerrainPacket(raw)
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

      for (const { node, raw } of spatialResults) {
        const parsed = parsePlanePayload(raw)
        if (parsed) {
          const meta = nodeMeta.get(node.id)
          spatialPlanesByNode.set(node.id, {
            nodeId: node.id,
            name: meta?.name || node.name || node.id,
            opId: node.opId,
            plane: parsed.plane,
          })
          continue
        }
        const point3d = parsePoint3dPayload(raw)
        if (point3d) {
          const meta = nodeMeta.get(node.id)
          spatialPointsByNode.set(node.id, {
            nodeId: node.id,
            name: meta?.name || node.name || node.id,
            ...point3d,
            space: 'world3d',
          })
          continue
        }
        const point = parsePoint2dPayload(raw)
        if (point) {
          const meta = nodeMeta.get(node.id)
          spatialPointsByNode.set(node.id, {
            nodeId: node.id,
            name: meta?.name || node.name || node.id,
            ...point,
          })
          continue
        }
        const curve = parseOperatingCurvePayload(raw)
        if (curve) {
          const meta = nodeMeta.get(node.id)
          spatialCurvesByNode.set(node.id, {
            nodeId: node.id,
            name: meta?.name || node.name || node.id,
            ...curve,
          })
        }
      }
      if (!narrowed) {
        publishWorldPlanes(nodeIds)
        publishWorldPoints(nodeIds)
        publishWorldCurves(nodeIds)
      } else if (spatialResults.length > 0) {
        publishWorldPlanes()
        publishWorldPoints()
        publishWorldCurves()
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
          const keys = hydrateRefMeshes(nodeId, port, setMeshLayer)
          hydratedSceneMeshCount += keys.length
          for (const key of keys) desiredMeshKeys.add(key)
          for (const key of hydrateSceneGuides(nodeId, port, setGuideLayer, manuals, controlNodes)) {
            desiredGuideKeys.add(key)
          }
        }
        if (hydratedSceneMeshCount > 0) {
          for (const key of [...desiredMeshKeys]) {
            const nodeId = key.slice(0, key.indexOf(':'))
            const meta = nodeMeta.get(nodeId)
            if (meta && skipMeshPort(meta.opId, true)) desiredMeshKeys.delete(key)
          }
        }
        const live = useRenderStore.getState()
        for (const layer of Object.values(live.previewLayers)) {
          if (nodeIds.has(layer.nodeId)) desiredGridKeys.add(layer.key)
        }
        for (const layer of Object.values(live.meshLayers)) {
          if (nodeIds.has(layer.nodeId)) desiredMeshKeys.add(layer.key)
        }
        for (const layer of Object.values(live.guideLayers)) {
          if (nodeIds.has(layer.nodeId)) desiredGuideKeys.add(layer.key)
        }
        retainPreviewLayers(desiredGridKeys, nodeIds)
        retainMeshLayers(desiredMeshKeys, nodeIds)
        forgetDrapeFieldIfNoTerrain()
        retainGuideLayers(desiredGuideKeys, nodeIds)
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
    let localParamEditUntil = 0
    const paramDragActive = (): boolean =>
      Date.now() < localParamEditUntil || localParamSettleTimer !== null
    const executionsInFlight = new Set<string>()
    const trackExecution = (kind: 'start' | 'end', executionId: unknown): void => {
      if (typeof executionId !== 'string' || executionId.length === 0) return
      if (kind === 'start') executionsInFlight.add(executionId)
      else executionsInFlight.delete(executionId)
    }
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
    // completes. Direct authoring preview-data pushes own the live frames; one
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
      localParamEditUntil = Date.now() + PARAM_EDIT_ACTIVITY_MS
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

    // Refresh on execution completion AND on structural graph:applied.
    // Deleting a node with no downstream triggers no execute, so GC is owned
    // by the graph event after the authoring adapter (or layout-only
    // applyBatch) persists. Param-drag batches defer this GET.
    const unsubExec = client.subscribe('execution', (e) => {
      if (e.kind === 'exec:started') {
        trackExecution('start', e.executionId)
        if (cancelStructuralDebounceOnExecStart(paramDragActive()) && graphRefreshTimer) {
          clearTimeout(graphRefreshTimer)
          graphRefreshTimer = null
        }
        postPreviewStatus('running', e.executionId)
        return
      }
      if (e.kind === 'exec:error') {
        trackExecution('end', e.executionId)
        if (executionsInFlight.size === 0) {
          if (graphRefreshTimer) {
            clearTimeout(graphRefreshTimer)
            graphRefreshTimer = null
          }
          scheduleRefresh()
        }
        return
      }
      if (e.kind === 'exec:completed') {
        trackExecution('end', e.executionId)
        syncTrace('preview:exec-completed', {})
        if (graphRefreshTimer) {
          clearTimeout(graphRefreshTimer)
          graphRefreshTimer = null
        }
        if (execCompletedRefresh(paramDragActive()) === 'settle') {
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
        if (graphAppliedAction(e.batchId) === 'defer-to-param-settle') {
          localParamEditUntil = Date.now() + PARAM_EDIT_SETTLE_MS
          if (graphRefreshTimer) {
            clearTimeout(graphRefreshTimer)
            graphRefreshTimer = null
          }
          scheduleLocalParamSettle()
          return
        }
        syncTrace('preview:graph-applied-debounced', { lane: 'structural' })
        if (graphRefreshTimer) clearTimeout(graphRefreshTimer)
        graphRefreshTimer = setTimeout(() => {
          graphRefreshTimer = null
          scheduleRefresh()
        }, STRUCTURAL_GRAPH_DEBOUNCE_MS)
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
          spatialPlanesByNode.clear()
          spatialPointsByNode.clear()
          spatialCurvesByNode.clear()
          client.syncViewingProjectId(projectId)
          scheduleRefresh()
        }
      }
    })
    const onAuthoringMessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; projectId?: unknown } | null
      if (!data || data.type !== 'authoring:project-changed') return
      const projectId = typeof data.projectId === 'string' ? data.projectId : null
      if (!projectId) return
      projectRevision += 1
      currentProjectId = projectId
      draftCursors.clear()
      portCache.clear()
      spatialPlanesByNode.clear()
      spatialPointsByNode.clear()
      spatialCurvesByNode.clear()
      client.syncViewingProjectId(projectId)
      scheduleRefresh()
    }
    window.addEventListener('message', onAuthoringMessage)
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
            const draftPlanes: Array<{ nodeId: string; name: string; opId: string; plane: Plane }> = []
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
              const planeItem = projectPlanesFor(nodeId, meta.opId, meta.name, (portName) => ports[portName])
              if (planeItem) {
                spatialPlanesByNode.set(nodeId, {
                  nodeId,
                  name: planeItem.name,
                  opId: planeItem.opId,
                  plane: planeItem.plane,
                })
              }
              const pointItem = projectPointsFor(nodeId, meta.opId, meta.name, (portName) => ports[portName])
              if (pointItem) spatialPointsByNode.set(nodeId, pointItem)
              const curveItem = projectCurvesFor(nodeId, meta.opId, meta.name, (portName) => ports[portName])
              if (curveItem) spatialCurvesByNode.set(nodeId, curveItem)
            }
            publishWorldPlanes(nodeIds)
            publishWorldPoints(nodeIds)
            publishWorldCurves(nodeIds)
            retainPreviewLayers(desiredGridKeys, nodeIds)
            retainMeshLayers(desiredMeshKeys, nodeIds)
            forgetDrapeFieldIfNoTerrain()
            retainGuideLayers(desiredGuideKeys, nodeIds)
            retainVoxelNodes(nodeIds)
            useRenderStore.getState().retainScenePorts(nodeIds)
            postPreviewStatus('completed', event.sync?.executionId ?? undefined)
          } else {
            scheduleRefresh()
          }
        })
      : () => {}
    // Re-project when the editor's preview toggles arrive (override map changes).
    // Hide/show the last frame immediately — do not wait for the 30ms refresh,
    // and do not drop the layer. Compare by CONTENT (not object identity).
    const overrideKey = (m: Record<string, boolean>): string =>
      Object.keys(m).sort().map((k) => `${k}=${m[k] ? 1 : 0}`).join(',')
    let lastOverrideKey = overrideKey(useRenderStore.getState().previewOverrides)
    const applyOverrideVisibility = (overrides: Record<string, boolean>) => {
      const store = useRenderStore.getState()
      for (const [nodeId, enabled] of Object.entries(overrides)) {
        store.setPreviewLayersVisibleForNode(nodeId, enabled)
        store.setMeshLayersVisibleForNode(nodeId, enabled)
        store.setGuideLayersVisibleForNode(nodeId, enabled)
        store.setLayersVisibleForNode(nodeId, enabled)
      }
    }
    const unsubOverrides = useRenderStore.subscribe((state) => {
      const key = overrideKey(state.previewOverrides)
      if (key !== lastOverrideKey) {
        lastOverrideKey = key
        applyOverrideVisibility(state.previewOverrides)
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
      window.removeEventListener('message', onAuthoringMessage)
    }
  }, [client, setLayers, setLayersVisibleForNode, retainVoxelNodes, setPreviewLayer, setPreviewLayersVisibleForNode, retainPreviewLayers])
}
