import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "addChild",
  contractVersion: "1.2.0",
  opId: "add_child",
  label: "添加子节点",
  nameEn: "AddChild",
  description: "Graft SceneTree children under parent.focus. A named focus grafts that node; an unnamed root grafts its children.",
  inputs: [
    {
      name: "scene",
      type: "scene",
      access: "item",
      required: true,
      label: "scene",
      description: "Parent SceneTree. focus must exist.",
    },
    {
      name: "nodes",
      type: "scene",
      access: "list",
      required: true,
      label: "nodes",
      description: "Child SceneTrees. Named focus is one node; unnamed root grafts its children.",
    },
  ],
  outputs: [
    {
      name: "scene",
      type: "scene",
      access: "item",
      label: "scene",
      description: "Updated SceneTree. focus stays on the parent.",
    },
    {
      name: "childPaths",
      type: "string",
      access: "list",
      label: "子节点路径",
    },
  ],
  deterministic: true,
})
