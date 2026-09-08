// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

describe('scene panel node types', () => {
  it('registers app-specific node types', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 8 }),
    } as CanvasRenderingContext2D)

    const [{ BatteryNode }, { default: ImageBatteryNode }, { default: ImagePreviewNode }, { scenePanelTypes }] = await Promise.all([
      import('@forgeax/node-runtime-react/editor'),
      import('../../workbench/ImageBatteryNode'),
      import('../../workbench/ImagePreviewNode'),
      import('../scenePanels'),
    ])

    expect(scenePanelTypes.scene_sink).toBe(BatteryNode)
    expect(scenePanelTypes.asset2d_image_battery).toBe(ImageBatteryNode)
    expect(scenePanelTypes.image_preview).toBe(ImagePreviewNode)
  })
})
