import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "numberValue",
  contractVersion: "1.0.0",
  opId: "number_const",
  label: "数值",
  nameEn: "InputNumber",
  description: "Output a numeric constant via slider or input.",
  canvas: {
    nodeType: "number_const",
  },
  inputs: [],
  outputs: [
    {
      name: "value",
      type: "number",
      access: "item",
      description: "用户设置的数值",
      label: "值",
    },
  ],
  deterministic: true,
})
