function s(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function n(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key]
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback
}

function parse(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const value = JSON.parse(raw) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

export function sidescrollerMetadataPack(input: Record<string, unknown>): Record<string, unknown> {
  const layerRole = s(input, 'layer_role', 'bg_middle')
  const quality = parse(s(input, 'qualityReport'))
  const action = typeof quality.action === 'string' ? quality.action : 'proceed'
  const metadata = {
    scene_type: 'side_scroller',
    camera_projection: 'side_view',
    layer_role: layerRole,
    texture_width: n(input, 'texture_width', 1920),
    texture_height: n(input, 'texture_height', 360),
    logical_tile_width: n(input, 'logical_tile_width', 640),
    logical_tile_height: n(input, 'logical_tile_height', 360),
    placement: s(input, 'placement', layerRole.startsWith('bg_') ? 'parallax_background' : 'foreground_sprite'),
    ...(Object.keys(quality).length ? { quality_check: quality } : {}),
  }
  return { metadata: JSON.stringify(metadata), layer_role: layerRole, ready: action === 'proceed' }
}
