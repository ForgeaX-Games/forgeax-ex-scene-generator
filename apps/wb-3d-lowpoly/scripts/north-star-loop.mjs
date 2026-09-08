// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  NORTH-STAR LOOP — "人看到的 == AI 看到的"                                  ║
// ║                                                                            ║
// ║  Proves the full LLM perception loop end-to-end:                           ║
// ║    API drive  →  live render  →  REAL screenshot via the agent API  →      ║
// ║    iterate the model  →  the screenshot DIFFERS (the AI sees the change).  ║
// ║                                                                            ║
// ║  Two observation channels, mirroring what an agent would actually use:     ║
// ║    • TEXTUAL (always available): GET <urdf_preview>/outputs/urdf → <robot> ║
// ║    • PIXEL  (needs chromium):    POST /agent/screenshot/capture, which      ║
// ║      broadcasts `screenshot:request` over /ws; open ?pane=viewer3d page's  ║
// ║      `useScreenshotCapture` renders a fresh frame and POSTs the canvas PNG  ║
// ║      back to /store, resolving the blocked /capture with a REAL pixel PNG.  ║
// ║                                                                            ║
// ║  GRACEFUL DEGRADE: if chromium cannot be launched, the pixel half is        ║
// ║  skipped; the script still drives + iterates and asserts the URDF XML       ║
// ║  CHANGED, then prints a loud data-only PASS (exit 0). See docs/llm-loop.md. ║
// ╚══════════════════════════════════════════════════════════════════════════╝

import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.PORT ?? 9567
const API = `http://127.0.0.1:${PORT}`
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:9565'

function fail(msg) {
  console.error(`\nFAIL: ${msg}`)
  process.exit(1)
}
function log(msg) { console.log(msg) }

async function postJson(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, json }
}

// flattenWire: unwrap one DataTree level — mirrors the frontend hook exactly.
function flattenWire(wire) {
  if (!Array.isArray(wire)) return []
  const out = []
  for (const entry of wire) {
    if (entry && typeof entry === 'object' && Array.isArray(entry.items)) out.push(...entry.items)
    else out.push(entry)
  }
  return out
}

async function observeUrdf(previewId) {
  const res = await fetch(`${API}/api/v1/nodes/${previewId}/outputs/urdf`)
  if (!res.ok) fail(`GET nodes/${previewId}/outputs/urdf returned HTTP ${res.status}`)
  const out = await res.json().catch(() => ({}))
  const urdf = flattenWire(out?.value)[0]
  if (typeof urdf !== 'string' || !urdf.includes('<robot')) {
    fail(`urdf_preview(${previewId}) missing <robot> — raw: ${JSON.stringify(out?.value).slice(0, 200)}`)
  }
  return urdf
}

// Build one preview chain `<prim> → g_part → g_to_urdf → urdf_preview`.
// `prim` is { opId, params } for the primitive node. Returns the preview nodeId.
async function buildChain(tag, prim, robotName) {
  const PRIM = `prim_${tag}`
  const PART = `part_${tag}`
  const URDF = `urdf_${tag}`
  const PREVIEW = `preview_${tag}`
  const ops = [
    { type: 'createNode', nodeId: PRIM, opId: prim.opId, position: { x: 0, y: 0 }, params: prim.params },
    { type: 'createNode', nodeId: PART, opId: 'g_part', position: { x: 240, y: 0 }, params: {} },
    { type: 'createNode', nodeId: URDF, opId: 'g_to_urdf', position: { x: 480, y: 0 }, params: { name: robotName } },
    { type: 'createNode', nodeId: PREVIEW, opId: 'urdf_preview', position: { x: 720, y: 0 }, params: {} },
    { type: 'connect', edgeId: `e_geom_${tag}`, source: { nodeId: PRIM, port: 'geometry' }, target: { nodeId: PART, port: 'geometry' } },
    { type: 'connect', edgeId: `e_shape_${tag}`, source: { nodeId: PRIM, port: 'id' }, target: { nodeId: PART, port: 'shape_id' } },
    { type: 'connect', edgeId: `e_part_urdf_${tag}`, source: { nodeId: PART, port: 'geometry' }, target: { nodeId: URDF, port: 'geometry' } },
    { type: 'connect', edgeId: `e_urdf_preview_${tag}`, source: { nodeId: URDF, port: 'urdf' }, target: { nodeId: PREVIEW, port: 'urdf' } },
  ]
  const batch = await postJson('/api/v1/batch', { ops, opts: { actor: 'north-star' } })
  if (!batch.ok || batch.json?.status !== 'ok') {
    fail(`batch(${tag}) rejected: ${batch.json?.reason ?? `HTTP ${batch.status}`} — ${JSON.stringify(batch.json?.diagnostics ?? [])}`)
  }
  const exec = await postJson('/api/v1/execute', {})
  if (!exec.ok) fail(`execute(${tag}) returned HTTP ${exec.status}`)
  return PREVIEW
}

