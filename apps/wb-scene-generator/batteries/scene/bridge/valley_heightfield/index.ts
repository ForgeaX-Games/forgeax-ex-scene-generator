/**
 * valley_heightfield (ValleyHeightfield):
 * Procedural mountain valley elevation field generator.
 * Creates a natural mountain valley with a gentle green meadow basin,
 * riverbed depression, terraced agricultural foothills, flanking mountain
 * ridges, Gaussian peaks, and harmonic terrain noise.
 */

import { generateAlpineValleyTerrain, type SemanticMountainPeak } from '../../../../vendor/shared/types/scene/heightfield.js'

export interface ValleyHeightfieldInput {
  width?: number
  height?: number
  valleyDepth?: number
  valleyWidth?: number
  riverDepth?: number
  riverWidth?: number
  ridgeNoise?: number
  seed?: number
  baseElevation?: number
  peaks?: unknown
  erosionStrength?: number
  terraceSteps?: number
}

function num(value: unknown, fallback: number): number {
  let cur: unknown = value
  if (Array.isArray(cur) && cur.length === 1) cur = cur[0]
  if (cur && typeof cur === 'object' && 'items' in cur) {
    const items = (cur as { items: unknown }).items
    if (Array.isArray(items) && items.length > 0) cur = items[0]
  }
  const n = typeof cur === 'number' ? cur : Number(cur)
  return Number.isFinite(n) ? n : fallback
}

function parsePeaks(raw: unknown): SemanticMountainPeak[] | undefined {
  if (!raw) return undefined
  let cur: unknown = raw
  if (cur && typeof cur === 'object' && 'items' in cur) {
    cur = (cur as { items: unknown }).items
  }
  if (!Array.isArray(cur)) return undefined
  const out: SemanticMountainPeak[] = []
  for (const item of cur) {
    if (Array.isArray(item) && item.length >= 2) {
      out.push({ x: Number(item[0]), y: Number(item[1]) })
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      out.push({
        x: Number(obj.x ?? 0),
        y: Number(obj.y ?? 0),
        elevation: obj.elevation !== undefined ? Number(obj.elevation) : undefined,
        radius: obj.radius !== undefined ? Number(obj.radius) : undefined,
        sharpness: obj.sharpness !== undefined ? Number(obj.sharpness) : undefined,
        type: obj.type as SemanticMountainPeak['type'],
      })
    }
  }
  return out.length > 0 ? out : undefined
}

export function valleyHeightfield(input: Record<string, unknown>): Record<string, unknown> {
  const res = generateAlpineValleyTerrain({
    width: num(input.width, 128),
    height: num(input.height, 128),
    valleyDepth: num(input.valleyDepth, 42),
    valleyWidth: num(input.valleyWidth, 32),
    riverDepth: num(input.riverDepth, 2.2),
    riverWidth: num(input.riverWidth, 8),
    ridgeNoise: num(input.ridgeNoise, 4.6),
    seed: num(input.seed, 27),
    baseElevation: num(input.baseElevation, 3),
    peaks: parsePeaks(input.peaks),
    riverPoints: input.riverPoints,
    erosionStrength: num(input.erosionStrength, 0.7),
    terraceSteps: num(input.terraceSteps, 6),
    plazaCenter: input.plazaCenter,
    plazaRadius: num(input.plazaRadius, 7.4),
  })

  return {
    heightGrid: res.heightGrid,
    valleyMask: res.valleyMask,
    riverMask: res.riverMask,
    terraceMask: res.terraceMask,
    cliffMask: res.cliffMask,
    forestMask: res.forestMask,
    buildableMask: res.buildableMask,
    slopeGrid: res.slopeGrid,
    minElevation: res.minElevation,
    maxElevation: res.maxElevation,
  }
}
