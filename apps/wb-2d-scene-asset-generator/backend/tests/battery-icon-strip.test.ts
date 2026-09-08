import { describe, expect, it } from 'vitest'
import { stripBatteryIcon } from '../src/tool-handlers.js'

describe('stripBatteryIcon — keeps the op catalog as clean text', () => {
  it('drops iconSvg and any other inline-image-like field', () => {
    const cleaned = stripBatteryIcon({
      id: 'image_gen',
      name: 'ImageGen',
      iconSvg: '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>',
      icon: '<svg/>',
      preview: 'data:image/png;base64,iVBORw0KGgo=',
      inputs: [{ id: 'image', type: 'image' }],
    })
    expect(cleaned).toEqual({
      id: 'image_gen',
      name: 'ImageGen',
      inputs: [{ id: 'image', type: 'image' }],
    })
  })

  it('strips nested inline-image strings but keeps ordinary text/params', () => {
    const cleaned = stripBatteryIcon({
      id: 'op',
      description: 'generate an image',
      params: [
        { id: 'prompt', default: 'a tree', sample: '<svg>icon</svg>' },
        { id: 'size', default: '512' },
      ],
    })
    expect(cleaned).toEqual({
      id: 'op',
      description: 'generate an image',
      params: [
        { id: 'prompt', default: 'a tree' },
        { id: 'size', default: '512' },
      ],
    })
  })
})
