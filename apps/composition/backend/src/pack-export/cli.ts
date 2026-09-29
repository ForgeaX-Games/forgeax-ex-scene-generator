import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { exportSceneModulePack } from './moduleExport.js'

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    entry: { type: 'string', default: 'main.scene.ts' },
    export: { type: 'string' },
    args: { type: 'string', default: '[]' },
    out: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    config: { type: 'string' },
    lighting: { type: 'boolean', default: false },
  },
})
if (!values.project || !values.out || !values.id)
  throw new Error(
    'Usage: bun run pack:scene --project <scene-source-dir> --entry house.scene.ts --export house --args "[{}]" --out <directory> --id <stable-package-uuid> [--config parameters.json]',
  )
const config = values.config
  ? JSON.parse(await readFile(values.config, 'utf8'))
  : {}
const result = await exportSceneModulePack({
  ...config,
  sourceDir: resolve(values.project),
  entryFile: values.entry!,
  exportName: values.export,
  args: JSON.parse(values.args!),
  destination: resolve(values.out),
  packageId: values.id,
  projectName: values.name,
  includeDefaultLighting: values.lighting,
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
