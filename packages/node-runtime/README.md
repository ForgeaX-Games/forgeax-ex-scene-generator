# @forgeax/node-runtime

Headless, domain-agnostic **node runtime + stable editing API** for ForgeaX
node-programming plugins. This package is the engine behind a node-editor
pipeline: it registers domain ops ("batteries"), executes a wire graph,
persists graph/history/output state, and exposes a single stable surface that
every UI component, AI agent, CLI command, and test drives the pipeline
through.

It is pure Node.js — no UI, no HTTP server, no plugin-manifest parsing. It
takes a graph plus asset files and produces executor results; everything
domain-specific lives in the `OpSpec.execute` closures that plugins attach at
registration time.

## Install / import

The package ships a root barrel plus two finer-grained subpath exports for
tree-shaking:

```ts
// Root barrel — everything (layer1 + layer2).
import { OpRegistry, createRuntime, applyBatch, executeNode } from '@forgeax/node-runtime'

// Or import per layer:
import { OpRegistry, DataTree } from '@forgeax/node-runtime/layer1'
import { createRuntime, applyBatch } from '@forgeax/node-runtime/layer2'
```

> Note: both layers export an `executeNode`. Layer 1's is the low-level
> single-node primitive; Layer 2's is the graph walker. The **walker is the
> public API**, so it wins at the root barrel — Layer 1's primitive stays
> reachable via the `/layer1` subpath.

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
| `executor.ts` | The graph executor: topological walk, per-node dispatch, output caching, and group sub-graph expansion (knows only OpSpec/nodes/edges). |
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
| `execute-node.ts` | The execution API: runs a node's downstream closure (or the whole pipeline), walking in the background and streaming progress over the event bus; boundary upstream inputs are hydrated from the output cache. |
| `resolve-inputs.ts` | Pure graph algorithms for execution: which nodes to run, in what (topological) order, and how each node's inputs are pulled from already-produced outputs or the cache. |
| `write-output.ts` | Out-of-band single-port cache write for **manual-trigger ops** (the AI generators behind the editor's Run button), so downstream consumers pick up the value on the next incremental run without re-firing the op. |
| `import-graph.ts` | Faithfully imports a whole wire graph (a template file or inline payload, in either kernel or legacy format) as one atomic batch, riding the same live-sync cascade every other actor uses. |
| `project-registry.ts` | Multi-project registry: CRUD + open/activate of many pipelines ("projects") inside one workspace, each with isolated storage, plus an in-memory exclusive lock for AI callers. |
| `subscriptions.ts` | The event types + subscribe interface for the graph / execution / asset channels. |
| `event-bus.ts` | In-process implementation of `subscriptions`: one bus per `Runtime`; consumers subscribe, and only layer2 internals emit. |

## Typical usage

```ts
import { createRuntime, applyBatch, executeNode } from '@forgeax/node-runtime'

// 1. Build a runtime for one pipeline (wires up storage under projectRoot).
const runtime = createRuntime({
  projectRoot: '/path/to/project',
  pipelineId: 'main',
  pluginId: 'my-plugin',
})

// 2. Register the plugin's ops into runtime.registry (OpSpec.execute closures),
//    e.g. via the loader scanning battery folders.

// 3. Mutate the graph atomically. Headless callers may omit `position` on
//    createNode (and createGroup root shadow) — the kernel assigns an
//    edge-aware layout for nodes added in that batch only.
await applyBatch(runtime, [
  { type: 'createNode', nodeId: 'n1', opId: 'my.op', params: {} },
])

// 4. Execute a node's downstream closure (or omit nodeId for the whole pipeline).
const handle = await executeNode(runtime, { nodeId: 'n1' })
const result = await handle.done
```

For layer boundaries and the broader plugin architecture, see the monorepo
[`README`](../../README.md) and the docs in [`docs/`](../../docs/).

## Scripts

`build` (tsc -b) · `test` (vitest) · `typecheck` · `lint` (eslint src) ·
`clean`. Requires Node ≥ 20.19.
