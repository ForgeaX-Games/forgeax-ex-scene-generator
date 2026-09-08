function s(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function layerOf(input: Record<string, unknown>): string {
  const raw = s(input, 'layer', 'bg_middle').toLowerCase().replace(/[\s-]+/g, '_')
  if (['bg_bottom', 'bg_middle', 'bg_top', 'platform', 'prop', 'silhouette_top', 'silhouette_bottom'].includes(raw)) return raw
  return 'bg_middle'
}

function styleLine(style: string): string {
  return style ? `Art direction / paint anchor: ${style}.` : 'Art direction: consistent 2D game art, readable silhouettes, unified palette.'
}

function backgroundLayerDescription(layer: string): string {
  if (layer === 'bg_bottom') {
    return 'far background layer: sky, atmosphere, distant horizon silhouette under 20% height, desaturated and low detail'
  }
  if (layer === 'bg_top') {
    return 'near foreground atmospheric layer: close rocks, roots, fog and texture hints, high contrast, but NOT a standable floor'
  }
  return 'middle background layer: main environment structures, foliage and ruins at medium scale and contrast'
}

function backgroundPrompt(input: Record<string, unknown>, layer: string): string {
  const scene = s(input, 'scene', 'side-scrolling game environment')
  return [
    `2D side-scrolling game ${backgroundLayerDescription(layer)}, ${scene}.`,
    styleLine(s(input, 'style')),
    'Forced 16:9 aspect ratio, pure side view camera parallel to the scene.',
    'Single continuous scene with smooth left-to-right transition; left and right edges can connect seamlessly.',
    'No panel stitching, no vertical color bands, no decorative border, no black bars, no incomplete objects at edges.',
    'No sun, moon, unique landmark, characters, creatures, UI text, or watermark.',
    'NO ground platforms visible; jump platforms are separate transparent sprites; pure atmospheric background layer only.',
    'Uniform ambient lighting, no vignette, no bright center spotlight.',
  ].join(' ')
}

function platformPrompt(input: Record<string, unknown>): string {
  const subject = s(input, 'subject', 'floating platform')
  return [
    `Generate one isolated side-view platform sprite: ${subject}.`,
    styleLine(s(input, 'style')),
    'Pure front side view, camera perfectly parallel to the platform face.',
    'Horizontal and level, complete and centered with padding.',
    'Flat top surface suitable for standing; no 3/4 perspective, no top-down view, no tilt.',
    'Use a flat high-contrast removable background; no scene background, no characters, no UI text, no watermark.',
  ].join(' ')
}

function propPrompt(input: Record<string, unknown>): string {
  const subject = s(input, 'subject', 'decorative prop')
  return [
    `Generate one isolated side-scroller decorative prop sprite: ${subject}.`,
    styleLine(s(input, 'style')),
    'Pure 2D side-view game asset, complete and centered with padding.',
    'Use a flat high-contrast removable background; no floor plane, no cast shadow, no scene background, no UI text, no watermark.',
  ].join(' ')
}

function silhouettePrompt(input: Record<string, unknown>, layer: string): string {
  const subject = s(input, 'subject', layer === 'silhouette_top' ? 'upper hanging silhouette elements' : 'lower foreground silhouette elements')
  const region = layer === 'silhouette_top' ? 'upper 30% of the image' : 'lower 20% of the image'
  return [
    `Generate transparent silhouette layer for a side-scrolling game: ${subject}.`,
    styleLine(s(input, 'style')),
    `Elements only occupy the ${region}; keep the rest transparent.`,
    'No full background, no characters, no UI text, no watermark.',
  ].join(' ')
}

export function sidescrollerPromptBuilder(input: Record<string, unknown>): Record<string, unknown> {
  const layer = layerOf(input)
  let prompt: string
  if (layer === 'platform') prompt = platformPrompt(input)
  else if (layer === 'prop') prompt = propPrompt(input)
  else if (layer === 'silhouette_top' || layer === 'silhouette_bottom') prompt = silhouettePrompt(input, layer)
  else prompt = backgroundPrompt(input, layer)
  return {
    prompt,
    aspectRatio: layer.startsWith('bg_') || layer.startsWith('silhouette_') ? '16:9' : '1:1',
    layerRole: layer,
  }
}
