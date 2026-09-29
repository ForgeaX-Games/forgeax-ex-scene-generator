import { defaultGeneratorContext } from '@forgeax/scene-authoring/generator-context'
export { defaultGeneratorContext } from '@forgeax/scene-authoring/generator-context'
import { AsyncLocalStorage } from 'node:async_hooks'

import { createSceneDiagnostic, stableEntityId, type SceneDiagnostic } from '@forgeax/scene-authoring'

export const SCENE_CALL_ID = Symbol.for('forgeax.scene.callId')
export const SCENE_CALL_PORT = Symbol.for('forgeax.scene.callPort')

export const HOST_FUNCTION_NAMES = [
  'allocateSpans',
  'segmentRun',
  'deriveSeed',
  'localFrame',
  'fitAnchor',
  'boundsRelation',

  'point2d',
  'basePlane',
  'polyline2d',
  'spline2d',
  'polygon2d',
  'network2d',
  'point3d',
  'polyline3d',
  'spline3d',
  'polygon3d',
  'network3d',
  'geometryMask',
  'createGrid',
  'gridFill',
  'gridGradient',
  'gridDiamondSquare',
  'gridMidpoint',
  'hashNoise',
  'valueNoise',
  'valueCubicNoise',
  'perlinNoise',
  'openSimplex2Noise',
  'openSimplex2sNoise',
  'cellularNoise',
  'gridAdd',
  'gridSub',
  'gridMul',
  'gridMin',
  'gridMax',
  'gridLerp',
  'gridChoose',
  'gridMaskDiff',
  'gridMaskUnion',
  'gridAbs',
  'gridNeg',
  'gridClamp',
  'gridRemap',
  'gridSmoothstep',
  'gridQuantize',
  'gridBlur',
  'gridSharpen',
  'gridMedian',
  'gridNeighborhoodMin',
  'gridNeighborhoodMax',
  'gridDilate',
  'gridErodeMorph',
  'gridOpen',
  'gridClose',
  'gridMajority',
  'gridOutline',
  'gridSlope',
  'gridAspect',
  'gridCurvature',
  'gridThreshold',
  'gridRangeSelect',
  'gridEdge',
  'gridBBox',
  'gridStats',
  'gridDistance',
  'gridResize',
  'gridComponents',
  'gridZonalMean',
  'heightfield',
  'heightfieldExplode',
  'heightfieldSetMask',
  'heightfieldMesh',
  'box',
  'transform',
  'placeOnGround',
  'liftToSurface',
  'surfaceBand',
  'emptyScene',
  'sceneNode',
  'addChild',
  'sceneOutput',
] as const

export type HostFunctionName = (typeof HOST_FUNCTION_NAMES)[number]

