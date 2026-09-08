import { describe, expect, it } from 'vitest'

import {
  createSceneDiagnostic,
  formatSceneDiagnosticRepairSlip,
  SCENE_DIAGNOSTIC_POLICIES,
  toPublicSceneDiagnostics,
  type SceneDiagnosticPhase,
} from '../index.js'

describe('Scene Script diagnostic contract', () => {
  it('defines retry and escalation policy for every phase', () => {
    const phases: SceneDiagnosticPhase[] = [
      'parse',
      'type',
      'resolve',
      'compile',
      'execute',
      'verify',
      'platform',
      'capability',
    ]
    expect(Object.keys(SCENE_DIAGNOSTIC_POLICIES).sort()).toEqual([...phases].sort())
    for (const phase of phases) {
      const diagnostic = createSceneDiagnostic({
        code: `TEST_${phase.toUpperCase()}`,
        phase,
        severity: 'error',
        message: `${phase} failed`,
      })
      expect(diagnostic.retryable).toBe(SCENE_DIAGNOSTIC_POLICIES[phase].retryable)
      expect(diagnostic.escalation).toBe(SCENE_DIAGNOSTIC_POLICIES[phase].escalation)
    }
  })

  it('preserves legacy fields while adding graph location and a structured fix', () => {
    const diagnostic = createSceneDiagnostic({
      code: 'SCENE_COMPILE_REST_CONSUMED',
      phase: 'compile',
      severity: 'error',
      message: 'Rest was consumed twice.',
      statementId: 'decorate.background',
      operation: 'distributeNature',
      source: {
        file: 'main.scene.ts',
        start: 120,
        end: 142,
        line: 8,
        column: 3,
      },
      fixes: [{
        fixId: 'use-latest-rest',
        title: 'Use mountain.rest',
        edits: [{
          type: 'ReplaceReference',
          statementId: 'decorate.background',
          argument: 'scene',
          sourceStatementId: 'terrain.mountain',
          sourceOutput: 'rest',
        }],
      }],
    })
    expect(diagnostic).toEqual(expect.objectContaining({
      code: 'SCENE_COMPILE_REST_CONSUMED',
      phase: 'compile',
      severity: 'error',
      message: 'Rest was consumed twice.',
      statementId: 'decorate.background',
      graph: { authoringNodeId: 'decorate.background' },
      retryable: true,
      escalation: 'compiler',
    }))
    expect(diagnostic.source?.statementId).toBe('decorate.background')
    expect(diagnostic.fixes?.[0].edits[0]).toEqual(expect.objectContaining({ type: 'ReplaceReference' }))
  })

  it('limits related errors, fixes, and hidden large payloads', () => {
    const diagnostics = Array.from({ length: 8 }, (_, index) => createSceneDiagnostic({
      code: `SCENE_TEST_${index}`,
      phase: 'execute',
      severity: 'error',
      message: `failure ${index}`,
      actual: {
        stack: 'private stack',
        runtimeGraph: { nodes: Array.from({ length: 1_000 }, () => ({ payload: 'x'.repeat(100) })) },
        safe: 'x'.repeat(20_000),
      },
      fixes: Array.from({ length: 8 }, (__, fixIndex) => ({
        fixId: `fix-${fixIndex}`,
        title: `Fix ${fixIndex}`,
        edits: [],
      })),
    }))
    const result = toPublicSceneDiagnostics(diagnostics)
    expect(result).toHaveLength(3)
    expect(result[0].fixes).toHaveLength(3)
    expect(JSON.stringify(result)).not.toContain('private stack')
    expect(JSON.stringify(result)).not.toContain('runtimeGraph')
    expect(JSON.stringify(result).length).toBeLessThan(10_000)
  })

  it('assembles a repair slip from structured fields for humans and agents', () => {
    const diagnostic = createSceneDiagnostic({
      code: 'SCENE_TYPE_REQUIRED_INPUT',
      phase: 'type',
      severity: 'error',
      message: 'Missing required input plane.',
      operation: 'workGrid',
      signature: 'workGrid({ plane, cellSize })',
      possibleCauses: ['The upstream basePlane was not connected.'],
      howToFix: ['Connect an existing plane to workGrid.plane.'],
      source: {
        file: 'main.scene.ts',
        start: 40,
        end: 80,
        line: 12,
        column: 1,
        statementId: 'grid',
      },
      actual: { stack: 'Error: private stack\n    at battery' },
    })
    expect(diagnostic.code).toBe('SCENE_TYPE_REQUIRED_INPUT')
    expect(diagnostic.repairSlip).toContain('Operation: workGrid')
    expect(diagnostic.repairSlip).toContain('How to fix:')
    expect(diagnostic.repairSlip).toContain('Connect an existing plane to workGrid.plane.')
    expect(diagnostic.repairSlip).toContain('Phase: type')
    expect(diagnostic.repairSlip).not.toContain('private stack')
    const publicPayload = toPublicSceneDiagnostics([diagnostic])
    expect(publicPayload[0]?.code).toBe('SCENE_TYPE_REQUIRED_INPUT')
    expect(JSON.stringify(publicPayload)).not.toContain('private stack')
    expect(formatSceneDiagnosticRepairSlip(diagnostic)).toBe(diagnostic.repairSlip)
  })
})
