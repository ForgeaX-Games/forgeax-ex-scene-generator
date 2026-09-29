import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import lockfile from 'proper-lockfile'
import { command } from './runtime.mjs'

export async function installCodex(root) {
  const home = homedir()
  const marketplaceDir = join(home, '.agents', 'plugins')
  const marketplacePath = join(marketplaceDir, 'marketplace.json')
  const destination = join(home, 'plugins', 'scene-generator')
  await mkdir(marketplaceDir, { recursive: true })
  const release = await lockfile.lock(marketplaceDir)
  try {
    let marketplace
    try { marketplace = JSON.parse(await readFile(marketplacePath, 'utf8')) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      marketplace = { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] }
    }
    if (!/^[A-Za-z0-9_-]+$/.test(marketplace.name) || !Array.isArray(marketplace.plugins)) throw new Error('Invalid personal Codex marketplace')
    const existing = marketplace.plugins.find(plugin => plugin.name === 'scene-generator')
    if (existing && (existing.source.source !== 'local' || existing.source.path !== './plugins/scene-generator')) throw new Error('Scene Generator already refers to a different marketplace source')
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    await mkdir(destination, { recursive: true })
    if (resolve(root) !== destination) {
      for (const file of ['package.json', ...pkg.files]) {
        await rm(join(destination, file), { recursive: true, force: true })
        await cp(join(root, file), join(destination, file), { recursive: true })
      }
    }
    if (!existing) {
      marketplace.plugins.push({ name: 'scene-generator', source: { source: 'local', path: './plugins/scene-generator' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' })
      await writeFile(marketplacePath, JSON.stringify(marketplace, null, 2) + '\n')
    }
    const result = await command('codex', ['plugin', 'add', `scene-generator@${marketplace.name}`, '--json'])
    return { ...JSON.parse(result), marketplacePath, source: destination }
  } finally {
    await release()
  }
}
