import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "booleanValue",
  contractVersion: "1.0.0",
  opId: "toggle",
  label: "布尔",
  nameEn: "Toggle",
  description: "Output a boolean constant (on/off) toggled on the node.",
  canvas: {
    nodeType: "toggle",
  },
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "bool",
      access: "item",
      description: "当前开关状态（true/false）",
      label: "值",
    },
  ],
  deterministic: true,
})
