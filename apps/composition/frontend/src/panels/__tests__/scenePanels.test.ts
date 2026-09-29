// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { BatteryNode } from '@forgeax/node-runtime-react/editor'
import { scenePanelTypes } from '../scenePanels'

describe('scene panel node types', () => {
  it('registers the scene_output sink node type', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as CanvasRenderingContext2D)

    expect(scenePanelTypes.scene_sink).toBe(BatteryNode)
    expect(scenePanelTypes.scene_structure).toBeDefined()
    expect(scenePanelTypes.mask_structure).toBeDefined()
  })
})
