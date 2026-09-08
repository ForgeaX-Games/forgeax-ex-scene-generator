# Battery Catalog

The battery catalog is runtime data. Always query it instead of copying stale
IDs from old scene generator docs.

## List Batteries

```json
{
  "toolId": "asset2d:batteries.list",
  "args": {},
  "caller": { "kind": "ai" }
}
```

Each item includes the op `id`, display names, inputs, outputs, params, dynamic
ports, lacing, and principal output hints.

## Get One Battery

```json
{
  "toolId": "asset2d:batteries.get",
  "args": { "id": "add_child" },
  "caller": { "kind": "ai" }
}
```

Use the returned `inputs`, `outputs`, and `params` exactly when building graph
batches. Do not infer port names from labels.

## Scene Guidance

- Prefer scene, terrain, room, prop, road, city, or world-map batteries when the
  catalog contains one that matches the user's vocabulary.
- Use renderer-facing outputs that the current catalog and preview surface can
  display.
- Treat missing batteries as a capability gap and report it instead of
  inventing op IDs.
