# Scene authoring and Engine delivery

Use the CLI command defined by the calling Skill wherever `{{CLI}}` appears below.

## Authoring

> [!IMPORTANT]
> Focus on scene modeling and environmental design: terrain, architecture, routes, vegetation, props, and spatial composition. Do not model people, NPCs, playable characters, or other character models, including simplified crowd figures and human scale markers. Express activity through stalls, merchandise, signage, furniture, and environmental dressing.

Organize the design into independently reusable TypeScript rules. Each distinct building style belongs in its own `.scene.ts` module with named exports and parameters for dimensions, proportions, materials, and local variation. Let `main.scene.ts` compose terrain, routes, landmarks, building families, vegetation, props, and environmental dressing modules. Shared geometry and material helpers serve those modules. Preserve the user's chosen level of complexity and existing organization when editing.

For a complete environment, develop variation at the scale of the setting: terrain elevation and edges, routes and public spaces, building silhouettes and roof profiles, facade rhythms, entrances, and purpose-specific details. Give prominent buildings recognizable construction and use; vary structural rules as well as size and color. Refine roof edges, supports, openings, material transitions, ground contact, and clusters of everyday objects according to the brief. Keep circulation and focal points readable. Select and parameterize these rules from the creative request; the user need not specify the module layout or a detail checklist.

1. Run `{{CLI}} projects --json`; select the requested project by its returned ID, or create one with `{{CLI}} create --name "Project name" --json`.
2. Run `{{CLI}} info --project <id> --json` and `{{CLI}} read --project <id> --file main.scene.ts --json`. Keep the returned project revision for the next commit.
3. Discover available functions with `{{CLI}} contracts --project <id> --json`. Select functions relevant to the design, then request their signatures with `{{CLI}} contracts --project <id> --functions <comma-separated-names> --json` in groups of at most six. Follow the tool-library guidance below when choosing reuse, adaptation, or original code. Author TypeScript `.scene.ts` files with named imports from `@forgeax/scene`.
4. For single-module validation, save the proposed source in a local file and run `{{CLI}} validate --project <id> --file main.scene.ts --source <local-file> --json`. Multi-module changes use the atomic commit operation, which compiles the supplied files together.
5. Write a JSON input file containing `files: [{"file":"main.scene.ts","source":"..."}]`, `entryFile`, and `expectedProjectRevision` from `info`. Run `{{CLI}} commit --project <id> --input <json-file> --json`. Optional `patches`, `deleteFiles`, and `label` use the existing Scene Generator commit API. On a revision conflict, read the current project before editing again.
6. Run `{{CLI}} execute --project <id> --json`. Correct reported diagnostics and repeat until execution and verification succeed. The independent UI receives the updated scene. Report rendering as verified only when separate renderer evidence establishes it.

### Use the provided tool library

Before implementing a reusable modeling operation, check the relevant library capabilities. Use the scene's needs to guide discovery; inspect selected functions and their dependencies without surveying the whole toolkit. For example:

| Design need | Functions to investigate |
| --- | --- |
| Facade bays, colonnades, fence segments | `allocateSpans`, `segmentRun`, `localFrame`, `fitAnchor` |
| Terrain contours, elevations, and regional variation | Grid noise and math, `geometryMask`, `heightfield`, `heightfieldMesh` |
| Ground contact and paths over terrain | `sampleHeight`, `sampleSurface`, `placeOnGround`, `liftToSurface`, `surfaceBand` |

Use available source in the supplied toolkit checkout or installed standalone Scene Generator package as a working reference. In a checkout, search `apps/composition/batteries/` for the function name in `scene.contract.ts`, then read its adjacent `index.ts` and the relevant imported helpers, often under `_shared/`. In a standalone package, inspect `modules/composition/batteries/`, where entries are compiled `index.js` beside `scene.contract.ts`. Read relevant examples or tests when present. API details describe calling conventions; implementation code explains the algorithm, units, coordinate assumptions, and dependencies. Source access is optional and must not block scene creation.

Call a suitable public function through `@forgeax/scene`. When a useful algorithm needs scene-specific behavior, copy or adapt the relevant implementation into a project-local `.ts` helper, `.generator.ts`, or building-style `.scene.ts`, include its required dependencies, and use relative project imports. Preserve applicable notices and verify units, coordinates, seeded variation, output types, and failure behavior. Keep creative adaptations in the project so exported Packs contain the required code.

