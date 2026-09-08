// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "textTemplateFill",
  "contractVersion": "1.0.0",
  "opId": "text_template_fill",
  "description": "Fills template placeholders {0} {1} {2} with three string inputs and outputs the assembled text.",
  "inputs": [
    {
      "name": "template",
      "type": "string",
      "defaultValue": "",
      "description": "Text template containing {0} {1} {2} placeholders.",
      "label": "模板",
      "mode": "parameter"
    },
    {
      "name": "value_0",
      "type": "string",
      "defaultValue": "",
      "description": "String to replace {0} in the template.",
      "label": "{0}",
      "mode": "parameter"
    },
    {
      "name": "value_1",
      "type": "string",
      "defaultValue": "",
      "description": "String to replace {1} in the template.",
      "label": "{1}",
      "mode": "parameter"
    },
    {
      "name": "value_2",
      "type": "string",
      "defaultValue": "",
      "description": "String to replace {2} in the template.",
      "label": "{2}",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "text",
      "type": "string",
      "description": "Assembled text after all placeholder substitutions.",
      "label": "输出文本"
    }
  ],
  "deterministic": true
})