export const HOST_FUNCTION_OP_IDS: Record<HostFunctionName, string> = {
  allocateSpans: 'allocate_spans',
  segmentRun: 'segment_run',
  deriveSeed: 'derive_seed',
  localFrame: 'local_frame',
  fitAnchor: 'fit_anchor',
  boundsRelation: 'bounds_relation',

  point2d: 'point2d',
  basePlane: 'base_plane',
  polyline2d: 'polyline2d',
  spline2d: 'spline2d',
  polygon2d: 'polygon2d',
  network2d: 'network2d',
  point3d: 'point3d',
  polyline3d: 'polyline3d',
  spline3d: 'spline3d',
  polygon3d: 'polygon3d',
  network3d: 'network3d',
  geometryMask: 'geometry_mask',
  createGrid: 'create_grid',
  gridFill: 'grid_fill',
  gridGradient: 'grid_gradient',
  gridDiamondSquare: 'grid_diamond_square',
  gridMidpoint: 'grid_midpoint',
  hashNoise: 'hash_noise',
  valueNoise: 'value_noise',
  valueCubicNoise: 'value_cubic_noise',
  perlinNoise: 'perlin_noise',
  openSimplex2Noise: 'opensimplex2_noise',
  openSimplex2sNoise: 'opensimplex2s_noise',
  cellularNoise: 'cellular_noise',
  gridAdd: 'grid_add',
  gridSub: 'grid_sub',
  gridMul: 'grid_mul',
  gridMin: 'grid_min',
  gridMax: 'grid_max',
  gridLerp: 'grid_lerp',
  gridChoose: 'grid_choose',
  gridMaskDiff: 'grid_mask_diff',
  gridMaskUnion: 'grid_mask_union',
  gridAbs: 'grid_abs',
  gridNeg: 'grid_neg',
  gridClamp: 'grid_clamp',
  gridRemap: 'grid_remap',
  gridSmoothstep: 'grid_smoothstep',
  gridQuantize: 'grid_quantize',
  gridBlur: 'grid_blur',
  gridSharpen: 'grid_sharpen',
  gridMedian: 'grid_median',
  gridNeighborhoodMin: 'grid_neighborhood_min',
  gridNeighborhoodMax: 'grid_neighborhood_max',
  gridDilate: 'grid_dilate',
  gridErodeMorph: 'grid_erode_morph',
  gridOpen: 'grid_open',
  gridClose: 'grid_close',
  gridMajority: 'grid_majority',
  gridOutline: 'grid_outline',
  gridSlope: 'grid_slope',
  gridAspect: 'grid_aspect',
  gridCurvature: 'grid_curvature',
  gridThreshold: 'grid_threshold',
  gridRangeSelect: 'grid_range_select',
  gridEdge: 'grid_edge',
  gridBBox: 'grid_bbox',
  gridStats: 'grid_stats',
  gridDistance: 'grid_distance',
  gridResize: 'grid_resize',
  gridComponents: 'grid_components',
  gridZonalMean: 'grid_zonal_mean',
  heightfield: 'heightfield',
  heightfieldExplode: 'heightfield_explode',
  heightfieldSetMask: 'heightfield_set_mask',
  heightfieldMesh: 'heightfield_mesh',
  box: 'box',
  transform: 'transform',
  placeOnGround: 'place_on_ground',
  liftToSurface: 'lift_to_surface',
  surfaceBand: 'surface_band',
  emptyScene: 'empty_scene',
  sceneNode: 'scene_node',
  addChild: 'add_child',
  sceneOutput: 'scene_output',
}

/**
 * Single-output host functions return the value itself to Scene Script.
 * The name is only the canvas handle. Multi-output calls stay records.
 */
export const HOST_PRIMARY_OUTPUT: Partial<Record<HostFunctionName, string>> = {
  allocateSpans: 'result',
  segmentRun: 'result',
  deriveSeed: 'result',
  localFrame: 'result',
  fitAnchor: 'result',
  boundsRelation: 'result',

  point2d: 'geometry',
  basePlane: 'geometry',
  polyline2d: 'geometry',
  spline2d: 'geometry',
  polygon2d: 'geometry',
  network2d: 'geometry',
  point3d: 'geometry',
  polyline3d: 'geometry',
  spline3d: 'geometry',
  polygon3d: 'geometry',
  network3d: 'geometry',
  geometryMask: 'grid',
  createGrid: 'grid',
  gridFill: 'grid',
  gridGradient: 'grid',
  gridDiamondSquare: 'grid',
  gridMidpoint: 'grid',
  hashNoise: 'grid',
  valueNoise: 'grid',
  valueCubicNoise: 'grid',
  perlinNoise: 'grid',
  openSimplex2Noise: 'grid',
  openSimplex2sNoise: 'grid',
  cellularNoise: 'grid',
  gridAdd: 'grid',
  gridSub: 'grid',
  gridMul: 'grid',
  gridMin: 'grid',
  gridMax: 'grid',
  gridLerp: 'grid',
  gridChoose: 'grid',
  gridMaskDiff: 'grid',
  gridMaskUnion: 'grid',
  gridAbs: 'grid',
  gridNeg: 'grid',
  gridClamp: 'grid',
  gridRemap: 'grid',
  gridSmoothstep: 'grid',
  gridQuantize: 'grid',
  gridBlur: 'grid',
  gridSharpen: 'grid',
  gridMedian: 'grid',
  gridNeighborhoodMin: 'grid',
  gridNeighborhoodMax: 'grid',
  gridDilate: 'grid',
  gridErodeMorph: 'grid',
  gridOpen: 'grid',
  gridClose: 'grid',
  gridMajority: 'grid',
  gridOutline: 'grid',
  gridSlope: 'grid',
  gridAspect: 'grid',
  gridCurvature: 'grid',
  gridThreshold: 'grid',
  gridRangeSelect: 'grid',
  gridEdge: 'grid',
  gridDistance: 'grid',
  gridResize: 'grid',
  gridComponents: 'grid',
  gridZonalMean: 'grid',
  heightfield: 'heightfield',
  heightfieldSetMask: 'heightfield',
  heightfieldMesh: 'geometry',
  box: 'geometry',
  transform: 'geometry',
  placeOnGround: 'geometry',
  liftToSurface: 'geometry',
  surfaceBand: 'geometry',
  emptyScene: 'scene',
}

