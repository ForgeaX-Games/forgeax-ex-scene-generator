/**
 * BiRefNet 语义抠图 —— HTTP 客户端（模型跑在独立服务里）
 *
 * 这是 `image_matting_birefnet` 电池调不动的「重活」落点，但**重活本身不在这**：模型权重、
 * PyTorch/ONNX、GPU 全在一个**独立部署、与本仓库分离的 BiRefNet 抠图 API 服务**里。
 * 本文件只是个轻量客户端——把图片 base64 POST 过去、拿回抠好的 RGBA，再做 soft_edges /
 * 裁剪 / 派生 mask / 落盘。与 ai/imageGeneration.ts 调 Studio 网关是同一范式。
 *
 * 为什么拆出去：1024² 模型在 editor 后端进程内跑会卡死/吃内存；拆成服务后 editor 零负担，
 * 服务可独立配 GPU、独立扩缩容、崩了也不连累 editor。
 *
 * 服务地址：优先用电池传入的 serviceUrl（节点上的 service_url 输入），否则回退环境变量
 *   FORGEAX_BIREFNET_URL。两者都没有则报错提示去配置。
 * 超时：FORGEAX_BIREFNET_TIMEOUT_MS（默认 120000）。
 */

import type { Runtime } from '@forgeax/node-runtime'
import { readImageBytesFromRef, writeProcessedImage } from '../assets/generatedAssets.js'
import { decodeImageBytes, encodePng } from '../utils/png_codec.js'

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function resolveServiceUrl(override?: string): string {
  const raw = (override && override.trim()) || process.env.FORGEAX_BIREFNET_URL?.trim() || ''
  return raw.replace(/\/+$/u, '')
}

function resolveTimeoutMs(): number {
  const v = Number(process.env.FORGEAX_BIREFNET_TIMEOUT_MS ?? '120000')
  return Number.isFinite(v) && v > 0 ? v : 120000
}

interface MatteServiceResponse {
  image?: string
  error?: string
}

/**
 * 用 alpha 合成两路输出（均为返回图的 w×h）：
 *   - cut ：抠图 RGBA（前景 RGB + alpha；alpha=0 处清零 RGB，避免黑边）；
 *   - mask：灰度 RGBA（白=前景、黑=背景，不透明），供下游 CutByMask 对齐。
 * softEdges=false 时把 alpha 在 0.5 处硬二值化，否则保留服务返回的软 alpha。
 */
function compose(
  rgba: Buffer,
  w: number,
  h: number,
  softEdges: boolean,
): { cut: Uint8Array; mask: Uint8Array } {
  const n = w * h
  const cut = new Uint8Array(n * 4)
  const mask = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    const di = i * 4
    let a = rgba[di + 3] / 255
    if (!softEdges) a = a >= 0.5 ? 1 : 0
    const av = Math.round((a < 0 ? 0 : a > 1 ? 1 : a) * 255)
    if (av <= 0) {
      cut[di] = 0
      cut[di + 1] = 0
      cut[di + 2] = 0
      cut[di + 3] = 0
    } else {
      cut[di] = rgba[di]
      cut[di + 1] = rgba[di + 1]
      cut[di + 2] = rgba[di + 2]
      cut[di + 3] = av
    }
    mask[di] = av
    mask[di + 1] = av
    mask[di + 2] = av
    mask[di + 3] = 255
  }
  return { cut, mask }
}

/** 裁剪到 alpha 超过阈值的外接框（含 padding，越界夹紧）。 */
function cropToContent(
  pixels: Uint8Array,
  w: number,
  h: number,
  padding: number,
  alphaThresh: number,
): { pixels: Uint8Array; w: number; h: number } {
  let minX = w
  let minY = h
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > alphaThresh) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return { pixels, w, h }
  minX = Math.max(0, minX - padding)
  minY = Math.max(0, minY - padding)
  maxX = Math.min(w - 1, maxX + padding)
  maxY = Math.min(h - 1, maxY + padding)
  const nw = maxX - minX + 1
  const nh = maxY - minY + 1
  const out = new Uint8Array(nw * nh * 4)
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const si = ((minY + y) * w + minX + x) * 4
      const di = (y * nw + x) * 4
      out[di] = pixels[si]
      out[di + 1] = pixels[si + 1]
      out[di + 2] = pixels[si + 2]
      out[di + 3] = pixels[si + 3]
    }
  }
  return { pixels: out, w: nw, h: nh }
}

export interface MatteInput {
  image: string
  /** 保留软 alpha（抗锯齿边缘）；false 则在 0.5 处硬二值化。默认 true。 */
  softEdges?: boolean
  /** 裁剪到前景外接框（+2px）。默认 true。 */
  crop?: boolean
  /** 抠图主输出的 alias 后缀。默认 `_matte`。 */
  suffix?: string
  /** BiRefNet 服务地址，覆盖 FORGEAX_BIREFNET_URL。 */
  serviceUrl?: string
}

