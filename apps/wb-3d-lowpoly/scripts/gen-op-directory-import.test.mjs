import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDir = dirname(fileURLToPath(import.meta.url))

test('gen-op-directory imports the generated registry through a file URL', async () => {
  const source = await readFile(join(scriptsDir, 'gen-op-directory.mjs'), 'utf8')

  assert.match(
    source,
    /import \{ fileURLToPath, pathToFileURL \} from 'node:url'/,
    'the script must expose the platform-aware path-to-URL conversion',
  )
  assert.match(
    source,
    /await import\(pathToFileURL\(join\(appRoot, 'vendor\/dist\/shared\/types\/index\.js'\)\)\.href\)/,
    'the generated registry must be dynamically imported with a file URL',
  )
})
