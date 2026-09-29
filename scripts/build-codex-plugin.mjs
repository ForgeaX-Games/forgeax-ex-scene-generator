import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function buildCodexPlugin(root, destination) {
  const source = join(root, 'integrations/codex/scene-generator')
  const manifest = JSON.parse(readFileSync(join(source, '.codex-plugin/plugin.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  if (manifest.name !== 'scene-generator' || manifest.version !== pkg.version) throw new Error('Codex plugin identity disagrees with the package')
  mkdirSync(join(destination, 'codex'), { recursive: true })
  execFileSync('bun', ['build', join(source, 'src/cli.mjs'), '--outfile', join(destination, 'codex/cli.mjs'), '--target=node', '--format=esm'], { cwd: root, stdio: 'inherit' })
  cpSync(join(source, 'skills'), join(destination, 'skills'), { recursive: true })
  const reference = 'extensions/scene-generator/skills/scene-generator-authoring/references/authoring.md'
  mkdirSync(join(destination, 'skills/scene-build/references'), { recursive: true })
  cpSync(join(root, reference), join(destination, 'skills/scene-build/references/authoring.md'))
  const hash = createHash('sha256').update(JSON.stringify(manifest))
  for (const file of ['package.json', 'serve.mjs', 'README.md', 'forgeax-extension.json']) hash.update(readFileSync(join(destination, file)))
  for (const directory of ['codex', 'skills', 'modules', 'extensions', 'schemas']) hashDirectory(hash, destination, directory)
  manifest.version = `${pkg.version}+codex.${hash.digest('hex').slice(0, 12)}`
  mkdirSync(join(destination, '.codex-plugin'), { recursive: true })
  writeFileSync(join(destination, '.codex-plugin/plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
  const portable = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: manifest.name, version: manifest.version, description: manifest.description,
    author: manifest.author, repository: manifest.repository, license: manifest.license,
    extensions: { 'com.openai': { interface: manifest.interface } },
  }
  writeFileSync(join(destination, 'plugin.json'), JSON.stringify(portable, null, 2) + '\n')
}

function hashDirectory(hash, root, directory) {
  const entries = readdirSync(join(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const file = `${directory}/${entry.name}`
    if (entry.isDirectory()) hashDirectory(hash, root, file)
    else hash.update(file).update('\0').update(readFileSync(join(root, file)))
  }
}
