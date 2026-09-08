# Pipeline And Batch Shape

The scene plugin uses `@forgeax/node-runtime` graph storage. Agents should
mutate it with `asset2d:pipeline.applyBatch`.

## Read

Call:

```json
{ "toolId": "asset2d:pipeline.get", "args": {}, "caller": { "kind": "ai" } }
```

The result is the active pipeline snapshot:

```json
{
  "id": "main",
  "hash": "...",
  "nodes": {},
  "edges": {},
  "metadata": {}
}
```

## Mutate

Call:

```json
{
  "toolId": "asset2d:pipeline.applyBatch",
  "args": {
    "ops": [],
    "opts": {
      "actor": "ai:scene",
      "label": "add terrain and props"
    }
  },
  "caller": { "kind": "ai" }
}
```

Use the op shapes already accepted by node-runtime for create/update/connect,
delete, grouping, layout, and metadata changes. Inspect an existing graph and
the node-runtime API contract before emitting non-trivial batches.

## Execute

```json
{
  "toolId": "asset2d:pipeline.execute",
  "args": { "nodeId": "optional-node-id" },
  "caller": { "kind": "ai" }
}
```

Omit `nodeId` for a full graph execution.
