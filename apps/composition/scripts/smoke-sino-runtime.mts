#!/usr/bin/env tsx
import { homedir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const studioRoot = resolve(pluginRoot, '../../../../../..')
const server = (process.env.FORGEAX_SERVER_URL ?? 'http://127.0.0.1:18900').replace(/\/+$/, '')
const userDir = process.env.FORGEAX_USER_DIR?.trim() || join(homedir(), '.forgeax')
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR
  ?? resolve(pluginRoot, '.cache', 'acceptance', `sino-runtime-${stamp}`)
mkdirSync(evidenceDir, { recursive: true })

function wireName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function expectedSceneTools(): string[] {
  const plugin = JSON.parse(readFileSync(resolve(pluginRoot, 'forgeax-plugin.json'), 'utf8')) as {
    contributes: { agents: Array<{ id: string; tools: string[] }> }
  }
  const sino = plugin.contributes.agents.find((agent) => agent.id === 'sino')
  if (!sino) throw new Error('sino agent missing from forgeax-plugin.json')
  return [...sino.tools]
}

async function requestJson(path: string, init?: RequestInit): Promise<{ status: number; ok: boolean; body: unknown }> {
  const response = await fetch(`${server}${path}`, init)
  const text = await response.text()
  let body: unknown = null
  if (text.trim()) {
    try { body = JSON.parse(text) } catch { body = text }
  }
  return { status: response.status, ok: response.ok, body }
}

function walkFiles(root: string, acc: string[] = [], depth = 0): string[] {
  if (depth > 8 || !existsSync(root)) return acc
  let entries: string[] = []
  try { entries = readdirSync(root) } catch { return acc }
  for (const name of entries) {
    const full = join(root, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) walkFiles(full, acc, depth + 1)
    else acc.push(full)
  }
  return acc
}

function collectManifestTools(sid: string): string[] {
  const files = walkFiles(userDir).concat(walkFiles(resolve(studioRoot, '.forgeax')))
    .filter((file) => file.includes(sid) && file.includes(`${join('agents', 'sino')}`) && file.endsWith('.jsonl'))
  const names = new Set<string>()
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (const line of lines) {
      if (!line.includes('x.tools.manifest')) continue
      try {
        const event = JSON.parse(line) as { type?: string; payload?: { tools?: Array<{ name?: string }> } }
        if (event.type !== 'x.tools.manifest') continue
        for (const tool of event.payload?.tools ?? []) {
          if (typeof tool.name === 'string') names.add(tool.name)
        }
      } catch { /* skip */ }
    }
  }
  return [...names]
}

function collectAllowlist(sid: string): string[] {
  const files = walkFiles(userDir).concat(walkFiles(resolve(studioRoot, '.forgeax')))
    .filter((file) => file.includes(sid) && file.endsWith(`${join('sino', 'agent.json')}`))
  for (const file of files) {
    try {
      const json = JSON.parse(readFileSync(file, 'utf8')) as {
        kits?: { config?: { ['host-tools']?: { allow?: string[] } } }
      }
      const allow = json.kits?.config?.['host-tools']?.allow
      if (Array.isArray(allow) && allow.length) return allow
    } catch { /* skip */ }
  }
  return []
}

const expected = expectedSceneTools()
const expectedWire = expected.map(wireName)
const failures: string[] = []

let health
try {
  health = await requestJson('/api/health')
} catch (error) {
  writeFileSync(resolve(evidenceDir, 'runtime.json'), `${JSON.stringify({
    ok: false,
    error: `Studio not reachable at ${server}: ${error instanceof Error ? error.message : String(error)}`,
    evidenceDir,
  }, null, 2)}\n`)
  console.error(`[accept:sino-runtime] Studio is not running at ${server}. Restart from this checkout, then re-run.`)
  process.exit(2)
}

if (!health.ok) {
  failures.push(`GET /api/health HTTP ${health.status}`)
}

await requestJson('/api/extensions/reload', { method: 'POST' })

const catalog = await requestJson('/api/tools')
const catalogTools = Array.isArray((catalog.body as { tools?: Array<{ id?: string; exposedToAI?: boolean }> })?.tools)
  ? (catalog.body as { tools: Array<{ id: string; exposedToAI?: boolean }> }).tools
  : []
const sceneCatalog = catalogTools.filter((tool) => tool.id.startsWith('scene:') && tool.exposedToAI)
const sceneCatalogIds = sceneCatalog.map((tool) => tool.id).sort()
if (sceneCatalogIds.join() !== [...expected].sort().join()) {
  failures.push(`GET /api/tools Scene exposedToAI mismatch: ${sceneCatalogIds.join(', ')}`)
}
if (sceneCatalogIds.includes('scene:script.completion')) {
  failures.push('GET /api/tools still exposes scene:script.completion')
}