export function primaryOutputPort(functionName: string | undefined): string | undefined {
  if (!functionName) return undefined
  return HOST_PRIMARY_OUTPUT[functionName as HostFunctionName]
}

export function unwrapPrimaryResult(functionName: string, result: unknown): unknown {
  const port = primaryOutputPort(functionName)
  if (!port || result == null || typeof result !== 'object' || Array.isArray(result)) return result
  const rec = result as Record<string, unknown>
  if (rec[port] === undefined) return result
  return rec[port]
}

export type HostImpl = (args: Record<string, unknown>) => unknown

export interface SceneArgRef {
  from: string
  port: string
  arg: string
}

export interface SceneCallSource {
  file?: string
  line?: number
  column?: number
}

export interface SceneCallRecord {
  id: string
  functionName: string
  args: Record<string, unknown>
  result: unknown
  source?: SceneCallSource
  argRefs: SceneArgRef[]
  reused: boolean
}

export interface SceneRunHost {
  implementations: Record<string, HostImpl>
  memo: Map<string, { argsKey: string; result: unknown }>
  trace: SceneCallRecord[]
  diagnostics: SceneDiagnostic[]
  mintId: (functionName: string, source?: SceneCallSource) => string
  seed: number
}

const storage = new AsyncLocalStorage<SceneRunHost>()

const INTERNAL_ARG_KEYS = new Set(['__sceneId', '__sceneFile', '__sceneLine', '__sceneColumn'])

export function currentSceneHost(): SceneRunHost | undefined {
  return storage.getStore()
}

export function runWithSceneHost<T>(host: SceneRunHost, fn: () => T): T {
  return storage.run(host, fn)
}

export function createSceneRunHost(input: {
  implementations?: Record<string, HostImpl>
  seed?: number
  memo?: Map<string, { argsKey: string; result: unknown }>
}): SceneRunHost {
  const minted = new Map<string, number>()
  return {
    implementations: { ...input.implementations },
    memo: input.memo ?? new Map(),
    trace: [],
    diagnostics: [],
    seed: input.seed ?? 1,
    mintId(functionName, source) {
      const file = source?.file ?? 'main.scene.ts'
      const line = source?.line ?? 0
      const column = source?.column ?? 0
      const material = `${file}:${line}:${column}:${functionName}`
      const seen = minted.get(material) ?? 0
      minted.set(material, seen + 1)
      return stableEntityId('stmt', seen === 0 ? material : `${material}#${seen}`)
    },
  }
}

function taggedId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const id = (value as Record<symbol, unknown>)[SCENE_CALL_ID]
  return typeof id === 'string' ? id : undefined
}

function taggedPort(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const port = (value as Record<symbol, unknown>)[SCENE_CALL_PORT]
  return typeof port === 'string' ? port : undefined
}

