// Native HTML5 DnD auto-generates its drag ghost by rasterizing the dragged DOM
// node; template rows embed a multi-MB base64 iconPng thumbnail, and Edge (unlike
// Chrome) does this rasterization synchronously on the main thread — the OS-level
// drag session blocks waiting for it, which reads as a full page freeze (cursor
// stuck in "dragging", clicks dead). A tiny pre-rendered canvas as the explicit
// drag image sidesteps that snapshot entirely, regardless of thumbnail size.
let dragGhostCanvas: HTMLCanvasElement | null = null
export function getDragGhostCanvas(): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  if (dragGhostCanvas) return dragGhostCanvas
  const canvas = document.createElement('canvas')
  canvas.width = 28
  canvas.height = 28
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(90, 140, 255, 0.9)'
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath()
      ctx.roundRect(0, 0, 28, 28, 6)
      ctx.fill()
    } else {
      ctx.fillRect(0, 0, 28, 28)
    }
  }
  dragGhostCanvas = canvas
  return dragGhostCanvas
}
