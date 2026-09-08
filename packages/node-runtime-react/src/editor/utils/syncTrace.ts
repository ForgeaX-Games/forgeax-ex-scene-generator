/** Opt-in probe/preview/bake sync diagnostics. Enable: localStorage.setItem('wb-scene-generator.debugSync', 'true') */

const LS_KEY = 'wb-scene-generator.debugSync'

export function syncTraceEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(LS_KEY) === 'true'
  } catch {
    return false
  }
}

export function syncTrace(tag: string, detail?: Record<string, unknown>): void {
  if (!syncTraceEnabled()) return
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[sync-trace ${ts}] ${tag}`, detail ?? '')
}

let _hintShown = false
export function syncTraceHintOnce(): void {
  if (!syncTraceEnabled() || _hintShown) return
  _hintShown = true
  console.info('[sync-trace] probe/preview/bake diagnostics active (filter: sync-trace)')
}

export function summarizeNodeOutputs(outputs: Record<string, Record<string, unknown>>): string {
  return Object.entries(outputs)
    .map(([nodeId, ports]) => `${nodeId}:{${Object.keys(ports).join(',')}}`)
    .join(' | ')
}
