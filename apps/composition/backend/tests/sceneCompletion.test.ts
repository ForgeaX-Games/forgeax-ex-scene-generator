import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getScreenshotService } from '../src/agent/screenshot.service.js'
import { afterEach, describe, expect, it } from 'vitest'

import {
  noteAuthoringCommit,
  noteAuthoringExecute,
  reportRendererFrame,
  resetRendererStatusForTests,
} from '../src/agent/rendererStatus.js'
import { latestScreenshotRecord, noteScreenshotCaptureProject, setScreenshotEnabled } from '../src/agent/routes.js'
import {
  noteCompiledRevision,
  noteExecutedRevision,
} from '../src/scene-script/agent/revisionState.js'
import { inspectSceneCompletion } from '../src/routes/scene-script/completion.js'

const temporaryDirs: string[] = []

async function projectDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'scene-verification-'))
  temporaryDirs.push(dir)
  return dir
}

afterEach(async () => {
  resetRendererStatusForTests()
  setScreenshotEnabled(false)
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('revision readiness verification', () => {
  it('reports source, execution, and semantic verification independently', async () => {
    const dir = await projectDir()
    await noteCompiledRevision(dir, 'project-1', 'rev-1', 'commit-project', 'hash-1')

    const result = await inspectSceneCompletion('project-1', dir)

    expect(result.ok).toBe(false)
    expect(result.reasons).toEqual(expect.arrayContaining([
      'execution-revision-mismatch',
      'execution-failed-or-missing',
      'semantic-verification-failed-or-missing',
    ]))
  })

  it('accepts aligned visible output without requiring a screenshot receipt', async () => {
    const dir = await projectDir()
    const projectId = 'project-authored'
    const revision = 'rev-authored'
    const executionId = 'exec-authored'
    await noteCompiledRevision(dir, projectId, revision, 'commit-project', 'hash')
    await noteExecutedRevision(dir, projectId, revision, executionId, true, true)
    noteAuthoringCommit({ projectId, revision })
    noteAuthoringExecute({ projectId, revision, executionId })
    reportRendererFrame({
      viewingProjectId: projectId,
      openProjectId: projectId,
      projectRevision: revision,
      executionId,
      executionStatus: 'completed',
      meshLayers: 1,
      frameDigest: 'frame-authored',
      reportedAt: new Date().toISOString(),
    })

    const result = await inspectSceneCompletion(projectId, dir)

    expect(result).toMatchObject({ ok: true, reasons: [] })
    expect(result.nextAction).toContain('Look at Default')
    expect(result.nextAction).not.toMatch(/Deliver design|Structural verification complete/)
    expect(result).not.toHaveProperty('receipt')
  })

  it('returns a screenshot only as current visual evidence', async () => {
    const dir = await projectDir()
    const projectId = 'project-with-capture'
    const revision = 'rev-capture'
    const executionId = 'exec-capture'
    await noteCompiledRevision(dir, projectId, revision, 'commit-project', 'hash')
    await noteExecutedRevision(dir, projectId, revision, executionId, true, true)
    noteAuthoringCommit({ projectId, revision })
    noteAuthoringExecute({ projectId, revision, executionId })
    reportRendererFrame({
      viewingProjectId: projectId,
      openProjectId: projectId,
      projectRevision: revision,
      executionId,
      executionStatus: 'completed',
      meshLayers: 1,
      frameDigest: 'frame-capture',
      reportedAt: new Date().toISOString(),
    })
    setScreenshotEnabled(true)
    const service = getScreenshotService()
    const pending = service.createCapture(1000)
    noteScreenshotCaptureProject(pending.captureId, projectId)
    service.resolveCapture(pending.captureId, {
      captureId: pending.captureId,
      dataUrl: 'data:image/png;base64,AA==',
      width: 320,
      height: 200,
      capturedAt: new Date(Date.now() + 10).toISOString(),
    })
    await pending.promise
    expect(latestScreenshotRecord()?.captureId).toBe(pending.captureId)

    const result = await inspectSceneCompletion(projectId, dir)

    expect(result.evidence.screenshot).toEqual(expect.objectContaining({
      captureId: pending.captureId,
      current: true,
    }))
  })

  it('accepts voxel layers as visible scene content without a mesh', async () => {
    const dir = await projectDir()
    const projectId = 'project-voxel-visible'
    const revision = 'rev-voxel'
    const executionId = 'exec-voxel'
    await noteCompiledRevision(dir, projectId, revision, 'commit-project', 'hash')
    await noteExecutedRevision(dir, projectId, revision, executionId, true, true)
    noteAuthoringCommit({ projectId, revision })
    noteAuthoringExecute({ projectId, revision, executionId })
    reportRendererFrame({
      viewingProjectId: projectId,
      openProjectId: projectId,
      projectRevision: revision,
      executionId,
      executionStatus: 'completed',
      voxelLayers: 9,
      meshLayers: 0,
      frameDigest: 'frame-voxel',
      reportedAt: new Date().toISOString(),
    })

    const result = await inspectSceneCompletion(projectId, dir)

    expect(result.ok).toBe(true)
    expect(result.evidence.renderer).toEqual(expect.objectContaining({
      representation: expect.objectContaining({
        hasVoxelContent: true,
        hasVisibleSceneContent: true,
      }),
    }))
  })

  it('accepts valued grid layers as visible scene content without a mesh', async () => {
    const dir = await projectDir()
    const projectId = 'project-grid-visible'
    const revision = 'rev-grid'
    const executionId = 'exec-grid'
    await noteCompiledRevision(dir, projectId, revision, 'commit-project', 'hash')
    await noteExecutedRevision(dir, projectId, revision, executionId, true, true)
    noteAuthoringCommit({ projectId, revision })
    noteAuthoringExecute({ projectId, revision, executionId })
    reportRendererFrame({
      viewingProjectId: projectId,
      openProjectId: projectId,
      projectRevision: revision,
      executionId,
      executionStatus: 'completed',
      gridLayers: 4,
      meshLayers: 0,
      frameDigest: 'frame-grid',
      reportedAt: new Date().toISOString(),
    })

    const result = await inspectSceneCompletion(projectId, dir)

    expect(result.ok).toBe(true)
  })

  it('accepts mesh together with voxel layers', async () => {
    const dir = await projectDir()
    const projectId = 'project-mesh-plus-voxels'
    const revision = 'rev-mesh'
    const executionId = 'exec-mesh'
    await noteCompiledRevision(dir, projectId, revision, 'commit-project', 'hash')
    await noteExecutedRevision(dir, projectId, revision, executionId, true, true)
    noteAuthoringCommit({ projectId, revision })
    noteAuthoringExecute({ projectId, revision, executionId })
    reportRendererFrame({
      viewingProjectId: projectId,
      openProjectId: projectId,
      projectRevision: revision,
      executionId,
      executionStatus: 'completed',
      voxelLayers: 2,
      meshLayers: 1,
      frameDigest: 'frame-mesh',
      reportedAt: new Date().toISOString(),
    })

    const result = await inspectSceneCompletion(projectId, dir)

    expect(result.ok).toBe(true)
  })
})
