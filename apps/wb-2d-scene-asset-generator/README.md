# 2D Scene Asset Generator

ForgeaX node-programming workbench app: **2D Scene Asset Generator** (2D 场景资产生成器). Built
on the monorepo kernel [`@forgeax/node-runtime`](../../packages/node-runtime) +
[`@forgeax/node-runtime-react`](../../packages/node-runtime-react).

This app lives at `apps/wb-2d-scene-asset-generator/` inside the
[`forgeax-ex-scene-generator`](../../) Bun monorepo.

## Quick start

```bash
# From the monorepo root — build kernel packages first:
bun install
bun run build

# Then launch this app:
cd apps/wb-2d-scene-asset-generator
bun run serve          # self-builds if dist is missing; starts backend :9567 + frontend :9565
```

For development (watch mode with HMR):

```bash
cd apps/wb-2d-scene-asset-generator
bun run dev            # runs backend + frontend in dev/watch mode
```

```bash
# Headless checks:
bun run smoke:batteries    # battery load + executeNode in-process
bun run accept             # forgeax CLI headless determinism loop
```

## Kernel dependency

The kernel (`@forgeax/node-runtime`, `@forgeax/node-runtime-react`,
`@forgeax/editor-host`, `@forgeax/batteries-common`, `@forgeax/i18n`) lives in
the monorepo `packages/*` and is consumed via `workspace:*` — source, not
pre-built dist. One `bun run build` from the monorepo root rebuilds everything.

There is no `external/` directory, no `link:` protocol, no `kernel:setup` or
`kernel:build` script, and no submodule pin to bump.

## Layout

```
backend/                    # Fastify backend; registers kernel runtime + domain routes
  src/
    main.ts                 # boot: build Fastify app, register route groups + /health (PORT 9567)
    runtime.ts              # kernel Runtime + ProjectRegistry (defaultType:'scene') + asset2d service
    tool-handlers.ts        # Studio tool proxy
    routes/                 # queries / mutations / execute / ws / projects / pipelineImport /
                            #   groupTemplates / batteryCategories
    assets/                 # generatedAssets.ts (file-backed index) + routes.ts (/generated-assets, /preview)
    ai/                     # imageGeneration.ts (Studio image gateway) + routes.ts (/api/v1/ai/image)
    presets/                # store.ts + routes.ts (built-in + user text presets)
    ops/index.ts            # empty stub — all ops are file-based batteries
frontend/                   # Vite + React UI
  src/
    App.tsx                 # pane router (?pane= routing: preview / assetstore / left / center)
    workbench/              # WorkbenchHost.tsx mounts kernel <Editor>; Image{Source,Battery,Preview}Node; protocol.ts
    surfaces/               # GeneratedAssetStoreSurface.tsx / ImagePreviewSurface.tsx / library/draggedAssetBus.ts
    panels/                 # scenePanels.ts (custom inspector panels + domain node renderers)
    api/                    # HttpApiClient.ts
batteries/                  # 42 2D domain batteries (file-based; scanned by kernel loader)
vendor/shared/types/        # vendored shared types; build:vendor → vendor/dist/ (gitignored)
schemas/                    # JSON schemas for batteries / ops
forgeax-plugin.json         # ForgeaX plugin manifest (id @forgeax-plugin/wb-2d-scene-asset-generator)
SKILL.md                    # AI-readable op + workflow guide
```

## Batteries

Batteries are the 2D domain's op library — **42** app batteries (big tags:
`image` 28, `ai` 5, `helper` 5, `grayscale` 3, `prompt` 1; plus `groups/` and
`templates/` JSON entries) plus 45 from `@forgeax/batteries-common`.

Each battery is a `{meta.json, index.ts}` directory pair under `batteries/`.
The kernel loader (`createBatteryLoader`) scans them from
`resolveBatteryScanRoots(repoRoot)` in `@forgeax/editor-host/backend`.

```bash
bun run build:vendor       # compile vendor/shared/types → vendor/dist/shared/types
bun run smoke:batteries    # load all batteries + run executeNode (in-process)
bun run accept             # drive the forgeax CLI headlessly; assert deterministic output
```

## Status

Fully implemented: the node-graph editor (kernel `<Editor>`), two generated-asset
surfaces (Asset Folders + Image Preview), image canvas nodes (source / battery /
preview), drag-an-image-onto-canvas, multi-project management, per-agent
exclusive lock, 42 batteries, AI image generation via the Studio gateway, text
presets, pipeline import/export, undo/redo, and the LLM/CLI tool surface.

## Ports

| Service | Port |
|---|---|
| Frontend (served by `serve-dist.mjs`) | 9565 |
| Backend (Fastify) | 9567 |

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
