import type { DisplaySchema } from '../types'

/** Mesh-like schemas that can appear as Stage drawables. Names come from the scene, not this list. */
export const STAGE_BRANCHES = ['mesh', 'road', 'houses', 'guide'] as const satisfies readonly DisplaySchema[]
export type StageBranch = (typeof STAGE_BRANCHES)[number]

/** Path is the scene node name (or an already-rooted path). Schema is never a folder name. */
export function stagePathForSchema(schema: DisplaySchema, label?: string): string {
  if (label && label.startsWith('/')) return label
  if (label) return `/${label}`
  return `/${schema}`
}
