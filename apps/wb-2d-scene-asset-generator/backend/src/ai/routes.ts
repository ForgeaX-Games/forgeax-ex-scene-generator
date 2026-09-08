import type { FastifyInstance } from 'fastify'
import { writeNodeOutput, applyBatch, executeNode, findNodeWithGroup, getGroup } from '@forgeax/node-runtime'
import type { Runtime, NodeGroup } from '@forgeax/node-runtime'
import { getRuntime } from '../runtime.js'
import {
  generateImageAsset,
  resolveNodeImageInputs,
  resolveInnerNodeImageInputs,
  resolveInnerNodeTextPrompt,
} from './imageGeneration.js'
import { createAiRateLock } from './rateLock.js'

// Persist a manual-trigger Run result so genuine downstream consumers hydrate
// from it WITHOUT the walker re-firing the op. For a TOP-LEVEL node this means
// writing the node's param + its output-port cache. For an inner node of a
// combined battery (groups are not flattened) it means writing the inner node's
// param (group-aware updateNode) AND the GROUP's exposed-output cache, so the
// collapsed group's downstream refreshes — the external mapped Run button and an
// AI tool naming the inner node id reach the identical end state.
async function persistManualRun(
  rt: Runtime,
  nodeId: string,
  groupId: string | undefined,
  outputPort: 'image' | 'result',
  value: string,
): Promise<void> {
  const paramKey = outputPort === 'image' ? '_gen_image' : '_gen_result'
  await applyBatch(
    rt,
    [{ type: 'updateNode', nodeId, params: { [paramKey]: value, _gen_error: '' } }],
    { actor: 'ai', label: `AI: run ${outputPort === 'image' ? 'image_gen' : 'text_gen'}` },
  )
  if (!groupId) {
    writeNodeOutput(rt, nodeId, outputPort, value)
    return
  }
  // Surface the inner result on every group exposed output bound to this inner
  // port, keyed by the top-level group shadow node (id === groupId).
  const group: NodeGroup | null = getGroup(rt, groupId)
  for (const ep of group?.exposedOutputs ?? []) {
    if (ep.sourceNodeId === nodeId && ep.sourcePortName === outputPort) {
      writeNodeOutput(rt, groupId, ep.portName, value)
    }
  }
}

interface AiImageBody {
  prompt?: string
  images?: string[]
  nodeId?: string
  model?: string
  role?: 'concept-art' | 'sprite-frame'
  imageSize?: string
}

interface AiTextBody {
  prompt?: string
  model?: string
  nodeId?: string
}

interface StudioTextResponse {
  success?: boolean
  text?: string
  error?: string
  upstreamModel?: string
}

