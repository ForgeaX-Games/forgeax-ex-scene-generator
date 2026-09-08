/** Opt-in backend probe/preview/bake sync diagnostics.
 *  Enable: `FORGEAX_DEBUG_SYNC=1` or `WB_SCENE_GENERATOR_DEBUG_SYNC=1`. */

export function syncTraceEnabled(): boolean {
  return (
    process.env.FORGEAX_DEBUG_SYNC === '1'
    || process.env.WB_SCENE_GENERATOR_DEBUG_SYNC === '1'
  )
}

export function syncTrace(tag: string, detail?: Record<string, unknown>): void {
  if (!syncTraceEnabled()) return
  const ts = new Date().toISOString().slice(11, 23)
  console.log(`[sync-trace ${ts}] ${tag}`, detail ?? '')
}
