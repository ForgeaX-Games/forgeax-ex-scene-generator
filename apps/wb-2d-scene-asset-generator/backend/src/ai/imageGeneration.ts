import type { Runtime } from '@forgeax/node-runtime'
import { getNodeOutput, getNode, listEdges, findNodeWithGroup, resolveGroupInnerNodeInputs } from '@forgeax/node-runtime'
import { importGeneratedImage, parseImageRef, readGeneratedAsset } from '../assets/generatedAssets.js'
import { DEFAULT_GEMINI_IMAGE_SIZE, normalizeGeminiImageSize, type GeminiImageSize } from './imageSize.js'

export type { GeminiImageSize } from './imageSize.js'

export interface GenerateImageInput {
  prompt?: string
  images?: string[]
  nodeId?: string
  model?: string
  role?: 'concept-art' | 'sprite-frame'
  imageSize?: GeminiImageSize | string
}

interface StudioImageResponse {
  success?: boolean
  imageBase64?: string
  mimeType?: string
  error?: string
  vendor?: string
  modelId?: string
  triedVendors?: string[]
}

function studioBaseUrl(): string {
  return (
    process.env.FORGEAX_STUDIO_API_BASE_URL ??
    process.env.FORGEAX_SERVER_URL ??
    'http://127.0.0.1:18900'
  ).replace(/\/+$/u, '')
}

function dataUrlToInput(dataUrl: string): { base64: string; mimeType?: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/u)
  if (!match) return null
  return { mimeType: match[1], base64: match[2] }
}

/** Whether a value is the wire DataTreeEntry[] shape (path/items arrays). */
function isDataTreeEntries(v: unknown): v is Array<{ path: number[]; items: unknown[] }> {
  if (!Array.isArray(v) || v.length === 0) return false
  const first = v[0] as { path?: unknown; items?: unknown } | null
  if (typeof first !== 'object' || first === null) return false
  return Array.isArray(first.path) && Array.isArray(first.items)
}

/**
 * Peel the first item of the first entry from a wire value (DataTreeEntry[]);
 * non-wire values are returned unchanged. Mirrors the editor-side
 * peelWireValue (node-runtime-react datatreeShape.ts) so backend-resolved
 * inputs match what the Run button reads from the canvas.
 */
function peelWireValue(v: unknown): unknown {
  if (!isDataTreeEntries(v)) return v
  if (v.length !== 1) return v
  const items = v[0].items
  if (items.length !== 1) return v
  return items[0]
}

function promptTextFromValue(value: unknown): string {
  const peeled = peelWireValue(value)
  if (peeled === null || peeled === undefined) return ''
  if (typeof peeled === 'string') return peeled
  if (typeof peeled === 'number' || typeof peeled === 'boolean') return String(peeled)
  return ''
}

function imageRefsFromValue(value: unknown): string[] {
  // Multi-image inputs arrive as a DataTree wire value with one branch per
  // image (tree_merge of N ImageSources). peelWireValue only collapses the
  // single-entry/single-item case, so flatten every branch's items here;
  // otherwise a 2-image merge reads as zero refs and the model gets no
  // reference images. Mirrors AINode.imageRefsFromValue (frontend Run path).
  if (isDataTreeEntries(value)) {
    return value
      .flatMap((entry) => entry.items)
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
  }
  const peeled = peelWireValue(value)
  if (Array.isArray(peeled)) return peeled.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
  if (typeof peeled === 'string' && peeled.trim()) return [peeled.trim()]
  return []
}

/** Persist-only Run result written by manualTrigger image_gen nodes. */
function imageGenPersistedRef(node: { params?: Record<string, unknown> } | null | undefined): string[] {
  if (!node || typeof node.params?._gen_image !== 'string') return []
  const s = node.params._gen_image.trim()
  return s ? [s] : []
}

/**
 * Read an upstream `image` port value for image_gen resolution. Prefer the
 * file-backed output cache (what exec:node:output / getNodeOutput serves);
 * fall back to the upstream node's `_gen_image` persist param when the cache
 * is missing. That param always survives a Run and still holds the last result
 * when input-edge invalidation cleared the port cache — the common
 * image_gen → image_gen chain case.
 */
export function readUpstreamImageRefs(
  rt: Runtime,
  sourceNodeId: string,
  sourcePort: string,
): string[] {
  const fromCache = imageRefsFromValue(getNodeOutput(rt, sourceNodeId, sourcePort))
  if (fromCache.length > 0) return fromCache
  if (sourcePort !== 'image') return []
  const source = getNode(rt, sourceNodeId)
  if (source?.opId !== 'image_gen') return []
  return imageGenPersistedRef(source)
}

/**
 * Resolve a node's prompt/images inputs straight from the canvas graph — the
 * backend equivalent of the AINode Run button's getPromptValue/getInputImage.
 * For each input port we look for an incoming edge and read the upstream node's
 * cached output; with no edge we fall back to the node's own param. This lets a
 * tool caller (AI) "click Run" on a specific node by id, using exactly the
 * inputs already wired on the canvas — identical to a human pressing Run.
 */