export interface MatteResult {
  image: string
  mask: string
  width: number
  height: number
  error: string
}

/** 向 BiRefNet 服务请求一张图的 matte，返回 base64 RGBA PNG（原尺寸，软 alpha）。 */
async function requestMatte(baseUrl: string, imageBase64: string, softEdges: boolean): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), resolveTimeoutMs())
  try {
    const res = await fetch(`${baseUrl}/matte`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ image: imageBase64, soft_edges: softEdges }),
      signal: controller.signal,
    })
    const json = (await res.json().catch(() => null)) as MatteServiceResponse | null
    if (!res.ok || !json || json.error || !json.image) {
      throw new Error(json?.error ?? `service HTTP ${res.status}`)
    }
    return json.image
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 对一张图跑 BiRefNet 抠图（经外部服务）。读取 `image`（ImageRef alias）→ base64 POST 到
 * 服务 → 拿回 RGBA matte → 解码 → 应用 soft_edges → 合成抠图 + 全尺寸 mask → 可选裁剪 →
 * 编码落盘。失败时返回 `error`（空 image），不抛出，便于电池透传到画布的 error 端口。
 */
export async function matteImage(rt: Runtime, input: MatteInput): Promise<MatteResult> {
  const ref = typeof input.image === 'string' ? input.image : ''
  if (!ref) return { image: '', mask: '', width: 0, height: 0, error: 'missing image input' }

  const baseUrl = resolveServiceUrl(input.serviceUrl)
  if (!baseUrl) {
    return {
      image: '',
      mask: '',
      width: 0,
      height: 0,
      error: 'BiRefNet 服务地址未配置：先部署并启动独立的 BiRefNet 抠图服务，再设环境变量 FORGEAX_BIREFNET_URL，或在节点的 service_url 输入填服务地址（如 http://127.0.0.1:8080）',
    }
  }

  const found = readImageBytesFromRef(rt, ref)
  if (!found) return { image: '', mask: '', width: 0, height: 0, error: `image not found: ${ref.slice(0, 64)}` }

  const softEdges = input.softEdges !== false
  const crop = input.crop !== false

  let matteB64: string
  try {
    matteB64 = await requestMatte(baseUrl, found.bytes.toString('base64'), softEdges)
  } catch (e) {
    return { image: '', mask: '', width: 0, height: 0, error: `birefnet service request failed: ${msg(e)}` }
  }

  let decoded: { width: number; height: number; data: Buffer }
  try {
    decoded = decodeImageBytes(Buffer.from(matteB64, 'base64'), 'image/png')
  } catch (e) {
    return { image: '', mask: '', width: 0, height: 0, error: `decode matte failed: ${msg(e)}` }
  }
  const { width: w, height: h, data: rgba } = decoded

  const { cut, mask } = compose(rgba, w, h, softEdges)

  // 抠图主图可选裁剪到外接框；mask 始终保持原始全尺寸（标出原图坐标系里的前景区域，
  // 与 image_remove_bg 的 mask 语义一致，可直接喂给 CutByMask 电池对齐其他同源图）。
  let outCut = cut
  let outW = w
  let outH = h
  if (crop) {
    const c = cropToContent(cut, w, h, 2, 7)
    outCut = c.pixels
    outW = c.w
    outH = c.h
  }

  const suffix = typeof input.suffix === 'string' && input.suffix.trim() ? input.suffix.trim() : '_matte'
  let savedImage: { image: string }
  try {
    const cutPng = encodePng(outW, outH, Buffer.from(outCut.buffer, outCut.byteOffset, outCut.byteLength))
    savedImage = writeProcessedImage(rt, {
      bytes: cutPng,
      operation: 'image_matting_birefnet',
      srcAlias: found.alias,
      suffix,
    })
  } catch (e) {
    return { image: '', mask: '', width: 0, height: 0, error: `encode failed: ${msg(e)}` }
  }

  let maskImage = ''
  try {
    const maskPng = encodePng(w, h, Buffer.from(mask.buffer, mask.byteOffset, mask.byteLength))
    const savedMask = writeProcessedImage(rt, {
      bytes: maskPng,
      operation: 'image_matting_birefnet',
      srcAlias: found.alias,
      suffix: '_matte_mask',
    })
    maskImage = savedMask.image
  } catch {
    // mask 为附带输出，失败不影响主抠图结果
  }

  return { image: savedImage.image, mask: maskImage, width: outW, height: outH, error: '' }
}
