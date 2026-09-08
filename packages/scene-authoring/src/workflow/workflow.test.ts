import { describe, expect, it } from 'vitest'

import {
  parseSceneSemanticAddress,
  requiresHumanGate,
  sceneSemanticAddress,
} from './workflow.js'

describe('persistent Scene Project workflow contracts', () => {
  it('keeps semantic addresses independent from paths and runtime ids', () => {
    const address = sceneSemanticAddress('module.east/settlement', 'inn-counter')
    expect(address).toBe('scene://authoring/module.east%2Fsettlement#inn-counter')
    expect(parseSceneSemanticAddress(address)).toEqual({
      moduleId: 'module.east/settlement',
      statementId: 'inn-counter',
    })
    expect(address).not.toContain('.scene.ts')
    expect(address).not.toContain('runtime')
  })

  it('requires a human gate for destructive and structural edits', () => {
    expect(requiresHumanGate([
      { type: 'removeCall', statementId: 'important-building' },
      { type: 'moveStatement', statementId: 'road', targetModuleId: 'module.other' },
    ], 'refactor settlement')).toEqual([
      'high-impact-intent',
      'important-deletion',
      'structural-refactor',
    ])
  })
})
