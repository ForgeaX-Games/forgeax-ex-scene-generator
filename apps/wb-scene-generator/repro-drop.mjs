import { chromium } from 'playwright'

const URL = process.env.APP_URL || 'http://127.0.0.1:9555/'
const ONLY = process.env.ONLY // optional battery id to test

const browser = await chromium.launch()
const page = await browser.newPage()
const logs = []
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`))

await page.goto(URL, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.react-flow__pane', { timeout: 20000 }).catch(() => {})
await page.waitForTimeout(3000)

// Enumerate all battery-row payloads by dispatching dragstart on each row.
const batteries = await page.evaluate(() => {
  const out = []
  const rows = [...document.querySelectorAll('.battery-row[draggable="true"]')]
  for (const row of rows) {
    const dt = new DataTransfer()
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
    const b = dt.getData('application/battery')
    if (b) { try { const o = JSON.parse(b); out.push({ id: o.id, type: o.type, nodeType: o.nodeType, name: o.name }) } catch {} }
  }
  // de-dup by id
  const seen = new Set(); return out.filter(x => !seen.has(x.id) && seen.add(x.id))
})
console.log('battery count:', batteries.length)
console.log(batteries.map(b => `${b.id}(${b.type}/${b.nodeType||'-'})`).join(', '))

async function dropAndCheck(batteryId) {
  const res = await page.evaluate(async (targetId) => {
    const rows = [...document.querySelectorAll('.battery-row[draggable="true"]')]
    let row = null, dt = null
    for (const r of rows) {
      const d = new DataTransfer()
      r.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: d }))
      const b = d.getData('application/battery')
      if (b && JSON.parse(b).id === targetId) { row = r; dt = d; break }
    }
    if (!row) return { ok: false, reason: 'row not found' }
    const pane = document.querySelector('.react-flow__pane')
    const rect = pane.getBoundingClientRect()
    const cx = rect.left + rect.width / 2 + (Math.random()*100-50)
    const cy = rect.top + rect.height / 2 + (Math.random()*100-50)
    const mk = (t) => new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: cx, clientY: cy })
    pane.dispatchEvent(mk('dragenter'))
    pane.dispatchEvent(mk('dragover'))
    pane.dispatchEvent(mk('drop'))
    return { ok: true }
  }, batteryId)
  if (!res.ok) return `${batteryId}: SKIP (${res.reason})`
  // responsiveness probe
  try {
    await Promise.race([
      page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(1)))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('t')), 6000)),
    ])
    const n = await page.$$eval('.react-flow__node', els => els.length)
    return `${batteryId}: OK responsive, nodes=${n}`
  } catch {
    return `${batteryId}: *** FROZEN ***`
  }
}

const targets = ONLY ? [ONLY] : batteries.slice(0, 40).map(b => b.id)
for (const id of targets) {
  const line = await dropAndCheck(id)
  console.log(line)
  if (line.includes('FROZEN')) { console.log('STOP: froze on', id); break }
}

await page.waitForTimeout(500)
console.log('=== LOGS (tail) ===')
console.log(logs.slice(-30).join('\n'))
await browser.close()