export function collectArgRefs(args: Record<string, unknown>): SceneArgRef[] {
  const refs: SceneArgRef[] = []
  const seen = new Set<string>()
  const walk = (arg: string, value: unknown, depth: number): void => {
    if (value === null || typeof value !== 'object' || depth > 6) return
    const id = taggedId(value)
    if (id) {
      const port = taggedPort(value) ?? inferPort(value) ?? 'value'
      const key = `${id}:${port}->${arg}`
      if (seen.has(key)) return
      seen.add(key)
      refs.push({ from: id, port, arg })
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(arg, item, depth + 1)
      return
    }
    for (const nested of Object.values(value as Record<string, unknown>)) {
      walk(arg, nested, depth + 1)
    }
  }
  for (const [arg, value] of Object.entries(args)) walk(arg, value, 0)
  return refs
}

function inferPort(value: unknown): string | undefined {
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) return 'grid'
  if (!value || typeof value !== 'object') return undefined
  const rec = value as Record<string, unknown>
  if (rec.type === 'heightfield') return 'heightfield'
  if (typeof rec.kind === 'string') return 'geometry'
  if (typeof rec.focus === 'string' && rec.graph && typeof rec.graph === 'object') return 'scene'
  if ('heightfield' in rec) return 'heightfield'
  if ('geometry' in rec) return 'geometry'
  if ('grid' in rec) return 'grid'
  if ('scene' in rec) return 'scene'
  if ('layers' in rec) return 'layers'
  return undefined
}

// A call-site ID identifies the producer, not a particular value it produced.
// Weak identities keep downstream keys small and allow unchanged cached results
// to be reused across runs without retaining the results here.
const valueIdentities = new WeakMap<object, number>()
let nextValueIdentity = 0
function valueIdentity(value: object): number {
  let id = valueIdentities.get(value)
  if (id === undefined) { id = ++nextValueIdentity; valueIdentities.set(value, id) }
  return id
}

function replaceTagged(value: unknown): unknown {
  if (typeof value === 'function') return { $function: valueIdentity(value) }
  if (value === undefined) return { $undefined: true }
  if (typeof value === 'bigint') return { $bigint: String(value) }
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) }
  if (value === null || typeof value !== 'object') return value
  const id = taggedId(value)
  if (id) return { $sceneRef: id, $port: taggedPort(value) ?? null, $value: valueIdentity(value) }
  // A same-length buffer, a deep palette, and a Map-held transform can all
  // change independently. Never replace them with length/depth-only stubs.
  if (Array.isArray(value)) return value.map(replaceTagged)
  if (ArrayBuffer.isView(value)) return { $buffer: value.constructor.name, bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) }
  if (value instanceof ArrayBuffer) return { $buffer: 'ArrayBuffer', bytes: Array.from(new Uint8Array(value)) }
  if (value instanceof Map) return { $map: [...value].map(([key, item]) => [replaceTagged(key), replaceTagged(item)]) }
  if (value instanceof Set) return { $set: [...value].map(replaceTagged) }
  if (value instanceof Date) return { $date: value.toISOString() }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceTagged(item)]))
}

export function serializeArgs(args: Record<string, unknown>): string {
  // Store a digest, not a second full geometry JSON string in every memo entry.
  return stableEntityId('args', JSON.stringify(replaceTagged(args)))
}

export function tagResult(result: unknown, id: string, primaryPort?: string): unknown {
  if (!result || typeof result !== 'object') return result
  const rec = result as Record<string | symbol, unknown>
  Object.defineProperty(rec, SCENE_CALL_ID, { value: id, enumerable: false, configurable: true })
  if (primaryPort) {
    Object.defineProperty(rec, SCENE_CALL_PORT, { value: primaryPort, enumerable: false, configurable: true })
    return result
  }
  for (const [key, value] of Object.entries(rec)) {
    if (key.startsWith('_') || key === 'error') continue
    if (value && typeof value === 'object') {
      Object.defineProperty(value, SCENE_CALL_ID, { value: id, enumerable: false, configurable: true })
      Object.defineProperty(value, SCENE_CALL_PORT, { value: key, enumerable: false, configurable: true })
    }
  }
  return result
}

export function publicArgs(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => !INTERNAL_ARG_KEYS.has(key)))
}

