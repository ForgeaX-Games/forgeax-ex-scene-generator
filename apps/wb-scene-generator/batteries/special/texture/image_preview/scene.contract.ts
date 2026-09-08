// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "imagePreview",
  "contractVersion": "1.0.0",
  "opId": "image_preview",
  "description": "Preview an upstream image (library alias or data URL) directly on the canvas and pass it through to downstream as an inline visual inspector.",
  "inputs": [
    {
      "name": "image",
      "type": "image",
      "access": "item",
      "description": "Upstream image alias or data URL to display on the node.",
      "label": "图像"
    }
  ],
  "outputs": [
    {
      "name": "image",
      "type": "image",
      "access": "item",
      "description": "Identical passthrough of the input image; can be connected to any image-consuming node.",
      "label": "图像"
    }
  ],
  "deterministic": true
})
