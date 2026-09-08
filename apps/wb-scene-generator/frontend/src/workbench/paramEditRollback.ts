import type { ExecutionResult } from '@forgeax/node-runtime'

export function isFailedParamEdit(result: ExecutionResult | null | undefined): boolean {
  return !result || result.status === 'error' || result.status === 'aborted'
}

export function paramEditErrorMessage(result: ExecutionResult | null | undefined): string {
  const msg = result?.error?.message?.trim()
  if (msg) return msg
  const first = result?.execFailures?.[0]?.trim()
  if (first) return first
  return 'This edit failed. The previous value was restored.'
}
