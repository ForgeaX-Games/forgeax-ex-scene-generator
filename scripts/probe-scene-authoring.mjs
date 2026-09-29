import assert from 'node:assert/strict'

async function request(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(30_000),
    ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  const result = await response.json()
  assert(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(result)}`)
  return result
}

export async function probeSceneAuthoring(baseUrl) {
  const catalog = await request(baseUrl, '/api/v1/projects/main/scene-script/contracts?audience=sino&mode=summary')
  for (const name of ['heightfieldMesh', 'sceneNode', 'basePlane', 'sceneOutput']) {
    assert(catalog.functions.some((entry) => entry.functionName === name), `Missing published Scene contract: ${name}`)
  }
  console.log(`[release] Scene contracts=${catalog.functions.length}`)
}

// Only call against the disposable consumer workspace created by verify:release.
export async function probeSceneGeneration(baseUrl) {
  const project = await request(baseUrl, '/api/v1/projects', { name: 'Release acceptance' })
  const prefix = `/api/v1/projects/${encodeURIComponent(project.id)}/scene-script`
  const info = await request(baseUrl, `${prefix}/project-info`)
  const source = [
    "import { addChild, basePlane, emptyScene, sceneNode, sceneOutput } from '@forgeax/scene'",
    'export const world = basePlane({ origin: [0, 0], width: 12, height: 8 })',
    "const ground = sceneNode({ name: 'release-ground', geometry: { kind: 'mesh', positions: [0, 0, 0, 10, 0, 0, 0, 10, 5], indices: [0, 1, 2] } })",
    'sceneOutput({ scene: addChild({ scene: emptyScene(), nodes: [ground.scene] }).scene })',
  ].join('\n')
  await request(baseUrl, `${prefix}/commit`, {
    expectedProjectRevision: info.projectRevision,
    entryFile: 'main.scene.ts', files: [{ file: 'main.scene.ts', source }],
  })
  const execution = await request(baseUrl, `/api/v1/projects/${encodeURIComponent(project.id)}/execute/summary`, { quietErrors: true })
  assert.equal(execution.status, 'completed', JSON.stringify(execution))
  assert.equal(execution.verification.ok, true, JSON.stringify(execution))
  assert(execution.verification.finalOutput.totalSceneMeshes > 0, 'Published generator produced no final scene meshes')
  console.log(`[release] Scene execution=${execution.status}; final meshes=${execution.verification.finalOutput.totalSceneMeshes}`)
}
