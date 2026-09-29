import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "jsonPanel",
  contractVersion: "1.0.0",
  opId: "json_panel",
  label: "JSON",
  nameEn: "JSON",
  description: "Edit a JSON object or array. Invalid JSON stays on the node. Output is dict.",
  canvas: {
    nodeType: "json_panel",
  },
  agentVisible: false,
  definitionScope: "group-body",
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "dict",
      access: "item",
      label: "字典",
    },
  ],
  deterministic: true,
})
