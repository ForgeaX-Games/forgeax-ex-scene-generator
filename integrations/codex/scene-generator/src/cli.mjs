#!/usr/bin/env node
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { run } from '../../../../extensions/scene-generator/cli.ts'
import { configuration, request } from '../../../../extensions/scene-generator/src/client.ts'
import { installCodex } from './install.mjs'
import { location, serviceStatus, startService, stopService } from './service.mjs'
import { command } from './runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const parsed = parseArgs({ options: { workspace: { type: 'string' }, json: { type: 'boolean' } }, strict: false, allowPositionals: true, tokens: true })
const consumed = new Set()
for (const token of parsed.tokens) {
  if (token.kind !== 'option' || token.name !== 'workspace') continue
  consumed.add(token.index)
  if (!token.inlineValue) consumed.add(token.index + 1)
}
const args = process.argv.slice(2).filter((_, index) => !consumed.has(index))
const workspace = resolve(parsed.values.workspace ?? process.cwd())
const [action, ...rest] = args

async function main() {
  if (action === 'install') return installCodex(root)
  if (action === 'start') return startService(root, workspace)
  if (action === 'status') return serviceStatus(workspace)
  if (action === 'stop') return stopService(workspace)
  if (action === 'open') {
    const service = await startService(root, workspace)
    const executable = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open'
    await command(executable, [service.uiUrl])
    return service
  }
  const state = await serviceStatus(workspace)
  if (!state.running) throw new Error('Scene Generator is stopped; run the start command')
  if (action === 'view' || action === 'completion') {
    const values = parseArgs({ args: rest, options: { project: { type: 'string' }, json: { type: 'boolean' } } }).values
    if (!values.project) throw new Error('--project is required')
    const prefix = `/api/v1/projects/${encodeURIComponent(values.project)}`
    const config = configuration({ baseUrl: state.baseUrl })
    if (action === 'completion') {
      const response = await fetch(`${config.baseUrl}${prefix}/scene-script/completion`, { signal: AbortSignal.timeout(30_000) })
      const result = await response.json()
      if (!response.ok) throw new Error(`Scene completion returned HTTP ${response.status}: ${JSON.stringify(result)}`)
      return result
    }
    await request(config, `${prefix}/view`, {})
    const uiUrl = new URL(state.uiUrl)
    uiUrl.searchParams.set('projectId', values.project)
    return { projectId: values.project, uiUrl: uiUrl.href }
  }
  const context = await location(workspace)
  return run({ projectRoot: process.cwd(), stateDir: context.stateDir, packageVersion: state.version }, args)
}

console.log(JSON.stringify({ ok: true, value: await main() }))
