import assert from 'node:assert/strict'

export async function probeSceneAuthoring(baseUrl) {
  const read = async (path) => {
    const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(30_000) })
    const body = await response.json()
    assert(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(body)}`)
    return body
  }
  const catalog = await read('/api/v1/projects/main/scene-script/contracts?audience=sino&mode=summary')
  for (const name of ['heightfieldMesh', 'meshSceneNode', 'basePlane', 'sceneOutput']) {
    assert(catalog.functions.some((entry) => entry.functionName === name), `Missing published Scene contract: ${name}`)
  }
  for (const topic of ['terrain', 'districts', 'roads', 'parcels', 'buildings', 'dressing']) {
    const reference = await read(`/api/v1/scene-script/references?topic=${topic}`)
    assert.equal(reference.referenceManifest.closureVerified, true)
    assert(reference.referenceManifest.closureFileCount > 0)
  }
  console.log(`[release] Scene contracts=${catalog.functions.length}; six reference closures verified`)
}

// Only call against the disposable consumer workspace created by verify:release.
export async function probeSceneGeneration(baseUrl) {
  const request = async (path, body) => {
    const response = await fetch(`${baseUrl}${path}`, body === undefined ? { signal: AbortSignal.timeout(30_000) } : {
      signal: AbortSignal.timeout(30_000),
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const result = await response.json()
    assert(response.ok, `${path}: HTTP ${response.status}: ${JSON.stringify(result)}`)
    return result
  }
  const prefix = '/api/v1/projects/main/scene-script'
  const info = await request(`${prefix}/project-info`)
  await request(`${prefix}/scaffold`, { expectedProjectRevision: info.projectRevision })
  const execution = await request('/api/v1/projects/main/execute/summary', { quietErrors: true })
  assert.equal(execution.status, 'completed', JSON.stringify(execution))
  assert.equal(execution.verification.ok, true, JSON.stringify(execution))
  assert(execution.verification.finalOutput.totalSceneMeshes > 0, 'Published generator produced no final scene meshes')
  console.log(`[release] Scene execution=${execution.status}; final meshes=${execution.verification.finalOutput.totalSceneMeshes}`)
}
