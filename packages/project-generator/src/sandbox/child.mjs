import { pathToFileURL } from 'node:url'

const IPC_LIMIT = 16 * 1024 * 1024

function denyRandom() {
  throw new Error('Math.random is forbidden in Project Generators; use ctx.random().')
}

Object.defineProperty(Math, 'random', {
  value: denyRandom,
  writable: false,
  configurable: false,
})

function createRng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function run(request) {
  const module = await import(pathToFileURL(request.bundlePath).href)
  const definition = module[request.exportName]
  if (!definition || typeof definition.run !== 'function') {
    throw new Error(`Generator export '${request.exportName}' has no run() implementation.`)
  }
  const seed = Number.isFinite(request.seed) ? request.seed : 1
  const stream = createRng(seed)
  const ctx = {
    seed,
    random: (salt) => (Number.isFinite(salt) ? createRng(salt)() : stream()),
    rng: (salt) => createRng(Number.isFinite(salt) ? salt : seed),
    log: (level, message) => {
      process.send?.({ type: 'log', level, message })
    },
    signal: new AbortController().signal,
  }
  return definition.run(ctx, request.args)
}

process.on('message', (message) => {
  const encoded = Buffer.byteLength(JSON.stringify(message), 'utf8')
  if (encoded > IPC_LIMIT) {
    process.send?.({ type: 'error', message: 'IPC payload exceeds sandbox size limit.' })
    process.exit(1)
  }
  run(message).then(
    (value) => {
      const payload = JSON.stringify({ type: 'ok', value })
      if (Buffer.byteLength(payload, 'utf8') > IPC_LIMIT) {
        process.send?.({ type: 'error', message: 'Generator output exceeds sandbox size limit.' })
        process.exit(1)
      }
      process.send?.({ type: 'ok', value })
    },
    (error) => {
      process.send?.({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      })
    },
  )
})
