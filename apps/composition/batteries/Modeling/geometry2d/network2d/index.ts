import { buildNetwork } from '../../../../../../packages/scene-authoring/src/types/operating.js'

export function network2d(input: Record<string, unknown>): Record<string, unknown> {
  return buildNetwork(input)
}
