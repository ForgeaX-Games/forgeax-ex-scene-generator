import { describe, expect, it } from 'vitest'

import { isMissingExecuteTarget, pickExecuteTargetAfterRemap } from '../stores/pipelineExecution.js'

describe('pickExecuteTargetAfterRemap', () => {
  it('keeps the requested id when the kernel still has it', () => {
    expect(pickExecuteTargetAfterRemap('n1', ['n1'], ['n1'])).toEqual({ startNodeId: 'n1' })
  })

  it('executes the single newly compiled entity after a drop remap', () => {
    expect(pickExecuteTargetAfterRemap(
      'canvas-minted',
      ['empty', 'canvas-minted'],
      ['empty', 'compiled-noise'],
    )).toEqual({ startNodeId: 'compiled-noise' })
  })

  it('falls back to a full execute when many ids changed', () => {
    expect(pickExecuteTargetAfterRemap(
      'canvas-minted',
      ['a', 'canvas-minted'],
      ['b', 'c', 'd'],
    )).toBeUndefined()
  })
})

describe('isMissingExecuteTarget', () => {
  it('detects the kernel unknown-target error', () => {
    expect(isMissingExecuteTarget({
      status: 'error',
      error: { message: 'executeNode: target node not found: canvas-minted' },
    })).toBe(true)
    expect(isMissingExecuteTarget({ status: 'completed' })).toBe(false)
  })
})
