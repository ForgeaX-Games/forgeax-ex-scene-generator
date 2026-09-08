import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/main.js'
import { resetRuntimeForTests } from '../src/runtime.js'

// Regression coverage for two bugs reported as "agent conversations abruptly
// fail / path errors" when the agent works on any project other than the
// legacy default ("main") one:
//
//   1. `projects.open` (AI caller) never made the opened project the renderer's
//      "viewing" project, so `screenshot.capture` / `export-glb` (both gated
//      on `resolveAgentTarget`, which requires projectId === viewing) 409'd
//      with "project X is not the viewing project" for any project besides
//      whatever a human happened to be looking at — and no AI-facing tool
//      could switch it. See ProjectRegistry.openProject().
//
//   2. Every project's asset resolver silently pointed at the SAME global
//      `<workspaceRoot>/assets` folder (missing `layout.assetsDir` override in
//      createRuntime), so `lowpoly:assets.list` could never find what
//      `lowpoly:export-glb` had just written under the project's own
//      `<workspaceRoot>/projects/<id>/assets/` directory. See runtime.ts.

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'wb3d-agent-scoping-'))
  process.env.FORGEAX_PROJECT_ROOT = root
})

afterEach(() => {
  resetRuntimeForTests()
  rmSync(root, { recursive: true, force: true })
  delete process.env.FORGEAX_PROJECT_ROOT
})

describe('agent project scoping', () => {
  it('an AI projects.open makes the project the viewing project', async () => {
    const app = await buildApp()
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/v1/projects',
        payload: { name: 'Robot' },
      })
      expect(created.statusCode).toBe(201)
      const projectId = created.json().id as string

      // Before open: viewing is still the backfilled default project.
      const before = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
      expect(before.json()).toEqual(expect.objectContaining({ viewingProjectId: 'main' }))

      const opened = await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/open`,
        headers: { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'agent-1' },
      })
      expect(opened.statusCode).toBe(200)

      const after = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
      expect(after.json()).toEqual(expect.objectContaining({ viewingProjectId: projectId }))
    } finally {
      await app.close()
    }
  })

  it('workspace surfaces the caller-agent\'s own locked project even when viewing points elsewhere', async () => {
    const app = await buildApp()
    try {
      const a = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'A' } })
      const b = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'B' } })
      const projA = a.json().id as string
      const projB = b.json().id as string

      // agent-1 opens A (viewing → A), then agent-2 opens B — an AI open also
      // sets the shared viewing pointer, so viewing is now B, NOT agent-1's A.
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projA}/open`,
        headers: { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'agent-1' },
      })
      await app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projB}/open`,
        headers: { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'agent-2' },
      })

      // agent-1's workspace view must still resolve to A via its own lock — this
      // is what resolveProjectId prefers so an omitted-projectId mutation from
      // agent-1 targets A (its lock), not B (the globally-shared viewing).
      const ws1 = await app.inject({
        method: 'GET',
        url: '/api/v1/workspace',
        headers: { 'x-forgeax-caller-kind': 'ai', 'x-forgeax-caller-agent-id': 'agent-1' },
      })
      expect(ws1.json()).toEqual(
        expect.objectContaining({ viewingProjectId: projB, agentProjectId: projA }),
      )
    } finally {
      await app.close()
    }
  })

  it('a human open (no ai caller header) does not steal viewing from an agent', async () => {
    const app = await buildApp()
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Robot' } })
      const projectId = created.json().id as string

      const opened = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/open` })
      expect(opened.statusCode).toBe(200)

      const workspace = await app.inject({ method: 'GET', url: '/api/v1/workspace' })
      // Non-AI callers bypass the lock/viewing gate entirely (see
      // acquireProjectLock: `if (caller.kind !== 'ai') return { ok: true }`),
      // so viewing is untouched — only an AI open follows the project.
      expect(workspace.json()).toEqual(expect.objectContaining({ viewingProjectId: 'main' }))
    } finally {
      await app.close()
    }
  })

  it('assets.list for a non-default project resolves under that project\'s own dir, matching export-glb', async () => {
    const app = await buildApp()
    try {
      const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Robot' } })
      const projectId = created.json().id as string

      // Simulate what /api/v1/agent/glb/store writes: a file under
      // <workspaceRoot>/projects/<id>/assets/3d/<name>.glb (see agent/routes.ts
      // getProjectDir()).
      const projectAssetsDir = join(root, 'projects', projectId, 'assets', '3d')
      mkdirSync(projectAssetsDir, { recursive: true })
      writeFileSync(join(projectAssetsDir, 'robot.glb'), 'glb-bytes')

      const listed = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/assets?type=3d&suffix=.glb`,
      })
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual({
        items: [expect.objectContaining({ type: '3d', relPath: '3d/robot.glb' })],
      })
    } finally {
      await app.close()
    }
  })
})
