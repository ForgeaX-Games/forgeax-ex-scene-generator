---
id: wb-2d-scene-asset-generator:author-guide
trigger: /wb-2d-scene-asset-generator
displayName:
  en: 2D Scene Asset Generator Author Guide
  zh: 2D 场景资产生成器 作者指引
---

# 2D Scene Asset Generator · AI guide

This plugin extends `@forgeax/node-runtime` with domain ops and surfaces
specific to **2D Scene Asset Generator** workflows. AI agents drive editor actions
through Studio ToolRegistry (`/api/tools/call`) tools declared in
`forgeax-plugin.json`; nothing in this plugin requires a human-only path.

## Workflow shape

1. `asset2d:projects.list` / `asset2d:projects.open` to choose the active project.
2. `asset2d:batteries.list` and `asset2d:batteries.get` to inspect exact op IDs and
   ports.
3. `asset2d:pipeline.get` to read the graph.
4. `asset2d:pipeline.applyBatch` to create/update/remove nodes and edges.
5. `asset2d:pipeline.execute` to run the graph.
6. `asset2d:renderer.*` and `asset2d:assets.list` / `asset2d:assets.get` to
   verify generated assets via metadata (dimensions / byte size / errors).

## Domain op catalogue

Use `asset2d:batteries.list`; the catalog is dynamic and includes plugin domain
ops plus shared node-runtime ops.

## Domain surfaces

- `wb-2d-scene-asset-generator.projects` — project list/create/open/remove actions.
- `wb-2d-scene-asset-generator.pipeline` — graph get/apply/execute/import/export actions.
- `wb-2d-scene-asset-generator.preview` — renderer control and asset inspection
  actions.

## Path slots

(empty — populated when path slots are declared)