Original implementation is equally valid. Write custom geometry, solvers, building rules, and composition whenever they serve the design; combine them freely with library calls and adapted helpers. Choose by suitability and scene quality, with no required reuse percentage or tool-count target. Validate adapted and original modules through the same scene execution and native Pack workflow.

## Publish a native Pack

Run `{{CLI}} publish --project <id> --out assets/scene-generator/<asset-name> --json` to write a complete `.pack.ts` asset into the current game and build it with the game's installed Engine. The configured service must run on the same machine and have access to this directory. Correct build diagnostics before attempting to use the asset.

For named module exports or parameterized assets, supply `--options <json-file>`. Supported options include `entryFile`, `exportName`, `args`, `packageId` (stable UUID), `sourceKey`, `parameters`, `parameterBindings`, `includeDefaultLighting`, and `consumerBuildBudgetMs`. Native ScriptablePack uses `schemaVersion: "2.0.0"`. Keep `packageId` and `sourceKey` stable when updating an asset so existing game references retain the same GUID. The CLI owns `projectId` and `destination`.

Retain the complete returned directory: `.pack.ts`, `build-scene.mjs`, `build-scene.d.mts`, `scene/`, `platform/`, and `scene-entry.json`. It contains the editable scene source and executable tool-library dependencies. `publish` verifies portable geometry, runs the native Engine build, and checks the resulting catalog and asset packages against the build digests. Read `ok`, `sceneGuid`, and `engine.assets`; each asset record carries its authoritative GUID, kind, source path, and source key. Use these returned identities for game integration.

`{{CLI}} export --project <id> --out assets/scene-generator/<asset-name> --json` also supports source-only delivery with portable verification. Native Engine acceptance is established by `publish`.

## Use the Engine GUID in the game

Engine `0.2.1` projects select runtime plugins through `forge.json#roots`. Read the game's existing scene-loading plugin and the installed Engine asset/application skills. The Empty template's `assets/scene-owner.pack.ts` demonstrates `ctx.assets.loadByGuid`, `ctx.assets.instantiate`, and lifecycle cleanup. Supply the returned `sceneGuid` in its Pack configuration as `{ "scene": { "$asset": "<sceneGuid>" } }`; the native Pack build resolves that reference for the runtime plugin. Preserve the existing game composition, camera, lighting, controls, and cleanup when integrating the generated scene.

Use the game-local Engine CLI: `node node_modules/@forgeax/engine/dist/bin/forgeax.mjs`. When a separate plugin is required, discover its commands with `help asset plugin create --json` and `help project root set --json`. For the existing Empty scene owner, a JSON request to `asset plugin create --input <file> --json` can contain:

```json
{
  "path": "assets/generated-scene-owner.pack.json",
  "module": "./scene-owner.pack.ts",
  "export": "sceneOwner",
  "config": { "scene": { "$asset": "<returned sceneGuid>" } }
}
```

Read the command's returned plugin GUID. Only when that plugin owns the intended Engine realm, select it with the same Engine CLI's `project root set --realm engine --guid <plugin-guid> --json`. A scene GUID identifies scene content; a realm root requires a plugin GUID. Use `--input` for structured configuration. Add camera, lighting, and gameplay where the current game needs them.

Build the game and present a visible Engine result as part of a complete scene delivery. Discover the installed Engine's live commands; Engine 0.2.1 provides `dev start --headless false --json`. If a headless owner is already running, use its `dev stop` before starting the visible owner. Require a ready connected runtime and inspect the generated hierarchy at its returned revision. Use the actual returned URL to open or reuse the Engine page when the host supports it; keep the visible window available for the user. Frame the whole scene with a suitable camera and lighting, then check the requested materials, scale, composition, and behavior with the available inspection capabilities.

Deliver the Scene Generator page, visible Engine result, editable modules, Pack path, and returned GUIDs. Report build, runtime loading, and appearance verification according to the evidence obtained. A headless entity query establishes runtime loading; delivery of the visible Engine result remains a separate step. If display is unavailable, state that specific unfinished step.

Business commands return a JSON envelope; a failed command requires correction before continuing dependent operations.
