/**
 * Code-authored materials: the two `@forgeax/scene` names a `.material.ts` and
 * the scene that uses it call.
 *
 * Neither is a battery, and that is deliberate rather than incidental. A battery
 * call goes through `callHost`, which writes its arguments into `host.memo`'s
 * argsKey and into `host.trace` for the canvas to project. A material's argument
 * is the agent's `surface(sample)` closure: it serializes to nothing, so two
 * different materials would hash to the same argsKey and silently reuse each
 * other's result, and there is no sensible way to draw a closure as a wire on a
 * node graph. They live on the ambient host object next to `sampleHeight` /
 * `sampleSurface` — query helpers that are called but never recorded.
 *
 * The bodies live app-side (`vendor/shared/types/scene/surfacePaint.ts`), reached
 * through `host.implementations` like every battery, because that tree is what
 * the pack exporter vendors — one partition implementation, both runs.
 */

import { createSceneDiagnostic } from '@forgeax/scene-authoring'

import {
  currentSceneHost,
  hostResultError,
  publicArgs,
  runWithSceneHost,
  type SceneCallSource,
  type SceneRunHost,
} from './host.js'

function sourceOf(rawArgs: Record<string, unknown>): SceneCallSource | undefined {
  if (typeof rawArgs.__sceneFile !== 'string') return undefined
  return {
    file: rawArgs.__sceneFile,
    ...(typeof rawArgs.__sceneLine === 'number' ? { line: rawArgs.__sceneLine } : {}),
    ...(typeof rawArgs.__sceneColumn === 'number' ? { column: rawArgs.__sceneColumn } : {}),
  }
}

/**
 * `_warnings` from an unrecorded call. Same `SCENE_*` contract as the recorded
 * path in `host.ts`, minus the `graph` link: there is no statement node for the
 * canvas to highlight, and pointing at a minted-but-unregistered id would be a
 * lie the frontend then fails to resolve.
 */
function recordQueryWarnings(
  host: SceneRunHost,
  functionName: string,
  source: SceneCallSource | undefined,
  result: unknown,
): void {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return
  const warnings = (result as { _warnings?: unknown })._warnings
  if (!Array.isArray(warnings)) return
  for (const item of warnings) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const rec = item as { code?: unknown; message?: unknown }
    if (typeof rec.code !== 'string' || !rec.code.startsWith('SCENE_')) continue
    host.diagnostics.push(createSceneDiagnostic({
      code: rec.code,
      phase: 'execute',
      severity: 'warning',
      message: typeof rec.message === 'string' && rec.message.trim() ? rec.message : rec.code,
      operation: functionName,
      source: {
        file: source?.file ?? 'main.scene.ts',
        start: 0,
        end: 0,
        line: source?.line ?? 1,
        column: source?.column ?? 1,
      },
    }))
  }
}

function implementation(functionName: string): (args: Record<string, unknown>) => unknown {
  const host = currentSceneHost()
  if (!host) throw new Error(`@forgeax/scene '${functionName}' must run under runSceneModule`)
  const impl = host.implementations[functionName]
  if (!impl) throw new Error(`No host implementation for '${functionName}'`)
  return impl
}

/** Brands a material rule with the name its `material/*` asset is derived from. */
export function defineMaterial(rawArgs: Record<string, unknown> = {}): unknown {
  return implementation('defineMaterial')(publicArgs(rawArgs))
}

/**
 * Bakes a material rule onto a mesh: evaluates it per triangle, dedupes the
 * appearances into a palette, and regroups the index buffer so each palette
 * entry is one contiguous run the engine can draw as a submesh.
 */
export function paintSurface(rawArgs: Record<string, unknown> = {}): unknown {
  const host = currentSceneHost()
  if (!host) throw new Error(`@forgeax/scene 'paintSurface' must run under runSceneModule`)
  const result = implementation('paintSurface')(publicArgs(rawArgs))
  recordQueryWarnings(host, 'paintSurface', sourceOf(rawArgs), result)
  const failure = hostResultError(result)
  if (failure) throw new Error(`paintSurface: ${failure}`)
  return result
}

/**
 * Adds the material names to the ambient host object. Separate from
 * `bindSceneHostGlobals` so `host.ts` stays at its line budget; `runner.ts`
 * calls both.
 */
export function bindMaterialHostGlobals(host: SceneRunHost): void {
  const global = globalThis as typeof globalThis & { __forgeaxSceneHost?: Record<string, unknown> }
  const bound = global.__forgeaxSceneHost
  if (!bound) throw new Error('bindMaterialHostGlobals must run after bindSceneHostGlobals')
  bound.defineMaterial = (args: Record<string, unknown>) => runWithSceneHost(host, () => defineMaterial(args))
  bound.paintSurface = (args: Record<string, unknown>) => runWithSceneHost(host, () => paintSurface(args))
}
