import spawn from 'cross-spawn'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

export async function command(executable, args, options = {}) {
  const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options })
  let output = ''
  let diagnostics = ''
  child.stdout.on('data', chunk => { output += chunk; diagnostics += chunk; process.stderr.write(chunk) })
  child.stderr.on('data', chunk => { diagnostics += chunk; process.stderr.write(chunk) })
  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`${executable} exited ${code}: ${diagnostics}`)))
  })
  return output
}

export async function prepareRuntime(root) {
  const release = await lockfile.lock(root, { retries: { retries: 120, minTimeout: 250, maxTimeout: 1000 } })
  try {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const require = createRequire(join(root, 'package.json'))
    const missing = Object.keys(pkg.dependencies).filter(name => {
      try { require.resolve(name); return false } catch (error) {
        if (error.code === 'MODULE_NOT_FOUND') return true
        throw error
      }
    })
    if (missing.length) {
      await command('npm', ['install', '--prefix', root, '--workspaces=false', '--omit=dev', '--no-audit', '--no-fund'], { cwd: root })
    }
    await command('bun', ['--version'], { cwd: root })
  } finally {
    await release()
  }
}
