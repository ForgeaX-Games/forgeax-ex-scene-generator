import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  noteCompiledRevision,
  noteExecutedRevision,
  readSceneRevisionState,
  revisionStateSummary,
} from '../src/scene-script/agent/revisionState.js'

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('scene revision state', () => {
  it('separates source, artifact, execution, and last-good revisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'scene-revision-'))
    temporaryDirs.push(dir)

    await noteCompiledRevision(dir, 'project-1', 'rev-1', 'commit-project', 'hash-1')
    expect(revisionStateSummary(await readSceneRevisionState(dir, 'project-1'))).toMatchObject({
      sourceRevision: 'rev-1',
      artifactRevision: 'rev-1',
      executedRevision: null,
      compileOk: true,
      executionOk: null,
      verificationOk: null,
      evidenceAligned: false,
    })

    await noteExecutedRevision(dir, 'project-1', 'rev-1', 'exec-1', true, true)
    expect(revisionStateSummary(await readSceneRevisionState(dir, 'project-1'))).toMatchObject({
      executedRevision: 'rev-1',
      lastGoodRevision: 'rev-1',
      executionOk: true,
      verificationOk: true,
      evidenceAligned: true,
    })

    await noteCompiledRevision(dir, 'project-1', 'rev-2', 'commit-project', 'hash-2')
    await noteExecutedRevision(dir, 'project-1', 'rev-2', 'exec-2', false, false)
    expect(revisionStateSummary(await readSceneRevisionState(dir, 'project-1'))).toMatchObject({
      sourceRevision: 'rev-2',
      executedRevision: 'rev-2',
      lastGoodRevision: 'rev-1',
      executionOk: false,
      verificationOk: false,
    })
  })
})
