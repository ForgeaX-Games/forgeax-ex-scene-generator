// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "autotileTemplate",
  "contractVersion": "1.0.0",
  "opId": "autotile_template",
  "description": "Outputs an autotile template with sprite slicing and neighbor rules for custom renderers or downstream rule consumers.",
  "inputs": [
    {
      "name": "preset",
      "type": "string",
      "access": "item",
      "defaultValue": "single",
      "description": "Select a built-in preset: single=whole image per cell (no slicing), 4bit-cardinal-16=standard 16-tile 4-way autotile.",
      "label": "预设",
      "options": [
        "single",
        "4bit-cardinal-16"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "template",
      "type": "dict",
      "access": "item",
      "description": "Template dict with sprite slicing coordinates and neighbor rules.",
      "label": "模板"
    }
  ],
  "deterministic": true
})
