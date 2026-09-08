function str(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key]
  return typeof value === 'boolean' ? value : fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function parseObject(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function fourwayMetadataPack(input: Record<string, unknown>): Record<string, unknown> {
  const assetType = str(input, 'route', 'material_seamless')
  const view = str(input, 'view', 'top_down')
  const edgeReport = parseObject(str(input, 'edgeReport'))
  const edgePassed = typeof edgeReport.passed === 'boolean' ? edgeReport.passed : true
  const metadata = {
    assetType,
    view,
    camera: 'orthographic',
    groundPlane: str(input, 'groundPlane', view === 'isometric' ? 'iso_diamond' : 'flat_ground'),
    tileSize: 256,
    direction: str(input, 'direction', assetType === 'material_seamless' ? 'any' : 'horizontal'),
    blocking: bool(input, 'blocking', false),
    semantic: stringList(input.semantic),
    avoidZones: stringList(input.avoidZones),
    ...(assetType === 'material_seamless' ? { seamlessAxes: ['x', 'y'] } : {}),
    ...(Object.keys(edgeReport).length ? { seamless_check: edgeReport } : {}),
    matting_status: assetType === 'material_seamless' ? 'not_needed' : 'passed',
    alpha_check: assetType === 'material_seamless' ? 'not_needed' : 'transparent-corners',
  }
  return { metadata: JSON.stringify(metadata), assetType, ready: edgePassed }
}
