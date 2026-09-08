import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { SceneContractRegistry, type AcceptanceGateId } from '@forgeax/scene-authoring'
import {
  applyAcceptanceCoverage,
  getBatteryCategories,
  scanBatteryCategories,
  type BatteryUiMeta,
} from './batteryCategories.js'

const allGates: AcceptanceGateId[] = [
  'contract',
  'roundTrip',
  'graphWriteBack',
  'execute',
  'sourceMap',
  'capability',
  'visual',
]

describe('scanBatteryCategories', () => {
  it('includes iconSvg when an op directory has icon.svg', async () => {
    const root = await mkdtemp(join(tmpdir(), `scene-battery-icons-${process.pid}-`))
    const batteryDir = join(root, 'common', 'input', 'toggle')
    await mkdir(batteryDir, { recursive: true })
    await writeFile(join(batteryDir, 'meta.json'), JSON.stringify({ id: 'toggle', name: 'Toggle' }), 'utf8')
    await writeFile(join(batteryDir, 'icon.svg'), '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>\n', 'utf8')

    const categories = await scanBatteryCategories([root])

    expect(categories.get('toggle')?.iconSvg).toContain('<svg')
  })

  it('joins promoted evidence to palette entries by kind-qualified op id', () => {
    const categories = new Map<string, BatteryUiMeta>([
      ['empty_scene', { category: 'scene/manage' }],
      ['not_promoted', { category: 'scene/manage' }],
    ])
    const registry = new SceneContractRegistry([
      {
        functionName: 'emptyScene',
        kind: 'atomic',
        contractVersion: '1.0.0',
        opId: 'empty_scene',
        description: 'Empty scene',
        inputs: [],
        outputs: [],
      },
      {
        functionName: 'notPromoted',
        kind: 'atomic',
        contractVersion: '1.0.0',
        opId: 'not_promoted',
        description: 'Not promoted',
        inputs: [],
        outputs: [],
      },
    ])

    applyAcceptanceCoverage(categories, registry, { 'atomic:empty_scene': allGates })

    expect(categories.get('empty_scene')?.sceneScriptStatus).toBe('equivalence-verified')
    expect(categories.get('not_promoted')?.sceneScriptStatus).toBe('script-callable')
  })

  it('projects exactly the 362 promoted atomic identities into the real palette', async () => {
    const categories = await getBatteryCategories()
    const equivalent = [...categories.values()].filter(
      (meta) => meta.sceneScriptStatus === 'equivalence-verified',
    )

    expect(equivalent).toHaveLength(362)
  })
})
