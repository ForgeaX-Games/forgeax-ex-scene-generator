---
id: scene-generator:author-guide
trigger: /scene-generator
displayName:
  en: Scene Generator Author Guide
  zh: 场景生成器 作者指引
description: >-
  Route complete scene, level, city, terrain, road, district, circulation,
  playable-area, and skyline-layout work to Sino via delegate_to_subagent.
  Pass the user's spatial brief and relevant supplied toolkit paths. Do not ask Sino to read a game manifest,
  attach SceneAsset, or inspect how the entry loads.
---

# Scene Generator · Sino Author Guide

Scene Script is the canonical authoring surface. The 3D viewport and node graph are its live visual projections and runtime execution surfaces.

Sino is the dedicated Scene Designer Agent for this Authoring. Its expertise is spatial layout and 3D terrain/city design through multi-module Scene Script (`*.scene.ts`), project-local Generators (`*.generator.ts`), and mathematical algorithm libraries (`*.generator-lib.ts`).

## Dispatch Boundary & Teammate Delegation

- **Scope**: Delegate tasks involving full scenes, levels, cities, natural terrain, geomorphology, road networks, parcel zoning, playable space layout, or spatial composition to `sino` via `delegate_to_subagent` (with `agent: "sino"`).
- **Input Brief**: Forward the user's spatial requirements (terrain types, orientations, approximate size, transitions, visual features), preserving supplied toolkit paths relevant to the design. Copy the user wording. Do not expand it into a research plan.
- **Do not put in the brief**:
  - Read the game `main.ts`, game manifest, or inventory JSON
  - Attach or author a SceneAsset pack
  - Tell the game entry how to load the scene
- **City / level / terrain**: Sino's first-batch library is `point2d`, `basePlane`, `polyline`, `spline`, `polygon`, `network`, `geometryMask`, `createGrid`, `gridFill`, `gridGradient`, `gridDiamondSquare`, `gridMidpoint`, `hashNoise`, `valueNoise`, `valueCubicNoise`, `perlinNoise`, `openSimplex2Noise`, `openSimplex2sNoise`, `cellularNoise`, Grid math (`gridAdd`, `gridBlur`, `gridDilate`, `gridErodeMorph`, `gridSlope`, `gridThreshold`, and the rest of Arith / Filter / Morph / Derive, plus `gridComponents` / `gridZonalMean` / `gridStats` / `gridDistance` / `gridResize`), `heightfield`, `heightfieldExplode`, `heightfieldSetMask`, `heightfieldMesh`, `box`, `transform`, `placeOnGround`, `sampleHeight`, and `sceneOutput`. A street or building is a `.scene.ts` that consumes operating Geometry, not a platform road tool. `geometryMask({ plane, geometry, columns, rows, width?, feather? })` burns that Geometry onto a same-lattice 0–1 Grid. Geometry vertices are authoring metres. Heightfield is a packet, not a mesh. `heightfieldSetMask` replaces packet.mask only. `heightfieldMesh` weaves the packet into hangable mesh. `box` is a local mesh; `placeOnGround` sits it on the Heightfield. Sampling noise is `perlinNoise(...)` and the other six Grid/noise identifiers. Same-lattice Grid math uses cell radius (not metres); `gridErodeMorph` is surface morph, not hydro. Erosion stays in a project-local `.generator.ts`. Follow `compose-scene-script` for targeted library use, source adaptation, and original project algorithms.
- **Deliverables**: Sino works self-containedly in Scene Generator. Success is visible Default output that matches the brief, not `verification.ok` alone. Call `scene:export.glb` only when a triangle-mesh asset must land on disk. Forge reports that path to the user and ends the task.
- **Engine Separation**: Game runtime logic, player controllers, and engine camera scripts stay at the game project. Sino does not inspect or patch them.

## Workflow

1. Confirm `sino` is in the roster.
2. Call `delegate_to_subagent({ agent: "sino", message: <user spatial brief and relevant supplied toolkit paths> })`.
3. Wait for Sino. Sino opens or creates a scene project, `commitProject`s a skeleton, looks at Default, and only then treats the brief as done. `scene:export.glb` only when a triangle-mesh asset is needed.
4. When Sino returns Default evidence plus an export path (if requested), tell the user the scene is done. Do not send Sino back to hunt game files or engine loaders.

The full design and self-review workflow is defined by the `compose-scene-script` skill.
