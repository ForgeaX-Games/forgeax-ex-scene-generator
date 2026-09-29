// Public entry: re-exports Layer 1 and Layer 2 surfaces.
// Plugins should import from '@forgeax/node-runtime' (this barrel) or, for
// finer-grained tree-shaking, from '@forgeax/node-runtime/layer1' and
// '@forgeax/node-runtime/layer2' subpath exports.

export * from './layer1/index.js'
export * from './layer2/index.js'

// Layer 1 `executeNode` is the single-op dispatcher (battery tests). There is no
// Layer 2 graph walker. Scene execution is runSceneModule; `ExecutionResult` is
// the hydrate shape after that run.
export type { ExecutionResult } from './layer2/execution-result.js'
