/** Two write doors for the composition canvas. Graph JSON is not an authoring surface. */

import {
  isNumberConstSliderParamKey,
  isNumberConstSliderPresentationOp,
  type Op,
} from '@forgeax/node-runtime'
import { HOST_FUNCTION_NAMES } from '@forgeax/scene'
import type { AuthoringCommand } from '@forgeax/scene-authoring'

export const PRIMITIVE_OP_IDS = new Set(['number_const', 'text_panel', 'toggle', 'json_panel'])

/** Bindings that would shadow `import { name } from '@forgeax/scene'`. */
export const HOST_BINDING_ALIASES: Record<string, string> = {
  point2d: 'site',
  basePlane: 'world',
  createGrid: 'grid',
  gridFill: 'filled',
  gridGradient: 'ramp',
  gridDiamondSquare: 'diamond',
  gridMidpoint: 'midpoint',
  hashNoise: 'hash',
  valueNoise: 'value',
  valueCubicNoise: 'cubic',
  perlinNoise: 'perlin',
  openSimplex2Noise: 'simplex',
  openSimplex2sNoise: 'simplexS',
  cellularNoise: 'cellular',
  gridAdd: 'sum',
  gridSub: 'diff',
  gridMul: 'product',
  gridMin: 'lo',
  gridMax: 'hi',
  gridLerp: 'mix',
  gridChoose: 'pick',
  gridMaskDiff: 'cut',
  gridMaskUnion: 'union',
  gridAbs: 'abs',
  gridNeg: 'neg',
  gridClamp: 'clamped',
  gridRemap: 'remapped',
  gridSmoothstep: 'smooth',
  gridQuantize: 'steps',
  gridBlur: 'blurred',
  gridSharpen: 'sharp',
  gridMedian: 'median',
  gridNeighborhoodMin: 'nmin',
  gridNeighborhoodMax: 'nmax',
  gridDilate: 'fat',
  gridErodeMorph: 'thin',
  gridOpen: 'opened',
  gridClose: 'closed',
  gridMajority: 'vote',
  gridOutline: 'ring',
  gridSlope: 'slope',
  gridAspect: 'aspect',
  gridCurvature: 'bend',
  gridThreshold: 'gate',
  gridRangeSelect: 'band',
  gridEdge: 'rim',
  gridBBox: 'bounds',
  gridComponents: 'patches',
  gridZonalMean: 'zonal',
  gridStats: 'stats',
  gridDistance: 'dist',
  gridResize: 'resized',
  heightfield: 'field',
  heightfieldExplode: 'parts',
  heightfieldSetMask: 'marked',
  heightfieldMesh: 'woven',
  box: 'solid',
  transform: 'posed',
  placeOnGround: 'grounded',
  emptyScene: 'scene',
  sceneNode: 'node',
  addChild: 'tree',
  polyline2d: 'line',
  spline2d: 'curve',
  polygon2d: 'region',
  network2d: 'net',
  point3d: 'site3',
  polyline3d: 'line3',
  spline3d: 'curve3',
  polygon3d: 'region3',
  network3d: 'net3',
  liftToSurface: 'lifted',
  surfaceBand: 'ribbon',
  geometryMask: 'mask',
  jsonPanel: 'rec',
}

export function uniqueSceneBinding(base: string, used: Iterable<string> = []): string {
  const reserved = new Set<string>([...HOST_FUNCTION_NAMES, ...used])
  const preferred = HOST_BINDING_ALIASES[base] ?? base
  const normalized = preferred.replace(/[^A-Za-z0-9_$]/g, '') || 'node'
  const first = /^[A-Za-z_$]/.test(normalized) ? normalized : `node${normalized}`
  if (!reserved.has(first)) return first
  let suffix = 2
  while (reserved.has(`${first}${suffix}`)) suffix += 1
  return first + suffix
}

export const PRIMITIVE_VALUE_KEYS = new Set(['value', 'text', 'enabled'])

export type WriteLane = 'runtime' | 'authoring' | 'skip'

export function isPrimitiveOpId(opId: string | undefined): boolean {
  return !!opId && PRIMITIVE_OP_IDS.has(opId)
}

export function isKernelMetaKey(key: string): boolean {
  return key.startsWith('__')
}

/** Script persist may keep only the primitive value. Chrome and compile stamps stay on the kernel. */
export function authoringParamsFromUpdate(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(([key]) => {
      if (isKernelMetaKey(key) || isNumberConstSliderParamKey(key)) return false
      return PRIMITIVE_VALUE_KEYS.has(key)
    }),
  )
}

export function isLiteralOnlyAuthoring(commands: readonly AuthoringCommand[]): boolean {
  if (commands.length === 0) return false
  return commands.every((command) => {
    if (command.type === 'updateLiteral') return true
    if (command.type !== 'updateArguments') return false
    const setCount = Object.keys(command.set ?? {}).length
    return setCount <= 1
  })
}

export function classifyUpdateLane(
  op: Extract<Op, { type: 'updateNode' }>,
  liveOpId: string | undefined,
  ephemeral: boolean | undefined,
): WriteLane {
  if (ephemeral) return 'runtime'
  if (!op.params) return 'skip'
  if (isPrimitiveOpId(liveOpId)) {
    return Object.keys(authoringParamsFromUpdate(op.params)).length > 0 ? 'authoring' : 'runtime'
  }
  const scriptKeys = Object.keys(op.params).filter((key) => (
    !isKernelMetaKey(key) && !isNumberConstSliderParamKey(key)
  ))
  return scriptKeys.length > 0 ? 'authoring' : 'runtime'
}

export function classifyWriteLane(
  op: Op,
  liveNodes: Parameters<typeof isNumberConstSliderPresentationOp>[1],
  ephemeral: boolean | undefined,
): WriteLane {
  if (op.type === 'updateNode' && isNumberConstSliderPresentationOp(op, liveNodes)) return 'runtime'
  if (op.type === 'updateNode' && ephemeral && op.params) return 'runtime'
  if (op.type === 'createNode' || op.type === 'deleteNode' || op.type === 'connect') return 'authoring'
  if (op.type === 'updateNode' && op.params) {
    const liveOpId = liveNodeOpId(liveNodes, op.nodeId)
    return classifyUpdateLane(op, liveOpId, ephemeral)
  }
  if (op.type === 'disconnect' || op.type === 'deleteEdge' || op.type === 'deleteGroup' || op.type === 'ungroup') {
    return 'authoring'
  }
  return 'skip'
}

function liveNodeOpId(
  liveNodes: Parameters<typeof isNumberConstSliderPresentationOp>[1],
  nodeId: string,
): string | undefined {
  if (!liveNodes) return undefined
  if (Array.isArray(liveNodes)) return liveNodes.find((node) => node.id === nodeId)?.opId
  return liveNodes[nodeId]?.opId
}
