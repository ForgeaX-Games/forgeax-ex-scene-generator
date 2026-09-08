// ImageGen — AI 图像生成节点
//
// 执行模型说明：
//   - 前端 AINode 的 Run 按钮仍可用于单次预览。
//   - pipeline 执行时，本函数按 prompt 的 DataTree item 语义逐 prompt 调用
//     app 注入的 asset2d.generateImage service，并输出对应的 ImageRef。
//
// 参考图（image 端口）说明：
//   image 端口为 access:'tree'——dispatcher 把整棵树原样喂入、不 fanout。
//   本函数遍历整棵树收集所有图 alias、拍平成一个数组，在【单次】生图调用里
//     一并发给 Gemini（多图参考）。无论上游 Merge 走 item 档还是结构 pack 档，
//     结果一致：所有参考图都进同一次调用。

interface Asset2dServices {
  generateImage?: (input: {
    prompt?: string
    images?: string[]
    nodeId?: string
    model?: string
    role?: 'concept-art' | 'sprite-frame'
    imageSize?: string
  }) => Promise<{ image: string; error?: string }>
}

interface ExecutionContextLike {
  services?: {
    asset2d?: Asset2dServices
  }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

const GEMINI_IMAGE_SIZES = new Set(['512', '1K', '2K', '4K'])

function geminiImageSize(value: unknown): string {
  const s = stringValue(value)
  return GEMINI_IMAGE_SIZES.has(s) ? s : '2K'
}

// DataTree wire shape — duck-typed because dynamic-import boundaries break instanceof.
interface DataTreeLike {
  branches(): IterableIterator<{ path: number[]; items: unknown[] }>
}
function isDataTreeLike(v: unknown): v is DataTreeLike {
  return v !== null && typeof v === 'object' && typeof (v as Record<string, unknown>).branches === 'function'
}

/**
 * Flatten every image alias the `image` port carries into one ordered array,
 * regardless of the upstream tree's shape. The port is access:'tree', so the
 * dispatcher hands us the whole DataTree untouched (no fanout): we walk every
 * branch and item and collect each non-empty string alias. This lets Merge (or
 * any image[] upstream) feed N reference images into a SINGLE generation call,
 * independent of how the paths are laid out (item-concat vs prefix-pack).
 */
function collectImageAliases(value: unknown): string[] {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') {
    const s = value.trim()
    return s ? [s] : []
  }
  if (isDataTreeLike(value)) {
    const out: string[] = []
    for (const branch of value.branches()) {
      for (const item of branch.items) {
        const s = stringValue(item)
        if (s) out.push(s)
      }
    }
    return out
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => collectImageAliases(v))
  }
  return []
}

export async function imageGen(input: Record<string, unknown>, ctx?: ExecutionContextLike): Promise<Record<string, unknown>> {
  const generateImage = ctx?.services?.asset2d?.generateImage
  if (!generateImage) {
    throw new Error('image_gen requires asset2d.generateImage execution service')
  }

  const prompt = stringValue(input.prompt)
  const images = collectImageAliases(input.image)
  const imageSize = geminiImageSize(input.imageSize)
  const generated = await generateImage({
    prompt,
    imageSize,
    ...(images.length ? { images } : {}),
  })

  return generated.error ? { image: generated.image, error: generated.error } : { image: generated.image }
}
