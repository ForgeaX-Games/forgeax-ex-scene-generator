import { defineAtomic } from '@forgeax/scene-authoring'

export default defineAtomic({
  functionName: "emptyScene",
  contractVersion: "1.1.0",
  opId: "empty_scene",
  label: "空场景",
  nameEn: "EmptyScene",
  description: "Empty SceneTree root. Graft SceneTree children with addChild, then sceneOutput.",
  inputs: [],
  outputs: [
    {
      name: "scene",
      type: "scene",
      access: "item",
      label: "scene",
      description: "Empty SceneTree. focus is the root.",
    },
  ],
  deterministic: true,
})
