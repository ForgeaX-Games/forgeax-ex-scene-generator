/** Designed Alpine Valley CVs and numeric literals from alpine-valley.scene.ts. */
export const ALPINE_FACTORY_POINTS = {
  mountainPeaks: [[18, 10], [42, 8], [68, 9], [92, 12], [114, 16], [22, 28], [108, 36]],
  riverPath: [[0, 52], [22, 56], [48, 50], [70, 54], [96, 58], [128, 54]],
  plazaCenterPts: [[72, 66]],
} as const satisfies Record<string, ReadonlyArray<readonly [number, number]>>

export const ALPINE_FACTORY_VALLEY = {
  width: 128,
  height: 128,
  valleyDepth: 42,
  valleyWidth: 32,
  riverDepth: 2.2,
  riverWidth: 8,
  ridgeNoise: 4.6,
  seed: 27,
  baseElevation: 3,
  erosionStrength: 0.75,
  terraceSteps: 6,
  plazaRadius: 7.4,
} as const

export const ALPINE_FACTORY_NETWORK = {
  plazaRadius: 7.4,
  riverWidth: 8,
  seed: 27,
} as const

const CONTROL_BINDINGS = ['mountainPeaks', 'riverPath', 'plazaCenterPts'] as const

function skipJsValue(source: string, start: number): number {
  let i = start
  while (i < source.length && /\s/.test(source[i]!)) i += 1
  const open = source[i]
  if (open === '[' || open === '{') {
    let depth = 0
    let quote: string | null = null
    for (; i < source.length; i += 1) {
      const ch = source[i]!
      if (quote) {
        if (ch === '\\') { i += 1; continue }
        if (ch === quote) quote = null
        continue
      }
      if (ch === '"' || ch === "'") { quote = ch; continue }
      if (ch === '[' || ch === '{') depth += 1
      else if (ch === ']' || ch === '}') {
        depth -= 1
        if (depth === 0) return i + 1
      }
    }
    return source.length
  }
  while (i < source.length && /[^\s,}]/.test(source[i]!)) i += 1
  return i
}

function formatPoints(points: ReadonlyArray<readonly [number, number]>): string {
  return `[${points.map(([x, y]) => `[${x}, ${y}]`).join(', ')}]`
}

function replaceObjectKeyValue(
  source: string,
  objStart: number,
  key: string,
  nextValue: string,
): string {
  let i = objStart + 1
  let depth = 1
  let quote: string | null = null
  const needle = `${key}:`
  while (i < source.length && depth > 0) {
    const ch = source[i]!
    if (quote) {
      if (ch === '\\') { i += 2; continue }
      if (ch === quote) quote = null
      i += 1
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; i += 1; continue }
    if (ch === '{' || ch === '[') { depth += 1; i += 1; continue }
    if (ch === '}' || ch === ']') { depth -= 1; i += 1; continue }
    if (depth === 1 && source.startsWith(needle, i) && (i === 0 || /[\s,{]/.test(source[i - 1]!))) {
      const valueStart = i + needle.length
      const valueEnd = skipJsValue(source, valueStart)
      return `${source.slice(0, valueStart)} ${nextValue}${source.slice(valueEnd)}`
    }
    i += 1
  }
  return source
}

function findCallObjectStart(source: string, functionName: string): number {
  const re = new RegExp(`(?<![A-Za-z0-9_$])${functionName}\\s*\\(`)
  const match = re.exec(source)
  if (!match) return -1
  return source.indexOf('{', match.index + match[0].length)
}

function replaceCallNumbers(
  source: string,
  functionName: string,
  values: Record<string, number>,
): string {
  const objStart = findCallObjectStart(source, functionName)
  if (objStart < 0) return source
  let next = source
  for (const [key, value] of Object.entries(values)) {
    const start = findCallObjectStart(next, functionName)
    if (start < 0) return next
    next = replaceObjectKeyValue(next, start, key, String(value))
  }
  return next
}

function replaceControlPoints(
  source: string,
  binding: keyof typeof ALPINE_FACTORY_POINTS,
): string {
  const marker = `const ${binding} = controlPoints(`
  const callAt = source.indexOf(marker)
  if (callAt < 0) return source
  const objStart = source.indexOf('{', callAt + marker.length)
  if (objStart < 0) return source
  return replaceObjectKeyValue(source, objStart, 'points', formatPoints(ALPINE_FACTORY_POINTS[binding]))
}

/**
 * Rewrite an Alpine valley module back to the designed CVs and numeric
 * literals. Keeps `// @scene-id` comments and the rest of the document.
 * Also flattens SetParam datatree `{ path, items }` blobs back to `[[x, y], …]`.
 */
export function restoreAlpineFactorySource(source: string): string {
  let next = source
  for (const binding of CONTROL_BINDINGS) {
    next = replaceControlPoints(next, binding)
  }
  next = replaceCallNumbers(next, 'valleyHeightfield', { ...ALPINE_FACTORY_VALLEY })
  next = replaceCallNumbers(next, 'villageRoadNetwork', { ...ALPINE_FACTORY_NETWORK })
  next = next.replace(/plazaRadius:\s*[-+]?\d+(?:\.\d+)?/g, 'plazaRadius: 7.4')
  return next
}

export interface AlpineFactoryResetHooks {
  getModule: (file: string) => Promise<{ file: string; source: string; revision: string }>
  saveModule: (input: {
    file: string
    source: string
    expectedRevision: string
    canonicalize?: boolean
    label?: string
  }) => Promise<unknown>
  execute: () => Promise<void>
}

export interface AlpineFactoryResetResult {
  ok: boolean
  changed: boolean
  error?: string
}

/**
 * Restore the valley document to factory Alpine values, compile through the
 * stored entry (`main.scene.ts`), then run the full pipeline from a clear cache.
 */
export async function applyAlpineFactoryReset(
  hooks: AlpineFactoryResetHooks,
  file = 'valley.scene.ts',
): Promise<AlpineFactoryResetResult> {
  try {
    const current = await hooks.getModule(file)
    const next = restoreAlpineFactorySource(current.source)
    await hooks.saveModule({
      file: current.file || file,
      source: next,
      expectedRevision: current.revision,
      canonicalize: false,
      label: 'Reset Alpine Valley factory',
    })
    await hooks.execute()
    return { ok: true, changed: next !== current.source }
  } catch (error) {
    return {
      ok: false,
      changed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