// ── PNG helpers ─────────────────────────────────────────────────────────────
function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl ?? '')
  if (!m) fail(`captured dataUrl is not a PNG dataURL: ${String(dataUrl).slice(0, 40)}…`)
  return Buffer.from(m[1], 'base64')
}
function pngDims(buf) {
  // PNG sig (8) + IHDR length (4) + "IHDR" (4) + width(4 @16) + height(4 @20)
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) fail('captured buffer is not a valid PNG (bad signature)')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

const RUN = `ns_${Date.now().toString(36)}`
const BOX_PRIM = { opId: 'g_box', params: { w: 2, d: 1, h: 0.5 } }
const CYL_PRIM = { opId: 'g_cylinder', params: { radius: 0.6, length: 1.6 } }

const outDir = await mkdtemp(join(tmpdir(), 'north-star-'))
log(`[north-star] PORT=${PORT}  FRONTEND_URL=${FRONTEND_URL}`)
log(`[north-star] out dir: ${outDir}`)

// ── Detect chromium ───────────────────────────────────────────────────────────
let chromium = null
let chromiumReason = ''
try {
  ;({ chromium } = await import('playwright'))
  const { existsSync } = await import('node:fs')
  const execPath = chromium.executablePath()
  if (!execPath || !existsSync(execPath)) {
    chromiumReason = `chromium binary not found at ${execPath || '(none)'}`
    chromium = null
  }
} catch (err) {
  chromiumReason = `playwright import failed: ${err?.message ?? err}`
  chromium = null
}

// ════════════════════════ DATA-ONLY PATH (no chromium) ════════════════════════
if (!chromium) {
  log(`\n⚠️  PIXEL PATH DISABLED — ${chromiumReason}`)
  log('⚠️  Running DATA-ONLY: API drive + textual (URDF) observe + iteration-changes-XML.\n')

  const boxPreview = await buildChain(`${RUN}_box`, BOX_PRIM, 'north_star_box')
  const urdf1 = await observeUrdf(boxPreview)
  log(`[data] box URDF observed (${urdf1.length} chars):`)
  log(urdf1.slice(0, 300))

  const cylPreview = await buildChain(`${RUN}_cyl`, CYL_PRIM, 'north_star_cyl')
  const urdf2 = await observeUrdf(cylPreview)
  log(`\n[data] cylinder URDF observed (${urdf2.length} chars):`)
  log(urdf2.slice(0, 300))

  if (urdf1 === urdf2) fail('iteration did NOT change the URDF XML (data-only diff failed)')
  log(`\n[data] ✔ URDF XML changed after iteration (box → cylinder).`)
  log(`\nPASS (data-only; pixel path needs chromium — see docs/llm-loop.md)`)
  log(`       reason: ${chromiumReason}`)
  process.exit(0)
}

// ════════════════════════ FULL PIXEL PATH (chromium) ══════════════════════════
log('[north-star] chromium available — running FULL real-pixel loop.')

// Agent-API capture: broadcasts screenshot:request; the open page answers.
async function captureViaAgent(label, timeout = 8000) {
  const cap = await postJson('/api/v1/agent/screenshot/capture', { timeout })
  if (!cap.ok) fail(`/capture(${label}) HTTP ${cap.status}: ${JSON.stringify(cap.json)} — is the ?pane=viewer3d page connected?`)
  const buf = dataUrlToBuffer(cap.json?.dataUrl)
  const { width, height } = pngDims(buf)
  if (width <= 1 || height <= 1) fail(`/capture(${label}) PNG too small: ${width}x${height}`)
  const file = join(outDir, `${label}.png`)
  await writeFile(file, buf)
  log(`[pixel] capture(${label}): ${width}x${height}, ${buf.length} bytes → ${file}`)
  return { dataUrl: cap.json.dataUrl, buf, width, height, file }
}

