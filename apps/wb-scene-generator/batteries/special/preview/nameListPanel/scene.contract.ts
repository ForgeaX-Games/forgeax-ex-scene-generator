// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "menuPre",
  "contractVersion": "1.0.0",
  "opId": "Menu_Pre",
  "description": "Preview name list array: formats each entry on its own line for easy inspection.",
  "inputs": [
    {
      "name": "input",
      "type": "any",
      "access": "item",
      "defaultValue": null,
      "description": "Name list array in [{id, name, ...}] format.",
      "label": "名称清单"
    }
  ],
  "outputs": [
    {
      "name": "output",
      "type": "string",
      "access": "item",
      "description": "Formatted text with each entry on its own line.",
      "label": "输出"
    }
  ],
  "deterministic": true
})
