const ROUTES = ['material_seamless', 'decal_sprite', 'modular_tileset', 'prop_sprite'] as const
type FourWayRoute = typeof ROUTES[number]

const SEMANTIC_DECAL_WORDS = [
  'crosswalk', 'zebra', 'lane', 'arrow', 'marking', 'manhole', 'stain', 'symbol',
  '斑马线', '车道', '箭头', '井盖', '污渍', '标识', '路标'
]

const MODULAR_WORDS = [
  'road', 'curb', 'wall', 'bridge', 'rail', 'intersection', 'door', 'building edge',
  '道路', '路沿', '墙', '桥', '轨道', '路口', '门', '建筑边缘'
]

const PROP_WORDS = [
  'tree', 'crate', 'lamp', 'sign', 'barrel', 'bush', 'vehicle', 'car', 'pickup',
  '树', '箱', '灯', '招牌', '桶', '灌木', '车辆', '汽车', '拾取'
]

const BLOCKING_WORDS = [
  'wall', 'building', 'vehicle', 'car', 'crate', 'barrel', 'fence', 'rock',
  '墙', '建筑', '车辆', '汽车', '箱', '桶', '栅栏', '岩石'
]

function text(input: Record<string, unknown>, key: string): string {
  const value = input[key]
  return typeof value === 'string' ? value.trim() : ''
}

function includesAny(haystack: string, words: string[]): boolean {
  return words.some((word) => haystack.includes(word.toLowerCase()))
}

function normalizeRoute(value: string): FourWayRoute | null {
  const v = value.toLowerCase().replace(/[\s-]+/g, '_')
  return ROUTES.includes(v as FourWayRoute) ? v as FourWayRoute : null
}

function normalizeView(value: string): string {
  const v = value.toLowerCase().replace(/[\s-]+/g, '_')
  if (v === 'isometric' || v === 'iso') return 'isometric'
  if (v === 'three_quarter' || v === '3q' || v === 'threequarter') return 'three_quarter'
  return 'top_down'
}

function groundPlaneFor(view: string): string {
  if (view === 'isometric') return 'iso_diamond'
  if (view === 'three_quarter') return 'oblique_ground'
  return 'flat_ground'
}

function inferRoute(input: Record<string, unknown>): FourWayRoute {
  const explicit = normalizeRoute(text(input, 'assetType'))
  if (explicit) return explicit
  const corpus = `${text(input, 'usage')} ${text(input, 'notes')}`.toLowerCase()
  if (includesAny(corpus, SEMANTIC_DECAL_WORDS)) return 'decal_sprite'
  if (includesAny(corpus, MODULAR_WORDS)) return 'modular_tileset'
  if (includesAny(corpus, PROP_WORDS)) return 'prop_sprite'
  return 'material_seamless'
}

function inferDirection(route: FourWayRoute, raw: string): string {
  const v = raw.toLowerCase().replace(/[\s-]+/g, '_')
  if (['horizontal', 'vertical', 'nw_se', 'ne_sw', 'any'].includes(v)) return v
  return route === 'material_seamless' || route === 'prop_sprite' ? 'any' : 'horizontal'
}

export function fourwayRouteClassifier(input: Record<string, unknown>): Record<string, unknown> {
  const route = inferRoute(input)
  const view = normalizeView(text(input, 'view'))
  const groundPlane = groundPlaneFor(view)
  const corpus = `${text(input, 'usage')} ${text(input, 'notes')}`.toLowerCase()
  const blocking = route === 'modular_tileset' || route === 'prop_sprite'
    ? includesAny(corpus, BLOCKING_WORDS)
    : false
  const direction = inferDirection(route, text(input, 'direction'))
  const metadata = {
    assetType: route,
    view,
    camera: 'orthographic',
    groundPlane,
    tileSize: 256,
    direction,
    blocking,
    ...(route === 'material_seamless' ? { seamlessAxes: ['x', 'y'] } : {}),
  }
  return { route, view, groundPlane, blocking, direction, metadata: JSON.stringify(metadata) }
}
