// Project-scoped pipeline routes: `/api/v1/projects/:projectId/{batch,pipeline,nodes,…}`.
// Replaces the legacy global `/api/v1/batch`, `/api/v1/pipeline`, etc.
//
// Registered from `queries.ts`. The `deps` indirection is what is left of this
// file's life as `@forgeax/editor-host` — it is kept because it is also the seam
// `handleApplyBatch` (canonical Scene Script authoring) hooks into.

import type { FastifyInstance, FastifyRequest } from 'fastify'
import {
  applyBatch,
  clearOutputCache,
  getGroup,
  getHistory,
  getNode,
  getNodeOutput,
  getPipeline,
  listEdges,
  listGroups,
  listNodes,
  listOps,
  probeGroupInner,
} from '@forgeax/node-runtime'
import type { ProjectRegistry, Runtime } from '@forgeax/node-runtime'
import { ensureMutationAccess } from './projects.js'
import { registerOutputPageRoutes } from './outputPages.js'

interface ProjectPipelineRouteDeps {
  getProjectRegistry: () => Promise<ProjectRegistry>
  getRuntimeForProject: (projectId: string) => Promise<Runtime>
  /** Optional pre-batch hook (e.g. sino op gate). Return a 403 body to reject. */
  beforeApplyBatch?: (
    req: FastifyRequest,
    projectId: string,
    ops: unknown[],
  ) => Promise<{ status: number; body: unknown } | null>
  /**
   * Optional canonical-authoring interceptor. Returning a response means the
   * interceptor committed the mutation through its own transaction and the
   * legacy runtime batch must not run a second time.
   */
  handleApplyBatch?: (
    req: FastifyRequest,
    projectId: string,
    ops: unknown[],
    opts: { actor?: string; label?: string; batchId?: string; ephemeral?: boolean; expectedPrevHash?: string } | undefined,
  ) => Promise<{ status: number; body: unknown } | null>
  getBatteryCategories?: () => Promise<Map<string, Record<string, unknown>>>
  logOutputFetch?: (
    nodeId: string,
    portId: string,
    durationMs: number,
    bytesOut: number,
    meta: Record<string, unknown>,
  ) => void
  logPersistBatch?: (
    ops: unknown[],
    result: unknown,
    meta: Record<string, unknown>,
  ) => void
}

interface ProjectParams {
  projectId: string
}

/** Max assembled output JSON over HTTP (sharded ports reassemble server-side). */
const MAX_INLINE_OUTPUT_RESPONSE_BYTES = 128 * 1024 * 1024

/**
 * Max TOTAL bytes the `/nodes/outputs/batch` route will inline across every
 * port in one request, on top of the per-port `MAX_INLINE_OUTPUT_RESPONSE_BYTES`
 * cap. Several sharded ports can each individually sit comfortably under the
 * per-port cap (e.g. four `g_veg_*` groups at ~90-110MB each once expanded —
 * see scene-generator-project-switch.md §2.10) yet still sum to several
 * hundred MB to over 1GB for the batch as a whole: one giant response body
 * that's slow to build (repeated reassemble+stringify), slow to transfer, and
 * has been observed to disconnect mid-transfer / take the backend down under
 * memory pressure. Same value as the per-port cap by design — "never send
 * more than ~128MB in one HTTP response" is the invariant we actually want,
 * regardless of how many ports contribute to it.
 */
const MAX_BATCH_RESPONSE_BYTES = MAX_INLINE_OUTPUT_RESPONSE_BYTES

/**
 * Below this, a sharded port's plain (non-deduped) expanded size is small
 * enough that trying the Phase-2 envelope isn't worth the extra
 * `readWithBlobRefs()` call. Above it, ALWAYS try the envelope — not only as
 * a last resort right before rejecting a port as `tooLarge`. A
 * `scene_focus_path`-style broadcast port (see
 * scene-generator-scene-tree-storage.md §3) can sit comfortably under
 * `MAX_INLINE_OUTPUT_RESPONSE_BYTES` fully expanded (e.g. ~65MB for a mere
 * 60x60 map — see §2.16/§2.17) yet still cost hundreds of ms of
 * resolve+`JSON.stringify` CPU and several times the wire bytes it needs to,
 * purely from re-embedding N branches' worth of copies of the SAME
 * underlying tree. When dedup genuinely doesn't help (no blob refs on this
 * port), the envelope is the identical shape/cost as the plain response
 * anyway, so trying it first here is never a regression — only a possible
 * win.
 */
