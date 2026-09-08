---
name: compose-scene-pipeline
description: >-
  Compose and iterate ForgeaX 2D Scene Asset Generator projects through the official
  Studio ToolRegistry tools. Use when the user asks to create, modify, preview,
  screenshot, export, or iterate a scene, level, map, renderer preview, or
  node-runtime graph in wb-2d-scene-asset-generator.
---

# Compose Scene Pipeline

## Purpose

Build and iterate a **2D Scene Asset Generator** project by calling Studio ToolRegistry
tools (`/api/tools/call`) that proxy to the plugin backend `/api/v1/*`
contract. Do not directly edit runtime files, do not drive the UI by clicking,
and do not use the legacy `wb-scene` plugin.

## Official Tool Path

Call tools with `caller.kind = "ai"` unless the host provides a different
caller context:

```json
{
  "toolId": "asset2d:pipeline.applyBatch",
  "args": { "ops": [], "opts": { "actor": "ai:scene", "label": "compose scene" } },
  "caller": { "kind": "ai" }
}
```

Use these tools:

- `asset2d:projects.list`, `asset2d:projects.create`, `asset2d:projects.open`,
  `asset2d:projects.remove`
- `asset2d:batteries.list`, `asset2d:batteries.get`
- `asset2d:pipeline.get`, `asset2d:pipeline.applyBatch`,
  `asset2d:pipeline.execute`, `asset2d:pipeline.import`, `asset2d:pipeline.export`
- `asset2d:assets.list`
- `asset2d:renderer.info`, `asset2d:renderer.setViewMode`,
  `asset2d:renderer.selectLayer`, `asset2d:renderer.openAllSubLayers`

`asset2d:projects.remove` requires destructive confirmation for AI callers.

## Workflow

1. List/open/create a project with `asset2d:projects.*`.
2. Inspect available batteries with `asset2d:batteries.list` and
   `asset2d:batteries.get`; never guess port names.
3. Read the current graph using `asset2d:pipeline.get`.
4. Apply graph changes with `asset2d:pipeline.applyBatch`, using
   `opts.actor = "ai:scene"` and a concise `opts.label`.
5. Execute with `asset2d:pipeline.execute`.
6. Drive the preview view mode with `asset2d:renderer.*` and inspect generated
   assets via metadata with `asset2d:assets.list` / `asset2d:assets.get`
   (dimensions / byte size / errors / out fields).
7. Iterate until the scene matches the request, then optionally save a graph
   template with `asset2d:pipeline.export`.

## Scene Decisions

- Prefer semantic scene batteries when available; inspect the op catalog first.
- Use node-runtime graph batches for creation, connection, parameter updates,
  grouping, and deletion. Do not write `state/graph.json` by hand.
- Preserve the renderer's supported view modes (`top`, `topBillboard`, `iso`,
  `free3d`) and layer selection contract.
- Use the execute output summary (no errors, expected layer/asset names),
  generated project assets, and node outputs as feedback for multi-turn
  iteration; do not declare completion from graph edits alone.

## References

- [quickstart.md](quickstart.md): ToolRegistry-first workflow.
- [pipeline-schema.md](pipeline-schema.md): graph and batch shape.
- [battery-catalog.md](battery-catalog.md): how to discover batteries.
