import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../src/main.js'

const workspaceRoot = mkdtempSync(join(tmpdir(), 'wb-scene-agent-workflow-'))
process.env.FORGEAX_PROJECT_ROOT = workspaceRoot

describe('persistent Scene Project Agent workflow', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  let projectId: string

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    const created = await app.inject({ method: 'POST', url: '/api/v1/projects', payload: { name: 'Agent workflow' } })
    projectId = (created.json() as { id: string }).id
    const authored = await app.inject({
      method: 'PUT',
      url: `/api/v1/projects/${projectId}/scene-script`,
      payload: {
        source: `// @scene-module-id module.main
// @scene-id base
export const base = emptyScene({})
// @scene-id output
sceneOutput({ scene: base })
`,
      },
    })
    expect(authored.statusCode, authored.body).toBe(200)
  })

  afterAll(async () => {
    await app.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  async function locate(body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/locate`,
      payload: body,
    })
  }

  async function propose(body: Record<string, unknown>) {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/propose`,
      payload: body,
    })
    expect(response.statusCode, response.body).toBe(200)
    return response.json() as { transactionId: string; humanGate: { required: boolean } }
  }

  it('resolves UI selections deterministically and asks for ambiguous queries', async () => {
    const selected = await locate({ selection: { authoringIds: ['base'] }, query: 'this' })
    expect(selected.statusCode).toBe(200)
    expect(selected.json()).toEqual(expect.objectContaining({
      requiresClarification: false,
      bounded: true,
      candidates: [expect.objectContaining({
        statementId: 'base',
        confidence: 1,
        semanticAddress: 'scene://authoring/module.main#base',
      })],
    }))

    const ambiguous = await locate({ query: 'module.main' })
    expect(ambiguous.json()).toEqual(expect.objectContaining({
      requiresClarification: true,
      candidates: expect.arrayContaining([expect.objectContaining({ confidence: .62 })]),
    }))
  })

  it('opens a bounded lens with no full Runtime Graph or DataTree payload', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/lens`,
      payload: { targetIds: ['output'] },
    })
    expect(response.statusCode, response.body).toBe(200)
    const lens = response.json()
    expect(lens).toEqual(expect.objectContaining({
      payload: 'bounded-no-runtime-graph',
      targetIds: expect.any(Array),
      directDependencies: expect.any(Array),
      directConsumers: expect.any(Array),
      invariants: expect.arrayContaining([expect.objectContaining({ id: 'acceptance-frozen', frozen: true })]),
      allowedWriteScope: ['module.main'],
    }))
    expect(JSON.stringify(lens)).not.toMatch(/"nodes"|"edges"|"DataTree"/u)
  })

  it('runs preview, local verify with read-only Critic, accept, and checkpoint resume', async () => {
    const transaction = await propose({
      intent: 'add a local decoration source',
      targetIds: ['base'],
      writableModuleIds: ['module.main'],
      commands: [{ type: 'addCall', moduleId: 'module.main', statementId: 'agent-added', binding: 'agentAdded', functionName: 'emptyScene' }],
      expectedSemanticDelta: [{ entityId: 'agent-added', change: 'created' }],
    })
    const applied = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${transaction.transactionId}/apply`,
      payload: {},
    })
    expect(applied.statusCode, applied.body).toBe(200)
    expect(applied.json()).toEqual(expect.objectContaining({
      status: 'preview',
      semanticDiff: expect.objectContaining({
        directlyChanged: ['agent-added'],
        expectedDeltaMatches: true,
        payload: 'semantic-summary',
      }),
    }))

    const verified = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${transaction.transactionId}/verify`,
      payload: { profile: 'local' },
    })
    expect(verified.json()).toEqual(expect.objectContaining({
      ok: true,
      profile: 'local',
      frozenStandardsPreserved: true,
      critic: { readOnly: true, verdict: 'approve', findings: [] },
    }))

    const accepted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${transaction.transactionId}/decision`,
      payload: { decision: 'accept' },
    })
    expect(accepted.json()).toEqual(expect.objectContaining({ status: 'accepted', checkpoint: expect.any(Object) }))

    const resumed = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-agent/resume`,
    })
    expect(resumed.json()).toEqual(expect.objectContaining({
      projectSummary: expect.any(Object),
      health: expect.objectContaining({ canonical: true }),
      payload: 'bounded-resume-context',
    }))
  })

  it('rejects scope violations and stale transaction conflicts', async () => {
    const scoped = await propose({
      intent: 'unauthorized target',
      targetIds: ['base'],
      writableModuleIds: [],
      commands: [{ type: 'removeCall', moduleId: 'module.main', statementId: 'base' }],
    })
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${scoped.transactionId}/apply`,
      payload: { humanApproved: true },
    })
    expect(denied.statusCode).toBe(403)
    expect(denied.json()).toEqual(expect.objectContaining({ code: 'scene-edit-scope-violation' }))

    const stale = await propose({
      intent: 'stale edit',
      targetIds: ['base'],
      commands: [{ type: 'renameBinding', moduleId: 'module.main', statementId: 'base', binding: 'renamedBase' }],
    })
    const current = (await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
    })).json()
    await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-script/commands`,
      payload: {
        expectedProjectRevision: current.state.projectRevision,
        commands: [{ type: 'addCall', moduleId: 'module.main', statementId: 'concurrent', binding: 'concurrent', functionName: 'emptyScene' }],
      },
    })
    const conflicted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${stale.transactionId}/apply`,
      payload: {},
    })
    expect(conflicted.statusCode).toBe(409)
    expect(conflicted.json()).toEqual(expect.objectContaining({ code: 'scene-edit-stale' }))
  })

  it('rolls back mismatched semantic deltas and supports explicit revert', async () => {
    const mismatch = await propose({
      intent: 'mismatched edit',
      targetIds: ['base'],
      commands: [{ type: 'addCall', moduleId: 'module.main', statementId: 'will-rollback', binding: 'willRollback', functionName: 'emptyScene' }],
      expectedSemanticDelta: [{ entityId: 'different-id', change: 'created' }],
    })
    const failed = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${mismatch.transactionId}/apply`,
      payload: {},
    })
    expect(failed.statusCode, failed.body).toBe(422)
    expect(failed.json()).toEqual(expect.objectContaining({
      code: 'scene-edit-semantic-delta-mismatch',
      transaction: { applied: false, rolledBack: true },
    }))
    const sourceAfterRollback = (await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/scene-script`,
    })).json().source as string
    expect(sourceAfterRollback).not.toContain('will-rollback')

    const reversible = await propose({
      intent: 'preview then revert',
      targetIds: ['base'],
      commands: [{ type: 'addCall', moduleId: 'module.main', statementId: 'reversible', binding: 'reversible', functionName: 'emptyScene' }],
      expectedSemanticDelta: [{ entityId: 'reversible', change: 'created' }],
    })
    expect((await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${reversible.transactionId}/apply`,
      payload: {},
    })).statusCode).toBe(200)
    const reverted = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${reversible.transactionId}/decision`,
      payload: { decision: 'revert' },
    })
    expect(reverted.json()).toEqual(expect.objectContaining({ status: 'reverted' }))
  })

  it('blocks destructive edits behind a Human Gate', async () => {
    const transaction = await propose({
      intent: 'delete important content',
      targetIds: ['concurrent'],
      commands: [{ type: 'removeCall', moduleId: 'module.main', statementId: 'concurrent' }],
    })
    expect(transaction.humanGate.required).toBe(true)
    const blocked = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/scene-agent/transactions/${transaction.transactionId}/apply`,
      payload: {},
    })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json()).toEqual(expect.objectContaining({ status: 'human-gate-required' }))
  })
})