const ENVELOPE_TRY_THRESHOLD_BYTES = 1024 * 1024

/**
 * How many ports the `/nodes/outputs/batch` loop processes before yielding
 * one event-loop turn (see the loop below). Small enough that other pending
 * requests/WS frames get regular chances to run during a large batch; large
 * enough that the `setImmediate` overhead stays negligible relative to the
 * per-port disk I/O it's interleaved with.
 */
const OUTPUT_BATCH_YIELD_EVERY = 8

export interface EnvelopeCapableOutputCache {
  envelopeByteSize?: (n: string, p: string) => number
  readWithBlobRefs?: (n: string, p: string) => { entry: { data?: unknown }; blobs: Record<string, unknown> } | null
}

/**
 * Try the Phase-2 deduped wire envelope (see
 * scene-generator-scene-tree-storage.md §3) for a sharded port whose plain
 * (non-deduped) size estimate exceeds `capBytes` — e.g. a decoration port
 * whose `scene_focus_path` broadcast makes N branches share ONE underlying
 * tree. `envelopeByteSize()` is a cheap pre-check (no shard reassembly) that
 * usually rules out the (rarer) case where dedup doesn't help enough before
 * paying for the real `readWithBlobRefs()` + stringify. Returns null when the
 * OutputCache implementation lacks these methods, or the deduped form still
 * doesn't fit — callers fall back to the existing `tooLarge` response.
 *
 * The payload comes back as ALREADY-SERIALIZED JSON fragments, not live values:
 * measuring the response requires a full stringify anyway, and callers splice
 * the result straight into their response body, so handing back the string is
 * what keeps a multi-hundred-MB envelope from being serialized a second time
 * just to be sent.
 */
export function tryEnvelopeResponse(
  outputCache: EnvelopeCapableOutputCache,
  rtOutputs: unknown,
  nodeId: string,
  portId: string,
  capBytes: number,
): { valueJson: string; blobsJson: string; bytesOut: number } | null {
  const envelopeBytes = outputCache.envelopeByteSize?.call(rtOutputs, nodeId, portId) ?? Infinity
  if (envelopeBytes > capBytes) return null
  const withRefs = outputCache.readWithBlobRefs?.call(rtOutputs, nodeId, portId)
  if (!withRefs) return null
  const valueJson = JSON.stringify(withRefs.entry.data ?? null)
  const blobsJson = JSON.stringify(withRefs.blobs ?? {})
  const bytesOut = Buffer.byteLength(valueJson, 'utf-8') + Buffer.byteLength(blobsJson, 'utf-8')
  if (bytesOut > capBytes) return null
  return { valueJson, blobsJson, bytesOut }
}

