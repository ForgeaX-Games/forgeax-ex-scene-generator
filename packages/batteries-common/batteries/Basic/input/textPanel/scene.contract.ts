import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "textPanel",
  contractVersion: "1.0.0",
  opId: "text_panel",
  label: "文本面板",
  nameEn: "Panel",
  description: "Text panel: accept any input or free edit, output as string.",
  canvas: {
    nodeType: "text_panel",
  },
  agentVisible: false,
  definitionScope: "group-body",
  runtimeDefaults: {
    contractAdapter: "text-panel-param",
  },
  inputs: [
    {
      name: "text",
      type: "string",
      required: true,
      mode: "parameter",
    },
  ],
  outputs: [
    {
      name: "output",
      type: "string",
      access: "item",
    },
  ],
  deterministic: true,
})
