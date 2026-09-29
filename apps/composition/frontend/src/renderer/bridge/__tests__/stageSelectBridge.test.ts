import { describe, expect, it } from 'vitest'
import { hostGraphNodeIds, mergeIncomingEditorSelection } from '../stageSelectBridge'

describe('stageSelectBridge', () => {
  it('does not send layer keys to the kernel editor', () => {
    expect(hostGraphNodeIds(['scene_output:mesh', 'n-river', 'gd:points'])).toEqual(['n-river'])
  })

  it('keeps a Stage layerKey selection when the editor echoes empty', () => {
    expect(mergeIncomingEditorSelection(['scene_output:mesh'], [])).toBeNull()
    expect(mergeIncomingEditorSelection(['n-river'], [])).toEqual([])
    expect(mergeIncomingEditorSelection(['scene_output:mesh'], ['n-river'])).toEqual(['n-river'])
  })
})
