type CopyImageResult = { image: string; width?: number; height?: number; error?: string }

export interface DecodedImage {
  width: number
  height: number
  /** RGBA, length = width * height * 4. */
  data: Buffer
}

export type TransformResult = { width: number; height: number; data: Buffer }

export interface Asset2dServices {
  copyImage?: (image: string, opts?: { operation?: string; suffix?: string; folder?: string; name?: string; tags?: string[]; overwrite?: boolean }) => Promise<CopyImageResult> | CopyImageResult
  decodeImage?: (image: string) => DecodedImage | null
  processImage?: (
    image: string,
    opts: { operation: string; suffix?: string; folder?: string },
    transform: (img: DecodedImage) => TransformResult,
  ) => { image: string; width: number; height: number; error: string }
  processImages?: (
    images: string[],
    opts: { operation: string; suffix?: string; folder?: string },
    transform: (imgs: DecodedImage[]) => TransformResult,
  ) => { image: string; width: number; height: number; error: string }
  createImage?: (
    pixels: Buffer,
    width: number,
    height: number,
    opts: { name: string; nodeId?: string; folder?: string },
  ) => { image: string; width: number; height: number; archivedPath: string; error: string }
}

/**
 * Decode the battery's `image` input → run a pure pixel transform → encode +
 * persist the result, returning a downstream `image` ImageRef. The real PNG
 * decode/encode and asset I/O live in the backend `asset2d` service
 * (`backend/src/runtime.ts` + `utils/png_codec.ts`); the battery supplies only
 * the algorithm. Returns an `error` (with empty `image`) when the input is
 * missing, not a string, the service is absent, or decode/transform throws.
 */
export function processImage(
  input: Record<string, unknown>,
  ctx: { services?: Record<string, unknown> } | undefined,
  operation: string,
  transform: (img: DecodedImage) => TransformResult,
  opts: { suffix?: string; folder?: string; inputName?: string } = {},
): { image: string; width: number; height: number; error: string } {
  const inputName = opts.inputName ?? 'image'
  const image = typeof input[inputName] === 'string' ? (input[inputName] as string) : ''
  if (!image) return { image: '', width: 0, height: 0, error: `missing ${inputName} input` }
  const asset2d = ctx?.services?.asset2d as Asset2dServices | undefined
  if (!asset2d?.processImage) {
    return { image: '', width: 0, height: 0, error: 'asset2d.processImage service unavailable' }
  }
  const suffix = typeof input.suffix === 'string' && input.suffix.trim() ? input.suffix.trim() : opts.suffix
  return asset2d.processImage(
    image,
    { operation, ...(suffix ? { suffix } : {}), folder: opts.folder ?? 'processed' },
    transform,
  )
}

/**
 * Multi-image variant of `processImage`: resolves a list of `image` inputs
 * (each an encoded ImageRef), decodes them all, runs a transform that produces
 * one output image, then encodes + persists it. Used by batteries that combine
 * several inputs (e.g. atlas compose: terrain + template). `inputNames` lists
 * the input port names in order; a missing/non-string input yields an error.
 */
export function processImages(
  input: Record<string, unknown>,
  ctx: { services?: Record<string, unknown> } | undefined,
  operation: string,
  inputNames: string[],
  transform: (imgs: DecodedImage[]) => TransformResult,
  opts: { suffix?: string; folder?: string } = {},
): { image: string; width: number; height: number; error: string } {
  const images: string[] = []
  for (const name of inputNames) {
    const v = typeof input[name] === 'string' ? (input[name] as string) : ''
    if (!v) return { image: '', width: 0, height: 0, error: `missing ${name} input` }
    images.push(v)
  }
  const asset2d = ctx?.services?.asset2d as Asset2dServices | undefined
  if (!asset2d?.processImages) {
    return { image: '', width: 0, height: 0, error: 'asset2d.processImages service unavailable' }
  }
  const suffix = typeof input.suffix === 'string' && input.suffix.trim() ? input.suffix.trim() : opts.suffix
  return asset2d.processImages(
    images,
    { operation, ...(suffix ? { suffix } : {}), folder: opts.folder ?? 'processed' },
    transform,
  )
}

