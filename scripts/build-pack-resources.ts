import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildPlatformClosure, portableLibraryNames } from '../apps/composition/backend/src/pack-export/vendorClosure.js'

const destination = process.argv[2]
if (!destination) throw new Error('Expected the Pack resource destination')
const closure = buildPlatformClosure(portableLibraryNames())
mkdirSync(destination, { recursive: true })
writeFileSync(resolve(destination, 'platform.json'), JSON.stringify({
  files: [...closure.files], barrel: closure.barrel, imported: closure.imported,
}) + '\n')
console.log(`[release] Pack resources: ${closure.imported.length} exports, ${closure.sourceFileCount} source files`)
