// 💡 Crop a PNG down to its non-background bounding box.
//
// The live agent screenshot (`POST /api/v1/agent/screenshot/capture`) always
// returns the FULL renderer canvas (viewport size, e.g. 2264×828), mostly
// empty `#000` background around the actual scene content. This trims that
// padding away so an AI reviewing the image only sees real pixels — same
// idea `renderToPng` already gets for free (its master canvas is sized to
// the scene bbox), but the live WS/canvas capture path has no such crop.
//
// Usage: tsx scripts/crop-to-content.mjs <in.png> <out.png> [bgHex] [tolerance]
//   bgHex     background color to treat as empty, default #000000
//   tolerance per-channel diff allowed to still count as background, default 8

import { loadImage, createCanvas } from '@napi-rs/canvas'
import { writeFileSync } from 'node:fs'

const [, , inPath, outPath, bgHex = '#000000', toleranceArg = '8'] = process.argv
if (!inPath || !outPath) {
  console.error('usage: tsx scripts/crop-to-content.mjs <in.png> <out.png> [bgHex] [tolerance]')
  process.exit(1)
}
const tolerance = Number(toleranceArg)

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

const img = await loadImage(inPath)
const w = img.width
const h = img.height
const full = createCanvas(w, h)
const fullCtx = full.getContext('2d')
fullCtx.drawImage(img, 0, 0)
const { data } = fullCtx.getImageData(0, 0, w, h)
const [bgR, bgG, bgB] = hexToRgb(bgHex)

let minX = w, minY = h, maxX = -1, maxY = -1
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3]
    const isBackground = a === 0 || (Math.abs(r - bgR) <= tolerance && Math.abs(g - bgG) <= tolerance && Math.abs(b - bgB) <= tolerance)
    if (!isBackground) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
}

if (maxX < 0) {
  console.log('[crop-to-content] no non-background pixels found — image is entirely background')
  process.exit(1)
}

const cropW = maxX - minX + 1
const cropH = maxY - minY + 1
const cropped = createCanvas(cropW, cropH)
cropped.getContext('2d').drawImage(full, minX, minY, cropW, cropH, 0, 0, cropW, cropH)
writeFileSync(outPath, cropped.toBuffer('image/png'))
console.log(`[crop-to-content] ${w}x${h} -> ${cropW}x${cropH} (bbox x:${minX}-${maxX} y:${minY}-${maxY}) -> ${outPath}`)
