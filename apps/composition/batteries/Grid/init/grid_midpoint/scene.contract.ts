import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "gridMidpoint",
  contractVersion: "1.0.0",
  opId: "grid_midpoint",
  label: "中点位移",
  nameEn: "GridMidpoint",
  description: "Fractal first table via midpoint displacement. Side length is 2^power + 1. Values normalized to 0–1.",
  inputs: [
    {
      name: "power",
      type: "number",
      access: "item",
      defaultValue: 6,
      mode: "parameter",
      label: "幂次",
    },
    {
      name: "roughness",
      type: "number",
      access: "item",
      defaultValue: 0.5,
      mode: "parameter",
      label: "粗糙度",
    },
    {
      name: "initHeight",
      type: "number",
      access: "item",
      defaultValue: 0.5,
      mode: "parameter",
      label: "角点",
    },
    {
      name: "spread",
      type: "number",
      access: "item",
      defaultValue: 1,
      mode: "parameter",
      label: "扰动",
    },
    {
      name: "seed",
      type: "number",
      access: "item",
      defaultValue: 0,
      mode: "parameter",
      label: "种子",
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
