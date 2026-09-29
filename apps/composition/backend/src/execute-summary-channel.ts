/** Shared payload when /execute/summary fails after canonical source is already applied. */
export const SCENE_EXECUTE_SUMMARY_CHANNEL = 'SCENE_EXECUTE_SUMMARY_CHANNEL'

export const EXECUTE_SUMMARY_CHANNEL_HOWTOFIX = [
  'Canonical Scene Script is already applied. Call scene:script.verify once.',
  'If compileOk, keep the golden-path source and report this execute-summary channel error. Do not draft, close/reopen, shrink basePlane/cellSize, or strip city operators to probe scale.',
] as const

export function executeSummaryChannelFailure(
  error: unknown,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const message = error instanceof Error ? error.message : String(error)
  return {
    status: 'error',
    summarized: true,
    code: SCENE_EXECUTE_SUMMARY_CHANNEL,
    error: { message },
    howToFix: [...EXECUTE_SUMMARY_CHANNEL_HOWTOFIX],
    retryable: false,
    verification: { ok: false, primaryFailure: 'execution' },
    ...extra,
  }
}

export function parseSceneBackendPayload(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { error: text.slice(0, 400), parseError: true }
  }
}
