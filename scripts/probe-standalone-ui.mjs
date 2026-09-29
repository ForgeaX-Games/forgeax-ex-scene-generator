import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { probeSceneAuthoring, probeSceneGeneration } from './probe-scene-authoring.mjs'

const frontendRequire = createRequire(new URL('../apps/composition/frontend/package.json', import.meta.url))
const { JSDOM } = frontendRequire('jsdom')

export async function probeStandaloneUi(origin) {
  const response = await fetch(origin)
  assert.equal(response.status, 200)
  const document = new JSDOM(await response.text(), { url: origin }).window.document
  const resources = [...document.querySelectorAll('script[type="module"][src], link[rel="stylesheet"]')]
  assert(resources.length >= 2, 'The installed UI must include JavaScript and CSS')
  for (const element of resources) {
    const url = element.src || element.href
    const resource = await fetch(url)
    assert.equal(resource.status, 200, url)
    assert.match(resource.headers.get('content-type'), element.tagName === 'SCRIPT' ? /javascript/ : /text\/css/, url)
    assert((await resource.arrayBuffer()).byteLength > 0, url)
  }
  const health = await (await fetch(`${origin}/health`)).json()
  assert.equal(health.uiUrl, `${origin}/`)
  await probeSceneAuthoring(origin)
  const socket = new WebSocket(origin.replace('http:', 'ws:') + '/ws')
  let timeout
  try {
    await once(socket, 'open', { signal: AbortSignal.timeout(10_000) })
    socket.send(JSON.stringify({ action: 'subscribe', channels: ['graph'] }))
    const changed = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('Source transaction did not reach the UI WebSocket')), 30_000)
      socket.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        if (message.event === 'scene:project-changed') resolve(message)
      })
    })
    await Promise.all([probeSceneGeneration(origin), changed])
  } finally {
    clearTimeout(timeout)
    const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) })
    socket.close()
    await closed
  }
  assert.equal((await fetch(`${origin}/assets/missing-release-file.js`)).status, 404)
  console.log('[release] installed UI assets, HTTP authoring, and WebSocket updates passed')
}