/** Query helper. Not recorded, not a graph node — safe inside placement loops. */
export function sampleHeight(rawArgs: Record<string, unknown> = {}): { z: number | null; error?: string } {
  const host = currentSceneHost()
  if (!host) throw new Error(`@forgeax/scene 'sampleHeight' must run under runSceneModule`)
  const impl = host.implementations.sampleHeight
  if (!impl) throw new Error(`No host implementation for 'sampleHeight'`)
  return impl(publicArgs(rawArgs)) as { z: number | null; error?: string }
}

/** Query helper. Not recorded. Vertical Heightfield sample: point, normal, planar UV, face. */
export function sampleSurface(rawArgs: Record<string, unknown> = {}): {
  point: readonly [number, number, number] | null
  normal: readonly [number, number, number] | null
  uv: readonly [number, number] | null
  face: number | null
  error?: string
} {
  const host = currentSceneHost()
  if (!host) throw new Error(`@forgeax/scene 'sampleSurface' must run under runSceneModule`)
  const impl = host.implementations.sampleSurface
  if (!impl) throw new Error(`No host implementation for 'sampleSurface'`)
  return impl(publicArgs(rawArgs)) as {
    point: readonly [number, number, number] | null
    normal: readonly [number, number, number] | null
    uv: readonly [number, number] | null
    face: number | null
    error?: string
  }
}

export function invoke(functionName: string, rawArgs: Record<string, unknown> = {}): unknown {
  const host = currentSceneHost()
  if (!host) {
    throw new Error(`@forgeax/scene '${functionName}' must run under runSceneModule`)
  }
  const source: SceneCallSource | undefined = typeof rawArgs.__sceneFile === 'string'
    ? {
        file: rawArgs.__sceneFile,
        ...(typeof rawArgs.__sceneLine === 'number' ? { line: rawArgs.__sceneLine } : {}),
        ...(typeof rawArgs.__sceneColumn === 'number' ? { column: rawArgs.__sceneColumn } : {}),
      }
    : undefined
  const id = typeof rawArgs.__sceneId === 'string' && rawArgs.__sceneId.trim()
    ? rawArgs.__sceneId.trim()
    : host.mintId(functionName, source)
  const args = publicArgs(rawArgs)
  const argRefs = collectArgRefs(args)
  const argsKey = serializeArgs(args)
  const previous = host.memo.get(id)
  if (previous && previous.argsKey === argsKey) {
    recordHostFailure(host, functionName, id, source, previous.result)
    recordHostWarnings(host, functionName, id, source, previous.result)
    host.trace.push({
      id,
      functionName,
      args,
      result: previous.result,
      source,
      argRefs,
      reused: true,
    })
    return previous.result
  }
  const impl = host.implementations[functionName]
  if (!impl) {
    const diagnostic = createSceneDiagnostic({
      code: 'SCENE_HOST_MISSING',
      phase: 'execute',
      severity: 'error',
      message: `No host implementation for '${functionName}'.`,
      operation: functionName,
      source: source?.file
        ? { file: source.file, start: 0, end: 0, line: source.line ?? 1, column: source.column ?? 1, statementId: id }
        : undefined,
    })
    host.diagnostics.push(diagnostic)
    throw new Error(diagnostic.message)
  }
  const raw = impl(args)
  recordHostFailure(host, functionName, id, source, raw)
  recordHostWarnings(host, functionName, id, source, raw)
  const result = tagResult(unwrapPrimaryResult(functionName, raw), id, primaryOutputPort(functionName))
  host.memo.set(id, { argsKey, result })
  host.trace.push({
    id,
    functionName,
    args,
    result,
    source,
    argRefs,
    reused: false,
  })
  return result
}

export function hostResultError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return undefined
  const error = (result as { error?: unknown }).error
  return typeof error === 'string' && error.trim() ? error : undefined
}

function hostCallSource(
  id: string,
  source: SceneCallSource | undefined,
): NonNullable<Parameters<typeof createSceneDiagnostic>[0]['source']> {
  return {
    file: source?.file ?? 'main.scene.ts',
    start: 0,
    end: 0,
    line: source?.line ?? 1,
    column: source?.column ?? 1,
    statementId: id,
  }
}

