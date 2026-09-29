import { getPipeline, type Runtime } from '@forgeax/node-runtime'
import { inspectSceneSource } from '@forgeax/scene'

import { runSceneProject } from '../run/runProject.js'
import { ensureCanonicalSceneProject } from '../persist/store.js'
import { lastProjectedRevision } from './projectionRevision.js'

const inFlight = new Map<string, Promise<void>>()

function displayNodeCount(runtime: Runtime): number {
  const nodes = getPipeline(runtime)?.nodes
  return nodes ? Object.keys(nodes).length : 0
}

/**
 * Project `.scene.ts` onto the display graph. graph.json / an empty snapshot
 * is not a reason to skip — Code is the truth.
 */
export async function hydrateRuntimeGraphFromScene(input: {
  projectId: string
  projectDir: string
  runtime: Runtime
}): Promise<void> {
  const pending = inFlight.get(input.projectId)
  if (pending) {
    await pending
    return
  }
  const work = hydrateOnce(input).finally(() => {
    inFlight.delete(input.projectId)
  })
  inFlight.set(input.projectId, work)
  await work
}

async function hydrateOnce(input: {
  projectId: string
  projectDir: string
  runtime: Runtime
}): Promise<void> {
  const stored = await ensureCanonicalSceneProject(input.projectDir, input.projectId)
  const revision = stored.projectRevision ?? stored.revision
  const sites = stored.source.trim() ? inspectSceneSource(stored.source, stored.file) : []
  const expected = sites.length
  const nodes = displayNodeCount(input.runtime)
  const inSync = lastProjectedRevision(input.projectId) === revision && (expected === 0 ? nodes === 0 : nodes > 0)
  if (inSync) {
    return
  }
  if (!stored.source.trim()) return
  await runSceneProject({
    projectId: input.projectId,
    projectDir: input.projectDir,
    runtime: input.runtime,
    entryFile: stored.file,
    actor: 'scene-script:hydrate',
    label: 'Hydrate Scene Script run projection',
  })
}
