import type { DomainValueFormatter } from '@forgeax/node-runtime-react/editor'

interface GeometryLike {
  source: string
  statements: readonly { op?: unknown }[]
  focus?: string
  version: number
}

function parseGeometry(value: unknown): GeometryLike | null {
  if (!value || typeof value !== 'object') return null
  const geometry = value as Partial<GeometryLike>
  if (typeof geometry.source !== 'string') return null
  if (!Array.isArray(geometry.statements)) return null
  if (typeof geometry.version !== 'number') return null
  if (geometry.focus !== undefined && typeof geometry.focus !== 'string') return null
  return geometry as GeometryLike
}

export const geometryValueFormatter: DomainValueFormatter = {
  typeLabel: 'geometry',
  typeLabelPlural: 'geometries',
  format(value) {
    const geometry = parseGeometry(value)
    if (!geometry) return undefined
    const lineCount = geometry.source === '' ? 0 : geometry.source.split('\n').length
    const focusPart = geometry.focus ? ` focus=${geometry.focus}` : ''
    return `geometry lines=${lineCount} stmts=${geometry.statements.length}${focusPart}`
  },
  formatExtra(value) {
    const geometry = parseGeometry(value)
    if (!geometry) return undefined
    return `v=${geometry.version}`
  },
}
