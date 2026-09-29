/** InputNumber (`number_const`) slider chrome: min / max / precision. */

export const NUMBER_CONST_OP_ID = 'number_const'

export const NUMBER_CONST_SLIDER_PARAM_KEYS = ['min', 'max', 'precision'] as const

export type NumberConstSliderParams = {
  min: number
  max: number
  precision: number
}

export function isNumberConstSliderParamKey(key: string): boolean {
  return key === 'min' || key === 'max' || key === 'precision'
}

export function inferNumberConstPrecision(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0
  const text = String(value)
  const dot = text.indexOf('.')
  if (dot < 0) return 0
  return Math.min(4, text.length - dot - 1)
}

/** First-seen range: max is 2× the value (or 2× toward the negative side). Zero falls back to 0–100. */
export function defaultNumberConstSlider(value: number): NumberConstSliderParams {
  const n = Number.isFinite(value) ? value : 0
  const precision = inferNumberConstPrecision(n)
  if (n > 0) return { min: 0, max: n * 2, precision }
  if (n < 0) return { min: n * 2, max: 0, precision }
  return { min: 0, max: 100, precision: 0 }
}

interface SliderNode {
  id: string
  opId: string
  params: Record<string, unknown>
}

interface PreviousSliderNode {
  opId?: string
  params?: Record<string, unknown>
}

function isNumberConst(opId: string | undefined): boolean {
  return opId === NUMBER_CONST_OP_ID
}

/**
 * Init slider chrome on first create; keep a previously chosen range/type when
 * the same node comes back from a later compile (script only updates `value`).
 */
export function stampNumberConstSliderParams(
  nodes: Iterable<SliderNode>,
  previousById?: Readonly<Record<string, PreviousSliderNode | undefined>>,
): void {
  for (const node of nodes) {
    if (!isNumberConst(node.opId)) continue
    const value = typeof node.params.value === 'number' ? node.params.value : 0
    const prev = previousById?.[node.id]
    const prevParams = isNumberConst(prev?.opId) || prev?.opId === undefined ? prev?.params : undefined
    if (typeof prevParams?.max === 'number') {
      if (typeof prevParams.min === 'number') node.params.min = prevParams.min
      node.params.max = prevParams.max
      if (typeof prevParams.precision === 'number') node.params.precision = prevParams.precision
      continue
    }
    const next = defaultNumberConstSlider(value)
    if (typeof node.params.min !== 'number') node.params.min = next.min
    if (typeof node.params.max !== 'number') node.params.max = next.max
    if (typeof node.params.precision !== 'number') node.params.precision = next.precision
  }
}

/** Copy min/max/precision from an incoming batch onto compiled number_const nodes. */
export function overlayNumberConstSliderPatches(
  nodes: Iterable<SliderNode>,
  ops: ReadonlyArray<{ type: string; nodeId?: string; params?: Record<string, unknown> }>,
): void {
  const byId = new Map<string, SliderNode>()
  for (const node of nodes) {
    if (isNumberConst(node.opId)) byId.set(node.id, node)
  }
  for (const op of ops) {
    if (op.type !== 'updateNode' || !op.nodeId || !op.params) continue
    const node = byId.get(op.nodeId)
    if (!node) continue
    for (const key of NUMBER_CONST_SLIDER_PARAM_KEYS) {
      const value = op.params[key]
      if (typeof value === 'number') node.params[key] = value
    }
  }
}

export function isNumberConstSliderPresentationOp(
  op: {
    type: string
    nodeId?: string
    params?: Record<string, unknown>
    position?: unknown
    name?: unknown
  },
  nodes: Readonly<Record<string, { opId?: string } | undefined>>,
): boolean {
  if (op.type !== 'updateNode' || op.position !== undefined || op.name !== undefined || !op.params) return false
  const keys = Object.keys(op.params)
  if (keys.length === 0 || keys.some((key) => !isNumberConstSliderParamKey(key))) return false
  return nodes[op.nodeId ?? '']?.opId === NUMBER_CONST_OP_ID
}

export function kernelGraphNodeList<T extends { id: string }>(
  nodes: readonly T[] | Record<string, T> | undefined,
): readonly T[] {
  if (!nodes) return []
  return Array.isArray(nodes) ? nodes : Object.values(nodes)
}