export function resolveNodeImageInputs(
  rt: Runtime,
  nodeId: string,
): { prompt: string; images: string[]; imageSize: GeminiImageSize } {
  const node = getNode(rt, nodeId)
  const edges = listEdges(rt)

  const promptEdge = edges.find((e) => e.target.nodeId === nodeId && e.target.port === 'prompt')
  let prompt = ''
  if (promptEdge) {
    prompt = promptTextFromValue(getNodeOutput(rt, promptEdge.source.nodeId, promptEdge.source.port))
  } else if (node && typeof node.params.prompt === 'string') {
    prompt = node.params.prompt
  }

  const imageEdge = edges.find((e) => e.target.nodeId === nodeId && e.target.port === 'image')
  const images = imageEdge
    ? readUpstreamImageRefs(rt, imageEdge.source.nodeId, imageEdge.source.port)
    : []

  const imageSizeEdge = edges.find((e) => e.target.nodeId === nodeId && e.target.port === 'imageSize')
  let imageSizeRaw: unknown = node?.params?.imageSize
  if (imageSizeEdge) {
    let wired = promptTextFromValue(getNodeOutput(rt, imageSizeEdge.source.nodeId, imageSizeEdge.source.port))
    if (!wired) {
      const upstream = getNode(rt, imageSizeEdge.source.nodeId)
      if (upstream?.opId === 'text_panel' && typeof upstream.params?.text === 'string') {
        wired = upstream.params.text.trim()
      }
    }
    if (wired) imageSizeRaw = wired
  }
  const imageSize = normalizeGeminiImageSize(imageSizeRaw ?? DEFAULT_GEMINI_IMAGE_SIZE)

  return { prompt, images, imageSize }
}

/**
 * Group-boundary equivalent of resolveNodeImageInputs: resolve an inner
 * manual-trigger node's prompt/images/imageSize from across the combined
 * battery's boundary. The kernel runs the group sub-graph (computing pure inner
 * upstreams, skipping manual nodes) and routes internal wires + exposed inputs
 * onto this node's ports; unconnected ports fall back to the inner node's own
 * params — exactly what a human gets pressing the inner node's Run button.
 */
export async function resolveInnerNodeImageInputs(
  rt: Runtime,
  groupId: string,
  innerNodeId: string,
): Promise<{ prompt: string; images: string[]; imageSize: GeminiImageSize }> {
  const inner = (await resolveGroupInnerNodeInputs(rt, groupId, innerNodeId)) ?? {}
  const node = findNodeWithGroup(rt, innerNodeId)?.node ?? null

  let prompt = promptTextFromValue(inner.prompt)
  if (!prompt && typeof node?.params?.prompt === 'string') prompt = node.params.prompt

  const images = imageRefsFromValue(inner.image)

  let imageSizeRaw: unknown = node?.params?.imageSize
  if (inner.imageSize !== undefined) {
    const wired = promptTextFromValue(inner.imageSize)
    if (wired) imageSizeRaw = wired
  }
  const imageSize = normalizeGeminiImageSize(imageSizeRaw ?? DEFAULT_GEMINI_IMAGE_SIZE)

  return { prompt, images, imageSize }
}

/** Resolve an inner text manual-trigger node's `prompt` across the group boundary. */
export async function resolveInnerNodeTextPrompt(
  rt: Runtime,
  groupId: string,
  innerNodeId: string,
): Promise<string> {
  const inner = (await resolveGroupInnerNodeInputs(rt, groupId, innerNodeId)) ?? {}
  const prompt = promptTextFromValue(inner.prompt)
  if (prompt) return prompt
  const node = findNodeWithGroup(rt, innerNodeId)?.node ?? null
  return typeof node?.params?.prompt === 'string' ? node.params.prompt : ''
}

async function resolveReferenceImages(rt: Runtime, rawRefs: string[]): Promise<Array<{ base64: string; mimeType?: string }>> {
  const refs: Array<{ base64: string; mimeType?: string }> = []
  for (const raw of rawRefs) {
    const parsed = parseImageRef(raw)
    if (!parsed) continue
    if ('dataUrl' in parsed) {
      const input = dataUrlToInput(parsed.dataUrl)
      if (input) refs.push(input)
      continue
    }
    const found = readGeneratedAsset(rt, parsed.alias)
    if (found) refs.push({ base64: found.bytes.toString('base64'), mimeType: found.record.mimeType })
  }
  return refs
}

export async function generateImageAsset(rt: Runtime, input: GenerateImageInput) {
  const prompt = input.prompt?.trim() ?? ''
  const images = Array.isArray(input.images) ? input.images : []
  if (!prompt && images.length === 0) {
    throw new Error('prompt or reference image is required')
  }

  const inputImages = await resolveReferenceImages(rt, images)
  if (images.length > 0 && inputImages.length === 0) {
    throw new Error(
      'reference image(s) could not be loaded — upstream alias missing from the asset library; re-run the upstream image_gen node',
    )
  }
  const imageSize = normalizeGeminiImageSize(input.imageSize ?? DEFAULT_GEMINI_IMAGE_SIZE)
  const res = await fetch(`${studioBaseUrl()}/__ce-api__/generate-image`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt,
      role: input.role ?? 'concept-art',
      imageSize,
      ...(input.model ? { model: input.model } : {}),
      ...(inputImages.length ? { inputImages } : {}),
    }),
  })
  const json = (await res.json().catch(() => null)) as StudioImageResponse | null
  if (!res.ok || !json?.success || !json.imageBase64) {
    throw new Error(json?.error ?? `Studio image gateway failed (${res.status})`)
  }

  const saved = importGeneratedImage(rt, {
    imageBase64: json.imageBase64,
    mimeType: json.mimeType ?? 'image/png',
    prompt,
    ...(input.nodeId ? { nodeId: input.nodeId } : {}),
    source: json.vendor ? `studio-gateway:${json.vendor}` : 'studio-gateway',
    folder: 'ai',
    tags: ['ai', 'generated', ...(json.modelId ? [json.modelId] : [])],
  })

  return {
    image: saved.image,
    asset: saved.asset,
    vendor: json.vendor,
    modelId: json.modelId,
    triedVendors: json.triedVendors,
  }
}
