// Generated from sibling meta.json; edit deliberately and keep parity.
import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  "functionName": "furnitureTemplatePicker",
  "contractVersion": "1.0.0",
  "opId": "furniture_template_picker",
  "description": "Picks a pre-generated furniture template (1-15 room types) and outputs JSON compatible with furniture_list_split.",
  "inputs": [
    {
      "name": "index",
      "type": "number",
      "defaultValue": 1,
      "description": "Room index 1-15: 1bedroom 2study 3kitchen 4dining 5tavern 6guard 7treasury 8forge 9prison 10altar 11alchemy 12shop 13armory 14hall 15storage",
      "label": "房间编号",
      "mode": "parameter"
    }
  ],
  "outputs": [
    {
      "name": "result",
      "type": "string",
      "description": "Full furniture template as JSON string, compatible with furniture_list_split input.",
      "label": "推理结果 JSON"
    },
    {
      "name": "room",
      "type": "string",
      "description": "Room name in Chinese.",
      "label": "房间名称"
    },
    {
      "name": "room_size",
      "type": "string",
      "description": "Room size string, e.g. 10x10.",
      "label": "房间尺寸"
    }
  ],
  "deterministic": true
})
