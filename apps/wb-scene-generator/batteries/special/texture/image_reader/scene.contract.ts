// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "imageReader",
  "contractVersion": "2.0.0",
  "opId": "image_reader",
  "description": "Load a local image file, upload to the asset library, and output an image alias for downstream image nodes.",
  "inputs": [],
  "outputs": [
    {
      "name": "image",
      "type": "image",
      "access": "item",
      "description": "Alias of the uploaded image in the asset library, connectable to any downstream image input.",
      "label": "图像"
    }
  ],
  "deterministic": true
})
