import { describe, expect, it, vi } from 'vitest'
import {
  ALPINE_FACTORY_POINTS,
  applyAlpineFactoryReset,
  restoreAlpineFactorySource,
} from '../alpineFactoryReset'

const corrupted = `// @scene-module-id module.alpineValley

// @scene-id stmt_peaks
const mountainPeaks = controlPoints({
  points: [{
    path: [0, 0],
    items: [[66, 105]],
  }, {
    path: [0, 1],
    items: [[42, 8]],
  }],
})

// @scene-id stmt_river
const riverPath = controlPoints({
  points: [{
    path: [0, 0],
    items: [[0, 52]],
  }, {
    path: [0, 1],
    items: [[41, 56]],
  }],
})

// @scene-id stmt_plaza
const plazaCenterPts = controlPoints({
  points: [{
    path: [0, 0],
    items: [[34, 100]],
  }],
})

const vField = valleyHeightfield({
  width: 64,
  height: 64,
  valleyDepth: 12,
  valleyWidth: 10,
  riverDepth: 1,
  riverWidth: 4,
  ridgeNoise: 1,
  seed: 79,
  baseElevation: 1,
  peaks: mountainPeaks.points,
  riverPoints: riverPath.points,
  erosionStrength: 0.1,
  terraceSteps: 2,
  plazaCenter: plazaCenter.item,
  plazaRadius: 15.3,
})

const network = villageRoadNetwork({
  plazaCenter: plazaCenter.item,
  plazaRadius: 15.3,
  riverPoints: riverPath.points,
  riverWidth: 4,
  seed: 79,
})
`

describe('restoreAlpineFactorySource', () => {
  it('flattens datatree control points and restores designed numbers', () => {
    const next = restoreAlpineFactorySource(corrupted)
    expect(next).toContain('// @scene-id stmt_peaks')
    expect(next).toContain(`points: ${JSON.stringify(ALPINE_FACTORY_POINTS.mountainPeaks).replace(/,/g, ', ')}`)
    expect(next).toContain(`points: ${JSON.stringify(ALPINE_FACTORY_POINTS.riverPath).replace(/,/g, ', ')}`)
    expect(next).toContain('points: [[72, 66]]')
    expect(next).not.toContain('path: [0, 0]')
    expect(next).toContain('valleyDepth: 42')
    expect(next).toContain('valleyWidth: 32')
    expect(next).toContain('ridgeNoise: 4.6')
    expect(next).toContain('seed: 27')
    expect(next).toContain('plazaRadius: 7.4')
    expect(next).not.toContain('plazaRadius: 15.3')
  })
})

describe('applyAlpineFactoryReset', () => {
  it('saves the restored valley document then full-executes', async () => {
    const saveModule = vi.fn(async () => ({}))
    const execute = vi.fn(async () => {})
    const result = await applyAlpineFactoryReset({
      getModule: async () => ({ file: 'valley.scene.ts', source: corrupted, revision: 'rev-1' }),
      saveModule,
      execute,
    })
    expect(result).toEqual({ ok: true, changed: true })
    expect(saveModule).toHaveBeenCalledTimes(1)
    expect(saveModule.mock.calls[0]![0]).toEqual(expect.objectContaining({
      file: 'valley.scene.ts',
      expectedRevision: 'rev-1',
      canonicalize: false,
      label: 'Reset Alpine Valley factory',
    }))
    expect(saveModule.mock.calls[0]![0].source).toContain('points: [[72, 66]]')
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.invocationCallOrder[0]).toBeGreaterThan(saveModule.mock.invocationCallOrder[0]!)
  })

  it('returns the save error and does not execute when the document write fails', async () => {
    const execute = vi.fn(async () => {})
    const result = await applyAlpineFactoryReset({
      getModule: async () => ({ file: 'valley.scene.ts', source: corrupted, revision: 'rev-1' }),
      saveModule: async () => { throw new Error('SCENE_RESULT_CAPTURE_REQUIRED') },
      execute,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('SCENE_RESULT_CAPTURE_REQUIRED')
    expect(execute).not.toHaveBeenCalled()
  })
})
