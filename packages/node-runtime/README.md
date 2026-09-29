# @forgeax/node-runtime

Headless, domain-agnostic **node runtime + stable editing API** for ForgeaX
Scene Script. This package holds the display-graph store, OutputCache, battery
registry, and the editing surface (applyBatch / queries / import). Scene
execution is `runSceneModule` in `@forgeax/scene`, not a topological walk of
the last-run graph.

It is pure Node.js — no UI, no HTTP server, no plugin-manifest parsing.

## Install / import

The package ships a root barrel plus two finer-grained subpath exports for
tree-shaking:

```ts
// Root barrel — everything (layer1 + layer2).
import { OpRegistry, createRuntime, applyBatch } from '@forgeax/node-runtime'

// Or import per layer:
import { OpRegistry, DataTree } from '@forgeax/node-runtime/layer1'
import { createRuntime, applyBatch } from '@forgeax/node-runtime/layer2'
```

> Layer 1 `executeNode` is a single-op dispatcher for battery tests. There is
> no Layer 2 graph walker. Scene execution is `runSceneModule`.

## Architecture: two layers

The runtime is split into a pure kernel (**layer1**) and the orchestration
surface above it (**layer2**). Consumers normally talk to layer2; layer2 talks
to layer1.

### layer1 — the headless kernel

Domain-agnostic mechanism only (op registration / execution / dispatch, data,
persistence, loading). It never knows about any specific battery's logic.

| Piece | Role |
|---|---|
| `types/` | The kernel's public data-shape vocabulary: what an op, graph, execution request and response look like (no UI-only fields). |
| `op-registry.ts` | In-process registry of `OpSpec`s: register by id at plugin start, look up by id at execution, with add/remove/replace to support hot-reload. |
| `executor.ts` | Single-op `OpSpec.execute` dispatcher (battery tests / group probe). Scene execution is `runSceneModule`. |
| `dispatcher.ts` | The fanout/regroup engine for a single op call: from port `access` (item/list/tree) + lacing + principal it decides how many times `execute` runs, what shape each call is fed, and how results regroup back into a `DataTree`. |
| `datatree/` | The structure every wire carries: an immutable tree keyed by integer paths that unifies scalar/list/tree forms and offers structural ops (flatten, graft, …). |
| `path-resolver.ts` | Resolves a plugin's path slots to absolute paths by a 4-level precedence (session override > persisted config > env var > manifest default), validating no-escape and type/shape. |
| `loader/` | Scans battery folders on disk and registers them into the kernel, with hot-reload support. |
| `storage/` | Durably persists one pipeline's state: the graph itself, the operation history, and the execution-output cache. |
| `asset-resolver/` | Manages a plugin's asset directory: CRUD / list / filter under a fixed root, and subscribe to add/change/remove. |
| `utils/` | Shared kernel helpers (logger, group-battery finder). |

### layer2 — the stable editing API

The surface every consumer (UI / AI / CLI / tests) drives the runtime
through, instead of touching layer1 storage directly — so the kernel can
evolve caching/auth/projection behind a fixed contract.

| Piece | Role |
|---|---|
| `runtime.ts` | Assembles the layer1 pieces (registry / graph store / history / output cache / path & asset resolvers) into one `Runtime` handle — one per pipeline. |
| `apply-batch.ts` | **The single atomic mutation entry.** Any edit becomes an `Op[]` submitted at once; only on full success does it write `graph.json` + append one history entry. Covers create/update/delete node & edge, metadata, and group/ungroup primitives. |
| `queries.ts` | Read-only query surface: graph / node / edge / output / history / group / op-list reads from layer1 storage, never mutating, so callers don't touch `GraphStore` directly. |
| `execution-result.ts` | `ExecutionResult` hydrate shape after a Scene Script run writes OutputCache. |
| `write-output.ts` | Out-of-band single-port OutputCache write for editor/tests. |
| `import-graph.ts` | Faithfully imports a whole wire graph (a template file or inline payload, in either kernel or legacy format) as one atomic batch, riding the same live-sync cascade every other actor uses. |
| `project-registry.ts` | Multi-project registry: CRUD + open/activate of many pipelines ("projects") inside one workspace, each with isolated storage, plus an in-memory exclusive lock for AI callers. |
| `subscriptions.ts` | The event types + subscribe interface for the graph / execution / asset channels. |
| `event-bus.ts` | In-process implementation of `subscriptions`: one bus per `Runtime`; consumers subscribe, and only layer2 internals emit. |

## Typical usage

```ts
import { createRuntime, applyBatch } from '@forgeax/node-runtime'

const runtime = createRuntime({
  projectRoot: '/path/to/project',
  pipelineId: 'main',
  pluginId: 'my-plugin',
})

await applyBatch(runtime, [
  { type: 'createNode', nodeId: 'n1', opId: 'my.op', params: {} },
])
```

Scene Script runs through `runSceneModule`. The display graph is last-run
projection, not the executor.

For layer boundaries and the broader plugin architecture, see the monorepo
[`README`](../../README.md) and the docs in [`docs/`](../../docs/).

## Scripts

`build` (tsc -b) · `test` (vitest) · `typecheck` · `lint` (eslint src) ·
`clean`. Requires Node ≥ 20.19.
