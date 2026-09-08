import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'

// Regression coverage for the "agent conversation dies on a tool call" reports,
// all rooted in lowpoly never following the kernel's split open/claim model
// (wb-scene-generator did):
//
//   1. `/close` called releaseProjectLock, which only drops the write lock and
//      leaves the shared session behind — so the agent got a permanent
//      `agent-holds-another` on every attempt to open a second project.
//   2. Mutation routes only *checked* for a write lock that nothing ever
//      claimed, so every AI applyBatch/execute 403'd `mutation-denied-not-open`
//      and the tool seam's re-open-and-replay recovery looped into the same 403.

const AI = { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'lowpoly' }

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-agent-lock-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

async function createProject(app: Awaited<ReturnType<typeof buildApp>>, name: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name } })
  expect(res.statusCode).toBe(201)
  return res.json().id as string
}

describe('agent lock lifecycle', () => {
  it('close releases the shared session so the agent can open another project', async () => {
    const app = await buildApp()
    try {
      const a = await createProject(app, 'A')
      const b = await createProject(app, 'B')

      expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${a}/open`, headers: AI })).statusCode).toBe(200)

      // Still attached to A — opening B must be refused with a recoverable reason.
      const blocked = await app.inject({ method: 'POST', url: `/api/v1/projects/${b}/open`, headers: AI })
      expect(blocked.statusCode).toBe(409)
      expect(blocked.json().code).toBe('agent-holds-another')

      expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${a}/close`, headers: AI })).statusCode).toBe(200)

      const reopened = await app.inject({ method: 'POST', url: `/api/v1/projects/${b}/open`, headers: AI })
      expect(reopened.statusCode).toBe(200)
      const mine = await app.inject({ method: 'GET', url: '/api/v1/workspace/mine', headers: AI })
      expect(mine.json()).toEqual({ openProjectId: b, holdsWriteLock: false })
    } finally {
      await app.close()
    }
  })

  it('an AI mutation claims the write lock instead of 403-ing mutation-denied-not-open', async () => {
    const app = await buildApp()
    try {
      const id = await createProject(app, 'A')
      await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/open`, headers: AI })

      // Soft open alone must NOT hold the write lock.
      expect((await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/lock` })).json().lock).toBeNull()

      const applied = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/batch`,
        headers: { ...AI, 'content-type': 'application/json' },
        payload: { ops: [] },
      })
      expect(applied.statusCode).not.toBe(403)

      // The mutation itself claimed the lock, and it stays held for follow-ups.
      expect((await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/lock` })).json().lock).toMatchObject({
        agentId: 'lowpoly',
      })
      expect((await app.inject({ method: 'GET', url: '/api/v1/workspace/mine', headers: AI })).json()).toEqual({
        openProjectId: id,
        holdsWriteLock: true,
      })
    } finally {
      await app.close()
    }
  })

  it('heartbeat renews a held lock and rejects an agent holding nothing', async () => {
    const app = await buildApp()
    try {
      const id = await createProject(app, 'A')
      await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/open`, headers: AI })

      // No write lock yet — nothing to renew.
      const early = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/heartbeat`, headers: AI })
      expect(early.statusCode).toBe(409)
      expect(early.json().code).toBe('mutation-denied-not-open')

      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/batch`,
        headers: { ...AI, 'content-type': 'application/json' },
        payload: { ops: [] },
      })

      const beat = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/heartbeat`, headers: AI })
      expect(beat.statusCode).toBe(200)
      expect(beat.json().lock).toMatchObject({ agentId: 'lowpoly' })
    } finally {
      await app.close()
    }
  })

  it('force-unlock is human-only and fully frees a project', async () => {
    const app = await buildApp()
    try {
      const a = await createProject(app, 'A')
      const b = await createProject(app, 'B')
      await app.inject({ method: 'POST', url: `/api/v1/projects/${a}/open`, headers: AI })
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${a}/batch`,
        headers: { ...AI, 'content-type': 'application/json' },
        payload: { ops: [] },
      })

      const denied = await app.inject({ method: 'POST', url: `/api/v1/projects/${a}/force-unlock`, headers: AI })
      expect(denied.statusCode).toBe(403)

      const forced = await app.inject({ method: 'POST', url: `/api/v1/projects/${a}/force-unlock` })
      expect(forced.statusCode).toBe(200)

      expect((await app.inject({ method: 'GET', url: `/api/v1/projects/${a}/lock` })).json().lock).toBeNull()
      // The agent's session is gone too, so it is free to work elsewhere.
      expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${b}/open`, headers: AI })).statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })

  it('queue status is side-effect free and reports a busy project\'s waiters', async () => {
    const app = await buildApp()
    try {
      const id = await createProject(app, 'A')
      const other = { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'other' }
      await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/open`, headers: AI })
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${id}/batch`,
        headers: { ...AI, 'content-type': 'application/json' },
        payload: { ops: [] },
      })

      // Another agent may still soft-open and read without joining any queue.
      expect((await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/open`, headers: other })).statusCode).toBe(200)
      const queue = await app.inject({ method: 'GET', url: `/api/v1/projects/${id}/queue`, headers: other })
      expect(queue.json()).toEqual({ queue: [] })

      const left = await app.inject({ method: 'POST', url: `/api/v1/projects/${id}/queue/leave`, headers: other })
      expect(left.statusCode).toBe(200)
    } finally {
      await app.close()
    }
  })
})