interface Asset2dDecodeServices {
  decodeImage?: (image: string) => DecodedImage | null
}

/**
 * Resolve the battery's image input (an ImageRef alias string) → decode it to
 * RGBA via the backend `asset2d.decodeImage` service. Returns `{ image }` with
 * the DecodedImage on success, or `{ error }` when the input is missing/not a
 * string, the service is absent, or decode returns null. Used by batteries that
 * read raw pixels but produce non-image outputs (e.g. collision polygons, masks).
 */
export function decodeInputImage(
  input: Record<string, unknown>,
  ctx: { services?: Record<string, unknown> } | undefined,
  inputName = 'image',
): { image?: DecodedImage; error?: string } {
  const ref = typeof input[inputName] === 'string' ? (input[inputName] as string) : ''
  if (!ref) return { error: `missing ${inputName} input` }
  const asset2d = ctx?.services?.asset2d as Asset2dDecodeServices | undefined
  if (!asset2d?.decodeImage) return { error: 'asset2d.decodeImage service unavailable' }
  const decoded = asset2d.decodeImage(ref)
  if (!decoded) return { error: `decode failed: ${ref.slice(0, 64)}` }
  return { image: decoded }
}

interface Asset2dCreateServices {
  createImage?: (
    pixels: Buffer,
    width: number,
    height: number,
    opts: { name: string; nodeId?: string; folder?: string },
  ) => { image: string; width: number; height: number; archivedPath: string; error: string }
}

/**
 * Create a brand-new image from raw RGBA pixels (no source image required) and
 * persist it. The backend `asset2d.createImage` service dual-writes: it archives
 * the encoded PNG into the top-level `.forgeax/grayscale/` column AND imports it
 * into the asset library, returning a downstream `image` ImageRef. Used by
 * batteries that synthesize images from data (e.g. house_template grayscale).
 * Returns an `error` (with empty `image`) when the service is absent or encode
 * fails; `archivedPath` is the column file path (empty if the column write was
 * skipped — the `image` output still succeeds).
 */
export function createImage(
  ctx: { services?: Record<string, unknown> } | undefined,
  pixels: Buffer,
  width: number,
  height: number,
  opts: { name: string; nodeId?: string; folder?: string },
): { image: string; width: number; height: number; archivedPath: string; error: string } {
  const asset2d = ctx?.services?.asset2d as Asset2dCreateServices | undefined
  if (!asset2d?.createImage) {
    return { image: '', width: 0, height: 0, archivedPath: '', error: 'asset2d.createImage service unavailable' }
  }
  return asset2d.createImage(pixels, width, height, opts)
}

interface Asset2dCopyServices {
  copyImage?: (image: string, opts?: { operation?: string; suffix?: string; folder?: string; name?: string; tags?: string[]; overwrite?: boolean }) => Promise<CopyImageResult> | CopyImageResult
}

export async function copyImage(
  input: Record<string, unknown>,
  ctx: { services?: Record<string, unknown> } | undefined,
  operation: string,
  inputName = 'image',
): Promise<CopyImageResult> {
  const image = typeof input[inputName] === 'string' ? input[inputName] as string : ''
  if (!image) return { image: '', width: 0, height: 0, error: `missing ${inputName} input` }
  const asset2d = ctx?.services?.asset2d as Asset2dCopyServices | undefined
  if (!asset2d?.copyImage) return { image, width: 0, height: 0, error: '' }
  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined
  const tags = Array.isArray(input.tags)
    ? (input.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0))
    : undefined
  const overwrite = typeof input.overwrite === 'boolean' ? input.overwrite : undefined
  return asset2d.copyImage(image, {
    operation,
    suffix: typeof input.suffix === 'string' ? input.suffix : undefined,
    folder: 'processed',
    ...(name ? { name } : {}),
    ...(tags && tags.length ? { tags } : {}),
    ...(overwrite !== undefined ? { overwrite } : {}),
  })
}
