/**
 * Primary-output unwrap for the emitted pack's barrel. Copied verbatim into
 * `platform/`.
 *
 * Mirrors `packages/scene/src/host.ts` `unwrapPrimaryResult`: a battery returns
 * `{ <port>: value, _warnings? }`, and the app's host hands the scene only
 * `value`. Without the same step here, scene code that *reads* a result rather
 * than forwarding it — a material rule indexing a Grid, say — sees a different
 * shape in the pack than it did in the app. The port name is baked into the
 * generated barrel from the same `HOST_PRIMARY_OUTPUT` table, so there is no
 * second copy of the mapping.
 */
export function primary(result: unknown, port: string): unknown {
  if (result == null || typeof result !== 'object' || Array.isArray(result)) return result
  const rec = result as Record<string, unknown>
  if (typeof rec.error === 'string' && rec.error) throw new Error(rec.error)
  if (rec[port] === undefined) return result
  return rec[port]
}
