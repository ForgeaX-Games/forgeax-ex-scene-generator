const VALID_ROUTES = new Set(['material_seamless', 'decal_sprite', 'modular_tileset', 'prop_sprite'])

function s(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function routeOf(input: Record<string, unknown>): string {
  const route = s(input, 'route', 'material_seamless').toLowerCase().replace(/[\s-]+/g, '_')
  return VALID_ROUTES.has(route) ? route : 'material_seamless'
}

function viewLine(input: Record<string, unknown>): string {
  const view = s(input, 'view', 'top_down')
  const groundPlane = s(input, 'groundPlane', view === 'isometric' ? 'iso_diamond' : 'flat_ground')
  return `View protocol: ${view}, orthographic camera, ${groundPlane}.`
}

function styleLine(input: Record<string, unknown>): string {
  const style = s(input, 'style')
  return style ? `Art direction: ${style}.` : 'Art direction: clean production-ready 2D game asset, readable silhouette, consistent palette.'
}

function materialPrompt(subject: string, input: Record<string, unknown>): string {
  return [
    'Asset type: material_seamless.',
    `Generate only non-semantic ground material: ${subject}.`,
    viewLine(input),
    styleLine(input),
    'Uniform density across the full image, no central focal point, no directional lighting.',
    'No characters, no props, no road markings, no symbols, no buildings, no landmarks.',
    'The source will be post-processed into a four-way seamless texture.',
  ].join(' ')
}

function decalPrompt(subject: string, input: Record<string, unknown>): string {
  const direction = s(input, 'direction', 'horizontal')
  return [
    'Asset type: decal_sprite.',
    `Generate one isolated transparent PNG decal for a 2D game: ${subject}.`,
    viewLine(input),
    styleLine(input),
    'The decal lies flat on the declared ground plane; it is not standing upright.',
    `If this is a road marking, painted stripes follow direction: ${direction}.`,
    'No road or floor background unless explicitly requested, no vehicles, characters, UI text, or watermark.',
    'Do not make this seamless or tileable.',
  ].join(' ')
}

function modularPrompt(subject: string, input: Record<string, unknown>): string {
  return [
    'Asset type: modular_tileset.',
    `Generate a modular 2D game tileset for: ${subject}.`,
    viewLine(input),
    styleLine(input),
    'Tile size: 256x256. Edges align exactly with tile borders and declared directions.',
    'Required variants when applicable: straight, corner, t-junction, cross, endcap, empty.',
    'Do not include unique landmarks or random props baked into every tile.',
  ].join(' ')
}

function propPrompt(subject: string, input: Record<string, unknown>): string {
  return [
    'Asset type: prop_sprite.',
    `Generate one isolated 2D game prop sprite: ${subject}.`,
    viewLine(input),
    styleLine(input),
    'Transparent background if possible; otherwise use a flat high-contrast removable background.',
    'No terrain baked under the prop, no characters, no UI text, no watermark.',
    'Keep the whole subject complete, centered, padded, and easy to mask.',
  ].join(' ')
}

export function fourwayPromptBuilder(input: Record<string, unknown>): Record<string, unknown> {
  const route = routeOf(input)
  const subject = s(input, 'subject', 'generic game environment asset')
  let prompt: string
  if (route === 'decal_sprite') prompt = decalPrompt(subject, input)
  else if (route === 'modular_tileset') prompt = modularPrompt(subject, input)
  else if (route === 'prop_sprite') prompt = propPrompt(subject, input)
  else prompt = materialPrompt(subject, input)
  return { prompt, role: route === 'material_seamless' ? 'concept-art' : 'sprite-frame', route }
}
