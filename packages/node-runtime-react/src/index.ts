// Public surface — @forgeax/node-runtime-react (`.` entry).
//
// The faithful, supported editor lives at the `./editor` sub-export
// (`@forgeax/node-runtime-react/editor`): the real <Editor>, canvas, node types
// and stores. Both first-party apps (scene-generator, 3d-lowpoly) consume only
// `./editor` for runtime, and import just the API-contract TYPES (ApiClient,
// ActivateProjectResult, CreateProjectRequest) from this `.` entry.
//
// The original v0.2.0 "P4 approximation" composable tree (NodeCanvas, Inspector,
// BatteryPalette, StatusBar, Toolbar, NodeEditor, PipelineControls, AssetBrowser,
// HistoryView, PathSlotsPanel and the parallel hooks/ + components/ + panels/
// trees) was a deprecated surface superseded by `./editor`. It was confirmed
// unused by every first-party consumer and has been REMOVED. New code must
// import from `@forgeax/node-runtime-react/editor`.
//
// What the `.` entry still exports, and why:
//   * API contract types — the stable cross-process contract both apps type
//     their HttpApiClient against.
//   * Theme bundles — the self-contained `./themes` surface, also re-exported
//     here for back-compat (`./themes` remains the canonical import path).

// API contract ---------------------------------------------------------------
export type { ApiClient, ActivateProjectResult, CreateProjectRequest, GroupTemplateBattery, GroupTemplateDocs, PromptDto, TextPresetDto, ViewProjectResult } from './api/index.js'
// Phase-2 wire-envelope hydration (see wb-scene-generator-scene-tree-storage.md
// §3) — a pure, React-free helper HttpApiClient implementations call to undo a
// deduped batch/single-port response before handing the value to callers. Part
// of the API contract, not the editor runtime, so it lives at this entry too.
export { hydrateBlobRefs } from './api/index.js'

// Theme bundles + token resolver --------------------------------------------
export { defaultTheme, legacyTheme, resolveTheme } from './themes/index.js'
export type { NodeCanvasTheme } from './themes/index.js'
