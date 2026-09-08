/** Sentinel stored in `nodeOutputs` when a port is computed but too large to inline-fetch. */

export const TOO_LARGE_OUTPUT_SUMMARY_KEY = '__forgeaxTooLargeSummary' as const

export interface TooLargeOutputSummary {
  readonly [TOO_LARGE_OUTPUT_SUMMARY_KEY]: true
  readonly nodeId: string
  readonly portId: string
  readonly portType?: string
  readonly sharded?: boolean
  readonly dataChunks?: number
  readonly estimatedBytes?: number
}

export function isTooLargeOutputSummary(value: unknown): value is TooLargeOutputSummary {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as TooLargeOutputSummary)[TOO_LARGE_OUTPUT_SUMMARY_KEY] === true &&
    typeof (value as TooLargeOutputSummary).nodeId === 'string' &&
    typeof (value as TooLargeOutputSummary).portId === 'string'
  )
}

export function makeTooLargeOutputSummary(input: {
  nodeId: string
  portId: string
  portType?: string
  sharded?: boolean
  dataChunks?: number
  estimatedBytes?: number
}): TooLargeOutputSummary {
  return {
    [TOO_LARGE_OUTPUT_SUMMARY_KEY]: true,
    nodeId: input.nodeId,
    portId: input.portId,
    ...(input.portType ? { portType: input.portType } : {}),
    ...(input.sharded ? { sharded: true } : {}),
    ...(typeof input.dataChunks === 'number' ? { dataChunks: input.dataChunks } : {}),
    ...(typeof input.estimatedBytes === 'number' && input.estimatedBytes > 0
      ? { estimatedBytes: input.estimatedBytes }
      : {}),
  }
}

function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `~${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`
  if (bytes >= 1024 * 1024) return `~${(bytes / (1024 * 1024)).toFixed(0)}MB`
  if (bytes >= 1024) return `~${(bytes / 1024).toFixed(0)}KB`
  return `~${bytes}B`
}

export function formatTooLargeOutputSummaryText(
  summary: TooLargeOutputSummary,
  lang: 'zh' | 'en' = 'en',
): string {
  const type = summary.portType ?? 'output'
  const size =
    typeof summary.estimatedBytes === 'number' && summary.estimatedBytes > 0
      ? formatByteSize(summary.estimatedBytes)
      : null
  const chunks =
    typeof summary.dataChunks === 'number' && summary.dataChunks > 0
      ? lang === 'zh'
        ? `${summary.dataChunks} 项`
        : `${summary.dataChunks} entries`
      : null

  if (lang === 'zh') {
    const parts = [type]
    if (chunks) parts.push(chunks)
    if (size) parts.push(size)
    parts.push('过大，仅摘要')
    return parts.join(' · ')
  }

  const parts = [type]
  if (chunks) parts.push(chunks)
  if (size) parts.push(size)
  parts.push('too large (summary only)')
  return parts.join(' · ')
}

/** Drop probe-only summary sentinels before forwarding real output bags to the renderer. */
export function stripTooLargeSummaries(
  bag: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [port, value] of Object.entries(bag)) {
    if (!isTooLargeOutputSummary(value)) out[port] = value
  }
  return out
}
