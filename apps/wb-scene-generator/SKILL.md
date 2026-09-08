---
id: wb-scene-generator:author-guide
trigger: /wb-scene-generator
displayName:
  en: Scene Generator Author Guide
  zh: 场景生成器 作者指引
description: >-
  Route complete scene, level, city, terrain, road, district, circulation,
  playable-area, and skyline-layout work to Sino and the Scene Script workflow.
  Low-poly is a visual style, not a reason to route a complete scene to the
  standalone GLB modeling workflow.
---

# Scene Generator · Sino author guide

Scene Script is the canonical authoring surface. The existing node graph is its
live visual projection and remains the runtime execution surface.

Sino is the preferred Agent for this Workbench. Its task is scene design through
multi-module Scene Script and project-local Generators. Coastal Small City
(`examples/scene-script/coastal-small-city/`) is the reference architecture:
terrain, districts, roads, parcels, buildings, dressing. Sino does not
orchestrate other Agents or generate assets.

## Dispatch boundary

- For a complete scene, level, city, terrain, road network, district,
  circulation plan, playable space, or skyline layout, call `list_subagents`
  when needed and then `delegate_to_subagent` with `agent: "sino"`.
- This remains true for low-poly scenes, small scenes, grayboxes, backdrops,
  and scenes that could superficially be assembled from boxes.
- Do not let Forge author a SceneAsset pack, prefab, or engine entry-code
  substitute for this workflow.
- Use a modeling Agent only when the user explicitly asks for one or more
  standalone reusable `.glb` model assets. Do not invent that asset split from
  a complete-scene request.
- A timeout or kernel error is not a finished scene. Reuse the existing project
  and resume from its source revision and last-good output.

## Workflow

1. Open the requested project and read the relevant source file plus compact
   manifest. Reuse `ifRevision` when checking unchanged context.
2. Select declarative Scene Script, platform primitives, or a project Generator
   according to the algorithmic need.
3. Commit new algorithms and cross-file protocol changes atomically. Use the
   Authoring Lens and structured commands for local edits.
4. Inspect bounded diagnostics, semantic impact, execution evidence, and the
   current Renderer. Preserve last-good output while repairing a failed revision.
5. `scene:script.verify` checks revision alignment. The user's brief and visual
   review determine completion; no fixed stage receipt does.

Do not manipulate runtime nodes, template internals, port numbers, or graph
storage for a Scene Script-managed project.

The full design and self-review workflow is defined by the
`compose-scene-script` skill.
