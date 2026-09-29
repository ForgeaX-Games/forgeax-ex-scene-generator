// Compile the vendored shared/types TS source into ESM .js so that the
// battery .ts files (loaded raw by the kernel via Node type-stripping) can
// resolve their `shared/types/index.js` imports at runtime. Node's
// type-stripping does not map .js specifiers to .ts, so this lib must be
// emitted as real .js. Output lives under vendor/dist (gitignored).
//
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// app root = this script's dir (scripts/) up one level — cwd-independent so this
// works whether invoked from the app root or as the backend's prebuild step.
const appRoot = resolve(import.meta.dirname, '..')

const tsc = 'bun x tsc'
const sharedTypesOut = resolve(appRoot, 'vendor/dist/shared/types')
const cmd = [
  tsc,
  // Plain ESM emit (esnext + bundler) — nodenext without package "type":"module"
  // previously produced CJS __exportStar(require(...)) which Rollup cannot tree-shake.
  '--module esnext --moduleResolution bundler --target es2022',
  '--skipLibCheck --declaration true --noEmitOnError false',
  '--rootDir vendor/shared/types --outDir vendor/dist/shared/types',
  // index.ts = the v3 barrel (graph/volume/port/summary/projection).
  // tree.ts is a second, deliberately NOT-barrel-exported entry point — the old
  // nested-tree implementation is kept alive solely for backend/src/baked/store.ts.
  'vendor/shared/types/index.ts',
  'vendor/shared/types/scene/tree.ts',
  'vendor/shared/types/scene/heightfieldField.ts',
].join(' ')

execSync(cmd, { stdio: 'inherit', cwd: appRoot })

// Bundler emit may keep relative imports extensionless; Node ESM needs .js.
const addJsExtensions = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) { addJsExtensions(full); continue }
    if (!entry.name.endsWith('.js')) continue
    const src = readFileSync(full, 'utf8')
    const fixed = src.replace(
      /((?:from|import)\s*\(?\s*['"])(\.\.?\/[^'"]*?)(['"])/g,
      (m, pre, spec, post) => (/\.[a-zA-Z0-9]+$/.test(spec) ? m : `${pre}${spec}.js${post}`),
    )
    if (fixed !== src) writeFileSync(full, fixed)
  }
}
addJsExtensions(sharedTypesOut)
writeFileSync(resolve(sharedTypesOut, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`)

const sceneTypes = await import(
  `${pathToFileURL(resolve(sharedTypesOut, 'scene', 'index.js')).href}?build=${Date.now()}`,
)
if (typeof sceneTypes.cellCount !== 'function') {
  throw new Error('vendor scene barrel must expose cellCount as an ESM named export')
}
const heightfieldField = await import(
  `${pathToFileURL(resolve(sharedTypesOut, 'scene', 'heightfieldField.js')).href}?build=${Date.now()}`,
)
if (typeof heightfieldField.unwrapHeightfield !== 'function' || typeof heightfieldField.sampleHeightfieldWorld !== 'function') {
  throw new Error('vendor heightfield field helpers must compile as ESM named exports')
}
const surfacePaint = await import(
  `${pathToFileURL(resolve(sharedTypesOut, 'scene', 'surfacePaint.js')).href}?build=${Date.now()}`,
)
if (typeof surfacePaint.defineMaterialHost !== 'function' || typeof surfacePaint.paintSurfaceHost !== 'function') {
  throw new Error('vendor surface painting helpers must compile as ESM named exports')
}
console.log('[build-vendor] OK — vendor/dist/shared/types compiled (ESM + scene smoke)')

// Vendor the renderer's PURE sprite resolver so the scene-export backend can
// call the SAME pickFaceSprite the browser renderer uses (one implementation,
// no parallel re-derivation). We compile the barrel (renderer/server/
// spriteResolver.ts) + its pure transitive deps (pickFaceSprite, neighborKey)
// directly from the frontend SOURCE — there is NO copy of the resolver, the
// frontend file stays the single source of truth. The frontend uses `bundler`
// module resolution (extensionless relative imports), so we compile with that,
// then post-rewrite the emitted relative specifiers to add `.js` so plain Node
// (the backend / tsx) can import the output. Type-only imports (ruleCache/types)
// are erased, so the emitted .js pulls in no browser/DOM code.
const resolverOut = resolve(appRoot, 'vendor/dist/renderer-resolve')
const resolverCmd = [
  tsc,
  '--module esnext --moduleResolution bundler --target es2022',
  '--skipLibCheck --declaration false --noEmitOnError false --verbatimModuleSyntax',
  '--rootDir frontend/src --outDir vendor/dist/renderer-resolve',
  // spriteResolver (billboard cook) + modelVariants (mesh3d export / preview parity)
  'frontend/src/renderer/server/spriteResolver.ts',
  'frontend/src/renderer/modes/mesh3d/modelVariants.ts',
].join(' ')
execSync(resolverCmd, { stdio: 'inherit', cwd: appRoot })

addJsExtensions(resolverOut)
// Mark the emitted tree as ESM so Node parses the .js as modules without the
// MODULE_TYPELESS_PACKAGE_JSON reparse warning.
writeFileSync(resolve(resolverOut, 'package.json'), JSON.stringify({ type: 'module' }) + '\n')
console.log('[build-vendor] OK — vendor/dist/renderer-resolve compiled')