function recordHostWarnings(
  host: SceneRunHost,
  functionName: string,
  id: string,
  source: SceneCallSource | undefined,
  result: unknown,
): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return
  const warnings = (result as { _warnings?: unknown })._warnings
  if (!Array.isArray(warnings)) return
  for (const item of warnings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as { code?: unknown; message?: unknown }
    if (typeof rec.code !== 'string' || !rec.code.startsWith('SCENE_')) continue
    host.diagnostics.push(createSceneDiagnostic({
      code: rec.code,
      phase: 'execute',
      severity: 'warning',
      message: typeof rec.message === 'string' && rec.message.trim() ? rec.message : rec.code,
      operation: functionName,
      source: hostCallSource(id, source),
      graph: { authoringNodeId: id, runtimeNodeIds: [id] },
    }))
  }
}

function recordHostFailure(
  host: SceneRunHost,
  functionName: string,
  id: string,
  source: SceneCallSource | undefined,
  result: unknown,
): void {
  const message = hostResultError(result)
  if (!message) return
  host.diagnostics.push(createSceneDiagnostic({
    code: 'SCENE_HOST_FAILED',
    phase: 'execute',
    severity: 'error',
    message: `${functionName}: ${message}`,
    operation: functionName,
    source: {
      file: source?.file ?? 'main.scene.ts',
      start: 0,
      end: 0,
      line: source?.line ?? 1,
      column: source?.column ?? 1,
      statementId: id,
    },
  }))
}

function hostCall(functionName: HostFunctionName) {
  return (args: Record<string, unknown> = {}): unknown => invoke(functionName, args)
}

export const point2d = hostCall('point2d')
export const basePlane = hostCall('basePlane')
export const polyline2d = hostCall('polyline2d')
export const spline2d = hostCall('spline2d')
export const polygon2d = hostCall('polygon2d')
export const network2d = hostCall('network2d')
export const point3d = hostCall('point3d')
export const polyline3d = hostCall('polyline3d')
export const spline3d = hostCall('spline3d')
export const polygon3d = hostCall('polygon3d')
export const network3d = hostCall('network3d')
export const geometryMask = hostCall('geometryMask')
export const createGrid = hostCall('createGrid')
export const gridFill = hostCall('gridFill')
export const gridGradient = hostCall('gridGradient')
export const gridDiamondSquare = hostCall('gridDiamondSquare')
export const gridMidpoint = hostCall('gridMidpoint')
export const hashNoise = hostCall('hashNoise')
export const valueNoise = hostCall('valueNoise')
export const valueCubicNoise = hostCall('valueCubicNoise')
export const perlinNoise = hostCall('perlinNoise')
export const openSimplex2Noise = hostCall('openSimplex2Noise')
export const openSimplex2sNoise = hostCall('openSimplex2sNoise')
export const cellularNoise = hostCall('cellularNoise')
export const gridAdd = hostCall('gridAdd')
export const gridSub = hostCall('gridSub')
export const gridMul = hostCall('gridMul')
export const gridMin = hostCall('gridMin')
export const gridMax = hostCall('gridMax')
export const gridLerp = hostCall('gridLerp')
export const gridChoose = hostCall('gridChoose')
export const gridMaskDiff = hostCall('gridMaskDiff')
export const gridMaskUnion = hostCall('gridMaskUnion')
export const gridAbs = hostCall('gridAbs')
export const gridNeg = hostCall('gridNeg')
export const gridClamp = hostCall('gridClamp')
export const gridRemap = hostCall('gridRemap')
export const gridSmoothstep = hostCall('gridSmoothstep')
export const gridQuantize = hostCall('gridQuantize')
export const gridBlur = hostCall('gridBlur')
export const gridSharpen = hostCall('gridSharpen')
export const gridMedian = hostCall('gridMedian')
export const gridNeighborhoodMin = hostCall('gridNeighborhoodMin')
export const gridNeighborhoodMax = hostCall('gridNeighborhoodMax')
export const gridDilate = hostCall('gridDilate')
export const gridErodeMorph = hostCall('gridErodeMorph')
export const gridOpen = hostCall('gridOpen')
export const gridClose = hostCall('gridClose')
export const gridMajority = hostCall('gridMajority')
export const gridOutline = hostCall('gridOutline')
export const gridSlope = hostCall('gridSlope')
export const gridAspect = hostCall('gridAspect')
export const gridCurvature = hostCall('gridCurvature')
export const gridThreshold = hostCall('gridThreshold')
export const gridRangeSelect = hostCall('gridRangeSelect')
export const gridEdge = hostCall('gridEdge')
export const gridBBox = hostCall('gridBBox')
export const gridStats = hostCall('gridStats')
export const gridDistance = hostCall('gridDistance')
export const gridResize = hostCall('gridResize')
export const gridComponents = hostCall('gridComponents')
export const gridZonalMean = hostCall('gridZonalMean')
export const heightfield = hostCall('heightfield')
export const heightfieldExplode = hostCall('heightfieldExplode')
export const heightfieldSetMask = hostCall('heightfieldSetMask')
export const heightfieldMesh = hostCall('heightfieldMesh')
export const box = hostCall('box')
export const transform = hostCall('transform')
export const placeOnGround = hostCall('placeOnGround')
export const liftToSurface = hostCall('liftToSurface')
export const surfaceBand = hostCall('surfaceBand')
export const emptyScene = hostCall('emptyScene')
export const sceneNode = hostCall('sceneNode')
export const addChild = hostCall('addChild')
export const sceneOutput = hostCall('sceneOutput')

