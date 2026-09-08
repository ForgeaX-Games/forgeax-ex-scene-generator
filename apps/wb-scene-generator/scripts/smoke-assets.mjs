// Boot the backend in-process and verify the asset serve path end-to-end:
// a rule JSON via the disk fallback + image aliases via aliases-meta + a real
// image blob stream. Uses a throwaway project root for idempotency.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.FORGEAX_PROJECT_ROOT = mkdtempSync(join(tmpdir(), 'wb-scene-assets-'))
const { buildApp } = await import('../backend/src/main.ts')
const app = await buildApp()

// 1. rule JSON via /serve disk fallback
const rule = await app.inject({ method: 'GET', url: '/api/v1/library/serve/common_16' })
if (rule.statusCode !== 200 || rule.json().name !== 'common_16') {
  console.error('rule serve failed', rule.statusCode)
  process.exit(1)
}

// 2. aliases-meta returns the image aliases
const metas = await app.inject({ method: 'GET', url: '/api/v1/library/aliases-meta?zone=raw' })
if (metas.statusCode !== 200 || !Array.isArray(metas.json())) {
  console.error('aliases-meta failed', metas.statusCode)
  process.exit(1)
}
const aliases = metas.json()

// 3. a real image blob streams with an image/* content-type
if (aliases.length > 0) {
  const a = encodeURIComponent(aliases[0].alias)
  const img = await app.inject({ method: 'GET', url: `/api/v1/library/serve/${a}` })
  if (img.statusCode !== 200 || !String(img.headers['content-type']).startsWith('image/')) {
    console.error('image blob serve failed', img.statusCode, img.headers['content-type'])
    process.exit(1)
  }
}

await app.close()
rmSync(process.env.FORGEAX_PROJECT_ROOT, { recursive: true, force: true })
console.log(`[smoke-assets] OK — rule serve + aliases-meta (${aliases.length} image aliases) + blob stream`)
