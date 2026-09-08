// 💡 Reusable screenshot seam: turn the live renderer canvas into a PNG Blob.
//
//    The renderer is created with `preserveDrawingBuffer: true`, so the backing
//    drawing buffer is readable on demand via `canvas.toBlob`. This helper is
//    the single capture primitive shared by the toolbar "Save screenshot"
//    button and — in Plan 4 — the headless `screenshot:request` WS loop.
//
//    Defensive by design: a null canvas or a `toBlob` throw resolves to `null`
//    rather than rejecting, so callers can treat "no frame" uniformly.

export async function captureFrameToBlob(
  canvas: HTMLCanvasElement | null | undefined,
  mimeType = 'image/png',
): Promise<Blob | null> {
  if (!canvas) return null
  return new Promise<Blob | null>((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), mimeType)
    } catch (err) {
      console.warn('[viewer/capture-frame] toBlob failed', err)
      resolve(null)
    }
  })
}
