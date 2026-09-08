# Quickstart

Use Studio ToolRegistry as the only control plane:

1. `asset2d:projects.list` to find the active project.
2. `asset2d:projects.create` or `asset2d:projects.open` when needed.
3. `asset2d:batteries.list` and `asset2d:batteries.get` to inspect exact op IDs,
   params, inputs, and outputs.
4. `asset2d:pipeline.get` to read the current graph.
5. `asset2d:pipeline.applyBatch` to mutate the graph.
6. `asset2d:pipeline.execute` to run the graph.
7. `asset2d:renderer.info` / `asset2d:renderer.setViewMode` to control the
   preview view mode.
8. `asset2d:assets.list` / `asset2d:assets.get` to inspect generated project
   assets (dimensions / byte size / errors).

Do not write runtime JSON directly. The backend persists graphs, history, and
outputs through node-runtime so human UI actions and AI tool calls stay on the
same path.

## Example Tool Call

```json
{
  "toolId": "asset2d:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

## Iteration Loop

After every meaningful graph change:

1. Execute the graph.
2. Read the execute output summary (no errors, expected layer/asset names).
3. Inspect renderer state, selected layers, and assets when relevant.
4. Apply another focused batch if the outputs show a mismatch.