export async function registerProjectPipelineRoutes(
  app: FastifyInstance,
  deps: ProjectPipelineRouteDeps,
): Promise<void> {
  await registerOutputPageRoutes(app, deps)
  const prefix = '/api/v1/projects/:projectId'

  app.get<{ Params: ProjectParams }>(`${prefix}/pipeline`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getPipeline(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/pipeline/hash`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const snap = getPipeline(await deps.getRuntimeForProject(projectId))
    return { hash: snap?.hash ?? null }
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/nodes`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listNodes(await deps.getRuntimeForProject(projectId), (req.query as { filter?: unknown }).filter as never)
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/nodes/:id`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getNode(await deps.getRuntimeForProject(projectId), id)
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/edges`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listEdges(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams & { id: string; portId: string } }>(
    `${prefix}/nodes/:id/outputs/:portId/meta`,
    async (req, reply) => {
      const { projectId, id, portId } = req.params
      const reg = await deps.getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const rt = await deps.getRuntimeForProject(projectId)
      const readMeta = (rt.outputs as { readMeta?: (n: string, p: string) => unknown }).readMeta
      const meta = readMeta?.call(rt.outputs, id, portId) ?? null
      return meta ?? { missing: true }
    },
  )

  app.get<{ Params: ProjectParams & { id: string; portId: string } }>(
    `${prefix}/nodes/:id/outputs/:portId`,
    async (req, reply) => {
      const { projectId, id, portId } = req.params
      const reg = await deps.getProjectRegistry()
      if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
      const t0 = performance.now()
      const rt = await deps.getRuntimeForProject(projectId)
      const outputCache = rt.outputs as EnvelopeCapableOutputCache & {
        readMeta?: (n: string, p: string) => { sharded?: boolean; dataChunks?: number } | null
        portByteSize?: (n: string, p: string) => number
      }
      const meta = outputCache.readMeta?.call(rt.outputs, id, portId) ?? null
      // Cheap statSync-only size check BEFORE the expensive path: for a sharded
      // port, getNodeOutput() below fully reassembles every chunk file into one
      // in-memory value and then JSON.stringify()s it just to measure bytesOut —
      // for a multi-hundred-MB voxel output that's seconds of synchronous,
      // event-loop-blocking work spent on a value we're about to discard anyway
      // once we see it's over MAX_INLINE_OUTPUT_RESPONSE_BYTES.
      if (meta?.sharded) {
        const diskBytes = outputCache.portByteSize?.call(rt.outputs, id, portId) ?? 0
        // See ENVELOPE_TRY_THRESHOLD_BYTES: try dedup for any non-trivial
        // sharded port, not only ones about to be rejected as `tooLarge`.
        if (diskBytes > ENVELOPE_TRY_THRESHOLD_BYTES) {
          const envelope = tryEnvelopeResponse(outputCache, rt.outputs, id, portId, MAX_INLINE_OUTPUT_RESPONSE_BYTES)
          if (envelope) {
            deps.logOutputFetch?.(id, portId, performance.now() - t0, envelope.bytesOut, {
              sharded: true,
              dataChunks: meta.dataChunks,
              envelope: true,
            })
            reply.header('content-type', 'application/json; charset=utf-8')
            return reply.send(`{"value":${envelope.valueJson},"blobs":${envelope.blobsJson}}`)
          }
          if (diskBytes > MAX_INLINE_OUTPUT_RESPONSE_BYTES) {
            deps.logOutputFetch?.(id, portId, performance.now() - t0, diskBytes, {
              sharded: true,
              dataChunks: meta.dataChunks,
              skipped: true,
              tooLarge: true,
            })
            reply.code(413)
            reply.header('content-type', 'application/json; charset=utf-8')
            return reply.send(
              JSON.stringify({
                error: 'output too large for inline fetch',
                sharded: true,
                dataChunks: meta.dataChunks ?? null,
                value: null,
              }),
            )
          }
          // Envelope wasn't available (e.g. no blob refs — dedup wouldn't
          // help) but the plain size is still under the cap: fall through to
          // the plain path below, same as pre-existing behaviour.
        }
      }
      const value = getNodeOutput(rt, id, portId)
      const body = JSON.stringify({ value })
      const bytesOut = Buffer.byteLength(body, 'utf-8')
      // Safety net: the disk-size proxy above is cheap but approximate (JSON
      // escaping can inflate the serialized size a little vs. raw chunk bytes).
      // A port that just barely passed the disk-size gate but turns out to
      // exceed the cap once actually stringified is rare and, by construction,
      // close to the boundary — reject it too rather than silently ship an
      // over-cap response.
      if (meta?.sharded && bytesOut > MAX_INLINE_OUTPUT_RESPONSE_BYTES) {
        deps.logOutputFetch?.(id, portId, performance.now() - t0, bytesOut, {
          sharded: true,
          dataChunks: meta.dataChunks,
          skipped: true,
          tooLarge: true,
        })
        reply.code(413)
        reply.header('content-type', 'application/json; charset=utf-8')
        return reply.send(
          JSON.stringify({
            error: 'output too large for inline fetch',
            sharded: true,
            dataChunks: meta.dataChunks ?? null,
            value: null,
          }),
        )
      }
      deps.logOutputFetch?.(id, portId, performance.now() - t0, bytesOut, {
        sharded: meta?.sharded,
        dataChunks: meta?.dataChunks,
      })
      reply.header('content-type', 'application/json; charset=utf-8')
      return reply.send(body)
    },
  )

  // Batch value+meta read for many ports in ONE HTTP round trip. Replaces the
  // fan-out pattern of `ports.length * 2` sequential GETs (meta then value,
  // per port) that made a project switch on a graph with hundreds of visible
  // ports queue behind the browser's per-origin connection cap and the
  // backend's single-threaded event loop. Callers typically do this in two
  // passes: `metaOnly: true` for the FULL port set (cheap — no value
  // serialization) to learn which ports actually changed, then a normal batch
  // call for just the changed subset (chunked client-side to bound the number
  // of large outputs held in memory for one response, mirroring the old
  // OUTPUTS_REFRESH_CONCURRENCY cap).
  app.post<{
    Params: ProjectParams
    Body: { ports?: Array<{ nodeId: string; portId: string }>; metaOnly?: boolean }
  }>(`${prefix}/nodes/outputs/batch`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    const { ports = [], metaOnly = false } = req.body ?? {}
    const __tBatch0 = performance.now()
    const rt = await deps.getRuntimeForProject(projectId)
    const outputCache = rt.outputs as EnvelopeCapableOutputCache & {
      readMeta?: (
        n: string,
        p: string,
      ) => { executedHash?: string; valid?: boolean; sharded?: boolean; dataChunks?: number } | null
      portByteSize?: (n: string, p: string) => number
    }
    const readMeta = outputCache.readMeta
    // Values are held as already-serialized JSON fragments rather than live
    // objects. A port's bytes have to be measured (budget + `tooLarge` gate),
    // which costs a full stringify; keeping the resulting string means the
    // response body is assembled by concatenation instead of serializing every
    // reassembled sharded output a second time — on a big scene that second
    // pass was seconds of event-loop-blocking CPU per request.
    const results: Array<{
      nodeId: string
      portId: string
      valueJson?: string
      blobsJson?: string
      meta: { executedHash?: string; valid?: boolean; sharded?: boolean; dataChunks?: number; type?: string } | null
      tooLarge?: boolean
      estimatedBytes?: number
    }> = []
    let processed = 0
    // Unconditional (not gated behind FORGEAX_CANVAS_PERF_DEBUG — matches the
    // always-on [switch-trace] lines elsewhere) per-request summary: this route
    // previously had ZERO default backend-side timing, so a slow batch was
    // invisible in server logs no matter how long the client waited on it. Ports
    // that resolve in <1ms are almost certainly an OutputCache in-memory hit
    // (Map lookup + one statSync); anything slower did real readFileSync+JSON.parse
    // work, so `coldReads`/`slowest` roughly separate "cache doing its job" from
    // "actually reading disk" without threading cache-hit info through the
    // OutputCache API itself.
    let coldReads = 0
    let totalBytes = 0
    let deferredCount = 0
    let slowestMs = 0
    let slowestPort = ''
    for (const { nodeId, portId } of ports) {
      const t0 = performance.now()
      let meta: { executedHash?: string; valid?: boolean; sharded?: boolean; dataChunks?: number; type?: string } | null = null
      try {
        meta = readMeta?.call(rt.outputs, nodeId, portId) ?? null
      } catch {
        meta = null
      }
      if (metaOnly) {
        results.push({ nodeId, portId, meta })
      } else {
        try {
          // Cheap statSync+small-JSON.parse size check BEFORE getNodeOutput():
          // for a sharded port, getNodeOutput() reassembles every chunk file
          // into one in-memory value, which we'd then JSON.stringify() just to
          // measure bytesOut — for a multi-hundred-MB voxel output (seen in
          // practice: >1GB single ports) that's SECONDS of synchronous,
          // event-loop-blocking work spent on a value we're about to discard
          // as `tooLarge` anyway. Skip straight to the disk-size verdict
          // instead — no reassembly, no stringify.
          const diskBytes = meta?.sharded ? outputCache.portByteSize?.call(rt.outputs, nodeId, portId) ?? 0 : 0
          // Batch-cumulative check, using the cheap diskBytes estimate:
          // several sharded ports can each individually clear the per-port
          // cap yet still sum past a sane single-response size (the actual
          // >1GB / mid-transfer-disconnect reports — see
          // scene-generator-project-switch.md §2.10). Only gate on this for
          // ports big enough to matter; small ports always go through even if
          // an earlier huge one already ate the budget, so a batch never
          // starves entirely on one outlier.
          const wouldExceedBatchBudget =
            meta?.sharded && diskBytes > 1024 * 1024 && totalBytes + diskBytes > MAX_BATCH_RESPONSE_BYTES
          const overCap = meta?.sharded && (diskBytes > MAX_INLINE_OUTPUT_RESPONSE_BYTES || wouldExceedBatchBudget)
          // Try dedup for any non-trivial sharded port (ENVELOPE_TRY_THRESHOLD_BYTES),
          // not only as a last resort right before rejecting one as `tooLarge`
          // — see the comment on that constant. Re-check against the
          // REMAINING batch budget too, so dedup doesn't let one port blow
          // past MAX_BATCH_RESPONSE_BYTES on its own.
          const envelope =
            meta?.sharded && diskBytes > ENVELOPE_TRY_THRESHOLD_BYTES
              ? (() => {
                  const remainingBudget = MAX_BATCH_RESPONSE_BYTES - totalBytes
                  return remainingBudget > 0
                    ? tryEnvelopeResponse(
                        outputCache,
                        rt.outputs,
                        nodeId,
                        portId,
                        Math.min(MAX_INLINE_OUTPUT_RESPONSE_BYTES, remainingBudget),
                      )
                    : null
                })()
              : null
          if (envelope) {
            totalBytes += envelope.bytesOut
            deps.logOutputFetch?.(nodeId, portId, performance.now() - t0, envelope.bytesOut, {
              sharded: true,
              dataChunks: meta?.dataChunks,
              envelope: true,
              batch: true,
            })
            results.push({ nodeId, portId, valueJson: envelope.valueJson, blobsJson: envelope.blobsJson, meta })
          } else if (overCap) {
            totalBytes += diskBytes
            deferredCount += 1
            deps.logOutputFetch?.(nodeId, portId, performance.now() - t0, diskBytes, {
              sharded: true,
              dataChunks: meta?.dataChunks,
              skipped: true,
              tooLarge: true,
              batch: true,
              batchBudget: wouldExceedBatchBudget,
            })
            results.push({ nodeId, portId, valueJson: 'null', meta, tooLarge: true, estimatedBytes: diskBytes })
          } else {
            const valueJson = JSON.stringify(getNodeOutput(rt, nodeId, portId) ?? null)
            const bytesOut = Buffer.byteLength(valueJson, 'utf-8')
            // Safety net: the disk-size proxy above is cheap but approximate
            // (JSON escaping can inflate serialized size a little vs. raw
            // chunk bytes) — a port that just barely passed the gate but
            // turns out to exceed either cap once actually stringified is
            // rare and, by construction, close to the boundary.
            if (meta?.sharded && (bytesOut > MAX_INLINE_OUTPUT_RESPONSE_BYTES || totalBytes + bytesOut > MAX_BATCH_RESPONSE_BYTES)) {
              totalBytes += bytesOut
              deferredCount += 1
              deps.logOutputFetch?.(nodeId, portId, performance.now() - t0, bytesOut, {
                sharded: true,
                dataChunks: meta.dataChunks,
                skipped: true,
                tooLarge: true,
                batch: true,
              })
              results.push({ nodeId, portId, valueJson: 'null', meta, tooLarge: true, estimatedBytes: bytesOut })
            } else {
              totalBytes += bytesOut
              deps.logOutputFetch?.(nodeId, portId, performance.now() - t0, bytesOut, {
                sharded: meta?.sharded,
                dataChunks: meta?.dataChunks,
                batch: true,
              })
              results.push({ nodeId, portId, valueJson, meta })
            }
          }
        } catch {
          results.push({ nodeId, portId, meta })
        }
      }
      const portMs = performance.now() - t0
      if (portMs >= 1) coldReads += 1
      if (portMs > slowestMs) {
        slowestMs = portMs
        slowestPort = `${nodeId}/${portId}`
      }
      // Each iteration is synchronous, event-loop-blocking disk I/O (readFileSync
      // + JSON.parse, and for sharded voxel outputs one such read per chunk file
      // — see OutputCache). A project switch's full-port fan-out can be hundreds
      // of ports; without yielding, that whole loop runs as ONE uninterrupted
      // task and starves every other in-flight request/WS frame for its entire
      // duration. Yielding every few ports lets those interleave, at the cost of
      // this response taking marginally longer wall-clock (never CPU) time.
      processed += 1
      if (processed % OUTPUT_BATCH_YIELD_EVERY === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
    const __batchMs = performance.now() - __tBatch0
    // `totalBytes` above is a would-be-serialized-size *estimate* for ports
    // this route deliberately never reconstructs (that's the whole point of
    // P0-5/P0-6 — it's what got discarded, not what's resident). `rss` here
    // is the actual OS-reported resident set size of this Node process at
    // the moment this request finishes, i.e. the real number to watch if
    // checking whether memory usage is actually growing over time/requests.
    const mem = process.memoryUsage()
    console.log(
      `[output-batch-trace] project=${projectId} metaOnly=${metaOnly} ports=${ports.length} ` +
        `coldReads=${coldReads} deferred=${deferredCount} totalBytes=${(totalBytes / 1024).toFixed(1)}KB ` +
        `slowest=${slowestPort || '-'}(${slowestMs.toFixed(1)}ms) TOTAL=${__batchMs.toFixed(1)}ms ` +
        `rss=${(mem.rss / 1024 / 1024).toFixed(1)}MB heapUsed=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB`,
    )
    reply.header('content-type', 'application/json; charset=utf-8')
    // Splice the per-port fragments in. Keys are emitted only when present, so
    // the wire shape matches what `JSON.stringify({ results })` produced (a
    // result with no value still omits `value` entirely).
    const body = results
      .map((r) => {
        const fields = [`"nodeId":${JSON.stringify(r.nodeId)}`, `"portId":${JSON.stringify(r.portId)}`]
        if (r.valueJson !== undefined) fields.push(`"value":${r.valueJson}`)
        if (r.blobsJson !== undefined) fields.push(`"blobs":${r.blobsJson}`)
        fields.push(`"meta":${JSON.stringify(r.meta ?? null)}`)
        if (r.tooLarge === true) fields.push('"tooLarge":true')
        if (r.estimatedBytes !== undefined) fields.push(`"estimatedBytes":${r.estimatedBytes}`)
        return `{${fields.join(',')}}`
      })
      .join(',')
    return reply.send(`{"results":[${body}]}`)
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/history`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getHistory(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams }>(`${prefix}/groups`, async (req, reply) => {
    const { projectId } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return listGroups(await deps.getRuntimeForProject(projectId))
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/groups/:id`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return getGroup(await deps.getRuntimeForProject(projectId), id)
  })

  app.get<{ Params: ProjectParams & { id: string } }>(`${prefix}/groups/:id/probe`, async (req, reply) => {
    const { projectId, id } = req.params
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return probeGroupInner(await deps.getRuntimeForProject(projectId), id)
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/outputs/clear`, async (req, reply) => {
    const { projectId } = req.params
    console.log(`[sync-trace] backend:outputs-clear`, { projectId })
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const reg = await deps.getProjectRegistry()
    if (!reg.getProject(projectId)) return reply.code(404).send({ reason: `project not found: ${projectId}` })
    return clearOutputCache(await deps.getRuntimeForProject(projectId))
  })

  app.post<{ Params: ProjectParams }>(`${prefix}/batch`, async (req, reply) => {
    const t0 = performance.now()
    const { projectId } = req.params
    const access = await ensureMutationAccess(req, projectId)
    if (!access.ok) return reply.code(403).send({ reason: access.reason, code: access.code, projectId: access.projectId })
    const { ops, opts } = req.body as {
      ops: unknown[]
      opts?: { actor?: string; label?: string; batchId?: string; ephemeral?: boolean; expectedPrevHash?: string }
    }
    const rejection = await deps.beforeApplyBatch?.(req, projectId, ops)
    if (rejection) return reply.code(rejection.status).send(rejection.body)
    const handled = await deps.handleApplyBatch?.(req, projectId, ops, opts)
    if (handled) return reply.code(handled.status).send(handled.body)
    const rt = await deps.getRuntimeForProject(projectId)
    const result = await applyBatch(rt, ops as never, {
      actor: opts?.actor ?? 'ui',
      ...(opts?.label !== undefined ? { label: opts.label } : {}),
      ...(opts?.batchId !== undefined ? { batchId: opts.batchId } : {}),
      ...(opts?.ephemeral !== undefined ? { ephemeral: opts.ephemeral } : {}),
      ...(opts?.expectedPrevHash !== undefined ? { expectedPrevHash: opts.expectedPrevHash } : {}),
    })
    if (result.status === 'rejected' && result.reason?.startsWith('concurrent-write:')) {
      return reply.code(409).send(result)
    }
    deps.logPersistBatch?.(ops, result, {
      actor: opts?.actor,
      label: opts?.label,
      batchId: opts?.batchId,
      durationMs: performance.now() - t0,
      projectId,
    })
    return result
  })

  // Global ops catalog (not project-scoped) — batteries are shared across projects.
  app.get('/api/v1/ops', async () => {
    const reg = await deps.getProjectRegistry()
    const viewingId = reg.getViewingProjectId()
    const list = reg.listProjects()
    const rt = viewingId
      ? reg.getRuntimeFor(viewingId)
      : list[0]
        ? reg.getRuntimeFor(list[0].id)
        : null
    if (!rt) return []
    const [ops, categories] = await Promise.all([
      Promise.resolve(listOps(rt)),
      deps.getBatteryCategories?.() ?? Promise.resolve(new Map()),
    ])
    return ops.map((op) => {
      const ui = categories.get(op.id)
      if (!ui) return op
      return { ...op, ...ui }
    })
  })
}
