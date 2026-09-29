import type { PluginHandle } from '../framework/plugin.js'
import { cropCanvasToContent } from '../framework/frameCrop.js'

// One capture implementation shared by the Preview toolbar's camera button and
// the left pane's "截图（去背景）" button (which reaches the canvas over
// screenshotBus). It reuses the plugin's §7.3 screenshot protocol — force one
// synchronous compose, then read the live frame canvas — the SAME render path
// the headless `useScreenshotCapture` WS loop uses; nothing is re-rendered here.
//
// The result is a PNG data URL rather than a download/clipboard write: the
// studio embeds this plugin in a sandboxed cross-origin iframe whose permissions
// policy blocks both the image-blob clipboard write and the `<a download>`
// click, while a base64 data URL is plain text the user can select + copy and
// renders as a right-click-able thumbnail.

export const NO_FRAME_MESSAGE =
  'No rendered frame to capture yet — switch to a populated view and try again.'
export const EMPTY_FRAME_MESSAGE =
  'Nothing to capture — the current frame has no visible pixels.'

export interface FrameCapture {
  dataUrl: string
  width: number
  height: number
  /** Full frame size before cropping (equals width/height when not cropped). */
  sourceWidth: number
  sourceHeight: number
  cropped: boolean
}

export type FrameCaptureResult =
  | { ok: true; capture: FrameCapture }
  | { ok: false; message: string }

export function captureFrame(
  handle: PluginHandle | null,
  options?: { crop?: boolean },
): FrameCaptureResult {
  handle?.renderFrame?.()
  const canvas = handle?.getFrameCanvas?.()
  if (!canvas) return { ok: false, message: NO_FRAME_MESSAGE }

  try {
    let target = canvas
    let cropped = false
    if (options?.crop) {
      const crop = cropCanvasToContent(canvas)
      if (crop.status === 'empty') return { ok: false, message: EMPTY_FRAME_MESSAGE }
      // 'unavailable' (no 2D readback / tainted canvas) falls through to the
      // full frame so the capture still produces something usable.
      if (crop.status === 'ok') {
        target = crop.canvas
        cropped = true
      }
    }
    return {
      ok: true,
      capture: {
        dataUrl: target.toDataURL('image/png'),
        width: target.width,
        height: target.height,
        sourceWidth: canvas.width,
        sourceHeight: canvas.height,
        cropped,
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
