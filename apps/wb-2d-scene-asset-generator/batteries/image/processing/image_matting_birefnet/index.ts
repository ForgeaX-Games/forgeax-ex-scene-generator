/**
 * image_matting_birefnet — BiRefNet 语义抠图（外部服务推理）
 *
 * 与 image_remove_bg（纯颜色泛洪）互补：用 BiRefNet 语义分割模型理解「前景物体 vs 背景」，
 * 能干净地抠出与背景同色的缝隙/孔洞，并输出软 alpha（抗锯齿边缘）——这正是颜色法抠不干净
 * 缝隙的根因。
 *
 * 执行模型：模型跑在**独立部署的 BiRefNet 抠图服务**里（自带权重/依赖/GPU），与 editor
 *   解耦。后端 `ai/matting.ts` 只是 HTTP 客户端：把图 POST 到服务、收回 matte、合成落盘。
 *   本电池只读参数、调 `ctx.services.asset2d.matteImage`、把结果透传到下游——与 image_gen
 *   调 generateImage 同一范式。
 *
 * 服务地址：节点的 `service_url` 输入优先；留空则用后端环境变量 FORGEAX_BIREFNET_URL。
 *
 * 错误处理（带回退）：**任何异常情况（服务未配置 / URL 未填 / 服务不可用 / 请求失败 /
 *   解码失败 / 意外抛错）都不让节点报红**，而是自动回退到传统颜色法抠图电池
 *   `image_remove_bg`（纯本地算法、无外部依赖）来产出 image/mask/width/height，
 *   **同时把 BiRefNet 失败的原因写到 `error_message` 输出端口**供下游检查。这样即便
 *   BiRefNet 没部署/配错，下游仍能拿到一张可用的（降级）抠图结果。注意输出端口
 *   特意命名为 `error_message` 而非 `error`——内核 dispatcher 会把非空的 `error` 字段当成
 *   节点失败直接 throw（丢弃所有输出），换个名字才能让原因正常落到端口上供下游读取/查看。
 *
 * 输出：image / mask / width / height / error_message。
 *   - 成功（BiRefNet）：error_message 为空。
 *   - 回退（image_remove_bg）：image/mask 为传统算法结果，error_message 记录 BiRefNet 失败原因。
 *   mask 可接 CutByMask 电池把同源图对齐到相同抠图区域。
 */

import { imageRemoveBg } from '../image_remove_bg/index.js'

interface Asset2dServices {
  matteImage?: (input: {
    image: string
    softEdges?: boolean
    crop?: boolean
    suffix?: string
    serviceUrl?: string
  }) => Promise<{ image: string; mask: string; width: number; height: number; error: string }>
}

interface ExecutionContextLike {
  services?: {
    asset2d?: Asset2dServices
  }
}

/**
 * BiRefNet 失败时回退到传统颜色法抠图（image_remove_bg，纯本地算法）：用同一个 ctx 跑
 * removeBg 产出 image/mask/width/height，但**始终把 BiRefNet 的失败原因保留在 error_message**
 * 供下游检查。若回退本身也失败（如缺 image 输入、processImage 服务也缺失），把两个原因都带上，
 * image/mask 退化为空。无论如何都不抛出，节点永不报红。
 */
async function fallbackRemoveBg(
  input: Record<string, unknown>,
  ctx: ExecutionContextLike | undefined,
  reason: string,
): Promise<Record<string, unknown>> {
  try {
    const res = await imageRemoveBg(input, ctx as { services?: Record<string, unknown> } | undefined)
    const fallbackError = typeof res.error === 'string' ? res.error : ''
    return {
      image: typeof res.image === 'string' ? res.image : '',
      mask: typeof res.mask === 'string' ? res.mask : '',
      width: typeof res.width === 'number' ? res.width : 0,
      height: typeof res.height === 'number' ? res.height : 0,
      error_message: fallbackError ? `${reason}；回退 image_remove_bg 也失败：${fallbackError}` : reason,
    }
  } catch (e) {
    return {
      image: '',
      mask: '',
      width: 0,
      height: 0,
      error_message: `${reason}；回退 image_remove_bg 异常：${e instanceof Error ? e.message : String(e)}`,
    }
  }
}

export async function imageMattingBirefnet(
  input: Record<string, unknown>,
  ctx?: ExecutionContextLike,
): Promise<Record<string, unknown>> {
  try {
    const matteImage = ctx?.services?.asset2d?.matteImage
    if (!matteImage) {
      return fallbackRemoveBg(input, ctx, 'asset2d.matteImage 服务不可用（后端可能未重启以加载该服务）')
    }

    const image = typeof input.image === 'string' ? input.image : ''
    if (!image) return fallbackRemoveBg(input, ctx, '缺少 image 输入')

    const softEdges = input.soft_edges !== false
    const crop = input.crop !== false
    const suffix = typeof input.suffix === 'string' && input.suffix.trim() ? input.suffix.trim() : undefined
    const serviceUrl =
      typeof input.service_url === 'string' && input.service_url.trim() ? input.service_url.trim() : undefined

    const res = await matteImage({
      image,
      softEdges,
      crop,
      ...(suffix ? { suffix } : {}),
      ...(serviceUrl ? { serviceUrl } : {}),
    })

    // BiRefNet 报错（服务未配置 / URL 未填 / 请求或解码失败等）→ 回退传统算法，
    // 但把原因保留在 error_message 端口供检查。
    if (res.error) return fallbackRemoveBg(input, ctx, `BiRefNet 抠图失败：${res.error}`)

    // 成功：error_message 为空。
    return {
      image: res.image,
      mask: res.mask,
      width: res.width,
      height: res.height,
      error_message: '',
    }
  } catch (e) {
    // 兜底：连意外抛出的异常也回退传统算法，并把原因落到端口，保证节点永不报红。
    return fallbackRemoveBg(input, ctx, `BiRefNet 抠图失败：${e instanceof Error ? e.message : String(e)}`)
  }
}