const created = await requestJson('/api/sessions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    displayName: `sino-runtime-${stamp}`,
    autoStart: true,
    bootstrapAgent: 'sino',
  }),
})
const sid = created.ok && created.body && typeof created.body === 'object'
  ? String((created.body as { sid?: unknown }).sid ?? '')
  : ''
if (!sid) failures.push(`POST /api/sessions failed: ${JSON.stringify(created.body)}`)

if (sid) {
  await requestJson(`/api/sessions/${encodeURIComponent(sid)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      to: 'sino',
      content: 'Do not mutate any scene. Confirm your Scene tool names, then stop.',
    }),
  })
}

let allow = sid ? collectAllowlist(sid) : []
let manifest = sid ? collectManifestTools(sid) : []
const deadline = Date.now() + 45_000
while (sid && Date.now() < deadline && (allow.length === 0 || manifest.length === 0)) {
  await new Promise((resolveWait) => setTimeout(resolveWait, 1000))
  if (allow.length === 0) allow = collectAllowlist(sid)
  if (manifest.length === 0) manifest = collectManifestTools(sid)
}

if (allow.length) {
  const missing = expected.filter((id) => !allow.includes(id))
  const extra = allow.filter((id) => id.startsWith('scene:') && !expected.includes(id))
  if (missing.length) failures.push(`new session allowlist missing ${missing.join(', ')}`)
  if (extra.length) failures.push(`new session allowlist extra ${extra.join(', ')}`)
  if (allow.includes('scene:script.completion')) failures.push('new session allowlist still has scene:script.completion')
} else {
  failures.push('could not read new session sino agent.json host-tools.allow — plugin reload/session scaffold failed')
}

const sceneManifest = manifest.filter((name) => name.startsWith('scene_'))
if (manifest.length > 0) {
  const missingWire = expectedWire.filter((name) => !sceneManifest.includes(name))
  if (missingWire.length) failures.push(`x.tools.manifest missing ${missingWire.join(', ')}`)
  if (sceneManifest.includes('scene_script_completion')) {
    failures.push('x.tools.manifest still contains scene_script_completion — runtime is an old plugin snapshot')
  }
  for (const required of ['scene_script_verify', 'scene_authoring_lens', 'scene_authoring_applyCommands']) {
    if (!sceneManifest.includes(required)) failures.push(`x.tools.manifest missing ${required}`)
  }
} else {
  failures.push('x.tools.manifest was not written for the new Sino session; a real turn is required after restart')
}

const catalogSource = readFileSync(resolve(pluginRoot, 'backend/src/scene-script/contracts/agentContractCatalog.ts'), 'utf8')
const sourceVersion = /SINO_CATALOG_VERSION = '([^']+)'/.exec(catalogSource)?.[1]
if (sourceVersion !== '1.0') failures.push(`catalog source version ${sourceVersion}, expected 1.0`)

const contracts = await requestJson('/api/tools/call', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    toolId: 'scene:script.contracts',
    args: { projectId: 'main', mode: 'summary' },
    caller: { kind: 'user', agentId: 'runtime-accept', sessionId: sid || 'runtime-accept' },
  }),
})
const contractBody = contracts.body && typeof contracts.body === 'object'
  ? (contracts.body as { result?: { version?: string }; version?: string })
  : {}
const version = contractBody.result?.version ?? contractBody.version
if (version && version !== '1.0') failures.push(`catalog version ${version}, expected 1.0`)

const evidence = {
  ok: failures.length === 0,
  server,
  sid,
  expected,
  expectedWire,
  sceneCatalogIds,
  allow,
  sceneManifest,
  catalogVersion: version ?? null,
  failures,
  evidenceDir,
  at: new Date().toISOString(),
}
writeFileSync(resolve(evidenceDir, 'runtime.json'), `${JSON.stringify(evidence, null, 2)}\n`)
if (sid) {
  await requestJson(`/api/sessions/${encodeURIComponent(sid)}`, { method: 'DELETE' }).catch(() => undefined)
}

if (failures.length) {
  console.error(`[accept:sino-runtime] FAILED\n${failures.map((item) => `- ${item}`).join('\n')}\nEvidence: ${evidenceDir}`)
  process.exit(1)
}
console.log(`[accept:sino-runtime] OK sid=${sid} catalog=${version} evidence=${evidenceDir}`)
