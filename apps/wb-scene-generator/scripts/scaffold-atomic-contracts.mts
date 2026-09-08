import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(here, '..')
const nodeEditorRoot = resolve(appRoot, '..', '..')
const roots = [
  resolve(nodeEditorRoot, 'packages', 'batteries-common', 'batteries', 'common'),
  // Group/Template Definitions may depend on components and scene30 batteries
  // outside the user-facing migration categories. Include every runtime atomic
  // so a native Definition never needs a legacy Contract fallback.
  resolve(appRoot, 'batteries'),
]

interface MetaPort {
  name?: string
  type?: string
  access?: 'item' | 'list' | 'tree'
  required?: boolean
  default?: unknown
  description?: string
  'description-en'?: string
  label?: string
  options?: string[]
}

interface Meta {
  id?: string
  version?: string
  description?: string
  'description-en'?: string
  inputs?: MetaPort[]
  outputs?: MetaPort[]
  params?: MetaPort[]
}

const functionNames: Record<string, string> = {
  empty_scene: 'emptyScene',
  number_const: 'numberValue',
  type_string: 'stringValue',
  toggle: 'booleanValue',
  seed_control: 'seed',
  manual_points: 'manualPoint',
  rect_grid: 'rectangularGrid',
  grid2node: 'gridSceneNode',
  add_child: 'addSceneChildren',
  scene_output: 'sceneOutput',
  scene_focus_path: 'sceneFocusPath',
  scene_passthrough: 'scenePassthrough',
  scene_set_attribute: 'sceneSetAttribute',
  text_panel: 'textPanel',
}

const compilerOnly = new Set(['scene_focus_path', 'scene_passthrough', 'scene_set_attribute', 'text_panel'])

function lowerCamel(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const [first = 'battery', ...rest] = words
  return first.toLowerCase() + rest.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
}

function contractPort(port: MetaPort, parameter = false): Record<string, unknown> {
  return {
    name: port.name ?? 'value',
    type: port.type ?? 'any',
    ...(port.access ? { access: port.access } : {}),
    ...(port.required !== undefined ? { required: port.required } : {}),
    ...(Object.hasOwn(port, 'default') ? { defaultValue: port.default } : {}),
    ...(port['description-en'] || port.description ? { description: port['description-en'] ?? port.description } : {}),
    ...(port.label ? { label: port.label } : {}),
    ...(port.options ? { options: port.options } : {}),
    ...(parameter ? { mode: 'parameter' } : {}),
  }
}

async function collectMeta(dir: string, output: string[]): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) await collectMeta(path, output)
    else if (entry.isFile() && entry.name === 'meta.json') output.push(path)
  }
}

function standardDefinition(meta: Meta): Record<string, unknown> {
  const opId = meta.id!
  if (opId === 'text_panel') {
    return {
      functionName: 'textPanel',
      contractVersion: meta.version ?? '1.0.0',
      opId,
      description: meta['description-en'] ?? meta.description ?? 'Literal text panel.',
      agentVisible: false,
      definitionScope: 'group-body',
      runtimeDefaults: { contractAdapter: 'text-panel-param' },
      inputs: [{ name: 'text', type: 'string', required: true, mode: 'parameter' }],
      outputs: [{ name: 'output', type: 'string', access: 'item' }],
      deterministic: true,
    }
  }
  const inputs = [
    ...(meta.inputs ?? []).map((port) =>
      contractPort(port, ['number', 'string', 'boolean'].includes(port.type ?? ''))),
    ...(meta.params ?? []).map((port) => contractPort(port, true)),
  ]
  return {
    functionName: functionNames[opId] ?? lowerCamel(opId),
    contractVersion: meta.version ?? '1.0.0',
    opId,
    description: meta['description-en'] ?? meta.description ?? `Scene Script contract for ${opId}.`,
    ...(compilerOnly.has(opId) ? { agentVisible: false, definitionScope: 'group-body' } : {}),
    inputs,
    outputs: (meta.outputs ?? []).map((port) => contractPort(port)),
    deterministic: true,
  }
}

function treeMergeDefinitions(meta: Meta): Array<Record<string, unknown>> {
  return [
    ['mergePoints', 'point2d', 'item'],
    ['mergeScenes', 'scene', 'tree'],
    ['mergeStrings', 'string', 'tree'],
    ['mergeNumbers', 'number', 'item'],
  ].map(([functionName, type, access]) => ({
    functionName,
    contractVersion: meta.version ?? '1.0.0',
    opId: meta.id,
    description: `Merge multiple ${type} values into one typed DataTree.`,
    runtimeDefaults: { inferredAccess: access, inferredType: type, portCount: 1 },
    inputs: [{ name: 'items', type, access, required: true, runtimePort: 'item' }],
    outputs: [{ name: 'tree', type, access: 'tree' }],
    deterministic: true,
  }))
}

const metaFiles: string[] = []
for (const root of roots) await collectMeta(root, metaFiles)
for (const metaPath of metaFiles.sort()) {
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as Meta
  if (!meta.id) throw new Error(`${metaPath}: meta.json id is required`)
  const definitions = meta.id === 'tree_merge' ? treeMergeDefinitions(meta) : [standardDefinition(meta)]
  const body = definitions.length === 1
    ? `defineAtomic(${JSON.stringify(definitions[0], null, 2)})`
    : `[\n${definitions.map((item) => `  defineAtomic(${JSON.stringify(item, null, 2).replace(/\n/g, '\n  ')})`).join(',\n')}\n]`
  const source = `// Generated from sibling meta.json; edit deliberately and keep parity.\nimport { defineAtomic } from '@forgeax/scene-authoring'\n\nexport default ${body}\n`
  await writeFile(resolve(dirname(metaPath), 'scene.contract.ts'), source)
}

console.log(JSON.stringify({ generated: metaFiles.length, roots }, null, 2))
