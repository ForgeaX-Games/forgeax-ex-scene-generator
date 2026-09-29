import {
  createSceneDiagnostic,
  type SceneDiagnostic,
} from '@forgeax/scene-authoring'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { firstDifference, type PackFingerprint } from './fingerprint.js'
import { appRoot, isPackaged } from '../resources.js'

const execFileAsync = promisify(execFile)

export interface PackVerification {
  /** Standalone generation and projection timing; native build also assembles typed assets. */
  readonly durationMs: number
}

/**
 * Proves the emitted tree is self-contained *and* identical, in one check.
 *
 * `verifyChild.ts` runs in its own process so nothing from this one — module
 * cache, host globals, battery registry — can make the pack look more portable
 * than it is. Comparing its vertex buffers against the in-app run is what backs
 * the "same scene as scene output" claim.
 */
export async function verifyEmittedPack(
  destDir: string,
  entryFile: string,
  expected: PackFingerprint,
): Promise<PackVerification> {
  const child = isPackaged
    ? resolve(appRoot, 'pack-resources/verify-child.mjs')
    : resolve(import.meta.dirname, 'verifyChild.ts')
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      ...(process.versions.bun ? [] : ['--import', 'tsx']),
      child,
      destDir,
      entryFile,
    ],
    { cwd: isPackaged ? appRoot : resolve(import.meta.dirname, '../..'), maxBuffer: 64 * 1024 * 1024 },
  )
  const line = stdout
    .trim()
    .split('\n')
    .reverse()
    .find((line) => line.startsWith('SCENE_PACK_VERIFIED:'))
  if (!line) throw new Error('Portable verification did not return a result')
  const report = JSON.parse(line.slice('SCENE_PACK_VERIFIED:'.length)) as {
    durationMs: number
    fingerprint: PackFingerprint
  }
  const difference = firstDifference(expected, report.fingerprint)
  if (difference)
    throw new Error(
      `Emitted pack does not reproduce the scene output — ${difference}`,
    )
  return { durationMs: report.durationMs }
}

/** Consumer time is additional to standalone generation: warn, never silently claim cook success. */
export function buildBudgetDiagnostics(
  durationMs: number,
  budgetMs = 5000,
): SceneDiagnostic[] {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0)
    throw new Error('consumerBuildBudgetMs must be positive and finite')
  if (durationMs <= budgetMs) return []
  return [
    createSceneDiagnostic({
      code: 'SCENE_PACK_CONSUMER_BUDGET',
      phase: 'verify',
      severity: 'warning',
      operation: 'pack:scene',
      message: `Standalone generation took ${durationMs} ms, exceeding the consumer build budget of ${budgetMs} ms before native asset assembly.`,
      expected: { consumerBuildBudgetMs: budgetMs },
      actual: { generationMs: durationMs },
      howToFix: [
        'Publish reusable building or district entries with smaller build costs.',
        'Optimize generation or configure and verify a larger consumer buildTimeoutMs.',
      ],
      documentationHint: 'docs/scene-asset-alignment-plan.md',
    }),
  ]
}
