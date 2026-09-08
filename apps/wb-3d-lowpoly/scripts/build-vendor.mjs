// Compile the vendored shared/types TS source into ESM .js so that the
// battery .ts files (loaded raw by the kernel via Node type-stripping) can
// resolve their `shared/types/index.js` imports at runtime. Node's
// type-stripping does not map .js specifiers to .ts, so this lib must be
// emitted as real .js. Output lives under vendor/dist (gitignored).
import { execSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'

// app root = this script's dir (scripts/) up one level — cwd-independent so this
// works whether invoked from the app root or as the backend's prebuild step.
const appRoot = resolve(import.meta.dirname, '..')

rmSync(resolve(appRoot, 'vendor/dist/shared/types'), { recursive: true, force: true })

const tsc = 'bun x tsc'
const cmd = [
  tsc,
  '--module nodenext --moduleResolution nodenext --target es2022',
  '--skipLibCheck --declaration true --noEmitOnError false',
  '--rootDir vendor/shared/types --outDir vendor/dist/shared/types',
  'vendor/shared/types/index.ts',
].join(' ')

execSync(cmd, { stdio: 'inherit', cwd: appRoot })
console.log('[build-vendor] OK — vendor/dist/shared/types compiled')

// Regenerate the compact DSL op directory (SSOT: the freshly-built op-registry)
// so the compose skill never drifts from the registry.
execSync('node scripts/gen-op-directory.mjs', { stdio: 'inherit', cwd: appRoot })