export function defineRecordedGenerator<
  TInputs extends Record<string, unknown> = Record<string, unknown>,
  TOutputs extends Record<string, unknown> = Record<string, unknown>,
>(definition: {
  id?: string
  version?: string | number
  description?: string
  inputs: Record<string, unknown>
  outputs: Record<string, unknown>
  run: (ctx: ReturnType<typeof defaultGeneratorContext>, args: TInputs) => TOutputs | Promise<TOutputs>
}): ((args?: TInputs) => TOutputs | Promise<TOutputs>) & typeof definition {
  const id = typeof definition.id === 'string' && definition.id.trim() ? definition.id.trim() : 'anonymous-generator'
  const host = currentSceneHost()
  const impl: HostImpl = (args) => {
    const ctx = defaultGeneratorContext(host?.seed ?? 1)
    return definition.run(ctx, args as TInputs)
  }
  if (host) host.implementations[id] = impl
  const fn = (args: TInputs = {} as TInputs) => {
    const run = () => invoke(id, args as Record<string, unknown>) as TOutputs | Promise<TOutputs>
    if (currentSceneHost()) return run()
    return host ? runWithSceneHost(host, run) : run()
  }
  return Object.assign(fn, { ...definition, id })
}

/**
 * Scene bundles call `globalThis.__forgeaxSceneHost`. Bun/Node `import()` of a
 * temp ESM file often drops AsyncLocalStorage, so each shim re-enters `host`.
 */
export function bindSceneHostGlobals(host: SceneRunHost): void {
  const wrap = <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => runWithSceneHost(host, () => fn(...args))
  const global = globalThis as typeof globalThis & { __forgeaxSceneHost?: unknown }
  global.__forgeaxSceneHost = {
    ...Object.fromEntries(HOST_FUNCTION_NAMES.map(name => [name, wrap(hostCall(name))])),
    sampleHeight: wrap(sampleHeight),
    sampleSurface: wrap(sampleSurface),
    invoke: wrap(invoke),
    defineRecordedGenerator: wrap(defineRecordedGenerator),
  }
}

export const allocateSpans = hostCall('allocateSpans')
export const segmentRun = hostCall('segmentRun')
export const deriveSeed = hostCall('deriveSeed')
export const localFrame = hostCall('localFrame')
export const fitAnchor = hostCall('fitAnchor')
export const boundsRelation = hostCall('boundsRelation')
