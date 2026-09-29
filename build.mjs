import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = import.meta.dirname
const source = resolve(root, 'extensions/scene-generator')
const destination = resolve(root, 'dist/extensions/scene-generator')
const manifest = JSON.parse(await readFile(resolve(source, 'extension.json'), 'utf8'))
const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
if (manifest.schemaVersion !== 1 || manifest.id !== 'scene-generator' ||
    manifest.version !== pkg.version || manifest.cli !== 'cli.mjs') {
  throw new Error('Scene Generator extension manifest disagrees with the package identity')
}
// The repository's dist symlink targets the composition frontend build directory.
await mkdir(resolve(root, 'apps/composition/frontend/dist'), { recursive: true })
await mkdir(destination, { recursive: true })
const result = await Bun.build({
  entrypoints: [resolve(source, 'cli.ts')], outdir: destination,
  naming: 'cli.mjs', target: 'node', format: 'esm',
})
if (!result.success) throw new Error(result.logs.join('\n'))
await copyFile(resolve(source, 'extension.json'), resolve(destination, 'extension.json'))
for (const skill of manifest.skills) {
  if (!/^skills\/[a-z][a-z0-9-]*$/.test(skill)) throw new Error('Invalid extension skill path')
  await mkdir(resolve(destination, skill), { recursive: true })
  await cp(resolve(source, skill), resolve(destination, skill), { recursive: true })
  const entry = await readFile(resolve(source, skill, 'SKILL.md'), 'utf8')
  const referenceLink = '[Authoring workflow](references/authoring.md)'
  if (!entry.includes(referenceLink)) throw new Error('The standard Skill must include its authoring workflow')
  const workflow = await readFile(resolve(source, skill, 'references/authoring.md'), 'utf8')
  await writeFile(resolve(destination, skill, 'SKILL.md'), entry.replace(referenceLink, workflow))
}
console.log('Built dist/extensions/scene-generator')