export async function registerAiRoutes(app: FastifyInstance): Promise<void> {
  // One process-wide lock for BOTH AI gateway routes (shared global burst
  // breaker). Created per app instance → tests are isolated. See rateLock.ts.
  const aiLock = createAiRateLock()

  app.post('/api/v1/ai/image', async (req, reply) => {
    const body = (req.body ?? {}) as AiImageBody
    const lockKey = `image:${body.nodeId ?? '__anon__'}`
    const lock = aiLock.acquire(lockKey)
    if (!lock.ok) {
      return reply.code(429).send({
        message: `AI 生图请求过于频繁，已临时锁定（${lock.reason}），请稍后再试`,
        reason: lock.reason,
        retryAfterMs: lock.retryAfterMs,
      })
    }
    try {
    let prompt = body.prompt?.trim() ?? ''
    let images = Array.isArray(body.images) ? body.images : []
    let imageSize = body.imageSize

    // "Run this node" mode: when the caller (an AI tool / CLI) names a node,
    // resolve from the canvas graph whatever the caller DID NOT spell out —
    // exactly what the editor's Run button reads from the wired inputs. We
    // resolve prompt, images, and imageSize INDEPENDENTLY: a caller may pass an
    // explicit prompt while still relying on the wired `image` edge for the reference
    // image(s) (and vice versa). Requiring BOTH to be empty before resolving
    // meant any caller that passed only `prompt` got ZERO reference images —
    // the "agent run ignores the reference image" bug. Explicit args always win;
    // unspecified ones are backfilled from the canvas.
    if (body.nodeId && (!prompt || images.length === 0 || imageSize === undefined)) {
      const rt = await getRuntime()
      const located = findNodeWithGroup(rt, body.nodeId)
      if (located?.groupId) {
        // Inner manual-trigger node of a combined battery: resolve across the
        // group boundary (kernel runs the sub-graph, routing internal wires +
        // exposed inputs onto this node). The external mapped Run button and an
        // AI tool naming the inner id both land here — same flow as top level.
        const resolved = await resolveInnerNodeImageInputs(rt, located.groupId, body.nodeId)
        if (!prompt) prompt = resolved.prompt
        if (images.length === 0) images = resolved.images
        if (imageSize === undefined) imageSize = resolved.imageSize
      } else {
        // Populate the upstream output cache exactly like the editor's incremental
        // run before reading wired inputs. `resolveNodeImageInputs` reads the
        // backend output cache (getNodeOutput), which is file-backed and only
        // exists once a node has actually EXECUTED here. A human Run works because
        // the FRONTEND store holds the computed `nodeOutputs`; an AI caller has no
        // such store, so an image_source created via a create-batch (params set,
        // never executed) leaves zero cached refs → "agent run ignores the wired
        // image". Walking image_gen's closure executes its pure upstream sources
        // (image_source, tree_merge, …) and writes their outputs to the cache,
        // while image_gen itself is skipped as a manualTrigger boundary (no
        // gateway re-fire). After this, the resolve reads the same values a human
        // sees. Failures here are non-fatal: resolve still falls back to caches.
        await (await executeNode(rt, { nodeId: body.nodeId })).done
        const resolved = resolveNodeImageInputs(rt, body.nodeId)
        if (!prompt) prompt = resolved.prompt
        if (images.length === 0) images = resolved.images
        if (imageSize === undefined) imageSize = resolved.imageSize
      }
    }

    if (!prompt && images.length === 0) {
      const hint = body.nodeId
        ? 'resolve by nodeId reads only cached upstream outputs — execute upstream nodes first (e.g. text_panel), or pass prompt/images explicitly in the request body'
        : 'pass prompt and/or images in the request body'
      return reply.code(400).send({ message: `prompt or reference image is required (${hint})` })
    }

    const rt = await getRuntime()
    try {
      const generated = await generateImageAsset(rt, {
        prompt,
        images,
        ...(body.nodeId ? { nodeId: body.nodeId } : {}),
        ...(body.model ? { model: body.model } : {}),
        ...(imageSize !== undefined ? { imageSize } : {}),
        role: body.role ?? 'concept-art',
      })
      // Manual-trigger op: persist the Run-button result into the backend output
      // cache so genuine downstream consumers hydrate from it on the next
      // incremental run WITHOUT the walker re-firing image_gen (the op is
      // skipped as a data boundary — see node-runtime execute-node.ts). The
      // `image` port carries the generated asset alias, matching imageGen()'s
      // execute() output exactly.
      if (body.nodeId) {
        // Persist `_gen_image` FIRST (group-aware for inner nodes) so the output
        // cache below is tagged with the post-update graph hash (writeNodeOutput
        // stamps the current graph.hash; a partial run only treats a boundary
        // value as valid when its hash matches). The human Run path reaches the
        // same end state — node param `_gen_image` set + `image` port cached —
        // just via the editor store. The param write also emits graph:applied, so
        // every live editor re-pulls the node and the preview lights up: same UI,
        // same data flow as a human click. For an inner node the result is also
        // surfaced on the group's exposed `image` output so downstream refreshes.
        const located = findNodeWithGroup(rt, body.nodeId)
        await persistManualRun(rt, body.nodeId, located?.groupId, 'image', generated.image)
      }
      return { data: generated }
    } catch (e) {
      return reply.code(502).send({ message: (e as Error).message })
    }
    } finally {
      aiLock.release(lockKey)
    }
  })

  app.post('/api/v1/ai/text', async (req, reply) => {
    const body = (req.body ?? {}) as AiTextBody
    const lockKey = `text:${body.nodeId ?? '__anon__'}`
    const lock = aiLock.acquire(lockKey)
    if (!lock.ok) {
      return reply.code(429).send({
        message: `AI 生文请求过于频繁，已临时锁定（${lock.reason}），请稍后再试`,
        reason: lock.reason,
        retryAfterMs: lock.retryAfterMs,
      })
    }
    try {
    let prompt = body.prompt?.trim() ?? ''
    // Inner text manual-trigger node of a combined battery: resolve `prompt`
    // across the group boundary when the caller named the node but spelled no
    // prompt (the external mapped Run button / an AI tool). Top-level callers are
    // unchanged — they still must pass an explicit prompt.
    if (!prompt && body.nodeId) {
      const rt = await getRuntime()
      const located = findNodeWithGroup(rt, body.nodeId)
      if (located?.groupId) {
        prompt = (await resolveInnerNodeTextPrompt(rt, located.groupId, body.nodeId)).trim()
      }
    }
    if (!prompt) return reply.code(400).send({ message: 'prompt is required' })
    const baseUrl = (
      process.env.FORGEAX_STUDIO_API_BASE_URL ??
      process.env.FORGEAX_SERVER_URL ??
      'http://127.0.0.1:18900'
    ).replace(/\/+$/u, '')
    const res = await fetch(`${baseUrl}/__ce-api__/gemini-text`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, ...(body.model ? { model: body.model } : {}) }),
    })
    const json = (await res.json().catch(() => null)) as StudioTextResponse | null
    if (!res.ok || !json?.success) {
      return reply.code(502).send({ message: json?.error ?? `Studio text gateway failed (${res.status})` })
    }
    const result = json.text ?? ''
    // Manual-trigger op: persist the Run-button result into the backend output
    // cache (port `result`) so downstream consumers hydrate without the walker
    // re-firing text_gen. Mirrors textGen()'s execute() output port. For an inner
    // node, also persist `_gen_result` + the group's exposed `result` output.
    if (body.nodeId) {
      const rt = await getRuntime()
      const located = findNodeWithGroup(rt, body.nodeId)
      if (located?.groupId) {
        await persistManualRun(rt, body.nodeId, located.groupId, 'result', result)
      } else {
        writeNodeOutput(rt, body.nodeId, 'result', result)
      }
    }
    return { data: { result, upstreamModel: json.upstreamModel } }
    } finally {
      aiLock.release(lockKey)
    }
  })
}
