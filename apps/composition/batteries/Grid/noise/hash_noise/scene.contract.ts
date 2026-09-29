import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "hashNoise",
  contractVersion: "1.0.0",
  opId: "hash_noise",
  label: "哈希噪声",
  nameEn: "HashNoise",
  description: "Coordinate-hash first table in index space. scale is spatial frequency. No fractal, no mask.",
  inputs: [
    {
      name: "columns",
      type: "number",
      access: "item",
      defaultValue: 16,
      mode: "parameter",
      label: "列",
    },
    {
      name: "rows",
      type: "number",
      access: "item",
      defaultValue: 16,
      mode: "parameter",
      label: "行",
    },
    {
      name: "seed",
      type: "number",
      access: "item",
      defaultValue: 1337,
      mode: "parameter",
      label: "种子",
    },
    {
      name: "scale",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      description: "Index-space scale. Not world metres.",
      label: "尺度",
    },
  ],
  outputs: [
    {
      name: "grid",
      type: "grid",
      runtimeType: "grid",
      access: "item",
      label: "网格",
    },
  ],
  deterministic: true,
})
