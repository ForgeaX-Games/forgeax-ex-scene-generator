/** Gemini imageConfig.imageSize values (uppercase K; 512 has no K suffix). */
export const GEMINI_IMAGE_SIZES = ['512', '1K', '2K', '4K'] as const
export type GeminiImageSize = (typeof GEMINI_IMAGE_SIZES)[number]

export const DEFAULT_GEMINI_IMAGE_SIZE: GeminiImageSize = '2K'

export function normalizeGeminiImageSize(value: unknown): GeminiImageSize {
  const s = typeof value === 'string' ? value.trim() : ''
  return (GEMINI_IMAGE_SIZES as readonly string[]).includes(s) ? (s as GeminiImageSize) : DEFAULT_GEMINI_IMAGE_SIZE
}

/** Map Gemini tier to ImageDispatcher vendor size (512 → 1k approximation). */
export function dispatcherSizeFromGeminiImageSize(imageSize: GeminiImageSize | string | undefined): '1k' | '2k' | '4k' {
  const s = normalizeGeminiImageSize(imageSize)
  if (s === '4K') return '4k'
  if (s === '1K' || s === '512') return '1k'
  return '2k'
}
