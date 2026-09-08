// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "textParse",
  "contractVersion": "1.0.0",
  "opId": "text_parse",
  "description": "Parses text into a number or a (possibly nested) list, preserving original structure. Supports JSON arrays and delimited values with auto-detection.",
  "inputs": [
    {
      "name": "text",
      "type": "string",
      "defaultValue": "",
      "description": "Text to parse. Supports: single number, JSON array, nested array, delimited values, etc.",
      "label": "输入文本",
      "mode": "parameter"
    },
    {
      "name": "delimiter",
      "type": "string",
      "defaultValue": "auto",
      "description": "Delimiter choice. auto = auto-detect (priority: comma > semicolon > tab > newline > space), others specify a fixed delimiter.",
      "label": "分隔符",
      "options": [
        "auto",
        ",",
        ";",
        "tab",
        "newline",
        "space"
      ],
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "value",
      "type": "number",
      "description": "Parsed single number. First number if input is a list, 0 if unparsable.",
      "label": "数值"
    },
    {
      "name": "list",
      "type": "number",
      "description": "Parsed list preserving original nesting (rank determined by actual nesting; rankAny=true).",
      "label": "列表"
    }
  ],
  "deterministic": true
})
