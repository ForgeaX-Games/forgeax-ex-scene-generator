import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { parseArgs, type ParseArgsConfig } from 'node:util'
import { configuration, inspectService, request, type ExtensionContext } from './src/client.js'
import { buildEnginePack, engineRelease } from './src/engine.js'

function options(args: readonly string[], names: readonly string[]) {
  const definitions: NonNullable<ParseArgsConfig['options']> = { json: { type: 'boolean' } }
  for (const name of names) definitions[name] = { type: 'string' }
  try {
    const parsed = parseArgs({ args: [...args], options: definitions, strict: true, allowPositionals: false })
    return parsed.values as Record<string, string | undefined>
  } catch {
    throw new Error(`scene_arguments_invalid: expected named options ${[...names, 'json'].map(name => `--${name}`).join(', ')}`)
  }
}

function required(values: Record<string, string | undefined>, name: string): string {
  const value = values[name]
  if (!value?.trim()) throw new Error(`scene_argument_required: --${name} is required`)
  return value
}

async function readJson(context: ExtensionContext, file: string): Promise<Record<string, unknown>> {
  const data = JSON.parse(await readFile(resolve(context.projectRoot, file), 'utf8'))
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('scene_input_invalid: JSON input must be an object')
  return data
}

export async function check(_context: ExtensionContext, args: readonly string[]) {
  const values = options(args, ['base-url'])
  const config = configuration({
    baseUrl: values['base-url'] ?? process.env.FORGEAX_SCENE_BACKEND_URL ?? 'http://127.0.0.1:9557',
  })
  await inspectService(config)
  return config
}

const commandOptions: Record<string, readonly string[]> = {
  doctor: [], projects: [], create: ['name'], info: ['project'],
  read: ['project', 'file'], contracts: ['project', 'functions'],
  validate: ['project', 'file', 'source'], commit: ['project', 'input'],
  execute: ['project'], export: ['project', 'out', 'options'], publish: ['project', 'out', 'options'],
}

export async function run(context: ExtensionContext, args: readonly string[]) {
  const [command, ...rest] = args
  if (!command || !Object.hasOwn(commandOptions, command)) {
    throw new Error(`scene_command_unknown: choose ${Object.keys(commandOptions).join(', ')}`)
  }
  const values = options(rest, commandOptions[command]!)
  const config = configuration(JSON.parse(await readFile(resolve(context.stateDir, 'config.json'), 'utf8')))
  if (command === 'doctor') return inspectService(config)
  if (command === 'projects') return request(config, '/api/v1/projects?all=1')
  if (command === 'create') return request(config, '/api/v1/projects', { name: required(values, 'name') })

  const project = required(values, 'project')
  const prefix = `/api/v1/projects/${encodeURIComponent(project)}`
  const scene = `${prefix}/scene-script`
  if (command === 'info') return request(config, `${scene}/project-info`)
  if (command === 'read') return request(config, `${scene}?${new URLSearchParams({ file: values.file ?? 'main.scene.ts' })}`)
  if (command === 'contracts') {
    const query = new URLSearchParams({ audience: 'sino', mode: values.functions ? 'detail' : 'summary' })
    if (values.functions) query.set('functionNames', values.functions)
    return request(config, `${scene}/contracts?${query}`)
  }
  if (command === 'validate') {
    const source = await readFile(resolve(context.projectRoot, required(values, 'source')), 'utf8')
    return request(config, `${scene}/validate`, { file: values.file ?? 'main.scene.ts', source })
  }
  if (command === 'commit') {
    const input = await readJson(context, required(values, 'input'))
    if (typeof input.expectedProjectRevision !== 'string' || !input.expectedProjectRevision) {
      throw new Error('scene_revision_required: commit input must include expectedProjectRevision from info')
    }
    return request(config, `${scene}/commit`, input)
  }
  if (command === 'execute') return request(config, `${prefix}/execute/summary`, {})

  const assets = resolve(context.projectRoot, 'assets')
  const destination = resolve(context.projectRoot, required(values, 'out'))
  const path = relative(assets, destination)
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`)) {
    throw new Error('scene_output_invalid: --out must name a directory inside this game project assets directory')
  }
  const input = values.options ? await readJson(context, values.options) : {}
  if (command === 'publish') {
    await engineRelease(context.projectRoot)
    if (input.schemaVersion !== undefined && input.schemaVersion !== '2.0.0') {
      throw new Error('scene_engine_schema: Engine 0.2.1 requires ScriptablePack 2.0.0')
    }
  }
  const exported = await request(config, `${prefix}/pack-export/cook`, { ...input, projectId: project, destination })
  if (command === 'export') return exported
  const sourcePath = relative(context.projectRoot, resolve(exported.path, exported.packFile)).split(sep).join('/')
  const engine = await buildEnginePack(context.projectRoot, sourcePath, exported.sceneGuid)
  return { ...exported, sceneGuid: engine.sceneGuid, engine }
}
