import { afterEach, describe, expect, it } from 'vitest'

import {
  dedupeRead,
  noteAuthoringMutation,
  READ_DEDUPE_NEXT_ACTION,
  resetReadDedupeForTests,
} from '../src/scene-script/agent/readDedupe.js'

afterEach(() => {
  resetReadDedupeForTests()
})

const caller = { kind: 'ai', sessionId: 's1', agentId: 'sino' }

describe('semantic read dedupe', () => {
  it('returns a short unchanged payload for the same session/project/revision', () => {
    const payload = { projectRevision: 'rev-1', source: 'huge '.repeat(200), file: 'main.scene.ts' }
    const first = dedupeRead({
      caller,
      tool: 'get',
      projectId: 'p1',
      revision: 'rev-1',
      extra: 'main.scene.ts',
      payload,
    })
    expect(first.unchanged).toBe(false)
    expect(first.delivered).toEqual(payload)

    const second = dedupeRead({
      caller,
      tool: 'get',
      projectId: 'p1',
      revision: 'rev-1',
      extra: 'main.scene.ts',
      payload,
    })
    expect(second.unchanged).toBe(true)
    expect(second.delivered).toMatchObject({
      unchanged: true,
      projectRevision: 'rev-1',
      nextAction: READ_DEDUPE_NEXT_ACTION,
    })
    expect(JSON.stringify(second.delivered)).not.toContain('huge')
  })

  it('delivers new content after a mutation or revision change', () => {
    const payload = { projectRevision: 'rev-1', source: 'one' }
    dedupeRead({ caller, tool: 'get', projectId: 'p1', revision: 'rev-1', extra: 'main.scene.ts', payload })
    noteAuthoringMutation(caller, 'p1')
    const afterMutation = dedupeRead({
      caller,
      tool: 'get',
      projectId: 'p1',
      revision: 'rev-2',
      extra: 'main.scene.ts',
      payload: { projectRevision: 'rev-2', source: 'two' },
    })
    expect(afterMutation.unchanged).toBe(false)
    expect(afterMutation.delivered).toEqual({ projectRevision: 'rev-2', source: 'two' })
  })

  it('does not block recovery when force is set', () => {
    const payload = { source: 'again' }
    dedupeRead({ caller, tool: 'open', projectId: 'p1', revision: 'rev-1', payload })
    const forced = dedupeRead({
      caller,
      tool: 'open',
      projectId: 'p1',
      revision: 'rev-1',
      payload,
      force: true,
    })
    expect(forced.unchanged).toBe(false)
    expect(forced.delivered).toEqual(payload)
  })
})
