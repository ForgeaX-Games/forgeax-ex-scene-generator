export type ExecuteSummaryVerification = {
  ok?: boolean
  hints?: string[]
  primaryFailure?: 'execution' | 'structural' | 'location-names'
  finalOutput?: {
    ok?: boolean
    resultEntityIds?: string[]
    totalSceneCells?: number
    missingResultEntityIds?: string[]
    emptyResultEntityIds?: string[]
  }
  executionFailures?: {
    ok?: boolean
    count?: number
    failures?: Array<{ index: number; message: string }>
    truncated?: boolean
  }
  locationNameAlignment?: {
    ok?: boolean
    missing?: Array<{ name: string }>
    fix?: string
    actualNodeNames?: string[]
    actualNodeNamesTruncated?: boolean
  }
}

/** Build the Error message for AI execute when verification failed. Structural issues take priority over naming. */
export function formatExecuteVerificationFailure(summary: {
  status?: string
  verification?: ExecuteSummaryVerification
  diagnostics?: Array<{ repairSlip?: string }>
}): string | null {
  if (summary.status !== 'completed' || summary.verification?.ok !== false) return null

  const hints = summary.verification.hints ?? []
  const loc = summary.verification.locationNameAlignment
  const structuralHints = hints.filter((h) => !h.startsWith('[stage3.location_names]'))
  const hasStructural = structuralHints.length > 0 || summary.verification.primaryFailure === 'structural'
  const hasLocation = loc?.ok === false
  const execution = summary.verification.executionFailures

  if (summary.verification.primaryFailure === 'execution' || execution?.ok === false) {
    const failures = (execution?.failures ?? []).map((item) => `[${item.index + 1}] ${item.message}`).join('\n')
    const repairSlip = summary.diagnostics?.find((item) => item.repairSlip)?.repairSlip
    return (
      `[primaryFailure: execution] pipeline.execute recorded ${execution?.count ?? 'one or more'} node execution failure(s); ` +
      `status=completed is not acceptance. Fix the first failing Scene Script operation and re-execute.` +
      (failures ? `\n${failures}` : '') +
      (repairSlip ? `\n\n${repairSlip}` : '')
    )
  }

  if (hasStructural) {
    const locationSection = hasLocation
      ? `\n\n[secondary: locationNameAlignment] missing narrative names: ${(loc!.missing ?? []).map((m) => m.name).join('、')}. ` +
        `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}` +
        (loc!.actualNodeNames?.length
          ? ` 当前场景实际节点名（共 ${loc!.actualNodeNames.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个）：${loc!.actualNodeNames.join('、')}`
          : '')
      : ''
    return (
      `[primaryFailure: structural] pipeline.execute verification failed — empty/disconnected group outputs (fix wiring before checking names). ` +
      `Correct the responsible Scene Script call using its structured diagnostic, then re-execute. ` +
      (structuralHints[0] ?? 'See verification.hints') +
      locationSection
    )
  }

  if (hasLocation) {
    const missing = (loc!.missing ?? []).map((m) => m.name).join('、')
    const actualList = loc!.actualNodeNames ?? []
    const actualNote = actualList.length > 0
      ? ` 当前场景实际节点名（共 ${actualList.length}${loc!.actualNodeNamesTruncated ? '+' : ''} 个，无需再跑 raw execute 翻找）：${actualList.join('、')}`
      : ''
    return (
      `[primaryFailure: location-names] pipeline.execute locationNameAlignment failed — missing narrative names: ${missing}. ` +
      `${loc!.fix ?? 'Wire Name/BuildingName ports from checklist namePort, then re-execute.'}${actualNote}`
    )
  }

  return (
    `[primaryFailure: structural] pipeline.execute verification failed (empty/disconnected group outputs). ` +
    `Correct the responsible Scene Script call using its structured diagnostic, then re-execute. ` +
    (hints[0] ?? 'See verification.hints')
  )
}
