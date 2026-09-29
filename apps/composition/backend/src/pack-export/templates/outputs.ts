/**
 * `sceneOutput` for the emitted pack. Copied verbatim into `platform/`.
 *
 * In the app, `sceneOutput` hands the scene to the renderer through the host's
 * OutputCache. A pack has no host and no cache, so the same call parks the
 * parsed scene in a module-level slot that `build()` reads back. Parsing goes
 * through the same `parseScenePort` the battery uses, so the collected value is
 * the battery's `scene` port — not a re-derived one.
 *
 * The battery's voxel-layer projection is deliberately skipped: it exists to
 * feed the editor viewport, produces nothing the pack consumes, and would drag
 * the voxel codec into the vendored closure.
 */

import { parseScenePort } from '../../../../vendor/shared/types/scene/port.js'

const outputs: unknown[] = []

export function sceneOutput(input: Record<string, unknown>): Record<string, unknown> {
  const port = parseScenePort(input.scene)
  if (!port) return { error: 'scene is required and must be a SceneTree' }
  outputs.push(port)
  return { scene: port, graph: port.graph, focus: port.focus }
}

/** The scene the module-scope `sceneOutput(...)` call parked. */
export function collectedScene(): { graph: unknown; focus: string } {
  if (outputs.length > 1) throw new Error('Multiple scene outputs: select a named export returning the desired scene')
  if (outputs.length === 0) {
    throw new Error('pack scene module finished without calling sceneOutput({ scene })')
  }
  return outputs[0] as { graph: unknown; focus: string }
}