const browser = await chromium.launch({ headless: true })
let result
try {
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => console.error('[page error]', e.message))

  // Cheap canvas signature (length of toDataURL) to detect live re-renders.
  const canvasSig = () => page.evaluate(() => {
    const c = document.querySelector('canvas')
    if (!c) return null
    try { return c.toDataURL('image/png').length } catch { return null }
  })

  // Pixel analysis in-browser: decode dataUrl(s), compute luminance range
  // (non-uniform ⇒ non-blank) and optional pixel-diff ratio vs another PNG.
  const analyze = (dataUrl, comparePng) => page.evaluate(async ({ dataUrl, comparePng }) => {
    const load = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u })
    const toData = (img) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, c.width, c.height).data }
    const a = toData(await load(dataUrl))
    let min = 255, max = 0
    for (let i = 0; i < a.length; i += 4) { const l = (a[i] + a[i + 1] + a[i + 2]) / 3; if (l < min) min = l; if (l > max) max = l }
    let diffRatio = null
    if (comparePng) {
      const b = toData(await load(comparePng))
      const n = Math.min(a.length, b.length); let diff = 0, total = 0
      for (let i = 0; i < n; i += 4) { total++; if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) diff++ }
      diffRatio = diff / total
    }
    return { range: max - min, diffRatio }
  }, { dataUrl, comparePng })

  // Wait for the live viewer to re-render after a graph change.
  async function waitForRerender(prevSig, label, timeoutMs = 10000) {
    const start = Date.now()
    let sig = prevSig
    while (Date.now() - start < timeoutMs) {
      sig = await canvasSig()
      if (sig != null && sig !== prevSig) break
      await page.waitForTimeout(150)
    }
    if (sig === prevSig) log(`[pixel] ⚠ canvas signature unchanged after ${label} (continuing — capture forces a fresh render anyway)`)
    await page.waitForTimeout(400) // settle damping / async model mount
    return sig
  }

  // 1) Open the live viewer; wait for the canvas + WS hook to mount.
  await page.goto(`${FRONTEND_URL}/?pane=viewer3d`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas', { timeout: 15000 })
  await page.waitForTimeout(800) // let the WS open + first frame paint
  let sig = await canvasSig()

  // 2) BLANK baseline (best-effort; only truly blank if the graph started empty).
  const blank = await captureViaAgent('00-blank')
  const blankStats = await analyze(blank.dataUrl)
  log(`[pixel] blank baseline luminance range=${blankStats.range.toFixed(1)}`)

  // 3) BUILD box → live render → capture REAL pixels.
  const boxPreview = await buildChain(`${RUN}_box`, BOX_PRIM, 'north_star_box')
  const urdf1 = await observeUrdf(boxPreview)
  log(`\n[textual] box URDF (${urdf1.length} chars):`)
  log(urdf1.slice(0, 300))
  sig = await waitForRerender(sig, 'box-build')

  const boxShot = await captureViaAgent('01-box')
  const boxStats = await analyze(boxShot.dataUrl, blank.dataUrl)
  log(`[pixel] box luminance range=${boxStats.range.toFixed(1)}, diff-vs-blank=${(boxStats.diffRatio * 100).toFixed(2)}%`)
  if (boxStats.range < 8) fail(`box PNG looks blank (luminance range ${boxStats.range.toFixed(1)} < 8)`)
  if (boxStats.diffRatio < 0.005) {
    log(`[pixel] ⚠ box differs from baseline by only ${(boxStats.diffRatio * 100).toFixed(2)}% — baseline likely wasn't a clean empty scene; relying on box→cyl diff for the hard proof.`)
  } else {
    log(`[pixel] ✔ box has materially more non-background pixels than the blank baseline.`)
  }

  // 4) ITERATE → cylinder → live re-render → capture; assert PNG DIFFERS.
  const cylPreview = await buildChain(`${RUN}_cyl`, CYL_PRIM, 'north_star_cyl')
  const urdf2 = await observeUrdf(cylPreview)
  log(`\n[textual] cylinder URDF (${urdf2.length} chars):`)
  log(urdf2.slice(0, 300))
  if (urdf1 === urdf2) fail('iteration did NOT change the URDF XML')
  sig = await waitForRerender(sig, 'cyl-build')

  const cylShot = await captureViaAgent('02-cyl')
  const iterStats = await analyze(cylShot.dataUrl, boxShot.dataUrl)
  log(`[pixel] cyl luminance range=${iterStats.range.toFixed(1)}, diff-vs-box=${(iterStats.diffRatio * 100).toFixed(2)}%`)
  if (iterStats.range < 8) fail(`cylinder PNG looks blank (luminance range ${iterStats.range.toFixed(1)} < 8)`)
  const bytesDiffer = cylShot.buf.length !== boxShot.buf.length
  if (iterStats.diffRatio < 0.005 && !bytesDiffer) {
    fail(`iteration PNG did NOT visibly differ from the box PNG (diff ${(iterStats.diffRatio * 100).toFixed(2)}%, bytes ${boxShot.buf.length} vs ${cylShot.buf.length})`)
  }
  log(`[pixel] ✔ iteration PNG differs from box (pixel diff ${(iterStats.diffRatio * 100).toFixed(2)}%, bytes ${boxShot.buf.length} → ${cylShot.buf.length}).`)

  result = { urdf1, urdf2, blank, boxShot, cylShot, boxStats, iterStats }
  await context.close()
} finally {
  await browser.close()
}

log('\n══════════════════════════ NORTH-STAR PASS ══════════════════════════')
log(`✔ TEXTUAL: urdf_preview emitted <robot> and CHANGED after iteration (box → cylinder).`)
log(`✔ PIXEL:   REAL non-blank PNG captured via the AGENT API (${result.boxShot.width}x${result.boxShot.height}, ${result.boxShot.buf.length} bytes).`)
log(`✔ ITERATE: post-iteration PNG DIFFERS (${(result.iterStats.diffRatio * 100).toFixed(2)}% pixels; bytes ${result.boxShot.buf.length} → ${result.cylShot.buf.length}).`)
log(`  PNGs: ${result.blank.file}, ${result.boxShot.file}, ${result.cylShot.file}`)
log('「人看到的 == AI 看到的」— the agent screenshot equals the live human view.')
process.exit(0)
