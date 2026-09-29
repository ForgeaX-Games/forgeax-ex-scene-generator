import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveNarrativeLocationNames } from '../src/resolve-narrative-names.js'

describe('resolveNarrativeLocationNames', () => {
  it('reads names from checklist via run-project sceneProjectId', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'aw-runs-'))
    const runDir = join(runsDir, 'run-a')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'run-project.json'), JSON.stringify({ sceneProjectId: 'p_x' }))
    writeFileSync(
      join(runDir, 'scene-composition-checklist.json'),
      JSON.stringify({ narrativeLocationNames: ['A', 'B'] }),
    )
    expect(resolveNarrativeLocationNames({ AW_SUPPORT_RUNS_DIR: runsDir }, [], 'p_x')).toEqual(['A', 'B'])
  })

  it('falls back to location contract', () => {
    const runsDir = mkdtempSync(join(tmpdir(), 'aw-runs-'))
    const runDir = join(runsDir, 'run-b')
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, 'run-project.json'), JSON.stringify({ sceneProjectId: 'p_y' }))
    writeFileSync(
      join(runDir, 'location-layout-contract.json'),
      JSON.stringify({ entries: [{ id: 'loc1', displayName: '地点一' }] }),
    )
    expect(resolveNarrativeLocationNames({ AW_SUPPORT_RUNS_DIR: runsDir }, [], 'p_y')).toEqual(['地点一'])
  })
})
