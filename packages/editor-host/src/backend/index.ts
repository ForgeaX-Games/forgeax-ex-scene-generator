// Editor-host backend — the deliberately tiny set of host helpers that every node-editor app backend shares verbatim, so each app no longer re-implements them. It is app-agnostic by design: only modules that are byte-identical across the wb-3d-lowpoly and wb-scene-generator backends and carry no app-local coupling are allowed here, namely where to scan for batteries and the cross-process screenshot capture lifecycle. App-specific backend logic stays in each app; this package owns just the common ground they all stand on.
export { resolveBatteryScanRoots } from './batteryRoots.js'
export { getScreenshotService } from './screenshot.service.js'
export {
  registerProjectPipelineRoutes,
  ensureProjectMutationAccess,
  type ProjectPipelineRouteDeps,
} from './projectPipelineRoutes.js'
