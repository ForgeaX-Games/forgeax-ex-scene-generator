# Changelog — `wb-scene-generator`

All notable changes to this app.

Format: [Keep a Changelog](https://keepachangelog.com/) · semver. Dates are
calendar dates in the project timezone.

> **Maintenance contract (see [`AGENTS.md`](./AGENTS.md)).** Every commit that
> touches this app's source MUST add a bullet under `## Unreleased`, grouped by
> Added / Changed / Fixed / Removed / Deferred, and state the *why*. Kernel
> changes go in the root [`CHANGELOG.md`](../../../../CHANGELOG.md). History
> below is **append-only** — never rewrite past entries; corrections append a
> new entry stating the reason.
>
> The kernel is in-repo `workspace:*` packages (`packages/*` in the monorepo
> root). There is no `external/forgeax-wb-node-core` submodule, no `link:` pin,
> and no cascade SHA to cite. Reference the changed `packages/*` file directly.

## Unreleased

### Fixed

- Embedded scene sockets use Studio's `/ws/render` proxy instead of its chat `/ws`, restoring graph updates, renderer commands and screenshots. `frontend/src/api/pluginHttp.ts:41` is shared by all three clients; `frontend/src/api/__tests__/pluginHttp.test.ts:4` covers installed, standalone and launcher routes.

### Fixed

- Expose the existing closed starter and completion tools to Sino, matching the reference endpoint guidance. `apps/wb-scene-generator/forgeax-plugin.json` declares both schemas and agent access; `scripts/release-tools.test.mjs:22` prevents missing declarations from silently breaking scene authoring.

### Fixed

- Published Scene authoring resolves resources from the module root and includes acceptance coverage and reference sources, so Sino receives callable contracts and all six reference topics work outside the source checkout. See `apps/wb-scene-generator/backend/src/resources.ts:1` and consumer regression `scripts/probe-scene-authoring.mjs:3`. Generator SDK/sandbox entries are included and backend bundles use production mode, avoiding development file watchers in the installed package.
- Canonical execution summaries resolve omitted final output references before counting meshes; large mesh scenes must not appear empty. See `apps/wb-scene-generator/backend/src/captured-outputs.ts:4` and `apps/wb-scene-generator/backend/tests/captured-outputs.test.ts:4`.

### Changed
- **Release identity now belongs to the Scene Generator package.** This app is published inside `@forgeax-extension/scene-generator` as the `composition` module; it is no longer an independently published npm package. *为什么：* the three workbenches share one product lifecycle.

### Removed
- **Removed Sino's previous mixed workflow and supplemental memory prompts.** The old four-stage Blockout/Circulation/Anchors/Density model, Template-first compatibility guidance, voxel-canvas framing, and duplicated memory files no longer participate in Sino's prompt. *为什么：* 删除旧 Skill 文件还不够；旧阶段和合同目录仍会把模型带回小沙盘流水线。
- **Deleted unregistered legacy skills.** `design-scene-brief`, `review-scene`, `compose-scene-pipeline`, `connect-node-task`, `create-scene-template`, and `Agent_0` are gone; `skills/` now contains only `compose-scene-script`. *为什么：* 旧 graph / critic / applyBatch 流程会把 Sino 拉回未适配新架构的第二套工作流。

### Added
- **Rebuilt `compose-scene-script` as a two-file skill.** `SKILL.md` now covers first-principles scene design, narrative translation, spatial hierarchy, Terrain→Regions→Routes→Parcels→Structures→Dressing staging, algorithm design, detail completion, and review; `TOOLS.md` exclusively defines the current metre-space, multi-module Scene Script, project Generator, atomic commit, revision-bound execution, and Renderer workflow. Tests: `sinoAgentContract.test.ts`. *为什么：* 设计判断和工具规程需要解耦，避免工具遗留反过来定义场景思路。
- **Code-first Sino workflow, Coastal references, and atomic project commit.** `compose-scene-script` now ranks multi-module Scene Script + project `.generator.ts` above Templates; `scene:script.references` returns bounded Coastal Small City topics; `scene:script.commitProject` commits many files then executes that exact revision. Resume inlines `stageLedger` so `checkpoint: null` no longer restarts. Tests: `codeFirstWorkflow.test.ts`, `sinoAgentContract.test.ts`. *为什么：* 完整场景不该被 Template 上限卡住，也不该在空 checkpoint 上循环规划。
- **Preview status that never stays blank.** Plugin-local renderer status (`POST /api/v1/renderer/status`, `scene:renderer.info.sync`) reports viewing project, execution, layer counts, and stale reasons (`preview-stale` / `no-visible-output` / `project-mismatch`). Studio save now execute-then-captures. Tests: `useNodePreviews.test.tsx`, `SceneScriptStudio.test.tsx`. *为什么：* 提交后空白预览会被误当成完成或失败，人与 Agent 都需要可见反馈。

### Changed
- **Sino's visible Contract catalog and stage ledger now match the new skill.** Catalog v0.5 exposes composition primitives, metre-space primitives, and project Generators instead of legacy outdoor Templates; resume stages are Narrative, Terrain, Regions, Routes, Parcels, Structures, Dressing, and Review. Tests: `agentContractCatalog.test.ts`, `tool-handlers.test.ts`, `codeFirstWorkflow.test.ts`. *为什么：* 如果工具仍说“所有室外场景从 addBaseGrid 开始”，重写 Skill 也无法消除旧逻辑。
- **Sino no longer sizes a complete scene as a 64/96/128 voxel canvas.** Skill, persona, and Coastal terrain references now require metre `basePlane` extent, independent `workGrid.cellSize`, and nested `place` / `extractPlane`. Unnamed city scale defaults to Coastal (~2 km, 8 m cells). Tests: `sinoAgentContract.test.ts`. *为什么：* 开局问体素网格三选一会把新世界标架打回旧沙盘逻辑。
- **Sino Contract detail now carries `acceptsLiteral`, `requiredAtRuntime`, and maturity.** `seed` is documented as a seed token, not a number constructor. `pathConnectionLink.obstacles` is required at compile and runtime. Catalog v0.4. Tests: `agentContractCatalog.test.ts`. *为什么：* validate 通过、execute 才爆 obstacles，以及用 seed 冒充数字构造器，是 Inland City 会话的根因。

### Fixed
- **Diagnostic circuit breaker and validate-then-commit hash lock.** The same `code + operation + source target` may be repaired once; a second hit returns `circuitOpen`. After `validate=true`, inspect tools and a different source hash are blocked. Tests: `codeFirstWorkflow.test.ts`. *为什么：* 同一份 SCENE_TYPE 错误被反复 get/contracts/validate，会话永远走不出循环。
- **graph:applied no longer empties the last frame while execute is in flight.** `exec:started` cancels the graph refresh; `exec:completed` swaps layers atomically. Tests: `useNodePreviews.test.tsx`. *为什么：* 提交先广播 graph:applied，输出缓存被清空，Renderer 在 execute 完成前是黑的。

### Added
- **Project-local Generator door, spatial protocol, and Agent contract catalog.** `.generator.ts` + `*.generator-lib.ts` compile to sandboxed `OpSpec`s (`local/<id>`) on a per-project `OverlayOpRegistry`; `.scene.ts` stays declarative and may import them. Catalog v0.3 discloses utility / spatial / legacy Template / current-project `local/` Generators only; `booleanValue` is listed so `choose.when` can stay on the first authoring path. Spatial batteries: `basePlane`, `workGrid`, `extractPlane`, `place`, `prototypeCatalog`, `instantiatePlacements`. Fixture: `backend/src/scene-script/__fixtures__/courtyard-plaza/`. Tests: `store.test.ts`, `projectCompiler.test.ts`, `spatial.test.ts`, `architecture-gate.test.ts`, `agentContractCatalog.test.ts`, `courtyard-plaza.test.ts`. *为什么：* 项目算法不能写进声明式脚本，也不能注册到进程级平台 op；Sino 只该看见 Contract。
- **Compiler builtins `repeat` / `choose`.** Static `count` 1..16; step is a state Contract; `choose` lowers to ordinary `scene_choose`. Ordinary `for` / `if` still rejected. How-to-fix filled for `SCENE_REPEAT_*` / `SCENE_CHOOSE_*`. Tests: `choose.runtime.test.ts`, `packages/scene-authoring` compiler tests. *为什么：* 循环和选择属于语言，不是高阶执行器。
- **Execute repair slips and the viewport third pointer.** Kernel `failures` project through source maps; `/execute` and `/execute/summary` share `persistExecutionLineage` so Agent diagnostics can carry `sceneNodeIds`. Script studio lists Scene / Generator / Helper / Material. Tests: `diagnostics.test.ts`, `execution-summary.test.ts`, `sceneScriptDiagnosticBridge.test.ts`, `displayIndex.test.ts`. *为什么：* 人和 Agent 要同一份修理单，以及脚本/图/视口同一指针。

- **Layered Territory is a live Scene project.** Continent → Valley → Plaza compiles with current batteries (`examples/scene-script/layered-territory/`). Default seeds the 2048 m world-frame overlay when `ContinentFrame` is in the scene. Tests: `worldFrame.test.ts`. *为什么：* 模板不能只停在缺符号的 AF 草图上，要能打开看三层尺度。
- **Layered-territory Scene Script template + Default world-frame toggle.** Continent → Valley → Plaza example lives at `examples/scene-script/layered-territory/` (AF contract, not a live compile entry). Default draws a world-metre grid/axes overlay (`worldFrame.ts`), independent of the schema `grid` field; Layers and Effects can hide it. Tests: `worldFrame.test.ts`, `store.test.ts`, `surfaces.smoke.test.tsx`. *为什么：* 后续多层场景要有一份只写局部米的模板；视口还要能关掉全局标架，避免把它当成作业 grid。
- **Control drawer has a Reset button.** It restores `valley.scene.ts` to the designed Alpine CVs and numeric literals, compiles through `main.scene.ts`, and full-executes. Tests: `ValleyControls.test.tsx`, `alpineFactoryReset.test.ts`. *为什么：* 拖点和拧滑块之后要能一键回到山谷的设计稿，而不是在脚本里手改。
- **Control pins use a Unity/Blender-style move gizmo.** Click a pin to show a local frame (RGB axes + XY/XZ/YZ planes). Hover highlights the handle under the cursor; drag locks that axis or plane. Orbit is disabled while grabbing a pin or handle. Tests: `guideGizmo.test.ts`. *为什么：* 整针在 3D 里乱飞不直观；没有悬停高亮时人对不上自己点的是哪一根轴。
- **Viewport Control handles appear after selecting the host structure.** Default no longer sprinkles always-on Guide pins across the valley. `pointsToNode` prims nest under the result (`River/RiverPath`, `Plaza/Center`, `Terrain/Peaks`); clicking that mesh (or the outliner row) shows only that Control. Tests: `guideSelection.test.ts`. *为什么：* users look for “select the river, then edit its curve”, not a separate Guide layer, and sibling `Plaza_2` under Terrain was unfindable.

### Fixed
- **Default wheel zoom keeps the point under the cursor.** Dolly moves along the pick ray and parks the orbit target on the look axis, so `OrbitControls.update()` `lookAt` cannot yank a house to screen center. Misses use the view plane through the current target, not Z=0 on the continent. Tests: `orbitCamera.test.ts`. *为什么：* 上一版把目标钉在命中点上，滚轮一对房子画面就甩到正中，人和鼠标对不上。
- **Default zoom can inspect a house again.** Auto-fit now walks content and skips `skipFit` subtrees — `Box3.setFromObject` still unions hidden ContinentFrame meshes, so the previous hide-then-fit left the camera ~4 km out. Wheel dolly aims at the mesh (or Z=0) under the cursor, steps by a fraction of that distance, and drops `minDistance` to 5 cm. Tests: `orbitCamera.test.ts`. *为什么：* 打开分层领地后滚轮缩不进村子，不是阻尼坏了，是相机构在 2 km 大陆框上，再加 zoomToCursor 对空标架推目标。
- **Default no longer fades the Stage with a 90–320 m fog ramp.** Continent-scale frames also stay out of auto-fit, so opening Layered Territory frames the valley instead of a grey 2 km wash. Tests: `stageLighting.test.ts`, `guideLine.test.ts`. *为什么：* 拉远看大陆时整片像罩了雾，不是像素不够，是雾把对比吃掉了。
- **Control Reset restores the Alpine document and full-executes, instead of graph `updateNode`.** Reset rewrites `valley.scene.ts` CVs/numbers back to the designed factory, compiles through `main.scene.ts`, then `clearCacheAndExecutePipeline`. Saving a non-entry module no longer treats that file as the compile entry. Tests: `alpineFactoryReset.test.ts`, `sceneScriptProjectAuthoring.test.ts`, `ValleyControls.test.tsx`. *为什么：* 把 `[[x,y],…]` 经 `updateNode` 写回会变成空 datatree，heightfield 就报 `grid is required and non-empty`，舞台变成 0 tri。
- **Control Reset no longer fails by racing one execute per node.** Reset now posts `workbench:set-params` and the host applies every edit, then persist+executes each touched node in order; a miss rolls the whole batch back. Tests: `controlParamBatch.test.ts`, `ValleyControls.test.tsx`. *为什么：* 并行 `incrementalExecute` 会丢结果，回滚路径就报 “This edit failed. The previous value was restored.”
- **Control Reset no longer starts at `valley_heightfield` and finds an empty river.** The batch now writes every touched node, then runs the full pipeline once so `riverPoints` / peaks / plaza exist before the heightfield reads them. Tests: `controlParamBatch.test.ts`. *为什么：* 增量从地形节点起跑时，上游 `control_points` 的缓存已被这次写入清掉，就会报 required input has no value。
- **Releasing a Control pin no longer drops it after the gesture.** X/Y/XY ride the terrain while dragging; Z/XZ/YZ may lift, but pointer-up samples the ground again and clears the temporary height so execute/hydrate cannot yank the pin down. Tests: `guideGizmo.test.ts`, `store.test.ts`. *为什么：* 脚本只记格子 XY，松手后针按新位置贴地；拖的时候还停在旧高度，回灌一来就像掉下来一下。
- **A failed viewport edit rolls back and shows the error.** SetParam waits for execute; on `error` the previous param is written back, the pin returns to the snapshot, and Stage shows the message. Tests: `paramEditRollback.test.ts`, `store.test.ts`. *为什么：* 一次拖点把图跑挂后，人不该停在坏参数上还不知道为什么。
- **Move gizmo is six real constraints, not a ground-plane hack.** X/Y/Z project the camera ray onto that world axis; XY/XZ/YZ intersect the plane through the point. Z lifts the pin. The previous “hit the terrain then lock axes” path made the blue axis decorative and let a 3/4 camera slide the point off the highlighted handle. Tests: `guideGizmo.test.ts`. *为什么：* 六个移动限制就是三轴投影加三面求交，不该和地面绑死。
- **Gizmo drag preview is the same cell that SetParam writes, and motion follows the highlighted handle.** Axis / XZ / YZ now project the camera ray onto that world axis (not ground-hit-then-lock). During the gesture the pin and gizmo move together to the snapped cell; the layer is not rebuilt and stale preview hydrates cannot pull the point back. Pointer-up commits that same `[x, y]`. Pick prefers a shaft the ray skims even when the XY square is closer. Tests: `guideGizmo.test.ts`, `guideDrag.test.ts`, `store.test.ts`. *为什么：* 3/4 相机下地面求交会让点滑离选中的轴；拖的时候显示格和松手后写回/回灌的格也不是同一个。
- **Gizmo plane/axis drags stay on the ground and match the highlighted handle.** All six handles intersect `z = const` then lock X, Y, or both. Vertical XZ/YZ ray hits are gone (those were the “I dragged a plane and it flew away” path). Pointer-down uses the hovered handle. Tests: `guideGizmo.test.ts`. *为什么：* 竖直面和 3/4 相机求交会冲出地图，高亮的面和实际约束也对不上。
- **Default auto-fit no longer walks every mesh with `instanceof`.** Fitting uses `setFromObject` and hides the move gizmo first, so a HMR/duplicate-THREE miss cannot leave the camera inside the heightfield (empty-looking Stage). Tests: `guideGizmo.test.ts`. *为什么：* 标架改完之后场景“东西都没了”，是相机没拉到山谷，不是内容被删了。
- **Control pins vanished after execute or a mesh click.** Handles now stay drawn; selecting a host only highlights that set. Stage layerKey selection is not posted to the kernel editor and is not wiped by an empty `editor-selection` echo. Tests: `guideSelection.test.ts`, `stageSelectBridge.test.ts`. *为什么：* “先选中再出针”加上编辑器回传空选中，执行或点一下河针就全没了。
- **Dragging a Control pin in the 3D Stage no longer teleports the point.** Pointer-down records a grab offset so a raised pin head does not project onto a far ground hit; when the camera is edge-on to the XY plane the drag falls back to screen-space instead of a near-parallel ray. Restored the Alpine river CV that had jumped to `[25, -28]`. Tests: `guideDrag.test.ts`. *为什么：* 3D orbit + 抬高的 map-pin 让第一帧交点飞出地图，松手后河被写坏。
- **Control handles were larger than the village.** Pin heads, ground rings and the river tube are editor-gizmo scale (~0.9 m head, 0.22 m curve) and camera-distance scale is capped at 2.1×. Tests: `guideLine.test.ts`. *为什么：* the previous “can’t find the points” pass used 12 m rings and 14× billboards, so once selection actually showed them they covered the scene.
- **Stage click selected the shared `scene_output` node, so the whole valley highlighted and Control handles never appeared.** Hydrated River/Plaza/Terrain meshes all stored `nodeId = scene_output`. Click now selects the unique `layerKey`; highlight ignores a node id owned by more than one prim; `points` prims are hydrated from the scene graph so Default actually builds the gizmos. Tests: `guideSelection.test.ts`, `sceneGuideHydration.test.ts`, `stageOutliner.test.ts`. *为什么：* 选中后高亮一片无关物体、看不到控制点 — 不是没实现拖点，是选中身份和 Guide 构建都绑在了 scene sink 上。
- **Control handles were still invisible in a 128 m Default overview.** 8 m poles and a 1 px `Line` sat inside the river/terrain silhouette. Handles are now unlit map-pins (ground halo + pole + head) that scale with camera distance, and river CVs use a fat tube. Empty terrace clips no longer return `error`, so a walls miss cannot abort execute and drop the Plaza / RiverPath / Peaks guides. Tests: `guideLine.test.ts`, `alpine_valley_batteries.test.ts`. *为什么：* from the fitted aerial camera a 1.8 m sphere is a few pixels, and `cell returned error: no terrace walls generated` stopped the graph before scene_output hung the new prims.
- **Control handles were invisible in Default.** Guide dots baked at z≈0.35 before the terrain mesh arrived and never rebuilt, so pins sat inside the heightfield. They are now map-pins (pole + 1.8 m emissive head, no depth test) and rebuild when terrain `updatedAt` changes. Tests: `guideLine.test.ts`. *为什么：* a 128 m overview cannot show 0.45 m spheres buried under the mesh.
- **Houses stay off the draped road ribbon and pack in street / market / hillside belts.** Layout densifies the same splines the road mesh uses, splits the west/east arterial only at the plaza jump (~20 m), and rejects a plot if any footprint corner enters the paved half-width plus curb. Frontage walks those curves by arc length so the civic ring and arterials get street lots; a second row and hillside belt fill the rest. Tests: `alpine_valley_batteries.test.ts`. *为什么：* a 9 m split treated ordinary 12–16 m road waypoints as breaks, so clearance never saw the real ribbon; densified ring samples were also shorter than the old 1.2 m skip, emptying the streets.
- **River sits in the terrain gully; houses sit on the same flipped XY as the ground.** `valleyHeightfield` now carves (and re-cuts after erosion) along the same `riverPoints` polyline the water sweep uses, so the blue ribbon is not a second, offset sine. House / tower / mill local offsets now map `worldY = -(gridY)` like the heightfield, so sampled plinth heights land under the drawn footprint instead of its Y-mirror. Tests: `alpine_valley_batteries.test.ts`. *为什么：* the gully was an independent meander, and building `rot()` added local Y after flipping the center, so water missed the bed and houses floated beside their foundations.

### Changed
- **Village roads keep a river-following shape when the plaza moves.** `villageRoadNetwork` no longer lerps fixed river-t samples to the west/east ring gates. The bank road stays on the landward offset of the river; if the plaza sits on that bank the arterial splits and joins the ring with short cubics, otherwise one curved approach meets the river-facing gate. Trail and feeder leave along the landward tangent instead of hardcoded +x/+y. Tests: `alpine_valley_batteries.test.ts`. *为什么：* 广场一拖远，中点弦就把主干道拧成斜线；路应该永远贴着河，再用自然弯接到村子。
- **Village roads are one surface-draped curve network, not five overlapping sweeps.** `villageRoadNetwork` now emits a single mesh: west/east arterial spokes meet the civic ring at shared junctions (the arterial no longer duplicates the south ring), each edge is a dense spline, and the ribbon uses centerline height plus a thin curb so it sits on the terrain as a slightly widened band. Layout splits the west/east arterial so houses are not reserved against a phantom chord through the plaza. Valley demo wires `network.mesh` once. Tests: `alpine_valley_batteries.test.ts`. *为什么：* independent lifted sweeps read as scattered broken planes — z-fighting, buried/floating shards, and no continuous road network.
- **Terrace walls stay on agricultural risers and break around the village.** `terrace_walls` no longer traces fixed elevation isolines across the whole map. It walks terrace-mask step edges, then clips those polylines away from the plaza, road graph, river, landmarks and house plots so retaining walls cannot run through streets or buildings. Tests: `alpine_valley_batteries.test.ts`. *为什么：* the old X-scan isolines cut straight through the settlement, roads and plaza.
- **Plaza-centric road graph and OBB village packing.** New `village_road_network` battery builds the civic ring, wrapping arterial, mill access, hillside feeder and trail from the plaza hub, and emits tower / mill / bridge anchors from the same junctions. `procedural_village_layout` now places the market ring first (leaving road gates), then street frontage on every corridor, then hillside fill only in the residential belt; footprints use SAT OBB tests instead of loose circles. Pine scatter avoids house plots and the plaza. Tests: `alpine_valley_batteries.test.ts`. *为什么：* roads, plaza and houses were independent polylines, so buildings sat on streets, clipped the square, and had no civic-to-district dependency.
- **Alpine valley scale and orography.** Default heightfield is now 128×128 with ~2× mountain relief. `generateAlpineValleyTerrain` no longer collapses to a single U-trough when a few peak gizmos are provided: user points stay as summits, then the generator still builds crest polylines, west/east flanking ranges, a hanging southeast side-valley, variable-width glacial flare, ridged FBM, and a thermal-erosion pass. Demo paths, forest count, and village `targetCount` scale with the larger basin. Tests: `alpine_valley_batteries.test.ts`. *为什么：* the 64×64 single-wall valley read as a toy diorama; 3A alpine scenes need layered ranges, side valleys, and room for a real settlement.

### Added
- **Procedural Village Layout battery & intelligent settlement distribution.** Implemented `procedural_village_layout` battery and `generateProceduralVillageLayout` algorithm. Instead of placing buildings one-by-one at arbitrary hardcoded coordinates, the algorithm automatically distributes building parcels across distinct functional zones (Town Center street frontage, Marketplace perimeter, Terraced hillside residential parcels, and Agricultural farmsteads) while enforcing strict distance setbacks from roads, trails, rivers, and neighboring buildings, plus slope-gradient filtering and road-tangent orientation alignment. Tests: `alpine_valley_batteries.test.ts`. *为什么：* Manual point placement caused buildings to overlap roads, intersect adjacent structures, and lack architectural rhythm; procedural zoning guarantees organic beauty, collision safety, and parameter adjustability.
- **Semantic mountain peaks, multifractal ridging & hydraulic erosion terrain system.** Extended `valley_heightfield` and `generateAlpineValleyTerrain` with semantic peak control points (`peaks: [{ x, y, elevation, radius, sharpness, type }]`), ridged multifractal noise, hydraulic-style slope erosion, stepped terrace shelf generation, and output fields for `buildableMask` and `slopeGrid`. *为什么：* Basic valleys felt too flat and uniform; 3A-grade alpine environments require dramatic multi-tier peaks, sculpted ridge lines, and natural terrain zoning.
- **Multi-tier house typology & seamless sloping terrain plinths.** Extended `multi_tier_houses` and `buildMultiTierHousesMesh` with alpine `chalet` typology (wooden balcony wraps, projecting eaves, steep gables) and automatic multi-corner ground height sampling. House foundation plinths now extend down to the lowest terrain corner beneath each footprint to eliminate floating foundations and clipping artifacts on steep hillsides. *为什么：* Alpine mountain villages sit on sloping terrain; structures must adapt their foundation plinths to the ground without gaps or clipping.
- **Alpine valley 3A white-box batteries.** `stone_arch_bridge`, `landmark_watchtower`, `watermill_building`, `village_plaza`, `terrace_walls`, `pine_forest_scatter`, and `multi_tier_houses` generate river, landmark, terrace, forest, and settlement meshes on the shared heightfield types. `examples/scene-script/alpine-valley.scene.ts` assembles them with river/road/trail sweeps. Tests: `alpine_valley_batteries.test.ts`. *为什么：* the valley demo needed reusable structure generators, not a one-off capture script.
- **S11 house module Ref.** Valley houses come from `import { HouseBox } from "./modules/house-box.scene.ts"` (`defineGroup` only). Outliner shows Houses with a child HouseBox badge `ref`. `refSceneNode` keeps the prim when mesh is missing (no 500). Changing box size literals in the module rebuilds every house. Tests: `scene_ref_house.test.ts`, `ref_scene_node.test.ts`, `displayIndex.test.ts`, `stageOutliner.test.ts`. *为什么：* A6 — a house is another scene, not geometry flattened into the valley file.

### Fixed
- **Valley param edits looked like no-ops.** Guide dots from `points_to_node` were always bound to the first `control_points` node (the river in the 3A graph), so dragging the road wrote the river. `setMeshLayer` also skipped updates when triangle count and corner vertices matched, so river-depth / valley-width changes never reached Default. Guide sources now match the polyline; mesh layers fingerprint sampled positions. Tests: `guidePoints.test.ts`, `store.test.ts`. *为什么：* a 64×64 heightfield keeps the same topology when only interior Z changes, and a multi-path scene cannot treat every Guide as the first control polyline.
- **S11 terrain mesh vanished after houses came back.** Walking the scene graph binds drawables by prim name, then by `mesh.role`. `mesh_to_node` layers are named by the battery id (often null), and `buildHeightfieldMesh` had no role, so Terrain resolved to `mesh:/Terrain` (empty store key) while Road (`role:'road'`) and HouseBox (hydrated name) still drew. DisplayIndex now falls back to the leftover unroled/`terrain` mesh layer; heightfield output is tagged `role:'terrain'`. Tests: `displayIndex.test.ts`, `heightfield_mesh.test.ts`. *为什么：* Default draws `layerKey` from the store; a scene prim named Terrain is not the same string as the heightfield battery id.
- **S11 houses vanished in Default and Outliner.** Two misses stacked: (1) preview only collected declared `mesh` ports, so `gabledHouses` inside `HouseBox` never became a mesh layer; (2) `scene_output.scene` arrives as a DataTree (`[{path, items:[port]}]`) and `parseScenePort` on that envelope returned null, so DisplayIndex fell back to meshLayers and had no Houses row. Preview now peels the wire with `parseScenePortFromWire` and hydrates Ref `content.mesh` into meshLayers. Tests: `sceneMeshHydration.test.ts`. *为什么：* a house module is a scene Ref on the composed graph; the Stage has to read that graph off the wire, not a top-level mesh battery.
- **Control pill is icon-only again.** The “控制/Control” caption under the preview-dock button is gone; `title` / `aria-label` still name it. Collector still calls `ensureViewingProject` first. Tests: `surfaces.smoke.test.tsx`. *为什么：* the caption was only a way to find the button; once visible it was noise.
- **Control sliders now change the scene without hitching, and no longer wipe the road.** Numeric ports commit on pointer-up (local draft while dragging) instead of `SetParam`+exec on every `input` tick. `point2d` Control ports are not collected as sliders — dragging that thumb had written `controlPoints({ points: 2 })` and emptied the centerline, so plot count / roof knobs appeared to do nothing. `footprint` / `depth` are Control. Tests: `ValleyControls.test.tsx`, `surfaces.smoke.test.tsx`. *为什么：* a Scene Script rewrite per slider tick is too expensive, and a point list is not a number.
- **Road and houses adsorb to the terrain surface.** `sampleHeightfieldSurface` barycentric-samples the same isotropic split as `buildHeightfieldMesh`. The road sweep takes Z at each left/right vertex with lift default 0 (no 0.2 m gap). House floors drape each footprint corner onto the surface and extrude walls up; no sit-on-max / contact lift. Preview uses `polygonOffset` so coplanar faces do not z-fight. Tests: `heightfield_mesh.test.ts`, `spline_sample_and_sweep.test.ts`, `gabled_houses.test.ts`. *为什么：* a geometric lift and a max-footprint plane leave a visible gap; adsorption has to follow the ground mesh the road and houses already depend on.

### Added
- **S13–S15 curve-first road and houses that follow it.** `spline_sample` exposes the sampled centerline (points, tangents, yaw, widths) as a value. `stroke_sweep_mesh` sweeps a terrain-following ribbon (Choice A: Z from the heightfield surface), so Default no longer triangulates a circular-brush mask. `roadWidth` is a Control on `splineSample`; optional `widths[]` and `flareStart` thicken the village entrance. `pointsAlongPolyline` offsets by local half-width + margin and outputs yaw; `gabledHouses` rotates the ridge (world heading, mesh Y-flip). Valley demo `p_mss75df6_0vpa4b` now wires `mainRoad → splineSample → strokeSweepMesh / pointsAlongPolyline → gabledHouses`. *为什么：* 15 §4.1 and 17 — the curve must be a value first; the visible road is a sweep, not a voxelized mask; width and house yaw are the same SetParam downstream.

### Fixed
- **Control drawer entry is labeled and waits for the viewing project.** The preview pill used the same sliders glyph as Effects and stayed hidden if `getSceneScriptContracts` / `listNodes` ran before `viewingProjectId` was set. The Control button now shows the “Control / 控制” caption, and the collector calls `ensureViewingProject` first. *为什么：* the valley demo’s roadWidth / house sliders were unreachable because the entry looked like Effects or never appeared.
- **Outliner names follow the scene graph, not Terrain/Houses folders.** `stagePathForSchema` no longer remaps every mesh to `/Terrain` and every box mesh to `/Houses`. Outliner rows use the scene node name (Lake, Cabins, …). Output type groups are now Mesh / Boxes and stay hidden when empty, so a non-valley scene does not show leftover Terrain/Houses chrome. *为什么：* not every scene is a valley village.
- **Design alignment & contracts correction (R1–R3):**
  - **R1 (Control surface collector):** Replaced static Valley controls with dynamic `useCollectedControls` hook that inspects `GET /api/v1/projects/:id/scene-script/contracts ∩ listNodes()`. Filters for inputs declared with `control: true && mode: 'parameter'`. The drawer pill button is hidden completely if the active scene graph does not expose any control ports. Scene Script Studio defaults to opening canonical module rather than hardcoding `valley.scene.ts`.
  - **R2 (Valley demo mainRoad & plotCount rewrite):** Implemented lightweight `control_points` and `points_along_polyline` batteries. Replaced individual manual points with a single `mainRoad` parameter list and `plotCount` along the polyline. Pointer-drag on guide dots now commits whole-array `SetParam(points, [...])` updates. Marked `roundness`/`peakRadius` and `width`/`height` as `control: true` in contracts, while removing `control: true` from single `manual_points`.
  - **R3 (DisplayIndex & Outliner dynamic tree):** Refactored `DisplayIndex` and `useDisplayIndex` to consume `SceneGraph → Drawable[]` via `projectSceneGraphToDisplayIndex` from `sceneOutput` scene ports. Outliner no longer hardcodes four fixed branches, instead building tree hierarchies dynamically from drawable `path`s. Default view consumes drawables strictly through `DisplayIndex`.

### Added
- **New Scene Batteries & Infrastructure (valley_heightfield, gabled_houses, heightfield_scale):**
  - Designed and implemented `valley_heightfield` battery: procedurally creates a continuous mountain valley elevation field with a gentle green meadow basin, flanking alpine mountain ridges, Gaussian peaks, and buildable mask.
  - Designed and implemented `gabled_houses` battery: procedurally creates architectural white-model village houses with pitched gabled roofs, triangular gables, and foundation plinths.
  - Designed and implemented `heightfield_scale` battery: converts discrete contour level grids into continuous metric elevation fields with Gaussian smoothing and power-law ridge shaping.
  - Upgraded road strip contrast with warm stone cobblestone palette (`[0.84, 0.80, 0.72]`) and `0.20m` lift.
  - Upgraded `valley.scene.ts` demo and established end-to-end editing (viewport guide dragging + dynamic control surface), display (SceneGraph DFS → DisplayIndex), and processing pipeline.
  - All 79 backend test files and 96 frontend test files pass 100%.

- **Default preview mode (S1): Voxel + Grid in one orbit-camera viewport.** Effects view switcher now leads with **Default**. Layers (Output, while Default is active) split into **Voxel** / **Grid** groups with independent eyes — hiding Voxel leaves the colored grid plane; hiding Grid leaves voxel blocks. Specialized modes (`top` / `topBillboard` / `iso` / `free3d` / `3DMesh`) stay registered. *为什么：* Default is the Hydra-style Stage preview; the first visible cut is the layer model (two schemas, one frame), not mesh ports.
- **Pack registry (S2, API only).** `GET /api/v1/packs` lists `world` / `geometry` / `image` host slots. A throwing geometry contract loader marks that pack `error` and leaves World `/ops` at 200. No left-pane Packs list — native host will not distinguish plugins in chrome. Batteries are not moved. Tests: `backend/tests/packs.test.ts`. *为什么：* contract isolation has to exist before a 3D/2D pack is copied in; one pack's failure must not take down the battery bar.
- **SceneContent union + schema badges (S3).** `SceneNode.content` is a discriminated union (`voxel` / `mesh` / `grid` / …). Bare Volume on the wire still means voxel. Output rows show a `voxel` / `grid` badge; Node Info shows `schema: voxel` for scene ports. No real mesh payload yet. Tests: `backend/tests/sceneContent.test.ts`, Default Output badges, Node Info. *为什么：* mesh cannot hang on the scene tree until content is more than Volume; the badge is the visible chrome this step must ship.
- **Terrain mesh in Default (S4).** New Output group **Terrain**. `heightfield_mesh` turns a height grid into a gray-white continuous mesh; `mesh_to_node` hangs it as `content.schema='mesh'`. DisplayIndex has a mesh adapter; Default draws it independently of Voxel cubes. 3DMesh still works and now reuses `pushIsotropicQuad` from the shared heightfield mesher. Demo wire: `hill_contour_generate` → `heightfield_mesh` → `mesh_to_node`. Tests: `backend/tests/heightfield_mesh.test.ts`, Default Terrain smoke. *为什么：* the valley demo's first "this is a white-model mountain, not top-down voxels" frame.
- **Road strip in Default (S5).** New Output group **Road**. `stroke_to_mesh` turns a road mask into a light ground-hugging strip (`mesh.role='road'`); `polyline_road_spline` is now Scene-Script callable so control points can feed the mask. Hide Terrain and the strip remains. Tests: `backend/tests/stroke_to_mesh.test.ts`, Default Road smoke. *为什么：* the valley demo's first "this is a road, not more hillside triangles" frame.
- **White-box houses in Default (S6).** New Output group **Houses**. `sample_height` reads the heightfield at plot points; `grid_to_boxes` extrudes axis-aligned white boxes (`mesh.role='houses'`). `buildingHeight` only grows the boxes; their bases stay on the slope. Tests: `backend/tests/grid_to_boxes.test.ts`, Default Houses smoke. *为什么：* the valley demo's first countable buildings, sitting on the hill instead of buried in it.
- **Guide polyline in Default (S7).** New Output group **Guide**. `points_to_node` hangs a point2d list as `content.schema='points'` and echoes the list for preview. Default draws a polyline + dots through the road control points. Hide Road and the line remains; dots are not draggable yet. Tests: `backend/tests/points_to_node.test.ts`, Default Guide smoke. *为什么：* these dots are the road's parameters, not vertices of the road mesh.
- **Drag guide dots = SetParam (S8).** Pointer-drag a Guide dot: during the drag only the polyline moves; on pointerup the renderer posts `workbench:set-param` for that `manual_points` x/y and the host `updateNodeParam` re-executes the road + houses. No baked writes. Tests: store `moveGuidePoint`, guide source mapping. *为什么：* the valley demo's bend-the-road acceptance is a param edit, not a mesh sculpt.
- **Valley Control panel + `valley.scene.ts` (S9).** Preview dock gains a **Valley** drawer with seed / hill / roadWidth / house count / buildingHeight / road points. Those ports are marked `control: true`. Studio opens `valley.scene.ts` when present. Sliders use the same SetParam path as S8. Tests: Valley drawer smoke; Studio prefers `valley.scene.ts`. *为什么：* the demo should be tunable without opening the 300-battery inspector.
- **Stage Outliner + lit Default scene (S10).** New **Outliner** drawer is the Terrain / Road / Houses / Guide tree from DisplayIndex paths. Click a row (or pick a mesh) posts `workbench:select-nodes` and the viewport draws an emissive outline. Default now uses hemisphere + shadowed sun, ACES, fog, a shadow-catcher ground, height-tinted terrain, and a triangle/object HUD. House boxes emit per-face normals. Tests: Outliner smoke, stageOutliner paths, Default HUD. *为什么：* the demo must be selectable like a Stage, and the white-box frame should look like a real Three.js scene, not an unlit overlay.

### Fixed
- **Dropped batteries teleported to the origin after Scene Script compile.** The authoring adapter only copied `updateNode` positions into layout, so a canvas `createNode` at the drop point was replaced by a newly compiled entity at `{0,0}`. Drop/create positions now stamp onto the new statement via `assignCreatedNodeLayouts`. Tests: `backend/tests/{runtimeBatchAdapter.layout,sceneScriptDropLayout}.test.ts`. *为什么：* the battery should stay where the user dropped it; id rewrite is an authoring detail, not a layout change.
- **A grid-output battery with no `sceneOutput` never previewed.** `POST /api/v1/projects/:id/execute` (auto-execute / live preview) reused the canonical capture gate meant for agent acceptance, so a lone Scene Script statement that only produces a `grid` returned 422 and never hydrated `previewLayers`. Preview execute now runs without `sceneOutput`; `POST .../execute/summary` and PUT/validate still require exactly one capture. *为什么：* intermediate grid is a Stage preview, not a finished scene.
- **Default Grid skipped zeros and could vanish even when the layer existed.** The S1 mesher instanced only non-zero cells (Top's empty-cell convention) and `Box3.setFromObject` often missed instance matrices, so noise/mask/heightfields looked blank. Default now paints a full-extent heatmap quad, including 0 as a dim cell. *为什么：* a single grid statement should show its intermediate result, not wait for a sink.
- **Scene Script Studio stayed stale until it was closed and reopened.** The panel loaded source only on mount, so canvas drops/edits that rewrite canonical source via the authoring adapter never appeared. It now subscribes to `graph:applied`, debounces, and reloads when local text is clean (dirty text is kept, with Reload). *为什么：* Studio is a live projection of the same authoring transaction, not a one-shot snapshot.
- **Output layer Alt-click subtree hide crashed the drawer.** `LayerTreeRows` called `collectDescendantLayerKeys` without importing it from `pathTree.ts`. *为什么：* parent output rows (the hierarchy tests) hit that helper; the function already existed.
- **Default crashed when voxel layers dropped to zero while staying in Default.** `useMaxRowsCols` called `useVoxelLayer` inside a variable-length `.map()` (and passed that array as `useMemo` deps), which violates the Rules of Hooks once landing/`reset()` no longer switches away to `3DMesh`. Extent now reads the layer maps with a stable hook list. *为什么：* opening an empty project or resetting while Default is the landing mode must not unmount-crash the Stage preview.

### Changed
- **Landing preview is Default.** Opening the plugin and `reset()` now set `viewMode: 'default'` instead of `3DMesh`. Specialized modes remain in Effects; viewMode is still session-only (not persisted). *为什么：* Default is the Stage preview the valley demo is built for; users should not have to click away from 3DMesh first.
- **Aligned live maps with the updated battery count.** `ARCHITECTURE.md` / `README.md` / `docs/architecture/{backend,extension-and-contracts}.md` now say ~327 scene batteries; `docs/templates/TEMPLATE_PATTERNS.md` points at `lib/legacy/templateOps.ts`. *为什么：* The scene-battery port grew the catalog past ~317, and the patterns table had drifted back to `lib/templateOps.ts`.

### Fixed

- **Left pane Status unavailable / `GET /api/v1/ops` 500 after the battery-port update.** `poi_scatter`, `hill_contour_generate`, `grid2node`, and `alg_region_area_partition` `scene.contract.ts` files lagged their sibling `meta.json` ports (`assetNames`/`outputAssetNames`, nested `outputGrids`/`outputLevels`, `stateGrid`/`stateKey`/`stateValues`, `stretch`/`edgeNoise`). `getSceneContractRegistry()` asserts that parity on first `/ops` and then caches the rejected promise for the process lifetime, so the left pane's `listOps()` catch showed Status unavailable until restart. *为什么：* Those four batteries' Runtime ports grew without regenerating the Scene Script contracts; `/health` stayed 200 because contract load is lazy.
- **`randomRules` 的权重变体在统计上"选不到"，`simple_common_16` 权重最高的变体永远不出现。** 根因在 `cellRng(x,y,salt)` 的散列组合方式：同一 `(x,y)` 会连续用两个相邻 salt 取数——`saltBase` 掷"是否保留基础块"（`keepProbability`），`saltBase+1` 掷"选哪个变体"（`pickWeightedVariant`）。旧实现只是 `(x*A) ^ (y*B) ^ (salt*C)` 一次线性乘+xor，没有 salt 差异之外的雪崩混合，等价于 `h(salt=1) = h(salt=0) xor 常数`——对 `h(salt=0)` 设阈值(掷骰)之后，`h(salt=1)` 的取值范围被这个 xor 常数确定性地搬到另一个子区间，导致"选变体"这一步不再均匀。实测 `simple_common_16` 的 `variantWeights:[4,2,2,2]`（对应 tile 6 的共享变体行）：权重 4 的变体在 90000 个格子上 0 次被选中(应约 40%)，只有权重 2 的三个变体轮流出现——这正是"预览里变体规则失效"的根因，且影响面是**所有**声明了 `randomRules`(不止 old-schema 单池 fallback，per-tileId pool 同理受影响) 的顶面/立面规则，只是权重均等([1,1,1,1])时不易察觉(仍会有 2 个变体永远选不到，只是它们互相"看起来一样"没被注意)。修复：`cellRng` 在原有乘+xor 之后追加一轮 MurmurHash3 `fmix32` 雪崩混合(`h^=h>>>16; h=imul(...); h^=h>>>13; h=imul(...); h^=h>>>16`)，让不同 salt 的输出互不相关。两处重复实现（`renderer/modes/topBillboard/buildVoxelMaster/pickFaceSprite.ts`、`renderer/modes/top/buildSurface.ts`）同步修复，并重编 `vendor/dist/renderer-resolve`（`pnpm build:vendor`）让 headless 导出/`scripts/preview.mjs` 走同一份逻辑，不再与浏览器渲染分叉。回归测试 `pickFaceSprite.test.ts`（90000 格 + 3 档 `keepProbability` 断言权重变体全部可达、比例贴近声明权重）。*为什么：* `simple_common_16` 是唯一显式声明非均匀 `variantWeights`(`4:2:2:2`) 的规则，问题在这里最先暴露，但根因是共享的散列函数，不是这个 JSON 文件本身的问题——修复后 `simple_common_16` 无需改动，旧版单池 fallback schema 天然兼容。
- **`PoiScatter` 的 `PoiRules`(`in_2`) 端口类型显示为 `any`**（`templates/structures/decorations/PoiScatter/PoiScatter.json`）。暴露端口写的是 `portType: "array"`，而编辑器端口类型表把 `array` / `list` 归一化成 `any`（`packages/node-runtime-react/src/editor/utils/portTypes.ts` 的 `TYPE_ALIASES`），于是画布上显示为任意类型、失去类型校验与配色。现改为 `string`，与同组 `AssetName`(`in_1`) 一致——实际用法就是接一个 `text_panel` 文本（`樱花树:1:6:4;…`）。*为什么：* 端口类型是接线时唯一的正确性提示，标成 `any` 会让任何类型都能接上去。
- **`DecorationBorder` / `PoiScatter` / `PoiPlace` 的装饰物在 Asset 视图下只显示下半截被地面盖掉**：三者的装饰 `grid2node` 未接 `zRange`，取默认 `[0]`，装饰体素与地面同层；而 Asset 视图的 object 贴图以「底面前排」为锚点绘制（`objectFootprintAnchorPoint` 注释即写明 `z=1` 才是地面 `z=0` 的顶面），同层会被地面立面盖掉下半截。现照 `NaturalDecorationDistribution` 的做法补 `basic_math_op('+', voxel_slice.z, 1) → range_list(start=end) → grid2node.zRange`，装饰落在地面之上一层。已扫描 `batteries/templates` 全部写 `asset_type=object` 的模板确认只有这三个漏了（`PickOneBuilding` / `PickMultiBuildings` / `PlaceOneDecoration` / `LocalPreciseDecoration` / `NaturalDecorationDistribution` 均已设 `zRange`）。实测装饰层 z 由 `[0]` 变为 `[1]`（地面与 Rest 仍为 `[0]`），Asset 出图铃兰草的花与茎叶完整可见。*为什么：* 上一条只解决了「画几个」，这条解决「每个画全」；两条约束都已写进三个模板的 README。
- **`assets/rules/rail_28.json`：端头改为逐格标签驱动（对齐 bridge_25 的写法）。** `faces.entry` 的默认 map（`edgeDist4`）只留 8 个「带弯」过渡片，端头 20–27 移进 `variants[].when.stateEquals`，按 `state.railTag` 分派：`entry_h`（端头是横长条 = 竖向轨的上/下端）→ 20/21·22/23，`entry_v`（竖长条 = 横向轨的左/右端）→ 24/26·25/27；标签由 `bridge_entry_tag(thickness=2)` → `grid2node(stateKey='railTag')` 产出，与 bridge_25 共用同一条链路（电池一行没改，它不是桥梁专用）。*为什么必须打标：* 竖向轨下端左格与左下外角的八邻域都是 `1,0,0,1,0,1,0,0`；最小尺寸拐角时连 `edgeDist4` 的 dist-2 探测也同样为空，旧版「端向 dist-2 空即端头」在拐角处必错。*带弯为什么仍可纯邻域判：* 键上多押一位垂直方向的 dist-2 实心（顶边带弯要求 `l2=0 && d2=1`）——旁边是拐角则拐角的竖臂让 `d2=1`，旁边只是端头则 `d2=0`，这一位是「带弯 / 端头旁的直边」的唯一分界。旧版还有两处顺手修掉：`faces.top` 的内角键写成 4 个通配符会被外角键抢走，现收敛为 4 条精确键；重复/语义写错的键已清。
- **`assets/rules/rail_28.json`：变体版位对齐示意图（右侧收边块的变体行整体上移一行）。** 示意图里 20–23 的变体从**第 2 行**起排（cols5-8），旧版从第 3 行起，8 个端头块的变体版位全体错一行。现统一为「tile t 的变体 = `sprites[28+4t..31+4t]`」——t 0-19 落第 `5+t` 行 cols0-3，t 20-27 落第 `2+(t-20)` 行 cols5-8，图集 144×400；28 个基块各挂一条 `randomRules`（`keepProbability` 0.5、4 变体等权），按「哪个面解析出这个基块」分挂到 top / entry（12 + 16 = 28，不重不漏）。`backend/tests/rail-28-autotile.test.ts` 里有一组用例直接对着示意图钉住基块坐标、图集边界与每个基块的变体行，避免再次静默错行。
- **变体槽的"有内容"判定加噪声下限：非透明像素 ≥ 6 才算有效变体。** `frontend/src/renderer/framework/asset/variantCandidates.ts:48` 的 `spriteHasVisiblePixel` 原本「任一 alpha>0 即算有内容」，图集切块边缘漏出的抗锯齿点、素材上的孤立噪点足以让一个实际为空的变体槽通过过滤、被 `randomRules` 抽中，渲染出空块（`edge_path_43` 的变体区可见）。现改为计数 `≥ MIN_VISIBLE_PIXELS(6)`；判定仍是 RENDER/EXPORT 共用的同一份纯函数，两侧候选集保持一致（导出侧经 `pnpm build:vendor` 同步 `vendor/dist/renderer-resolve`）。测试：`frontend/src/renderer/framework/asset/__tests__/variantCandidates.test.ts`。
- **`assets/rules/bridge_25.json`：`faces.entry` 把桥身整个吃掉了。** 三处真问题：(1) `map` 里 `"0,1,0,1,*,*,*,*"` 写了两遍（→8 与 →0），JSON 重复键后者覆盖前者，**tile 8 永远取不到**；(2) entry 的键全带 4 个通配符，`lookupWithWildcard` 让它们抢走大量非端头格，而 entry 又优先于 top 绘制——竖向桥左扶手 `1,1,0,1,…` 本该 top 的 3 却被 →11 抢走，横向桥顶部扶手 `0,1,1,1,…` 本该 top 的 9 却被 →1 抢走，全包围中段 `1,1,1,1,1,1,1,1` 被 `1,*,1,1,*…`→6 抢走；(3) `"1,*,0,0,*,*,*,*": 5` 语义写错（5 是竖向桥下端左角，应为 `u=1,d=0,l=0,r=1`，写成了孤立格）。现改为：`faces.entry.map` 置空（不命中即回落 top），`variants` 按 `state.bridgeTag` 分派——`entry_h` 走 0/1/2 与 5/6/7、`entry_v` 走 8/11/14 与 10/13/16；`faces.top.map` 收敛为只管 3/4/9/15/12 与 17–24。*为什么必须靠标签：* 竖向桥上端头中格与横向桥顶部扶手中格的八邻域都是 `0,1,1,1,0,0,1,1`，竖向桥上端头左角与横向桥左端头上格都是 `0,1,0,1,0,0,0,1`，纯邻域不可分。（sprites 切块本身经核对与图集完全对位，未改。）
- **`vendor/shared/types/scene/volume.ts`：带 `state` 的体积被密度阈值降级成 dense，标签整批丢失。** `volumeFromCells` 只在「uniform」分支检查 `allNoState`，填充率 ≥ `DENSE_FILL_THRESHOLD`(0.2) 就走 dense——而 dense 只存 token 编码，存不下 per-cell state（本次十字桥填充率 0.4，标签在 grid2node 出口就没了）。现在 `volumeFromCells` 与 `materialize()` 都在密度判断前先看有没有 state，有就留在 sparse。
- **`edge_path` 图层退化成整图直贴（看着完全没拼接）。** 规则文件从 `edge_path_23.json` 改名为 `assets/rules/edge_path_43.json`（基块 23→43），但素材 alias 第 8 段（field[7]，即规则名）仍写 `edge_path_23`，于是 `deriveAliasMeta` 给出的 `tileType` 在磁盘上已无对应文件。改素材侧对齐：用新增的离线工具把 `library.db` 里素材的 field[7] 重打标为 `edge_path_43`（规则文件本身不动）。*为什么：* 规则名是素材与规则之间唯一的连接键，改名后必须两侧同时改。注：重打标只落在本地 worktree 的 `library.db` 上，未随本次移植提交（blobs skip）。

### Added

- **逐格标签（per-cell `state`）生产链路打通：`grid2node` 新增 `stateGrid`/`stateKey`/`stateValues` 三个可选口。** `batteries/scene/bridge/grid2node/{index.ts,meta.json}`：与 `grid` 同尺寸的标签网格，非零值经 `stateValues` 按下标映射成字符串后写进体素 `state[stateKey]`；未接线时行为与从前逐字节一致（体素不带 state）。*为什么：* autotile 的 `face.variants[].when.stateEquals` 消费端（`renderer/.../pickFaceSprite.ts` + `backend/src/scene-export/tileRules.ts`）2026-06 就已就位，但**生产端一直没有入口**——slope_24 的 `slopeDir` 至今回退默认 map 就是这个原因。这是一个通用通道，不是桥梁专用口。
- **新增电池 `bridge_entry_tag`（桥梁端头标记）** `batteries/components/Topographic/bridge_entry_tag/{index.ts,meta.json,icon.svg}`：吃桥掩码 grid，吐 `tagGrid`（0=桥身 / 1=端头·横长条 / 2=端头·竖长条）+ `stateValues`（`["", "entry_h", "entry_v"]`，直接接 grid2node 同名口）+ `entryCount`。判据 = 「厚度 ≤ `thickness`(默认 3) 的终止长条」：逐格取行/列连续长度 `rx`/`ry`，`rx ≤ thickness && rx < ry` 且整条行段一侧全空 → 横长条端头，列向同理。`rx ≤ thickness` 是 L 拐角的防线——拐角外侧那一列虽然「整列一侧全空」，长度却是桥臂长而非桥宽，会被挡掉（`backend/tests/bridge-25-autotile.test.ts` 有专门用例）。
- **`backend/tests/rail-28-autotile.test.ts`**：与 bridge 同一条链路（真规则 + `bridge_entry_tag(thickness=2)` + vendored resolver）逐格断言 rail_28。
- **`backend/tests/bridge-25-autotile.test.ts`**：用**真规则 + 真电池 + vendored renderer resolver** 跑通 `bridge_entry_tag → grid2node → projectSceneToVoxelLayers → pickFaceSpriteIndexIfMapped(entry)/pickFaceSpriteIndex(top)`，对十字桥逐格断言基块 id。
- **新增 `scripts/retag-rule-alias.mjs`（离线工具）。** `retag-rule-alias.mjs <from> <to> [--dry-run]`：把素材 alias field[7] 的规则名整体重打标，同时清掉 `.forgeax-runtime` 里烘焙场景的旧引用。
- **新增 `assets/rules/edge_path_43.json`（由 `edge_path_23` 草稿重打标）。** 纯顶面 `keyMode=adjacent8`。`library.db` 重打标未随本次移植（blobs skip）。

### Changed

- **`PoiPlace` 重命名为 `PlaceMultipleDecorations`**（`templates/structures/decorations/PlaceMultipleDecorations/`）。文件夹 / JSON basename / 显示名同步为 `PlaceMultipleDecorations`（`nameEn`: Place Multiple Decorations）；`templateId` `group_1782200000003_poipl` 不变。校验脚本键名与 `TEMPLATE_VERIFY_REPORT` 已跟着改。同时把暴露端口 `PoiRules`(`in_2`) 的 `portType` 从 `array` 改为 `string`（否则会被归一成 `any`）。*为什么：* 与同目录 `PlaceOneDecoration` 对齐命名，表达「按坐标批量精准落装饰」；旧 basename `PoiPlace` 不再作为查找键。
- **`PoiScatter` README「使用方法」改为完整 graph JSON**（`nodes`+`edges`，对齐 `usage.png`），不再用示意文字。
- **`PoiScatter` README 按四段重写**：主要功能及适用场景 / 端口介绍（主要端口 + 其他参数）/ 特殊规则 / 使用方法（对齐 `usage.png` 接线）。
- **`PoiScatter` / `poi_scatter` 支持单条与批量两种用法**（`components/decoration/poi_scatter/`，`templates/structures/decorations/PoiScatter/`）。`poiRules` 除原有 JSON 数组外，现接受单个对象 `{"樱花树":"1:6:4"}`、裸文本 `樱花树:1:6:4`、分号分隔列表与多键对象；`assetNames` 为新增输入，接受单个名称或 `[a,b]` / `a,b` / `a；b` 列表，与规则按下标一一对应（只给一个则广播，不给则用规则名）。新增 `outputAssetNames`（access:list）按行优先逐点输出资产名，与 `alg_field2points` 的采样点分支路径完全一致，模板据此把它接到 `ObjectAssetName.in_1`，`in_1`(AssetName) 改为直连 `poi_scatter.assetNames`。*为什么：* 原先 `in_1` 只是一个写给所有 POI 的单一字符串，一组内无法混放多种资产；而 `in_2` 必须手工包成 JSON 数组（画布上还要额外接一个 `str_to_list`），单条使用的成本远高于必要。测试 `backend/tests/poi_scatter_single_and_batch.test.ts`。
- **`decoration_border` / `DecorationBorder` 的 `offset` 默认值改为 `1`**：原先默认 `0`（紧贴边界层），现改为外围第 1 圈；电池 `meta.json` / 运行时 fallback、组件 README 与模板 `params.offset` 已同步。

### Changed

- **Split Scene Agent HTTP by resource.** `backend/src/routes/sceneProjectAgent.ts` became `backend/src/routes/scene-agent/{index,work-graph,locate,lens,propose,transactions,helpers,types}.ts`. Prefix `/api/v1/projects/:projectId/scene-agent` and status codes are unchanged. *为什么：* the 776-line Agent route mixed locate/lens/propose/transaction after Scene Script routes were already split.
- **Aligned app maps with kernel counts and project-scoped batch.** `ARCHITECTURE.md` / `README.md` / `docs/architecture/extension-and-contracts.md` / `AGENTS.md` now say ~317 scene batteries + 45 common ops and `POST /api/v1/projects/:projectId/batch`; SKILL / `TEMPLATE_PATTERNS.md` point at `lib/legacy/templateOps.ts`. *为什么：* leftover 32 / ~276 / unscoped `/api/v1/batch` / `lib/templateOps.ts` contradicted the authoring-stack maps.
- **Split Scene Script integration and HTTP routes by concern.** `backend/src/scene-script/` is now `contracts/` `persist/` `compile/` `adapter/` `agent/`; `backend/src/routes/sceneScript.ts` became `backend/src/routes/scene-script/{index,project,history,lift,source,contracts,lens,definitions,commands,helpers,types}.ts`. Public paths and status codes are unchanged. JSON template materialization moved to `backend/src/lib/legacy/templateOps.ts`; unused `buildTemplateOps` import removed from `groupTemplates.ts`. Tests: `backend/src/scene-script/**/*.test.ts`, `backend/tests/sceneScript*.test.ts`, `backend/tests/groupTemplates.test.ts`, `backend/tests/templateInstantiate.test.ts`. *为什么：* the 1.2k-line route file and flat integration layer mixed persistence, compile, reverse-batch, and HTTP.
- **Scene Agent 工具返回改为有界投影。** `backend/src/tool-handlers.ts:195` 在 AI 的 `scene:script.validate/put` 返回中保留 revision、transaction、diagnostics 和计数，但剔除调用方刚提交的 canonical source、完整 Source Map 与多模块 sources；REST/Studio 契约不变。测试：`backend/tests/tool-handlers.test.ts`。*为什么：* 避免每次验证/提交都把可重建的大型编译投影重复灌回模型上下文。
- **Sino 的 Scene Script skill 改为按任务类型独立收口。** `skills/compose-scene-script/SKILL.md:25` 明确 project management / bootstrap / design / edit / inspection 五类边界；仅产生或修改 Scene Script 时才进入执行与非空 Renderer 门禁。*为什么：* 项目容器操作不能自动升级为完整场景创作。
- **Replaced the legacy Sino configuration with the independent Scene Script scene designer.** The Scene Generator page now prefers `@forgeax-extension/agent-sino`; Sino uses one canonical skill, a static high-level tool allowlist, bounded resume/edit transactions, staged scene-quality checks, and file-backed Renderer captures. Direct Authoring, Runtime Graph, catalog, export, and external-asset bridges are no longer exposed to AI. *为什么：* the Agent must spend context on spatial design and evidence-backed refinement rather than API discovery, graph internals, or cross-Agent coordination.
- **Removed obsolete Sino prompt surfaces.** The old Graph-v1 archive, brief handoff skill, external critic skill, deprecated skill alias, and their schemas/examples were deleted; prompt and manifest regression tests now reject those concepts. *为什么：* keeping contradictory instructions in the installed plugin made the retired workflow recoverable and could silently reintroduce it after prompt selection or compaction.
- **Completed the Studio-side unified Scene Script diagnostic loop.** `frontend/src/api/HttpApiClient.ts` now models and caps source/graph evidence, expected/actual, transaction, retry/escalation, Debug Attachment references, and structured fixes; safe `ReplaceReference` fixes are translated to revision-guarded authoring commands. `workbench/SceneScriptStudio.tsx` renders the full bounded contract, selects both text and Authoring nodes, preserves local text on 409, and shares statement codes with Node Info through `sceneScriptDiagnosticBridge.ts`. Tests: `frontend/src/api/__tests__/httpApiClient.test.ts`, `frontend/src/workbench/__tests__/{SceneScriptStudio,SceneGeneratorControlsPanel}.test.tsx`. *为什么：* source and graph surfaces must present one actionable diagnosis without stale-revision overwrite or leaking debug payloads.
- **Scene Script routes now return one bounded diagnostic and transaction contract for validation and mutation failures.** `backend/src/scene-script/diagnostics.ts` and `backend/src/routes/sceneScript.ts` preserve legacy revision-conflict fields while adding normalized graph/source evidence, expected/actual, retry/escalation policy, `applied/rolledBack/undoToken`, a three-diagnostic/three-fix budget, and removal of stack/Runtime Graph/DataTree/voxel payloads. Parse/compile/capability failures are rejected before Runtime Graph import; route tests verify revision conflicts, parse failures, compile failures, sealed capability denial, and graph immutability. Test: `backend/tests/sceneScriptDiagnostics.test.ts`. *为什么：* failed authoring submissions must be observably non-applied and return enough local repair context without flooding Agent context.
- **Replaced Sino's runtime-graph construction workflow with canonical Scene Script authoring.** A restricted typed DSL, deterministic compiler, recursive modules, stable Source Map, project-local group definitions, structured diagnostics, Edit Lens transactions, and sealed template capabilities now project into the existing node editor/runtime without changing its visual surface. `/compose-sino-scene` points to the semantic Scene Script skill; legacy `applyBatch`/template-composer tools are no longer exposed to AI, and the former graph-editing skill is archived under `skills/archive/`. *为什么：* stop spending Agent context on op schemas, port numbers, template internals, and repair loops; make scene semantics the Agent's primary work while preserving the existing graph execution and user editing experience.

- **Added floating Scene Gen opacity control and restore-workspace action (M14/M04).** The host toolbar exposes the Bundle’s 20–100% opacity range (default 92%) through layered editor surfaces, and the editor remains mounted while its card starts collapsed. The plugin-scoped “Restore workspace” action restores the renderer and editor availability, collapses the card, resets Preview drawer width, and removes only obsolete layout keys (`editorInline`, `sidebarWidth`, `workbench-height`). *为什么：* preserve Bundle interaction semantics without touching Page-owned sidebar/dock/locale state.
- **Re-baselined M05/M10/M12/M13/M15 against Bundle commit `658b8703`.** The Preview capsule now contains only the Bundle entries, opening a drawer or taking a screenshot closes the other Preview context, Renderer editor highlighting follows the host visibility protocol rather than the editor-availability storage key, and BatteryBar uses the Bundle’s hidden native scrollbar plus drawn thumb. History, Data Types, and Help remain reachable as tabs inside the Page-adapted Node Info card. The non-Bundle Reset/Fullscreen capsule additions and Create Grid auto-view switching were removed. *为什么：* separate strict UI migration from later product enhancements.
- **Changed the Preview default view mode to Top.** Store initialization, reset behavior, and sidebar context fallbacks now agree on `top`, so plain grid outputs such as Create Grid are visible without an execution-time mode override.

- **Migrated Editable and Output layer trees from the transitional right panel into mutually exclusive left drawers.** The tool capsule now exposes separate Editable and Output entries; drawer width is persisted under `wb-scene-generator.preview-drawer-width` (one-time migration from `renderer-layers-width`) and resized via an in-drawer grip with container-query caps. The later Bundle re-baseline restores screenshot/drawer mutual exclusion. *为什么：* complete the Page v2 preview chrome migration without duplicating the old right-rail layout.

- **Converted the Scene Gen workspace from a vertically split layout to a floating editor card.** Renderer now fills the Page workspace, Scene Gen starts collapsed and opens in the lower-right, and the Page-owned sidebar remains the single project-management surface. *为什么：* the current Page layout already owns the sidebar; recreating projects inside the center iframe would duplicate project state and controls.

- **Removed the standalone AssetStore workbench UI while retaining the asset-library service and AI/renderer data paths.** The workbench now mounts only the Renderer iframe; its left navigation, pane routing, focus/status protocol, and documentation no longer advertise AssetStore as a user-facing surface. *为什么：* the Page design has no approved AssetStore UI entry, while asset lookup and generated-asset workflows still require the underlying library contracts.

- **Workbench manifest migrated to the Page contract.** `forgeax-plugin.json`
  now contributes one Page, one reusable panel type, explicit sidebar/workspace
  placements, and a horizontal left/right Page layout instead of `provides.workbench`
  split metadata. *为什么：* panel availability and position must have one Page-owned SSOT.

### Fixed
- **Slug-root `package.json` no longer declares `workspace:*`, so Studio `bun install` can install this directory.** `@forgeax/node-runtime` stays `workspace:*` on `backend`/`frontend` only. Tests: `scripts/standalone-plugin-dependencies.test.mjs`, `scripts/serve-dist.test.mjs`. Cold start: `scripts/dev.mjs` / `serve-dist.mjs` call `ensureWorkspacePackages`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* Studio `prepare.ts` bun-installs the marketplace symlink to this slug root and cannot be changed this round.
- **Correction: `file:` in this app's `package.json` is not the install path.** The Unreleased bullet below that switched `@forgeax/node-runtime` to `file:../../packages/node-runtime` for Studio `bun install` is superseded. Apps keep `workspace:*`; Studio installs `@forgeax-extension/scene-generator` from `release/`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* relative `file:` dies outside this tree; mixing a pnpm workspace member with a Bun-installable extension already failed twice.
- **Create-only 场景项目不再被迫生成 base grid。** `backend/src/routes/projects.ts:140` 与 `forgeax-plugin.json:163` 将 name 改为可选（缺省按 active game 命名），创建后只返回位于 active game 的空 Scene Project；不会隐式 open、初始化或执行。测试：`backend/tests/activeGameProjectStorage.test.ts`。*为什么：* “只建项目/Just scaffold it”的合法完成状态就是空项目，不能被 Scene Script 的非空输出门禁篡改。
- **Pipeline execution acceptance now hard-fails false successes.** `backend/src/execution-summary.ts` treats every non-empty `execFailures` list as a structured execution failure and, for canonical Scene Script projects, verifies only the compiled `resultEntityIds`/`sceneOutput` captures contain final voxel cells; intermediate Scene ports can no longer make an empty final capture pass. `backend/src/routes/{sceneScript,execute}.ts` rejects canonical validation/commit/execution without a `sceneOutput` capture, while unmanaged legacy Runtime Graphs keep their previous all-output compatibility behavior. Agent tool execution enables bounded failure collection and throws a primary execution diagnosis even when runtime status is `completed`. Tests: `backend/tests/{execution-summary,tool-handlers,sceneScriptDiagnostics}.test.ts`. *为什么：* areaPartition 等内部节点失败、或中间端口有 cells 但顶层输出为空时，Agent 不能再把 `completed`/`verification.ok=true` 误判为交付成功。
- **Standalone installs no longer depend on pnpm's workspace protocol.**
  `package.json` now resolves `@forgeax/node-runtime` through the repository-local
  `file:../../packages/node-runtime` path, so Studio's direct `bun install` can
  install this plugin. Regression: `scripts/standalone-plugin-dependencies.test.mjs`.
  *为什么：* Studio installs a plugin directly rather than through pnpm's
  workspace resolver.

### Added
- **新增 `assets/rules/street_41.json`（街道 autotile，填充区域型 · 纯顶面 · top(adjacent8)+entry(edgeDist4)）。** 41 基块分 5 组：A 外收边 0–7、B 内部白线环 8–15、C 内收边 16–23、D 朝外内角+交点 24–28、E 端头三件套 29–40。两面按信息轴互补且 entry 优先：`faces.top`(keyMode=adjacent8)负责几何轮廓——边界(udlr 含 0)→A 组凸角/直边(0–7)与窄路(12/14)，内部(udlr=1111)按 8 位对角空缺数派发 C 内角/内收边(1 空→16/18/21/23、2 邻空→17/19/20/22)、D 朝外内角(3 空→24/25/27/28)/交点(4 空→26)；`faces.entry`(keyMode=edgeDist4, `u,d,l,r,u2,d2,l2,r2`)只装白线环 B——对 `udlr=1111` 且**至少一侧 dist-2 为空**的格按方向派发白线/角(8–15)，**刻意不含 dist-2 全满键**，使深内部与内角回退到 top 的 adjacent8 判定（避免 entry 优先覆盖 16–28）。每基块 4 变体（keepProbability 0.5），sprites 205（base41 + 变体 41×4，A/B/C 块各 8 行、D 块 5 行、E 块 12 行，x 基址 0/64/128/192/256），图集建议 336×240。*为什么：* 用户提供 street_41 示意图（图 2–3 为 basepieces 语义），要求补全该规则、只画顶面（未提供立面 basepiece）、不同标线样式另拆 rule。⚠️ 待验证：(1) E 端头 29–40 sprite 已备但不进 top/entry map——任意宽度下端头 4 邻域键与贯通路边界键不可区分，按既定方案由生成器端头掩码单独喂入 entry 匹配，本 rule 不含 E 键以免污染贯通路；(2) 超宽路(≥5 格)正中 dist-2 皆满，entry 落空回退 top 全满键→14 纯路面填充，无走向区分；(3) 细臂(≤2 格)路口的内角格若某侧 dist-2 恰空，可能被 entry 白线键误抓；(4) 2D top 预览不渲染 entry（与 rail_28 一致），白线仅在 3D billboard / scene-export 可见；(5) sprites 像素坐标依示意图读取，需与实际导出图集比对。
- **`FaceVariantWhen: stateEquals` —— face.variants 可按 per-cell `state[key]==value` 选 map（标签派发），并打通 cell.state → 选片上下文的消费链。** 原 `FaceVariantWhen` 单一 `regionContains`（空间关系）扩为闭合 union，新增 `stateEquals:{ key, value }`：`pickFaceSprite.ts` variant 匹配读 `ctx.cell.state`，命中即换 variant.map。前后端 parity 同步：`ruleCache.ts`/`tileRules.ts` 的 `parseFaceVariantWhen` 解析两种 when；`CollectedCell` 带 `state`（前端 `paintCell` 本就直传 collected cell，无需改）；后端 `tileRules.ts::faceContext` + `pickTopSpriteIndex`/`pickFrontSpriteIndex` 新增 `state` 入参，`cooker.ts` 发片循环把 `cell.state` 透传进去；`vendorResolver.d.ts` 同步 union + `CollectedCell.state`（并补齐遗漏的 `edgeDist4`）；`build:vendor` 重编 resolver。单测：`scene-export-renderer-parity.test.ts` 新增「slopeDir 标签派发」用例（三孤立格 tag 缺省/front/left → map 0/1/2，导出与 shared resolver 一致）。*为什么：* 坡向（前/后/左/右）无法用邻居/region 干净区分（独立坡带镜像同形、坡环邻域错乱，见调研）；改由上游地形按格派发 `state.slopeDir` 标签、rule 只据标签走对应 map。方向标签的**产出**由未来地形步骤负责，本次只搭后端消费链路。
- **新增 `assets/rules/slope_24.json`（坡道 autotile，四方向 · 纯 faces.top 平面逻辑 · 标签派发方向）。** 24 基块 = 左坡 0–5 / 右坡 6–11 / 后坡 12–17 / 前坡 18–23，每方向一条 2 格深坡带。方向由 per-cell 标签 `state.slopeDir` 判定（`when.stateEquals`）：默认 map=后坡(back/缺省)，`front`→前坡、`left`→左坡、`right`→右坡；带内用 adjacent4 `(u,d,l,r)` 分「远端下沿/近台面行」与「左端/中段/右端」。**不绘立面、无 `faces.front`** —— 「前坡/后坡」是平面方向字段，与 z 轴 `front` 立面字段是两回事，勿混淆。sprites 120（base24 + 变体 24×4，左组 tile0–11 @ x0–48/y64+、右组 tile12–23 @ x64–112/y64+），每基块 4 变体（keepProbability 0.5）。*为什么：* 用户要求按四方向补全坡道 rule 且走平面逻辑；方向改用地形派发的标签而非高度/region 判定（先前 `regions.high`+`regionContains` 版本已废弃）。⚠️ 待验证：地形侧尚未产出 `state.slopeDir`，当前所有坡格回退默认后坡 map，需未来地形步骤打标签后端到端验收。
- **`FaceKeyMode: edgeDist4` — top/entry 面 map 在四个方向探测距离 2 的邻居。** `buildTopFaceKey` / `FaceKeyMode` 新增 `edgeDist4`：8 位 key `u,d,l,r,u2,d2,l2,r2`（在 `edgeDist2` 的竖向 ±2 基础上再加水平 `l2=(x-2,y)` / `r2=(x+2,y)`），让 map 能在上下左右四个方向都区分「距端 1 格」与「真正中段」（适合双向都需收边的填充带）。前后端同步：`ruleCache.ts` / `tileRules.ts` 的 `parseFaceKeyMode` 接受该 schema，`tileRules.ts::occToCoords` 邻域种子补 `[-2,0,0]/[2,0,0]` 水平偏移；`build:vendor` 已重编 vendored resolver。单测：`neighborKey.test.ts`（8 元组竖+横 dist-2 探测）、`scene-export-renderer-parity.test.ts`（横向 3 列带用 `edgeDist4` 键区分左端/中段/右端，导出与渲染器逐格一致）。*为什么：* 用户需要一个上下左右 + 上上/下下/左左/右右 的 keymode，`edgeDist2` 只探竖向、`adjacent8` 只探 ±1 对角，都无法表达水平方向的「距端 1 格 vs 中段」。
- **新增 `assets/rules/rail_28.json`（铁轨 autotile，填充区域型 · 纯顶面 · top(adjacent8)+entry(edgeDist4)）。** 铁轨=2 格宽带，示意图排成 5×5 环（外圈 2 格宽矩形环、中心 3×3 空洞）+ 右侧收边块。两面互补且 entry 优先：`faces.top`(adjacent8, `u,d,l,r,ul,ur,dl,dr`)按纯邻域几何——4 外角 0/4/15/19(udlr 两正交零)、4 直边中段 2/9/10/17(udlr 一零)、4 内角 6/7/12/13(udlr=1111 + 一对角空，空对角指向凹侧：6=dr/7=dl/12=ur/13=ul)；`faces.entry`(edgeDist4, `u,d,l,r,u2,d2,l2,r2`)按距离-2 邻域装 top 无法区分的两类——8 带弯过渡片 1/3/5/8/11/14/16/18(直边 + 靠角侧 dist-2 空)、8 端头收边 20–27(2 格宽带端，端向 dist-2 空)。带弯/端头的 udlr 与直边/外角同形、adjacent8 不可分，故走 edgeDist4；命中即优先。28 键全去重、0–27 全覆盖、两面 tile 无重叠。sprites 140（base28 + 变体 28×4：左块 tile0–19 @ x0–63、右块 20–27 @ x80–143），每基块 4 变体（keepProbability 0.5，带弯/端头变体挂 entry 面）。*为什么：* 用户提供 rail_28 精确示意图（5×5 环 + 四件套带弯 + 端头三件套），要求照图修正——修正前 top.map 有 7 个重复 `*,*,*,*,*,*,*,*` 键（JSON 后覆前）、内角对角方向错乱、带弯全丢失。⚠️ 待验证：(1) 2D 顶视图只渲染 top（与既有规则一致），带弯显示为直边、端头显示为外角，细节仅在 3D billboard / scene-export 可见；(2) 端头 20–27 与外角 0/4/15/19 的 adjacent8 完全同形，仅靠 edgeDist4 端向 dist-2=0 区分，依赖生成器把带端产出为恒 2 格宽；(3) ≥3 格宽铁轨无对应基块（本设计假定恒 2 格宽）。
- **完成 `bridge_25.json` + 新增 `faces.entry` 面。** `top`：竖向中段扶手(3/4)、横向面域(9/12/15)、L 角柱(17–24，8 组对角精确键)；`entry`：全部收口块(0/1/2/5/6/7 竖向端、8/10/11/13/14/16 横向端)，竖向端用 `u,*,l,r` 通配键与横向 `0,1,l,r` 区分走向。渲染/导出：`pickFaceSpriteIndexIfMapped` + entry 优先于 top；`ruleCache`/`tileRules`/`bindings`/`cooker` 同步解析 entry 变体池。*为什么：* 用户提供 bridge_25 完整示意图（含 17–24 L 角点），要求补全 rule 并新增与 top/front 并列的 entry 字段。
- **新增 `assets/rules/outer_wall_36.json`（外墙 autotile 规则，内外墙双套立面）。** faces.top(0–17) 与 `path_18` 同结构顶面；faces.front(18–35) = 3×3 立面九宫格 ×2 套（18–26 外墙、27–35 内墙），按 `(t,b,l,r)` 折算 row×col，默认外墙，voxel 的 `(x,y+1)` 落在父 region 内（billboard 视角看到墙内侧）时经 `regionContains` 切到内墙（同 `wall_outer_16` 机制，从 5/3 扩到全 9/9）。每基块 4 变体，sprites 共 180（base36+变体×4）。*为什么：* 用户提供 `outer_wall_36` 示意图（墙顶 0–17 / 外墙 18–26 / 内墙 27–35），要求补全该规则。
- **`faces.front.blockVariants` —— 连续 3×3 实心墙块整体替换成大图。** `FaceRule` 新增可选 `blockVariants: { probability, groups: number[][] }`（每个 group 恰好 9 个 sprite idx，顺序=局部 z\*3+x 行主序）；新增纯函数 `frontend/src/renderer/framework/asset/blockVariant.ts::pickBlockVariantSpriteIndex`，在 `pickFaceSprite.ts::pickFaceSpriteIndex` 的 front 分支最前面接入——以世界坐标网格对齐（`anchor=floor(x/3)*3,floor(z/3)*3`）判定当前 cell 所在 3×3 巨格是否全实心，实心则按坐标定死的 hash 掷骰决定是否用某个候选 group 整体覆盖这 9 格（命中的 9 格共享同一 group，不再各自逐格 autotile/randomRules）。前后端 parity：`ruleCache.ts`/`tileRules.ts` 的 `parseFace` 同步解析该字段，`vendorResolver.d.ts` 补充 ambient 类型，`tileRules.ts::occToCoords` 的邻域探测偏移扩到 `dx,dz∈[-2,2]`（巨格内任意局部位置都可能是当前 cell）。单测：`blockVariant.test.ts`（纯函数：非实心/概率不中/组内一致性）、`scene-export-renderer-parity.test.ts`（`front.blockVariants` 用例：6×3 实心墙两个巨格，破坏左侧巨格验证局部回退、右侧巨格验证 cook 与渲染器一致）。*为什么：* `inner_wall_27` 需要"识别到连续九宫格墙体时概率替换为预制大图"，现有 map/randomRules/variants 机制只能逐格决策，无法表达"9 格共享同一张大图"。
- **新增 `assets/rules/inner_wall_27.json`（内墙 autotile 规则，仅内墙无外墙）。** faces.top(0–17) 与 `outer_wall_36`/`path_18` 同结构顶面；faces.front(18–26) 复用 `outer_wall_36` 默认（外墙角色集）的 9 格 3×3 立面结构但语义上作为"唯一一套墙体"（无 `regions`/`variants` 区域切换）；额外声明 `blockVariants`（3 个候选大变体组，probability 0.35）。sprites 布局：base 27（top18+front9，直接复用 `outer_wall_36` 对应位置像素坐标）+ top 变体 72 + front 变体 36 + 3 组大变体 27 = 162。*为什么：* 用户提供 `inner_wall_27` 示意图，要求仅内墙、并支持连续九宫格墙体概率替换为大变体。
- **新增 `assets/rules/cliff_25.json`（崖壁 autotile 规则）。** 顶面（0–15）直接复用 `common_16` 的 16-tile adjacent4 邻域走位；立面（16–24）仿 `outer_wall_36` 的顶面/立面分离写法，做成 3×3 九宫格，按 `(t,b,l,r)` 邻域折算 row(top/mid/bottom，t=0 恒顶行，t=1 时按 b 分中/底行，可向下重复延伸)×col(left-outer/mid/right-outer，仅一侧有邻块取对应外侧列)；因崖壁天然单向（无内侧），只需一套 9 格，不像 outer_wall 需要内外墙两套 variants。每基块 4 变体（`randomRules`），sprites 布局：顶面基块 4×4 @ (0,0)、立面基块 3×3 @ (64,0)，顶面变体行始于 y=64、立面变体行始于 y=48（各自紧接自身基块行尾），图集建议 ≥128×320。*为什么：* 场景生成器需要一个带垂直面的崖壁地形规则，用户提供了 rule 示意图，要求照 outer_wall_36 顶面/立面分离的方法撰写。
- **`FaceKeyMode: adjacent8` — top 面 map 探索 8 邻域。** `buildTopFaceKey` / `FaceKeyMode` 新增 `adjacent8`：8 位 key `u,d,l,r,ul,ur,dl,dr`（正交 ±1 + 四角对角）。前后端 `parseFace`（`ruleCache.ts` / `tileRules.ts`）与 `vendorResolver.d.ts` 同步接受该 schema；cooker 邻域种子含对角偏移。`bridge_25` 启用 `keyMode: adjacent8`，map 键改为 8 元组（对角暂 `*` 通配，可后续细化）。单测：`neighborKey.test.ts`、`scene-export-renderer-parity.test.ts`。*为什么：* 转角柱/斜接需区分对角占位，4 邻无法表达。
- **Asset Store「列表」视图新增可点击排序的表头，字段集与列序对齐 asset_manager 的 `AssetReviewTable`（索引/内外/名称/材质/朝向/题材风格/状态/类型规则/尺寸/静态/滤镜模板/变体/出现场所/几何/时间戳/大小）。** `frontend/src/surfaces/AssetStoreSurface.tsx`：新增 `LIST_COL_ORDER`/`LIST_COL_LABEL`/`LIST_COL_SLOT`（13 项经既有 `aliasName.ts` 的 `SLOT`+`fieldAt` 从 `alias` 拆列，几何取 `geometryJson` 有无、时间戳取 `updatedAt`??`createdAt`、大小复用既有 `formatBytes`），列表行改为按此列集渲染分列文本；表头按钮点击走三态排序（未排序→升序→降序→取消，逻辑对齐 asset_manager `ScenePage.handleSortColumn`）驱动纯前端 `[...assets].sort(compareListAssets(...))`（`assets` 本就是当前 zone 的全量列表，见 `assetStoreStore.ts fetchAssets` 的「整 zone 一次性加载、连续滚动」模型，client-side 排序无需分页协调）。`AssetRecord`（`frontend/src/surfaces/library/libraryApi.ts`）补充 `geometryJson?: string | null`（后端已返回，此前前端类型缺失）。新增 `AssetStoreSurface.css` 表格样式（`.asset-list-*`，CSS Grid + 共享 `--asset-list-cols` 变量对齐表头/行列宽，超宽横向滚动）。仅改列表视图展示与排序，不影响网格视图、批量操作、渲染器绑定等既有交互。*为什么：* 用户要求 Asset Store 顶部资产列表按表头方式组织展示（参照 `asset_manager/apps` 的审阅表格），并支持点击表头依据该字段排序。

- **`variantWeights` — 变体加权采样。** `FaceRule` / `randomRules[]` 可选声明与 `variantIdxs` 等长的 `variantWeights`；`randomRules` 命中且未保留 base 时经 `pickWeightedVariant` 按权重采样（缺省仍等权）。透明像素过滤后 idx/weight 成对剔除；前后端共用 `VariantPool` + `computeValidVariantPoolsByTileId`。*为什么:* common_16 中心 tile 的 4 个变体需不同出现概率（如 4:2:2:2），原先只能等概率随机。
- **`randomRules[].variantIdxs` — per-tileId 变体池。** `FaceRule.randomRules` 每条可声明独立 `variantIdxs`;缺省仍回退 face 级 `variantIdxs`。`pickFaceSpriteIndex` / `bindings` / `cookBakedScene` 经 `computeValidVariantPoolsByTileId` 共享像素过滤,前后端 parity 测试覆盖。*为什么:* 不同 base tile 需要采样不同变体 slot(如 common_16 中心 vs 内角),原先全 face 共池无法表达。

### Changed
- **资产库对齐 asset_manager 新版 13 字段契约（`@forgeax/asset-2d` SSOT）。** 新增 `backend/src/library/aliasName.ts` + `frontend/src/surfaces/library/aliasName.ts` 统一 `SLOT`/字段语义；`paintAssetBus` 修正名称=PPU 索引（name→f2、size→f8）；taxonomy `scene` 改为 **`index`**（f0 分类路径分层 drill-down）；过滤器/预览面板补齐 13 项（索引/内外/名称/材质/朝向/题材/状态/类型/尺寸/静态/滤镜/变体/出现场所）并透出 `tags`/`createdAt`/`updatedAt`/`hasError`/`isPlaceholder`；材质默认含纸/布/竹且与库内 distinct 值合并；变体改为自由输入以支持任意 ≥0 整数。*为什么：* 新版 `materials/asset-store/library.db` 与 wb-asset-manager 生成器格式打通，消除半迁移状态下的刷绘/匹配/浏览错位。

### Fixed
- **`inner_wall_27.json` 的 `sprites` 切割对齐示意图重排。** 基础块（0–26）由「按行横跨 3 组」改为示意图的 3 个 3×3 分组（0–8 墙顶 / 9–17 端点·T字 / 18–26 内墙立面），组 x 基址 0/64/128；变体（27–134）改为「每 tile 4 变体横排、按分组纵向 9 段（y=48+off\*16、组 x 基址同上）」，与 `randomRules.variantIdxs` 严格对齐；`blockVariants` 三组大变体（135–161）移到变体网格右侧 x=192/208/224 列，按 y=48/96/144 分三段各 3×3（局部 z\*3+x 行主序）。sprites 共 162 不变，spot-check 全通过；图集建议同步改为 ≥256×192。*为什么：* 原切割与示意图不符，tileId/大变体 ↔ 图集像素错位。
- **`outer_wall_36.json` 的 `sprites` 切割对齐示意图重排。** 基础块（0–35）由原「按行横跨 4 组」的错误顺序改为示意图的 4 个 3×3 分组（0–8 墙顶 / 9–17 端点·T字 / 18–26 外墙立面 / 27–35 内墙立面），每组内左→右·上→下、组 x 基址 0/64/128/192；变体（36–179）由原「16 格/行连续读」改为「每 tile 4 变体横排、按分组纵向 9 段（y=48+off\*16、组 x 基址同上）」，与 `randomRules.variantIdxs`（tileId 顺序）严格对齐。sprites 共 180 不变，spot-check 座标全通过。*为什么：* 原切割与示意图不符，导致 tileId ↔ 图集像素错位，取到的立面/端点子图错误。
- **scene-export 与 baked 层 vendor 类型补全，后端 `tsc -b` 恢复通过、dev 后端可稳定拉起。**
  `backend/src/baked/vendorScene.d.ts` 补 `projectSceneToVoxelLayers` 等投影类型；
  `backend/src/scene-export/routes.ts` 预加载 rule atlas PNG 到同步 cache（`cookBakedScene` 的 `resolveRuleImage` 必须同步）。
  *为什么：* 构建失败/类型断裂时 `tsx --watch` 后端起不来，Studio iframe 能开壳但 API 全挂，表现为「插件打不开」。

- **补全缺失的 `debug/syncTrace` 模块，修复插件前后端无法启动。** `frontend/src/debug/syncTrace.ts`（浏览器 localStorage 开关）与 `backend/src/debug/syncTrace.ts`（`FORGEAX_DEBUG_SYNC=1` 环境变量开关）此前被多处引用但文件未入库；同时修复 `frontend/src/renderer/bridge/bakedApi.ts` 的自引用 type import（阻断 `pnpm build:vendor`）并重建 `vendor/dist/renderer-resolve`，恢复后端 `tileRules` 对 `computeValidVariantIdxs` 的导入。*为什么：* 克隆后场景生成器 vite 能起但后端 `ERR_MODULE_NOT_FOUND`/vendor 断裂，iframe 空白且 API 500。
- **Billboard 预览 asset 模式重新贴出贴图（此前画笔画上的格子在 color 模式显示色块、切到 asset 模式却空白无贴图）。** 根因是资产库最近把全部 2909 条 base 资产的 `zone` 由 `raw` 迁到 `staging`（见下方 Changed），而渲染器的匹配池 `useAliasMetas.ts` 固定拉 `/api/v1/library/aliases-meta?zone=raw` → 池恒为空 → `matchAssetEntry` 永远 null → billboard asset 分支对每个 cell 直接 skip（`buildVoxelMaster/paintCell.ts:89-94` 刻意「缺 binding 就不画、不退色块」）；color 分支不碰这个池，故照常显示。修复：**渲染器/导出的匹配池改为 zone-agnostic**（一个 alias 可能落在任意 zone，取图 serve 本就跨 zone，匹配池理应对齐）。
  - 后端 `GET /api/v1/library/aliases-meta` **不带 `zone` 时返回全 zone（除 trash）合并、按 alias 去重的池**（`routes.ts:129`）；带 `zone=` 仍按原 zone 作用域（现有测试不受影响）。新增 `service.ts` `listAllAliasesWithMeta()`（`WHERE zone <> 'trash' GROUP BY alias`）、`privateStore.ts` `filterPrivateAllZonesForProjectDir()`、`mergedLibraryPool.ts` `listMergedAliasMetasAllZones[/ForProjectDir]()`。
  - 前端 `renderer/bridge/useAliasMetas.ts` 改请求 `/api/v1/library/aliases-meta`（去掉 `?zone=raw`）。
  - 同根因顺带修复导出/无头预览：`scene-export/routes.ts` cook 与 `scripts/preview.mjs` 的匹配池由 `listMergedAliasMetas('raw')` 改为 all-zones 变体（否则迁移后导出/预览同样匹配不到贴图）。
  - 测试：`backend/tests/library.test.ts` 新增「no zone 返回 zone-agnostic 池」用例（raw 空、staging 非空时 no-zone 池仍非空且为单 zone 超集）。*为什么：* 把「渲染池 = raw」这个随资产迁移而失效的硬假设，改成与 serve 一致的跨 zone 匹配，从根上杜绝「某 zone 一动整屏无贴图」。
- **同一资产的多个对象图层不再被拆分成不同的 `object-type-config.json` 类型 / `obj__*` 地形模板。** `cooker.ts` 的 `objectTypeNameFor()`/`templateIdFor()` 原先在没有手填 `object_type_id`/`template_id` 时按 `assetName → nodeName` 兜底——`nodeName` 每个图层天然不同、`assetName` 也可能漏填或填法不一致，导致两个渲染出来是同一张贴图的图层（`objectGraphicId()` 已经正确按解析出的 `alias` 去重共享同一个 atlas 图格）却各自注册成独立的对象类型/独立的 `obj__` 地形模板。新增共享的 `typeIdentityFor()`：无显式属性时优先用**解析到的资源库条目自身的显示名**（`assetMatch.ts` 新导出的 `aliasDisplayName()`，即匹配逻辑本身拿来比对 `assetName` 的字段），兜底顺序变为「显式属性 → 解析别名显示名 → assetName → nodeName」——只要两个图层解析到同一个 alias 就必然合并；显式 `object_type_id`/`template_id` 仍然优先生效（保留"同贴图但故意分成不同游戏逻辑类型"的手动契约），两个不同表（sheet）恰好显示名相同时的既有分叉保护（`templateIdAlias` 冲突检测）不受影响。*为什么：* 用户要求"使用同一类资产的肯定要属于同一个对象模板，不能变成多个不同对象"；用一个可复现的最小用例验证过旧逻辑确实会分裂（同贴图、`assetName` 一个填了一个空，产出两个 `objectTypes` 键和两个 `obj__` 模板）。折叠进地形的对象丢失 `instanceId`/`direction`/`interacted` 仍是已知且暂时接受的权衡——本轮曾原型实现一个新增的 `object_instances[]` 字段来保留这些数据，但因参考查看器 `viewer.js` 是禁止修改的冻结资产、根本不会读这个新字段而回退，不引入没有消费者的 schema 面。

### Added
- **`scene-export/cook` 接口新增可选 `narrative` 字段，可依据场景叙事节点列表自动推导并覆盖 `area_L{depth}` 区域标记**（新增 `backend/src/scene-export/narrativeAreaTags.ts`；接入 `routes.ts` 的 `cookSceneForProject()`、`cooker.ts` 的 `areaTags()`）。传入 `{ locations: [{ name, parent }] }`（可直接整体传入原始叙事 JSON `scene_nodes.*.json`，多余字段如 `scale`/`adjacent`/`description` 被忽略）后：先做叙事自身结构自检（唯一名、父引用有效、无环），再按 `name` 精确匹配同名 baked 图层（0 个报 `missing`、≥2 个报 `ambiguous`），再校验叙事 `parent` 链在 baked 树里是否保持祖先/后代包含关系（允许中间插入额外层，不要求直接父子）；全部通过后按叙事深度把 `area_L{depth}`（字符串，`cooker.ts` 侧仍按原有 `[value]` 包装成数组）覆盖式写入每个匹配子树下的所有图层——同层已手填的 `area_L{depth}` 被覆盖，未被叙事覆盖到的更深层手填值保留。同时把 `cooker.ts` 原先硬编码的 `area_L0..area_L4`（i<=4）读取上限改为从 0 开始连续扫描、遇首个缺口即停，不再有层数上限。任一环节的问题（缺失/歧义/包含关系错误/叙事结构错误）都会被收集后合并成一条错误一次性返回（`POST` 400），不是報第一个就中止。*为什么：* 让叙事驱动的场景区域标记可自动化生成并强校验一致性，替代逐图层手填 `area_L0..area_L4` 的人工流程。
- **`narrative` 输入的 `sceneName` 字段自动填充所有图层的 `region` 属性**（同一 `narrativeAreaTags.ts`）。与按子树作用域的 `area_L{depth}` 不同，`region` 是全场景统一标识（参考包里全部地形模板的 `region` 都等于场景名），所以只要叙事校验整体通过、且 `sceneName` 非空白，就会覆盖式写到**全部**烘焙图层（不局限于叙事匹配到的子树），未提供或为空白 `sceneName` 时完全不改动 `region`（沿用手填值或 `cooker.ts` 的 `"default"` 兜底）。*为什么：* `region` 是导出格式里唯一还依赖人工逐图层手填、且没有自动化机制的场景元数据字段，而叙事输入本身已经携带了场景名，顺手补上成本很低。
- **新增三条 autotile 规则,切自参考图 `assets/rules/{房墙02,草坡,院墙}.png`(ppu=16,schemaVersion 2,billboard 双面 top+front):** `grass_slope_7.json`(草坡:top=草地顶面+随机点缀变体,front=泥土台地立面坡)、`courtyard_wall_18.json`(院墙:top=石压顶环形 autotile,front=米色墙身+石基座立面)、`house_wall_10.json`(房墙:top=压顶帽,front=米色压顶+青砖墙身立面)。三者均按 `wall_outer_16.json` 的面/键语义编写——top key=(u,d,l,r) 同层 4 邻、front key=(t,b,l,r) z 上下+同层左右——`sprites` 仅列实际取用格(绝对 atlas 坐标,仿 `flower_bed_11.json`),atlas 包围盒分别 80×64 / 96×144 / 48×144。*为什么:* 用户要求为这三张参考图各配一条可绑定 `autotileKind` 的瓦片规则;首版按参考图 16px 网格逐格映射,像素级效果待 Preview 校验微调。
- **新增国风仙侠资产 13 字段清单 `materials/国风仙侠资产清单-13字段.csv`(289 行)**:依 `资产库大纲.md` §4 物品 / §5 瓦片 / §3 地形把所有资产展开为编辑器 13 字段(可能区域 / 室内外 / 大区域 / 小区域 / 物体名 / 朝向 / 题材风格 / 状态 / 是否抠图 / 尺寸 / 是否静态 / 滤镜模板序号 / 变体序号)。题材风格统一「国风仙侠」;大区域 / 小区域名按国风仙侠场所规范化为 40 个大区域(门派 / 道观 / 丹房 / 仙山 / 园林 / 古镇 等),`可能区域` 用 `-` 连接且 token 均为规范大区域;`是否抠图`(物件=抠图 / 瓦片地形=未裁剪)、`尺寸`(瓦 16 / 小 32 / 中 64 / 大 128 / 建筑 256)、`是否静态`(火 / 水 / 旗幡 / 喷泉 / 水车 等=动态)按物理类目派生。已剔除与古代国风不兼容的现代 / 科幻专属物(电视 / 电脑 / ATM / 霓虹灯 / 空间站 等),少量改写为国风等价(辐射污染带→瘴气带)。*为什么:* 用户需要把大纲里的资产按编辑器 13 字段成表、风格收敛为国风仙侠并保证覆盖全面,供后续批量标注 / 生成使用。
- **新增按场所导向的资产清单 `materials/资产清单-按场所.md`**（以「场所」为单位的可勾选施工清单，配套 `资产库大纲.md` 使用）。覆盖室外自然环境（15 类生物群系）、农业聚落（农场/牧场/村镇/都市/公园）、特殊与末日（废墟/营地/避难所/遗迹/军事/工业/港口/交通）、室内居住（客厅/卧室/厨卫/书房等）、公共商业（学校/商铺/酒馆/医院/警局/教堂/寺庙等）、特殊异世界室内（魔法工坊/地牢/实验室/飞船/邪教祭坛/凶宅/工厂/监狱），并含横切资产（角色占位/天气特效/昼夜光照/季节皮肤/UI）与 P0–P3 制作优先级。每个场所按「地形/瓦片→大型结构→中型→点缀→光源→墙面→动态」七组列出具体资产，标注瓦片/地面/墙面/动态分类。*为什么：* 用户需要一份以「可出现场所」为导向、可直接对照制作的资产待办清单。
- **新增资产库大纲文档 `materials/资产库大纲.md`**（与 `materials/export_2026-06-04/meta.json` 的 13 层 `tagLayerSchema`、15 题材风格、`organizeFolders` 三大物理分类对齐）。内容含：标签 schema 复述、题材风格表（现有 15 + 建议补充）、§3 场所大纲（室外自然/农业聚落/末日特殊 + 室内居住/公共商业/异世界，按「大区域 buildingType → 小区域 roomType」组织）、§4 物品大纲（20 个功能类目的 name 词典，标注地面/墙面/瓦片物理分类）、§5 瓦片/地形规则集、§6 覆盖矩阵与 P0–P3 施工优先级。*为什么：* 用户筹备星露谷/奈斯启示录风格 PCG 2D 像素游戏，需要覆盖面广、组织严谨且可标注的资产库蓝图来指导素材采集/生成，现有素材太少。
- **`building_cluster` 小标签新增电池 `siheyuan_cluster`（四合院组群）**（`batteries/scene30/building_cluster/siheyuan_cluster/`）。按传统四合院范式生成院落组群：外围一圈贴齐 region 非零包围盒外边界的围墙（可开底墙院门），沿进深叠 `courtyards`（进数）个院落，每院由「横向房屋带（正房/厅堂/倒座房，贯穿院宽，共 N+1 条）+ 左右纵向厢房 + 环绕中庭的围廊」连接而成；房屋数量=3×进数+1（进数=1 即标准四合院 4 座房屋，控制房屋数量即调进数）。`hallDepth`/`wingWidth` 放不下时自动缩小以容纳进数与中庭。输出 `outputGrid`（合并多值：房屋各递增 id + 围廊 + 围墙各一值）/ `houses`（0/1 房屋列表，序为 正房→厅堂…→倒座房→各院西/东厢房）/ `wall` / `corridor` / `outputNameList`。已用 16×16（进数1，输出标准四合院四面房屋+中庭围廊+院门）、34×22（进数3，10 座房屋、三进院落形态）、8×8（极小仍成形）三组脚本验证。*为什么：* 用户要求一个可控房屋数量、忠实还原「矩形房屋由围墙+围廊连接、围墙贴齐外边界」的四合院组群生成电池。
- **`building_cluster` 小标签新增电池 `random_rect_scatter`（随机生成矩形）**（`batteries/scene30/building_cluster/random_rect_scatter/`）。输入 `region`（grid，定义输出尺寸）+ `points`（point2d，list），对每个点在其周围随机生成 `countPerPoint` 个矩形：随机方向、与点保持可控的大致中心距（`distance` ± `distanceJitter`）、随机宽高（`minSize..maxSize`），按 region 边界裁剪。双输出：`outputGrid`（多值网格，每矩形递增 id）+ `rects`（0/1 网格列表），可直接接 `siheyuan_wall_frame` 串成围墙。`seed` 可复现。算法已用 24×24 单点 5 矩形脚本验证：各矩形中心距点约等于设定 distance（7±），且能链入围墙电池。*为什么：* 用户需要按点位在其周围随机布置矩形（建筑），并能控制矩形与点的大致距离。
- **新增 scene30 小标签 `siheyuan`（四合院），内含电池 `siheyuan_wall_frame`（四合院围墙）**（`batteries/scene30/siheyuan/siheyuan_wall_frame/`）。输入多个矩形（`rects`，`grid`+`access:list`：0/1 网格列表，每张一个矩形；或单张多值网格，按不同非零 id 自动拆分），对每个矩形取最小包围盒、沿其长边方向画中心线（脊线），按围绕整体质心的极角排成环形，再贪心首尾相接（脊线 + 连接段）串成一条闭合折线，Bresenham 光栅化为线宽 `thickness`（默认 1）的 `wall` 网格输出。坐标约定 x→列、y→行。算法已用 12×12 四矩形（四合院四面房屋）独立脚本验证：输出为穿过每个矩形长边中心线、把四块串成的闭合方框围墙；多值网格拆分路径同样正确。*为什么：* 用户需要把若干矩形（如 `points2rects`/`bsp_rect_gen` 产出的房屋地块）用一道穿过各自长边中心线的闭合围墙串成四合院院落。

### Removed
- **资产库 `library.db` 删除 `asset_kind` 列（信息融入 alias 类型域）**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`；`backend/src/library/service.ts`(`AssetRecord.assetKind`/`AssetRow.asset_kind`/`rowToRecord`/`deriveAliasMeta` 入参/`optionalAssetColumns`)、`gameSandboxStore.ts`、`mergedLibraryPool.ts`、导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs`、相关测试同步去引用）。*为什么：* `asset_kind` 与 alias 类型域表达同一信息（瓦片=规则别名 / 物件=抠图），合并后 alias 自洽、消除并列真源。
- **资产库 `library.db` 再精简 2 个死列：`tags_json` / `library_path`，并剔除 `geometry_json` 里冗余的 `name` 键**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`，2923 资产全保留；`geometry_json.name` 逐行删除 2838 处；导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs`、`backend/src/library/service.ts`(`AssetRecord`/`AssetRow`/`rowToRecord`/`optionalAssetColumns`)、`backend/tests/import-exported-assets.test.ts` 同步去引用）。*为什么：* 调研确认 `tags_json` 的信息已可由 alias 13 字段完全派生、运行时无任何读取方；`library_path` 全仓无消费；`geometry_json.name` 只是 alias 的重复，解析从不读取。
- **资产库 `library.db` 精简 4 个冗余列：`tag_layers_json` / `organize_folder_path` / `export_path` / `crop_type_original`**（`materials/asset-store/library.db` 就地 `ALTER TABLE DROP COLUMN`+`VACUUM`，2909 资产/2900 blob 全部保留；导入脚本 `scripts/{import-exported-assets,legacy-asset-overlays}.mjs` 同步去列）。*为什么：* 用户要求合并标签 JSON、删除无用溯源列与重复的抠图判别列——`tag_layers_json` 的 label/zone/index 对每行恒等（属字段 schema 非每行数据），`tags_json` 已含其 value；`organize_folder_path`/`export_path` 运行时从不读取；`crop_type_original` 与 `asset_kind` 表达同一信息。

### Deferred
- **项目 baked 引用未随 alias 12 字段重构迁移（仅报告，未执行）。** 已烘焙的项目图层里存的旧版 alias 字符串（name 在 idx4、type 在 idx8、含 `__` 长连接、带大/小区域），在新代码下按 idx2=name / idx7=type 解析会错位 → 精确 `assetAlias` 绑定与按名匹配都可能失效，渲染/导出对这些历史图层暂时匹配不到贴图。影响面：任何在本次重构前保存的 `.forgeax` 项目 baked 快照 / cook 输入。迁移方案（待用户确认后单独执行）：对每份 baked 数据里的 `assetAlias` 用与 DB 相同的 `toRendererAlias(旧alias, 旧asset_kind)` 转换重写一遍；`assetName`（纯物体名，不含括号）不受影响，仅靠名字匹配的图层无需迁移。*为什么：* 用户明确「迁移项目 baked 引用先不做，报告即可」。

### Changed
- **alias 类型域(idx7)的物件裁剪标记由 `抠图` 改为 `asset`（承接上条 12 字段重构）**：`library.db` 就地把 2866 条物件 alias 的 idx7 `抠图` 重写为 `asset`（瓦片的规则别名不变）；`privateStore.ts`(`CUTOUT_TYPE_FIELD='asset'`)、`service.ts`(`NON_TILE_ASSET_KINDS` 增 `asset`)、`scene-export/assetMatch.ts` 与 `frontend/renderer/framework/asset/matchAssetEntry.ts`(cutout 池判据新增 `isCutoutTypeField`，同时兼容旧 `抠图`)、`legacy-asset-overlays.mjs::toRendererAlias`(非瓦片输出 `asset`) 同步。代码仍保留识别旧 `抠图`（历史/baked 数据向后兼容）。测试同步：修正上次 12 字段重构遗漏、未随之更新的前端 `buildVoxelMaster/index.test.ts`（旧布局 name@idx4/cutout@idx8 → 新 name@idx2/cutout@idx7/`asset`），后端 cutout 用例改用 `asset`。*为什么：* 用户要求把裁剪物件的类型标记语义从中文「抠图」改为通用 `asset`。
- **alias 字段契约由 13 字段重构为 12 字段（不可逆命名契约变更）**：删除 `大区域`(旧 idx2)/`小区域`(旧 idx3)、在 `物体名` 后插入空 `材质` 域(新 idx3)、`asset_kind` 融入 `类型/规则` 域(新 idx7：瓦片=规则别名如 `common_16`/物件=`抠图`)、连接符统一为单下划线 `_`。DB 就地重写全部 2909 条括号 alias（14 条无括号测试图保持原样），并同步下移所有硬编码索引：`service.ts`(`FIELD_INDEX` type8→7/style6→5/size9→8、`extractAliasTypeField` idx8→7、`deriveAliasMeta` 改读 idx7、搜索字段 idx4→2、`place` facet 降为单级 室内/室外)、`privateStore.ts`(`composeRendererAlias` 长度 13→12/name idx4→2/type idx8→7、`FIELD_INDEX`、`matchesFacet`/`facetPrivate` 单级 place)、`privateRoutes.repairAlias`(12 字段/name idx2)、`scene-export/assetMatch.ts`(name idx4→2/cutout idx8→7)、`frontend/renderer/framework/asset/matchAssetEntry.ts`(name idx4→2/cutout idx8→7/ppu idx9→8/变体组前 11 字段)、`frontend/workbench/AssetStorePanel.tsx`(FIELD_DEFS 12 字段)、导入脚本新增 `toRendererAlias()` 旧→新转换。25 个新 alias 因仅在被删的大/小区域上不同而碰撞（50 行，全部保留，匹配池按 alias `GROUP BY` 去重）。*为什么：* 用户要求去掉大/小区域、加材质域、asset_kind 回归 alias、统一下划线，收敛为单一自洽命名契约。
- **资产库 `library.db` 清理「默认圆整 anchor」：`anchor_x`、`anchor_y` 均 ≤2 位小数（如 0.5/0.38，判据 `x=round(x,2)`）的 994 条资产，其 `anchor_x/anchor_y` 置 NULL、并从 `geometry_json` 移除对应的 `pivot`（否则 pivot 会以 0.5 覆盖回 anchor）、清空该资产 collision（`collision_mask=[]`、`collision_category="None"`，541 条）**（`materials/asset-store/library.db` 就地迁移；要求 x、y 同时 ≤2dp 才清，精确计算得到的锚点/碰撞如 `0.4973…` 保留）。*为什么：* 这类圆整值是历史导出塞进去的默认占位、并非真实处理结果；渲染本就有 `?? 0.5` 兜底，且运行时发布路径已不再落默认值——留库反而与「无 anchor 即空」的语义冲突。anchor null 数 269→1263。
- **资产库 `library.db` 全部 2909 条资产 `zone` 由 `raw` 改为 `staging`**（`materials/asset-store/library.db` 就地 `UPDATE assets SET zone = 'staging'`）。*为什么：* 用户要求将现有素材库划入 staging 分区，与后续 raw 新素材区分。
- **瓦片判别由 `crop_type_original`（'瓦片组'/'wall'）改为 `asset_kind`**（`backend/src/library/service.ts`：新增 `isTileAssetKind`，`asset_kind` 非空且非 `抠图`/`object` 即视为瓦片组、其值即 autotile 规则别名）。同步清理 `service.ts`(`AssetRecord`/`AssetRow`/`rowToRecord`/`deriveAliasMeta`/`optionalAssetColumns`)、`privateStore.ts`、`gameSandboxStore.ts`、`routes.ts` 中对已删字段的引用；`PrivateAssetRecord` 去掉 `cropTypeOriginal`，发布桥仅靠 `assetKind` 绑定瓦片规则。*为什么：* 删除 `crop_type_original` 后需要等价的瓦片判别来源，避免 autotile 规则绑定失效。
- **scene30 小标签 `siheyuan` 重命名为 `building_cluster`（建筑组群）**（`batteries/scene30/siheyuan/` → `batteries/scene30/building_cluster/`，`siheyuan_wall_frame` 电池随目录迁移，id 不变）。*为什么：* 用户要求把该小标签改名为「建筑组群」。

- **interests 模板新增四个兴趣点 scene 模板：`FenceFarm`(`fence_farm`) / `ParkGenerator`(`park_generator`) / `ShrineLayout`(`shrine_layout`) / `FarmlandGrid`(`farmland_grid`)**（`batteries/templates/structures/interests/{FenceFarm,ParkGenerator,ShrineLayout,FarmlandGrid}/`）。四个电池均为标准 `inputGrid→outputGrid` 形态，按 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / 主产物 / Rest / 主Path / RestPath）。暴露端口：FenceFarm=FenceMode/GateCount/SectionCount/GateWidth/PlotWidth/PlotHeight；ParkGenerator=Algorithm/PathWidth/TreeCount/SpokeCount；ShrineLayout=Algorithm/DecorCount/PathWidth；FarmlandGrid=Layout/PlotWidth/PlotHeight/PathWidth/PlantDensity（`fillValue`/`z`/`schema`/`token`/`zRange` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这四个兴趣点电池按结构模板范式封装为可套用 scene 模板。
- **新增小标签 `structures/indoor`，封装两个室内家具放置 scene 模板：`AdaptiveRoomFurniturePlacer`(`adaptive_room_furniture_placer`) / `RoomLayoutPlacer`(`room_layout_placer`)**（`batteries/templates/structures/indoor/{AdaptiveRoomFurniturePlacer,RoomLayoutPlacer}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做房间掩码 → 电池产家具网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / Furniture / Rest / FurniturePath / RestPath）。两电池核心网格入口为 `roomGrid`（已据此改接 slice→核心边，区别于其它电池的 `inputGrid`）；`doorGrid`(门位置网格,可选)、`furnitureList`(家具清单,不接则无家具) 作为暴露输入由组外接入。暴露端口：AdaptiveRoomFurniturePlacer=DoorGrid/FurnitureList；RoomLayoutPlacer=DoorGrid/FurnitureList/LayoutMode/LayoutConfig（`fillValue`/`z`/`schema`/`token`/`zRange` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 roomGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个室内家具电池按结构模板范式封装为可套用 scene 模板。命名沿用 `AssetName`+`str_to_list_branches`（仓内暂无「逐实例 `nameList`→按分支对齐」算子）。
- **water 模板新增两个 scene 模板：`RiverSpline`(`river_spline`) / `RiverLakeGen`(`river_lake_gen`)**（`batteries/templates/structures/water/{RiverSpline,RiverLakeGen}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → 取顶层切片做基准 → 电池产网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / River(Water) / Rest / RiverPath(WaterPath) / RestPath）。`RiverLakeGen` 核心输出端口为 `waterGrid`（已据此改接核心输出边，区别于其它电池的 `outputGrid`）。暴露端口：RiverSpline=Points(必填)/Algorithm/RiverWidth/NumMidPoints/OffsetMin/OffsetMax/SegmentUniformity（`WindowSize`/`Sigma`/`BezierDegree` 隐藏）；RiverLakeGen=RiverCount/Algorithm/MinWidth/MaxWidth/LakeCount/WaterItems（`inputNameList` 隐藏）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/(out) 接线正确。*为什么：* 用户要求把这两个水系电池按装饰模板范式封装为可套用 scene 模板。
- **新增两个结构 scene 模板：`HillContourGenerate`(`hill_contour_generate`，归入 `structures/topographic`) / `TownIslandLayout`(`town_island_layout`，新建小标签 `structures/interests`)**（`batteries/templates/structures/{topographic/HillContourGenerate,interests/TownIslandLayout}/`）。同 `BspDistrictCluster` 范式包成 scene 组：输入 Scene → 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、`asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（Scene / Hill(Town) / Rest / HillPath(TownPath) / RestPath）。暴露端口：HillContourGenerate=ContourLevels/HillCount/Roundness/PeakRadius/NoiseAmount/PeakPosition（`MinHoleSize`/`MinIslandSize` 隐藏）；TownIslandLayout=RoadWidth/BlockMinSize/ShapeType/ShapeScale/CoverageThreshold。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个电池按装饰模板范式封装为可套用 scene 模板；`interests` 为兴趣点类结构新建小标签。
- **新增两个结构 scene 模板：`OrganicIslandShape`(`organic_island_shape`，新建小标签 `structures/topographic`) / `PointZoneGen`(`point_zone_gen`，归入现有 `structures/districts`)**（`batteries/templates/structures/{topographic/OrganicIslandShape,districts/PointZoneGen}/`）。把这两个 grid→多值网格电池按 `BspDistrictCluster` 同款流水线包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、嵌套 `TileAssetName` 写 `asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（`out_0..4`：Scene / Island(Zone) / Rest / IslandPath(ZonePath) / RestPath）。暴露端口：OrganicIslandShape=NoiseScale/NoiseStrength/IslandRatio/Octaves；PointZoneGen=Regions（`[x,y,area,height]` JSON，必填否则无产物）。已校验 JSON、无悬空边、暴露端口源有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这两个电池按装饰模板范式封装为「输入 scene、五个固定输出」的可套用模板；`topographic` 为地形类结构新建小标签。
- **decorations 模板新增三个纹理地面 scene 模板：`IndoorTextureGround`(`indoor_texture`) / `MultiLayerGround`(`multi_layer_ground`) / `OutdoorTextureGround`(`outdoor_texture`)**（`batteries/templates/structures/decorations/{IndoorTextureGround,MultiLayerGround,OutdoorTextureGround}/`）。把 `components/decoration/{indoor_texture,multi_layer_ground,outdoor_texture}` 三个 grid→多值纹理网格电池按 `BspDistrictCluster` 同款流水线包成 scene 组：输入 Scene → `scene_passthrough→node_explode→rect_grid→voxel_slice` 取顶层切片做掩码 → 纹理电池产多值网格 → `grid_split_by_value`→`grid2node`(按 `AssetName` 命名、嵌套 `TileAssetName` 写 `asset_type=tile`)→`add_child` → `alg_region_subtract` 求 Rest → **严格 5 个固定输出**（`out_0..4`：Scene / Texture(Ground) / Rest / TexturePath(GroundPath) / RestPath，与 `NaturalDecorationDistribution`/`PoiPlace` 等装饰结构契约一致）。各模板额外暴露对应电池参数端口（indoor: Algorithm；ground: LayerCount/Threshold/Frequency/Octaves；outdoor: Temperature/Moisture）。已校验 JSON、无悬空边、暴露端口源节点/端口均有效、核心节点 inputGrid/seed/outputGrid 接线正确。*为什么：* 用户要求把这三个纹理电池按 `NaturalDecorationDistribution` 范式封装为「输入 scene、对 scene 操作、输出五个固定端口」的可一键套用模板。命名沿用已验证的 `AssetName`+`str_to_list_branches` 机制（仓内暂无「`nameList` 数组→按分支对齐的名称流」算子，故未直接消费电池 `nameList`）。
- **decorations 模板新增三个 scene 流水线模板：`DecorationBorder`(规则装饰物) / `PoiScatter`(随机POI分布) / `PoiPlace`(精准POI分布)**（`batteries/templates/structures/decorations/{DecorationBorder,PoiScatter,PoiPlace}/`，与 `NaturalDecorationDistribution` 同目录、同范式）。仿 `NaturalDecorationDistribution` 包成 scene 组：输入 Scene，内部 `scene_passthrough→node_explode→rect_grid→voxel_slice` 取区域 → 对应 `components/decoration/{decoration_border,poi_scatter,poi_place}` 电池在区域内布置 → `grid2node`+嵌套 `ObjectAssetName` 写资产名挂树 → `alg_region_subtract` 求剩余空地 → **严格 5 个输出**（`out_0..4`：Scene / 主产物 / Rest / 主Path / RestPath）。已通过真实后端 REST（instantiate + batch + execute）端到端验证：12×12 区域下 DecorationBorder 产出 decoration(20 体素)+rest(124)、PoiScatter/PoiPlace 在给定规则下产出 poi 层+rest，五件套路径句柄正确。*为什么：* 用户要求这三个装饰电池按 `NaturalDecorationDistribution` 范式封装为「输入 scene、对 scene 操作、严格五输出」的可一键套用模板，而非裸 grid 端口的薄封装。

### Changed
- **`PathConnectionLink` 模板的「道路宽度」默认值由 1 改为 2**（`batteries/templates/structures/path/PathConnectionLink/PathConnectionLink.json`：`road_connect_link` 节点 `params.roadWidth=2`）。*为什么：* 该模板期望更宽的默认道路，避免每次套用后手动调整。

### Fixed
- **`Scene Structure` 节点在组内视图（group inner view）现可正常显示逻辑树结构，不再卡在「连接 scene 端口以查看结构」占位。** `frontend/src/workbench/SceneStructureNode.tsx`：改为订阅整张 `nodeOutputs` 而非仅本节点输出——组内叶子可视化节点自身输出不会被持久化，scene 仅在异步 group-probe hydrate 上游生产者后到达，订阅全表才能在其落地后重渲染；配合内核 `nodeTooltip.tsx` `resolveInputPortValue` 现在会查 `group.edges` 追溯组内上游。*为什么：* 组内连线在 `group.edges` 而非根 edges，旧逻辑取不到输入。

### Added
- **新增 `BspDistrictCluster` district 模板（`batteries/templates/structures/districts/BspDistrictCluster/`）：输入一个点（Point）+ 矩形数量（RectCount）→ 围绕该点播撒一簇 BSP 矩形建筑地块，每块拆为独立子节点，并产出 Rest 空地。** 复用 `Regions` 同款六段流水线（passthrough→explode→rect_grid→voxel_slice→`bsp_rect_gen`→grid_split→grid2node→add_child→subtract→五件套），仅把分区算法换成 `bsp_rect_gen` 并暴露 Point/RectCount/MinSize/MaxSize 端口；嵌套 `TileAssetName` 子组写资产名。已用 `splitTemplate`+`buildTemplateOps`+`applyBatch` 验证实例化 `status:ok`。*为什么：* 缺少「点锚定的矩形建筑簇」模板（`Regions` 按方位配额、`ZoneNesting` 单块有机，均非矩形簇）。
- **`bsp_rect_gen` 新增可选 `centerPoint`（point2d）输入（`batteries/components/districts/bsp_rect_gen/`，v3.1.0）：** 连线时以精确采样点 `{x,y}`（裁剪到区域 bbox 内）作为播撒中心、覆盖九宫格 `centerPosition`；未连线时回退原九宫格行为，完全向后兼容（`index.ts:215,251` 中心定位分支 + `parsePoint`）。*为什么：* `BspDistrictCluster` 模板需要「输入一个真正的点」来锚定建筑簇，而原电池只接九宫格 1-9。
- **新增 `str_to_list_branches` 电池（`batteries/basic/trans/str_to_list_branches/`）：列表字符串 → 每元素一个独立子分支（`items`/`access:list`）。**
  容错解析：先按 JSON 解析，失败再退回「去外层方括号→顶层逗号切分→逐段 trim/数字转换」，故 `[test2,test3]`（元素不加引号）也能用；
  **非列表的裸标量（如 `TEST2`）按「单元素列表」处理、绝不返回 error**（否则单个输入会让节点失败、打断整条下游链）。空串→`[]`。
  与 `grid_split_by_value.grids` 同形态，可直接喂 item 端口逐个 fanout（如 `grid2node.name`）。
  *为什么：* `str_to_list` 只输出「单分支里的一个数组」，无法按分支与 `grid_split_by_value` 的网格分支对齐 fanout；需要一个把名称列表炸成分支、且对单值输入鲁棒的原语。

### Added
- **`PathConnection` / `PathConnectionLink` 模板新增可选 `Obstacles`(in_15, scene) 端口。** 模板内新增 `scene_passthrough→node_explode→voxel_slice→alg_region_union` 子链（`templates/structures/path/*/{PathConnection,PathConnectionLink}.json`）：接入的障碍场景在与主场景同一基准 grid/同一 z 高度上切片成障碍网格，再与内部"非可铺路区"(`alg_region_subtract`) 求并后喂给寻路节点 `obstacle`，道路据此绕行；端口悬空时 `node_explode` 返回空、并集等于原障碍，**与原行为完全一致**。*为什么：* 之前道路只能绕开"非可铺路区"，无法显式指定额外障碍场景（如特定建筑/水体）让道路避让。

### Fixed
- **`points_to_grid` 边界点不再被静默丢弃（`batteries/scene/point/points_to_grid/index.ts:21-30`）。** 原先 `c < cols && r < rows` 的硬越界判断会把「坐标==地图尺寸」的边界点（如 200 宽地图的 `x=200`）直接丢掉，导致 PathConnectionRandomWalk/Link 这类连点路网连不上该点，只能退一格输入 `x=199`。改为把越界坐标 `clamp` 到最近的边界格（`x=200`→第 199 列），落在区域外（0 格）的点仍忽略。*为什么：* 用户以地图尺寸级坐标定位边界点是自然预期，硬丢弃造成「差一格才连得上」的反直觉行为。

### Changed
- **`region_zone_generator` 改为「满铺基准」控制占地（`batteries/components/districts/region_zone_generator/`）。** 新增 `areaScale`（默认 10）参数：面积值以其为分母——加和 < 基准时各区域只占据 `面积/基准` 的比例（如 `[[3,8],[1,4]]` 加和=4 → 合计约 40%，分别约 30%/10%，区域收缩在方位种子周围、其余留空）；加和 ≥ 基准时按比例瓜分铺满（保持原行为）。改动点：`index.ts:91-101` 分母 `Math.max(areaScale, ratioSum)`；`placement.ts:220` `quotaVoronoiAssign` 在占比加和 < 1 时把各区域离种子最远的超额像素置空；`index.ts` 边界后处理改用 `effectiveMask`（仅已分配像素），避免 `rectilinear` 等风格重新铺满整张掩码抹掉留空。*为什么：* 原实现把面积权重归一化后恒满铺，无法表达「区域只占整体一部分」的需求；改为绝对面积/基准后既能部分占地又能贴合方位特征。
- **五个 interests 电池重写为 DataTree 形式（`building_generator` / `farmland_grid` / `fence_farm` / `park_generator` / `shrine_layout`）。**
  `batteries/components/interests/{building_generator,farmland_grid,fence_farm,park_generator,shrine_layout}/`：
  入参由 `gridList`(array/手动遍历) 统一改为 `inputGrid`(`grid`/`access:item`)，标量参数加 `access:item`，移除列表级 `mergeOutput`（building 的 `mergeOutput` 改为「该建筑房间地板是否合并」语义保留）；
  每次只处理单张网格，列表 fanout/重组交给引擎。输出统一为**单张多值 `outputGrid`**(`grid`/item) + `outputNameList`(array/item，仅含实际出现 id)。其中：
  `fence_farm`/`park_generator`/`shrine_layout` 各自的布局算法本就产出单张多值网格（栅栏/公园/神殿语义值），直接输出并按值生成名称清单（含 tile/asset 区分）；
  `farmland_grid` 移除「田地满铺 + 作物点位稀疏」双层拍平，合并为单张多值网格（田垄=1、田地=2、作物点位 3–6 按 `plantDensity` 稀疏，tile/asset 区分）；
  `building_generator` 移除跨建筑积累与墙体打包成 `outputGridList` 子列表的做法，墙顶=1/外墙体=2/内墙体=3/窗户=4/地板从5 写入同一张多值网格（重叠按 地板→内墙体→外墙体→窗户→墙顶 后写覆盖），`outputNameList` 保留墙体打包条目 `id=[3,2,4,1]`，大门继续由独立 `doorGrid`(item) 输出；同时把室内拆分提前到开窗前以修正自动窗数对 `roomComponents` 的引用顺序。各自的雕刻/BSP/开门窗/布局算法不变。
  版本：building 1.0.0→2.0.0、farmland 1.0.0→2.0.0、fence 1.0.0→2.0.0、park 1.0.0→2.0.0、shrine 1.0.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **四个电池重写为 DataTree 形式（`river_spline` / `town_island_layout` / `adaptive_room_furniture_placer` / `room_layout_placer`）。**
  `batteries/components/elements/{river_spline,town_island_layout}/` 与 `batteries/components/indoor/{adaptive_room_furniture_placer,room_layout_placer}/`：
  入参统一为单网格 `grid`/`access:item`，标量参数加 `access:item`；每次只处理单张网格，列表 fanout/重组交给引擎。其中：
  `river_spline` 仅端口 `grid`→`inputGrid` 并加 item 访问（本就单网格进出）；`town_island_layout` 移除列表级 `merge` 参数，
  道路+地块合并为**单张多值 `outputGrid`**（道路=1、各地块从 2 起递增 id）+ `outputNameList`(仅含实际出现 id)；
  `adaptive_room_furniture_placer`、`room_layout_placer` 本就单网格处理（roomGrid/doorGrid 进、单张多值 outputGrid 出），
  仅为各端口（含 doorGrid 同步配对）与标量加 item 访问，`furnitureList` 作为家具目录广播。各自的样条/BSP/家具放置算法不变。
  版本：river_spline 2.0.0→3.0.0、town_island_layout 1.3.0→2.0.0、adaptive 2.0.0→3.0.0、room_layout 1.5.0→2.0.0。
  顺带订正 town_island_layout / adaptive 的 README 过期端口名（mainRoad/subRoad/parcels、layoutGrid/newMaskA 等）。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **`Regions` 模板重写为「按分区 fanout 成多个同级子节点」（`batteries/templates/structures/districts/Regions/Regions.json`）。**
  数据流由「单张多值网格 → 一个 `grid2node` → 一个 district 节点」改为
  `region_zone_generator.outputGrid → grid_split_by_value(按 zone 值拆分) → grid2node(逐 zone fanout) → add_child`；
  每个 zone 生成 1 个同级子节点，节点名按顺序取 `DistrictAsset`（经 `str_to_list_branches` 解析的列表），外加 1 个 `rest` 节点。
  暴露输入修正：`DistrictAsset(in_1)` 现映射到 `rz_names.str`、`Regions(in_3)` 现直接映射到 `rz_zone.regions`（消费端输入口，连线即覆盖内部默认面板）——
  旧版 `in_3` 错误地映射到 `text_panel` 的 **output** 端口，导致外部 Regions 永远被丢弃、只用内部默认值。
  仍保持 5 个输出端口（out_0 主 scene / Rest / District / DistrictPath / RestPath），`DistrictPath` 现为各 zone 的路径列表。
  *为什么：* 用户期望 `DistrictAsset`、`Regions` 支持 datatree，在当前 focus 节点下挂载多个同级子节点、`DistrictPath` 输出为列表；
  旧模板既丢弃 Regions 输入、又只产出单个合并节点，不满足需求。
  `batteries/components/elements/{hill_contour_generate,lake_gen,river_lake_gen}/`：入参统一为 `inputGrid`(`grid`/`access:item`)，
  标量参数加 `access:item`；每次只处理单张网格，列表 fanout/重组交给引擎。其中：`hill_contour_generate` 由「每输入网格
  contourLevels 张单值层网格 `contourLayers`」合并为**单张多值 `outputGrid`**（格值=等高带层序号 1..N），`outputNameList` 仅含实际出现层；
  `lake_gen` 移除列表级 `merge` 参数，各湖泊写入同一张多值 `outputGrid`（每湖一个递增 id）+ `outputNameList`(item)；
  `river_lake_gen` 本就单网格处理，仅将端口 `grid`→`inputGrid`、`grid`/`waterGrid`/`nameList`/标量加 item 访问。各自的高斯距离场/
  随机洪泛/河流路径算法不变。版本：hill 1.0.0→2.0.0、lake 1.1.0→2.0.0、river 1.0.0→2.0.0。`region_zone_generator` 已是 DataTree 形式，未改动。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；除 `region_zone_generator`(已 DataTree)外当前均无图/模板引用，可安全改契约。
- **四个 districts 电池重写为 DataTree 形式（`cliff_platform_gen` / `organic_island_shape` / `point_zone_gen` / `random_rect_zone_gen`）。**
  `batteries/components/districts/{cliff_platform_gen,organic_island_shape,point_zone_gen,random_rect_zone_gen}/`：
  入参由 `grid`/`grids`/`inputGrid`(array/手动遍历) 统一改为 `inputGrid`(`grid`/`access:item`)，标量参数加 `access:item`；
  输出统一为**单张多值 `outputGrid`**(`grid`/item) + `outputNameList`/`nameList`(array/item)，每次只处理单张网格，列表 fanout/重组交给引擎。
  其中：`organic_island_shape` 由「每输入网格 4 张单值网格」合并为单张多值网格（地面=1/浅水=2/中水=3/深水=4）；
  `point_zone_gen` 各区域写入同一张多值网格（每区域递增 id，保留 height）；`random_rect_zone_gen` 移除列表级 `merge` 参数、
  各矩形写入同一张多值网格并保留 `placedCount`；`cliff_platform_gen` 仅重命名端口 + 加 item 访问（本就单网格处理）。
  各自的圆形平台/柏林噪声海岛/BFS 生长/矩形放置算法不变。版本：cliff 1.0.0→2.0.0、organic 2.0.0→3.0.0、point 1.0.0→2.0.0、rect 1.1.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **POI/装饰/地块四电池重写为 DataTree 形式（`poi_place` / `poi_scatter` / `precise_decoration_scatter` / `bsp_rect_gen`）。**
  `batteries/components/decoration/{poi_place,poi_scatter,precise_decoration_scatter}/` 与
  `batteries/components/districts/bsp_rect_gen/`：入参由 `grid`/`inputGrid`(array，手动遍历网格列表) 统一改为
  `inputGrid`(`grid`/`access:item`)；输出从「单值网格平铺列表 `outputGridList`」改为**单张多值 `outputGrid`**
  (`grid`/item，每种 POI/装饰/地块一个递增 id)，保留 `outputNameList`(array/item，仅含实际出现条目)；
  三个散布电池保留 `placedCount`(number/item)。`bsp_rect_gen` 同时移除列表级 `merge` 参数（合并/拆分交由下游
  `grid_split_by_value`），所有地块写入同一张多值网格、重叠处后写入者覆盖。各自的 BFS 就近/随机散布/泊松/BSP 分割
  算法不变。版本：poi_place 1.0.0→2.0.0、poi_scatter 1.0.0→2.0.0、precise 1.0.0→2.0.0、bsp_rect_gen 2.1.0→3.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **四个装饰电池重写为 DataTree 形式（`indoor_texture` / `outdoor_texture` / `natural_decoration` / `multi_layer_ground`）。**
  `batteries/components/decoration/{indoor_texture,outdoor_texture,natural_decoration,multi_layer_ground}/`：
  入参从 `gridList`/`grid`/`baseGrid`(array，手动遍历 + 跨网格合并) 统一改为 `inputGrid`(`grid`/`access:item`)；
  输出从「单值网格平铺列表 `outputGridList`」改为**单张多值 `outputGrid`**(`grid`/item，每类纹理/装饰/层一个递增值)，
  保留 `nameList`/`outputNameList`(array/item，仅含实际出现的条目，映射值→名称，下游可 `grid_split_by_value` 拆分后命名)。
  各自的纹理/生物群系/散布/Perlin 多层算法不变；`multi_layer_ground` 多层合并到一张多值网格、重叠处取较高层。
  版本：indoor 1.2.0→2.0.0、outdoor 2.0.0→3.0.0、natural 3.3.0→4.0.0、multi_layer 1.1.0→2.0.0。
  *为什么：* 与 DataTree 网格电池统一数据流，列表 fanout/重组交给引擎；当前均无图/模板引用，可安全改契约。
- **`river_bridge`（河流架桥）重写为 DataTree 形式。**
  `batteries/components/Topographic/river_bridge/`：端口由 `input`(array，手动遍历网格列表)/`outputGridList`
  改为 `inputGrid`/`outputGrid`(`grid`/`access:item`)，对齐 `road_connect_link`；算子每次只处理单张网格，
  列表 fanout/重组交给引擎。保留 `outputNameList`(array/item，固定 `[{id:1,name:'桥',type:'tile'}]`)。
  PCA/连连看/对角补点等架桥算法不变。版本 1.1.0 → 2.0.0。
  *为什么：* 与同组地形电池统一为 DataTree 数据流；当前无图/模板引用，可安全改契约。
- **`decoration_border`（规则装饰物）重写为 DataTree 形式。**
  `batteries/components/decoration/decoration_border/`：入参 `baseGridList`(array) → `inputGrid`(`grid`/item)，
  输出 `outputGridList`(每种装饰物一张) → 单张多值 `outputGrid`(`grid`/item，每种装饰物一个递增 fillValue)；
  保留 `nameList`(array/item，映射 fillValue→名称，下游可 `grid_split_by_value` 拆分后命名)。fillValue 改为按本网格
  `max+1` 起算。摆放/填充/解析算法不变。版本 2.0.0 → 3.0.0。
  *为什么：* 与 DataTree 网格电池统一；多值网格+nameList 保留用户自定义资产名映射，当前无图/模板引用，可安全改契约。
- **`ramp_mask_gen`（坡道掩码生成）重写为 DataTree 形式。**
  `batteries/components/Topographic/ramp_mask_gen/`：端口由 `input/output`(array，手动遍历网格列表 + `merge` 合并)
  改为 `inputGrid`/`outputGrid`(`grid`/`access:item`)，对齐 `zone_nesting`、`zone_nesting_riverbank`；
  算子每次只处理单张网格，列表 fanout/重组交给引擎。移除 `merge` 端口与 `outputNameList` 输出（列表级语义在 DataTree 下由引擎承担），
  坡道格保留原区域值。版本 1.3.0 → 2.0.0。
  *为什么：* 与同组地形电池统一为 DataTree 数据流；当前无任何图/模板引用该算子，可安全改契约。

### Fixed
- **`EdgeGrassClusters` 模板 District/Rest 两个 scene 输出端口内容对调。**
  `batteries/templates/structures/districts/EdgeGrassClusters/EdgeGrassClusters.json`：
  `out_1`(Rest) 与 `out_2`(District) 的 `sourceNodeId` 互换（`rb_out_rest` ↔ `rb_out_zone`），
  使 District 端口输出地块本体、Rest 端口输出剩余空地。
  *为什么：* 实测该模板运行时两端口输出内容反了；按用户要求仅交换本模板这两个端口。
- **用户「保存到模板」的小标签失效——保存路径补一层「模板文件夹」使其与内置模板同构。**
  此前 save-user 写到 `templates/My templates/<smallTag>/<name>.json`（json 直接放在小标签目录下），
  与扁平内置模板 `templates/{大}/{模板}/file.json` 结构相同，前端 `getTemplateSmallLabel` 把 `<smallTag>`
  误判为模板文件夹 → 返回 null → 小标签丢失、模板被平铺。现改写到
  `templates/My templates/<smallTag>/<name>/<name>.json`（`backend/src/routes/groupTemplates.ts` save-user），
  结构与内置 `templates/{大}/{小}/{模板}/file.json` 同构，小标签正确恢复；删除路径自下而上清理变空目录。
  测试 `backend/tests/groupTemplates.test.ts` 更新断言为新路径（含模板文件夹层）。
  *为什么：* 模板支持二级标题后，用户模板因少一层目录被误判，小标签整体失效。

### Added
- **新建 `PathConnectionLink` 模板（道路连接·连连看变体）。**
  `batteries/templates/structures/path/PathConnectionLink/`：复刻 `PathConnection` 骨架，仅把中间连点算子
  从 `alg_topology_connect_points`（A* 随机游走）换成 `road_connect_link`（连连看折线，最多 2 次转弯，A* 兜底），
  输入/输出端口完全一致、连线无需改动。新 group id `group_1782300000000_pclnk`。
  *为什么：* 用户要把另一种 road 电池（连连看）也包成与随机游走版并列的模板。
- **`/api/v1/group-templates` 列表返回模板的 `version` / `author` / `createdAt`，供前端 Templates 行展示。**
  `backend/src/routes/groupTemplates.ts`：`collectCatalogItems` 从模板 JSON 顶层读 `version`（缺省 `1.0.0`）、`author`、`createdAt`（缺省回退文件 mtimeMs）；
  `GroupTemplateBattery` 接口同步新增 `author?` / `createdAt?`。保存路径（`/save`、`/save-user`）经新增 `stampTemplateMeta` 把 `version`/`createdAt`（缺省 `Date.now()`）落盘进模板 JSON（已有值保留）。
  *为什么：* 模板列表要显示版本、作者、制作时间，需后端从模板 JSON 读取并在保存时持久化。

### Changed
- **`road_connect_link` 电池重写为 datatree/item 形态（v1→v2.0.0）。**
  `batteries/components/Topographic/road_connect_link/{meta.json,index.ts}`：I/O 从「array 进 / 列表出、内部批处理」
  改为与 `alg_topology_connect_points` 完全一致的「单张 grid 进/出 + 引擎 DataTree fanout」：`poiGrid`/`obstacle`(item grid)
  进、`topology`(item grid)+`outputNameList` 出，新增 `coverPoi`；连连看算法（`linkPath`+A* 兜底+`maxTurns`）保持不变。
  *为什么：* 让连连看电池能像随机游走版一样干净地包进 `PathConnection` 模板骨架（端口对齐、可直接互换）。
- **`PathConnection` 模板显示名改为 `PathConnectionRandomWalk`**（仅 `name`/`nameEn`）。
  保留文件名 `PathConnection.json`、folder、group id `…zblc6` 不变——`instantiateTemplate` 按 group id / 文件 basename
  解析，Sino skill 文档仍以 basename `PathConnection` 实例化，故不动 basename 以**零破坏**，只改调色板显示名以与 Link 版区分。
  *为什么：* 用户要两个 road 模板分别改名、可区分随机游走 vs 连连看。
- **`EdgeTreeClusters` 模板：内部电池默认值调整。**
  `batteries/templates/structures/districts/EdgeTreeClusters/EdgeTreeClusters.json`：
  `eg_clusters`(`edge_green_cluster`) 节点 `params` 写入 `count: 17`、`clusterSize: 267`，
  覆盖算子默认值（原 12 / 18）。*为什么：* 该模板需要更多、更大的边缘树簇默认表现。
- **`LakeRegions` 模板：暴露 `LakeSize` 输入以控制单个湖的大小。**
  `batteries/templates/structures/water/LakeRegions/LakeRegions.json`：删除原本硬喂
  `alg_region_flood_grow.size` 的 `number_const`(=50) 及其连线，改为把 flood_grow 的 `size`
  端口暴露为 `in_18`（`customLabelEn: LakeSize`），并将 50 写入该节点 `params.size` 作为默认值。
  *为什么：* 用户要能从模板外部控制 lake 的 size（每个湖斑块的目标格数）。

### Added
- **新建 `RegionZoneGenerator` districts 模板（按方位+面积配额分区）。**
  `batteries/templates/structures/districts/RegionZoneGenerator/`：照 `RiverbankZone` 骨架
  （`scene→node_explode→rect_grid→voxel_slice→region_zone_generator→grid2node→add_child`，
  Rest=`占用区−分区`），把 `region_zone_generator` 包成与同目录地块模板一致的 **5 输出**
  （Main/Rest/District/DistrictPath/RestPath）。输入暴露 scene + DistrictAsset/Seed/Regions/
  BoundaryStyle/RelaxIterations/SmoothIterations，`Regions` 由内置 `text_panel`（默认
  `[[1,1],[1,5],[1,9]]`）提供可覆盖默认值。
  *为什么：* 用户要把 `region_zone_generator` 小电池包成现在的 datatree 模板形态。
- **新建 `RiverbankGreenZone` 模板（河岸侵蚀 + 边缘绿簇·叠加到同一节点）。**
  `batteries/templates/structures/districts/RiverbankGreenZone/`：把 `RiverbankZone` 与 `EdgeGreenClusters`
  合并为一个模板。同一占用区掩码分别喂 `zone_nesting_riverbank`（河岸侵蚀网格 D）与 `edge_green_cluster`
  （边缘绿簇网格 C），两张网格经 `alg_region_union` **逐格求并为一张**，再 `grid2node` 生成**唯一一个地块节点**
  （单 voxel-mass）。默认 ErosionStrength=17、Count=16、ClusterSize=267，3 输出（主产物/District/DistrictPath）。
  *为什么：* 用户要 grid 结果完全合并到同一个节点（单节点单 voxel-mass），而非父子两层或保留差集。

### Fixed
- **`edge_green_cluster`：`clusterSize` 现在如实生效。** 旧实现各簇共享全局占用图，`count` 较大时
  种子沿轮廓密集排布、后到种子落在已占用格上直接产出 0 格，存活簇也被邻簇挤死，导致即便 `clusterSize=300`
  也只生成零星小簇。改为每簇独立生长、只受区域掩码约束（相邻簇允许重叠连片，写出取并集）。脚本实测
  200×130、count=5：`clusterSize=300`→1571 格、`=30`→158 格，单簇大小随参数线性变化。
  *为什么：* 用户反馈 `clusterSize` 调大无效。

### Changed
- **`EdgeTreeClusters` 模板补齐 Rest 输出，对齐 `RiverbankZone` 的 5 输出规范。**
  `batteries/templates/structures/districts/EdgeTreeClusters/EdgeTreeClusters.json`：原来只有
  3 输出（Main/Clusters/ClustersPath）、不产 Rest。新增 `alg_region_subtract`(占用区−绿簇)→
  `grid2node`→`add_child`(rest) + `scene_merge_subtrees` + 第二个 `scene_focus_path`，
  输出改为 **3 scene + 2 path**：Main/Rest/Clusters + ClustersPath/RestPath（顺序与
  RiverbankZone 一致）。README 同步更新。
  *为什么：* 用户要 EdgeGreenClusters 系模板也输出 Rest 区域、与其他地块模板输出规范统一。
- **`region_zone_generator` 电池改为 DataTree 单网格契约（v2.0.0）。**
  `batteries/components/districts/region_zone_generator/{index.ts,meta.json}`：入参 `baseGrid`(array,
  支持网格列表)+输出 `outputGridList`/`nameList` → 改为 `inputGrid`(grid, item) 进、单张多值
  `outputGrid`(grid, item) 出（分区 k→ID `k+1`，未分配=0），网格列表交由引擎逐张 fanout，
  与 `zone_nesting`/`edge_green_cluster` 对齐；移除 `nameList` 输出。`regions` 兼容
  `[area,position]`/`[name,area,position]`/JSON 字符串（名称仅作注释）。
  *为什么：* 用户要求直接在原电池上改成可被地块模板复用的单网格形态、不再输出 nameList。
- **三个 districts 模板的资产名暴露端口 `DistrictName`/`ClusterName` → `DistrictAsset`。** 与
  `structures/water/LakeRegions` 的 `LakeAsset` 命名对齐，明确该端口为资产名称。涉及
  `ZoneNesting`/`RiverbankZone`/`EdgeGreenClusters` 的 `customLabelEn` 及对应 README。

### Added
- **新建 `edge_green_cluster` 电池（边缘绿簇）+ `EdgeGreenClusters` 模板。**
  电池 `batteries/components/Topographic/edge_green_cluster/`：沿 targetValue 区域外轮廓等距+抖动取 `count`
  个边缘种子，每个种子用「欧氏距离 + FBM 噪声」优先级 BFS 在区域内部长出 ~`clusterSize` 个像素的不规则团块
  （`irregularity` 控制破碎度，占用图防重叠），输出与输入同形状的绿簇掩码（背景 0，簇=`outputValue`）；
  输入/输出同为 `grid`/`item`（DataTree）。脚本实测 50×50：簇细胞 100% 落在距边界 ≤4 内，确实粘附边缘。
  新模板 `batteries/templates/structures/districts/EdgeGreenClusters/`：scene 输入 + 暴露 `Count`/`ClusterSize`/
  `Irregularity`/`Seed`/`ClusterName`，内部 `node_explode → rect_grid + voxel_slice → edge_green_cluster →
  grid2node → add_child`，纯装饰叠加（不消耗区域），3 输出（主产物 / Clusters / ClustersPath）。
  *为什么：* 给已成形地块/水体边缘点缀自然碎绿（灌木/苔藓/藻类）。
- **`zone_nesting` 改 DataTree 数据格式 + 新建 `ZoneNesting` 模板（templates/structures/districts）。**
  电池 `batteries/components/Topographic/zone_nesting/`：输入 `inputGrid`、输出 `outputGrid` 改为
  `type:grid`/`access:item`——每次只处理单张网格，网格列表交由引擎按 DataTree 自动 fanout / 重组；
  删除手写的 `parseInputGrids` 列表打包与 `outputGridList` / `outputNameList` 数组（命名交给下游模板），
  `meta.json` 升版 `2.0.0`。新模板 `batteries/templates/structures/districts/ZoneNesting/`（参考
  `interests/structures/LakeRegions`）：scene 输入 + 自定义参数暴露为输入端口，5 个 scene/string 输出
  （主产物 / Rest / District / DistrictPath / RestPath），内部 `node_explode → rect_grid + voxel_slice →
  zone_nesting → grid2node → add_child`，Rest = `alg_region_subtract(占用区 − 地块)`。
  *为什么：* 让 `zone_nesting` 能像其它 grid 电池一样在 DataTree 流水线里直接复用，并提供可实例化的地块模板。
- **新建 `zone_nesting_riverbank` 电池（河岸式变深度侵蚀）+ `RiverbankZone` 模板。**
  电池 `batteries/components/Topographic/zone_nesting_riverbank/`：`erosionStrength` 默认 `54`；用低频 FBM
  噪声场驱动每段边界的侵蚀深度（`depth = clamp(strength + (fbm-0.5)·2·waviness,0,1) × maxDepth`，先 padded
  多源 BFS 求内向距离再判 `d ≤ depth`），让内边界**深浅不一、忽宽忽窄**形成自然河岸，而非 `zone_nesting`
  的等距偏移内缩；新增 `waviness`/`maxDepth`/`featureScale` 参数，输入/输出同为 `grid`/`item`（DataTree）。
  新模板 `batteries/templates/structures/districts/RiverbankZone/` 与 `ZoneNesting` 同构，改用本电池并暴露
  `ErosionStrength`/`Waviness`/`MaxDepth`。脚本实测 60×40 全 1 网格：内边界 top-edge 深度 7~40 起伏，明显波动。
  *为什么：* 用户需要比均匀偏移更夸张、极不均匀的有机河岸地块边界。
- **成组电池/模板保存方式与 wb-2d 资产插件统一：区分预置（builtin）与用户内容，支持删除用户模板。**
  此前 scene 侧 `groupTemplates.ts` 虽已能把「保存到模板」写入 workspace `.forgeax`
  （`save-user` → `user-content/templates/My templates/<smallTag>/`），但列表项不带 `builtin`
  标记、也没有删除入口，导致电池栏右键菜单无法删除自己保存的用户模板（内核已支持，但 scene
  的 `HttpApiClient` 缺 `deleteUserTemplate`）。现对齐 wb-2d：(1) `collectCatalogItems` 给每项
  打 `builtin`（`root !== userTemplateRoot()`：用户内容 = `false` 可删，groups/ 与内置 templates/
  = `true` 只读）；(2) 新增 `DELETE /api/v1/group-templates/user/:id`（仅在 `.forgeax` 用户根按
  id 定位删除，删后清理变空小标签目录，预设永不可达）；(3) 前端 `HttpApiClient.deleteUserTemplate`
  打通内核右键删除链路。落点：`backend/src/routes/groupTemplates.ts`（`builtin` 字段 +
  `findUserTemplateFile` + DELETE 路由）、`frontend/src/api/HttpApiClient.ts`。测试
  `tests/groupTemplates.test.ts`（用户模板 `builtin:false`、按 id 删除消失、删缺失/预设 404）。
  *为什么：* 让 scene 与资产插件「预置只读 / 用户保存到 .forgeax 且可删」的成组电池语义完全一致。

### Fixed
- **Templates 预览图改读文件夹内任意 `.png`（与 wb-2d 资产插件一致），不再只认 `icon.png`。**
  此前 `groupTemplates.ts:readIconPng` 只 `resolve(dir, 'icon.png')`，模板里实际图片名为
  `下载.png` 等时一律「No preview」。现改为扫文件夹、优先 `icon.png` 否则取首张受支持图片
  （png/jpg/jpeg/webp/gif，按名排序），编码 data URL（`backend/src/routes/groupTemplates.ts:readIconPng`）。
  测试 `tests/groupTemplates.test.ts`（放 `下载.png` 验证 iconPng 为 data URL）。
  *为什么：* 用户的 scene 模板预览图未命名为 `icon.png`，导致电池栏 Templates 卡片无预览。

### Changed
- **模板按小标签归类（配合内核 Templates 小标签手风琴）。** `AddBaseGrid` 由
  `templates/scene/` 迁到 `templates/general/`；`LakeRegions` 由 `templates/scene/`
  迁到 `templates/interests/decoration/`（`templates/{大标签}/{小标签}/{模板}/file.json`
  结构，使 Templates 模式显示「interests › decoration」小标签）。*为什么：* 让 scene
  模板能像 Develop 一样按小标签分组（内核渲染改动见根 CHANGELOG）。

- **整治 Sino「想太多」：补「放 N 栋手动建筑」照抄食谱 + 把房子路由从「专属/非默认」改回「默认走 `dechouse_gen`」。**
  起因：用户提供的 Sino 思考轨迹显示，做一个村庄时 Sino (1) 为「怎么串多个 `PointSampleBuilding`」反复空想几十轮，(2) 房子最终走了 PART A 小 sprite、完全没调 `dechouse_gen` 装饰房屋模板。根因两条都在文档：
  - **多栋手动建筑无可照抄食谱**（`PointSampleBuilding/README.md` 只讲单栋），但 persona 又「禁止自行探索」→ 被迫硬猜。现新增 README「放 N 栋手动建筑」节（链 `out_3`(Rest)→下一栋 `in_1`、**绝不接 `out_2`**(root 0 cells→静默产空+`scene is required`)、POI=各 `out_0` merge、汇总 `tree_merge`[`ABG.out_1`...]→flatten→merge_subtrees），并同步 `compose-sino-scene/SKILL.md`「手动放置装饰性建筑」、`TEMPLATES_INDEX.md`、persona 手动放楼条。
  - **房子被路由去 PART A**：`compose-sino-scene/SKILL.md`「掩码提取」、`texture-pipeline/SKILL.md` 3.0、`building_footprint_mask/README.md`、persona 与 lessons 此前都把 `dechouse_gen` 框成「专属、非默认、仅当用户明确要 billboard 整栋贴图」。现统一改为「**要给房子/建筑出贴图/资产 → 默认走 PART C `dechouse_gen`**，唯一例外是纯结构化盖楼用内置墙材」。
  - persona 新增「工作风格：多做少想、边做边想」directive + 「路由」速查表（普通场景/手动放楼/房子贴图/tile/小物件各走哪条），前置在最显眼处，replace「先长篇推演」的元行为。
  *为什么：* 用户明确「Sino 思考时间太长不合理、要多做少想直截了当；房子生成还在 PART A/B，完全没调装饰房屋模板电池」。过度思考的结构性成因＝文档既禁止探索又不给食谱、且把正确路径 gate 成「非默认」。
- **`PointSampleBuilding` 写明装饰性建筑尺寸铁律：Width/Height 至少 `10×10`（格），常规 10×10～16×16，`4×4` 太小、别过大（≫20×20）。**
  `batteries/templates/scene/PointSampleBuilding/README.md`（in_2/in_3 表行 + 新增「尺寸铁律」note + 把示例 Width/Height 由 8/6 改 12/12）、
  `compose-sino-scene/SKILL.md`「手动放置装饰性建筑」step 2、`TEMPLATES_INDEX.md` 同节、`agent-sino/persona/zh.md` 手动放楼一条同步补上。
  *为什么：* 用户明确「装饰性房屋推荐至少 10×10，4×4 这种瞎扯淡」；太小的 Width/Height → 建筑区域墙体/门挤一团、后续 `dechouse_gen` 整栋贴图也稀碎。
- **`compose-sino-scene/SKILL.md` 与 sino persona 的「整栋建筑贴图」更正为：2D 侧一键 `asset2d:pipeline.instantiateTemplate({templateId:"dechouse_gen"})`，不再让 AI 手搭等价链。**
  上一轮文档因当时 2D 工具层缺 `instantiateTemplate`，写了「用 `asset2d:pipeline.applyBatch` 复刻等价链」；本轮 2D 插件已补齐该 op
  （见 `wb-2d-scene-asset-generator` CHANGELOG「Added」），故把 `skills/compose-sino-scene/SKILL.md`「手动放置装饰性建筑」step 6/脚注、
  `agent-sino/persona/zh.md`「整栋建筑贴图」step 4 + 「2D 侧与发布」节统一改为**一键实例化 `dechouse_gen`**（`in_0`=占地 json、`in_1`=height、
  `in_15`=roofType → `out_3`=贴图、`out_4`=碰撞掩码；`house_template`/`house_footprint`/`grid_json_to_size` 是模板内部节点、别手搭）。
  *为什么：* 用户明确「生成建筑只需一个模板电池，手搭节点链是过时错误做法」；2D 现已和场景侧对等支持模板组一键实例化，文档与 persona 必须锁步。

### Added

- **新模板组 `PointSampleBuilding`（手动点位建筑）发布到 `templates/scene/`。**
  把开发版 `batteries/groups/scene/PointSampleBuilding`（仅 Develop 可见、Sino 看不到）原样复制为
  `batteries/templates/scene/PointSampleBuilding/PointSampleBuilding.json`（templateId
  `group_1781751905067_4k92s`），使 Sino 可经 `scene:pipeline.instantiateTemplate` 实例化。它支持
  **在指定坐标手动放一栋装饰性建筑**：IN `in_0`Point(point2d)/`in_1`场景/`in_2`Width/`in_3`Height/`in_4`BuildingAsset，
  OUT `out_0`Building/`out_1`BuildingPath/`out_2`scene/`out_3`Rest/`out_4`RestPath。配套新增 `README.md`
  （完整工作流 + 可照抄 ops/CLI）。*为什么：* 与 `ArchitectureRegions`（随机撒 N 栋）互补，满足"就要在这个坐标放一栋这么大的楼"的地标/剧情/装饰诉求。
- **`manual_points`（手动点位）加入 Sino 顶层 opId 白名单。** `backend/src/routes/sinoOpGate.ts`
  的 `SINO_TOP_LEVEL_OPID_ALLOWLIST` 增加 `manual_points`（x,y→point2d），并与
  `skills/compose-sino-scene/SKILL.md`「op 白名单」「手动放置装饰性建筑」一节、`TEMPLATES_INDEX.md`
  同步（gate↔skill 锁步）。*为什么：* `manualPoint → PointSampleBuilding` 工作流的第一步要在顶层
  `createNode` 一个点位源；不入白名单则被硬门拒绝，工作流无法跑通。`sinoOpGate.test.ts` 新增对应断言。

### Changed

- **`ArchitectureStructures` 模板新增可见输入 `in_30`（z 高度）。** 用开发版
  `batteries/groups/scene/ArchitectureStructures`（含新增 z 输入，31 个 exposedInputs）覆盖发布版
  `batteries/templates/scene/ArchitectureStructures/ArchitectureStructures.json`（原 30 个）；`in_30`
  接内部 `voxel_slice.z`，控制建筑结构层高/体素切片高度。同步更新该模板 `README.md` 与 `TEMPLATES_INDEX.md`。
  *为什么：* `PointSampleBuilding.out_0`(Building) → `ArchitectureStructures`（指定 z=1）出细节结构的工作流需要显式喂层高。
- **`compose-sino-scene/SKILL.md` 打通"手动放楼 → 占地 json → 2D 建筑贴图 + 碰撞掩码"端到端。**
  在「手动放置装饰性建筑」与「整栋建筑贴图」两节写明：`PointSampleBuilding` 的 Building 经 `BuildingPath` →
  `scene_focus_path` → `building_footprint_mask`（0/1/2 占地掩码）→ `grid_to_json` 分析成 JSON 保存，这份 JSON **原样**
  作为 2D 模板 `dechouse_gen.in_0`(json_mask)（内部 = `house_template.spec`/`house_footprint.spec`/`grid_json_to_size.json`），
  配 `in_1`=height、`in_15`=roofType → `out_3`=建筑贴图、`out_4`=碰撞掩码导出；并补「闭环命名铁律」step 7：渲染按
  `asset_name` 匹配，`PointSampleBuilding.in_4`(BuildingAsset) 即写 `asset_name` 的口子，故 **BuildingAsset == PART C
  item_name == publishToGame.assetName**（assetType=object）三处同名，手动放的楼才会渲染成生成的整栋贴图，`topBillboard` 截图核对。
  *为什么：* 已核对两侧端口契约严丝合缝（见 2D 插件 PART C「C-阶段零 dechouse_gen」），让 sino 学会"生成输入 json → 生成贴图+碰撞 →
  用回场景"完整闭环（整栋 billboard 铺多格 footprint 属专属路径，首跑需截图验证）。
- **`TEMPLATES_INDEX.md` / `compose-sino-scene/SKILL.md` 增补"手动放置装饰性建筑"工作流。**
  说明坐标系（左上角 0,0 / x横 y纵）与 `manualPoint → PointSampleBuilding →（可选）ArchitectureStructures(z=1)`
  →（BuildingPath 经 `scene_focus_path` + `building_footprint_mask` + `grid_to_json` 取网格形状；
  BuildingPath `string_concat` 拼 `/outer_door` + `scene_focus_path` + `node_explode` 看 `voxels` 取门坐标）的全链。

### Fixed

- **共享沙箱资产发布后场景侧不再需要手动刷新页面。** 根因：`scene:library.useGameTextures`
  绑定沙箱 `textures/` 目录时，2D 应用的首次 `publishToGame` 往往还没创建该目录，于是
  `gameSandboxStore.startGameSandboxWatcher` 里的 `fs.watch(dir)` 抛 ENOENT 被静默吞掉，
  watcher 永远没挂上 → 之后每次发布都不广播 `library:changed` → 用户必须手动刷新才能看到
  导入/匹配结果。修复（`backend/src/library/gameSandboxStore.ts`）：① 挂 watcher 前先
  `mkdirSync(dir,{recursive:true})`，保证目录存在、watcher 必定挂上（它本就是 2D 端要写入的共享路径）；
  ② 增加 1.5s 轮询 index.json 的 mtime/size 作为**跨进程兜底**（2D 与场景是两个独立后端进程，
  `fs.watch` 跨进程/原子重命名写入本就不可靠），变更即广播 `library:changed`；fs.watch 与轮询经同一
  debounce + 广播时回填签名，避免重复刷新；轮询 `unref()` 不阻塞事件循环。*为什么：* 资产导入是
  AI 高频操作，少了热更新每次都要手刷，体验断裂。验证：`gameSandboxStore.test.ts` 新增「绑定早于目录存在」
  用例（模拟真实顺序）并通过，原用例仍过；`tsc --noEmit` 干净。
- **模板实例化保留组边界端口类型。** `backend/src/lib/templateOps.ts` 的 `remapContract`
  重建 createGroup 契约时补带 `portType`，与内核新约定（契约可携带、缺省回退派生）一致，
  避免 AI/模板实例化路径丢失用户设置的端口类型。

### Added

- **User-template save route + scan root ("Save to templates").**
  `backend/src/routes/groupTemplates.ts` gained `POST
  /api/v1/group-templates/save-user`, which writes the posted group to the
  workspace `.forgeax` area at `<workspaceRoot>/user-content/templates/My
  templates/<smallTag>/<templateName>.json` (FORGEAX_PROJECT_ROOT-derived, read
  at request time for test isolation). The user-template root is appended to the
  template scan roots (`getKinds()`/`templateRoots()`), so `GET
  /api/v1/group-templates` lists built-in + user templates uniformly under the
  fixed **"My templates"** big-label. `frontend/src/api/HttpApiClient.ts`
  implements `saveUserTemplate`. Test: `backend/tests/groupTemplates.test.ts`
  (save-user round-trip + 400 on empty smallTag). *Why:* let users persist their
  own reusable group templates as project-shared user content.

### Fixed

- **Screenshot capture WS auto-reconnect and longer default timeout.** `useScreenshotCapture.ts`
  reconnects with capped exponential backoff (aligned with wb-3d-lowpoly); agent route default
  timeout raised to 10s. `agent/routes.ts`, `useScreenshotCapture.test.tsx`.
- **AI tool handlers transparently recover project lock after backend restart.**
  `tool-handlers.ts` re-opens active project on `mutation-denied-not-open` and retries once.
- **Mutation routes forward `expectedPrevHash` and surface lock `code` on HTTP 403.**
  `mutations.ts`, `projects.ts`, `execute.ts`, `pipelineImport.ts`, `groupTemplates.ts`.

- **HttpApiClient WebSocket reconnect after drop (aligned with 3d/2d).** Exponential
  backoff 500ms→5s cap; renderer/assetstore live-sync survives backend restart without
  full page reload. Scope: `frontend/src/api/HttpApiClient.ts`.

### Added

- **Tile atlas dimension validation on publish (`autotileKind` binding).** When
  publishing a tile (`publishExternal` / shared sandbox path), PNG width×height is
  checked against `assets/rules/<autotileKind>.json` sprite bounds. `common_16`
  accepts **64×64** (no variant row) or **64×80** (with randomRules variants);
  other rules require the exact bounding box from the rule JSON. Mismatch → 400/422
  with `allowedSizes`. Files: `backend/src/library/tileRuleAtlasValidation.ts`,
  `privateStore.ts`; 2D `publish-to-game` mirrored; tests +
  `skills/texture-pipeline/SKILL.md` updated.

- **Shared-game-sandbox asset source — generated textures live in the sandbox,
  not an app-internal store, and are merged into the AssetStore view + renderer
  pool.** The two workbenches each run under an isolated `FORGEAX_PROJECT_ROOT`
  and cannot see each other's internal stores; the only cross-app common ground
  is the project's `.forgeax/games/<slug>/` sandbox. New flow: the 2D app
  publishes a finished texture into `<projectRoot>/.forgeax/games/<slug>/textures/`
  (`asset2d:publishToGame` → 2D `POST /api/v1/publish-to-game`, writing
  `blobs/<sha>.png` + a raw descriptor in `index.json`), and the scene workbench
  binds that dir as a READ-ONLY third asset source via
  `scene:library.useGameTextures` (→ `POST /api/v1/library/use-game-textures`).
  `library/gameSandboxStore.ts` composes the renderer's 13-bracket alias +
  autotile binding from the descriptor (reusing the new exported
  `composeRendererAlias` + `deriveAliasMeta`) and is merged into
  `/api/v1/library/{list,aliases-meta,serve}` alongside base ∪ private (sandbox
  records sort first, `private:true`). Binding broadcasts `library:changed` so
  the AssetStore + renderer re-pull. No app-internal store is written. Files:
  `backend/src/library/{gameSandboxStore.ts,routes.ts,privateRoutes.ts,privateStore.ts}`,
  `backend/src/tool-handlers.ts`, `forgeax-plugin.json`,
  `skills/texture-pipeline/SKILL.md`; 2D side mirrored in `wb-2d-scene-asset-generator`.

### Changed

- **Texture hand-off no longer routes bytes through the agent — retires the
  base64/private-library path as the main flow.** Earlier iterations shuttled
  base64 (`scene:library.publishExternal({dataBase64})`) which auto-compaction
  dropped, causing publish retry loops; a server-to-server `from2dAlias` variant
  fixed the loop but still landed in the app-internal private store. Per the
  "files stay in the sandbox, separate from built-in assets" constraint, the
  main path is now the shared sandbox (see Added). `scene:library.publishExternal`
  is kept as a LEGACY fallback (manifest description flags it). `texture-pipeline`
  §4/§6 + Sino `lessons.md` rewritten to the `publishToGame` + `useGameTextures`
  flow.

### Fixed

- **Renderer matching pool now refreshes after a publish / project switch
  (textures applied without a manual reload).** `frontend/src/renderer/bridge/
  useAliasMetas.ts` previously fetched `/api/v1/library/aliases-meta?zone=raw`
  ONCE on mount, so a texture published via `scene:library.publishExternal`
  after the renderer mounted never matched onto voxels until a full reload, and
  switching the active project kept the stale pool. It now also opens `/ws` and
  re-pulls on `library:changed` (already broadcast by every library mutation
  incl. publish-external) and on project activation (`runtime`
  `project:activated` / `workbench:project-changed`), mirroring `useBakedLayers`.
  This was a primary cause of "the generated scene didn't show the texture
  applied".

### Added

- **`scene:library.list` AI tool — lets an agent SEE/verify the private library
  (incl. published textures).** Previously the only asset-listing tool exposed
  to AI was `scene:assets.list`, which proxies `/api/v1/assets` → the kernel
  AssetResolver over the shared **filesystem** `<workspaceRoot>/assets` dir, NOT
  the private library DB — so an agent could not confirm what
  `scene:library.publishExternal` landed (and `texture-pipeline` §6 told it to
  verify with the wrong tool). New tool proxies `/api/v1/library/list`
  (base ∪ active-project private, paginated, defaults to `zone=raw`).
  `texture-pipeline` §6 + Sino persona now verify publishes via
  `scene:library.list` and list the "texture not applied" diagnosis checklist
  (field4 == template `xxxAsset`; right active project; `asset_type=tile` →
  non-cutout pool; `raw` not `staging`). Files: `backend/src/tool-handlers.ts`,
  `forgeax-plugin.json`, `skills/texture-pipeline/SKILL.md`,
  `agent-sino/persona/zh.md`. (`scene:assets.list`'s description now states it
  is filesystem-only.)

### Removed

- **Dropped the standalone `@forgeax-plugin/agent-atlas` supervisor agent;
  folded the texture-pipeline capability into Sino instead.** Supersedes the
  Phase-3 "supervisor agent" entry below. Why: in testing, Atlas could not
  connect the scene graph correctly — its connection know-how lived only in the
  `compose-sino-scene` skill BODY, which (being a prompt-kind skill) is **not**
  auto-injected into context unless the skill is explicitly triggered; Atlas's
  always-on persona only covered texture orchestration. Sino, by contrast, works
  because its persona itself embeds every connection hard rule (`edgeId`, op
  schema, `in_0` wiring, PathConnection POI, `tree_merge` params). Rather than
  duplicate Sino's large skill into Atlas's persona (violating single-source /
  cleanliness), we delete Atlas and give Sino the 2D capability as an opt-in
  extension. Files removed: `packages/marketplace/plugins/agent-atlas/**`.

### Changed

- **`texture-pipeline` skill retargeted from Atlas → Sino's "freshly-generated
  textures" extension.** Frontmatter `audience`, intro, and §0.1 now address
  Sino; §0.1 keeps the "create a brand-new scene project every task" hard rule
  (`scene:projects.create` + `projects.open`, never reuse/modify the active
  graph; new id recorded in the contract `sceneProjectId`). A new top note makes
  explicit that the texture pipeline **does not change any graph-connection
  rule** — `edgeId` / op schema / `in_0` wiring / PathConnection POI /
  `tree_merge` params all defer to `/compose-sino-scene`; textures only swap the
  template `xxxAsset` from a built-in name to a contract semantic name and add
  generate→publish→verify steps.
- **Sino agent gains the 2D / texture capability (opt-in).**
  `agent-sino/forgeax-plugin.json`: `tools` now `["scene:*","asset2d:*"]`;
  `defaultSkills` adds `texture-pipeline` + `generate-2d-asset`; `produces` adds
  the contract + generated-assets paths; description updated. `persona/zh.md`
  adds a clearly-scoped "扩展能力：现生成贴图（按需触发，默认不用）" section + a
  publish-bridge / asset2d tool listing, and carves the texture exception out of
  the "不画 2D" boundary. `memory/lessons.md` records the same as an additive
  capability. Pure composition tasks are unchanged (ignore the texture section).
- **Sino's persona/lessons now EMBED the 2D image-generation operational core
  (not just a skill reference).** Because `generate-2d-asset` is a prompt-kind
  skill whose body is only inlined on trigger, listing it in `defaultSkills`
  alone does not make Sino "know" how to generate — mirroring why Atlas couldn't
  connect graphs. So a distilled, always-injected "2D 生图操作核心" was added to
  `agent-sino/persona/zh.md` + `memory/lessons.md`: the three hard rules
  (op-ids/ports only from `batteries.list`; `image_gen` is manualTrigger so
  `generation.generateImage(nodeId)` once THEN `pipeline.execute`; `pipeline.get`
  after every `applyBatch`), type-driven constant batteries
  (`text_panel`/`number_const`/`toggle`), and the PART A (single/object,
  cutout) / PART B (tile atlas, tile-count = 4×(maskH÷cellW) aligned to the
  contract rule cell count) / PART C (shape-controlled house) battery chains.
  Full step-by-step sequences stay in `/generate-2d-asset` as the deep reference.

- **Texture pipeline — screenshot-vision test toggle
  (`FORGEAX_SCENE_SCREENSHOT_NO_VISION`).** New env flag (declared in
  `forgeax-plugin.json::requestedEnv`, read in `backend/src/tool-handlers.ts`)
  that, when set (`1|true|yes|on`), makes `scene:screenshot.capture/latest`
  return the plain capture metadata (path + size + `visionDisabled:true`)
  **without** the `image_file` content part, so the agent never ingests the
  screenshot into its context. Default (unset) keeps vision ON (unchanged). Why:
  during texture-pipeline testing the user wants screenshot self-reading turned
  off so the agent verifies via `pipeline.execute` summaries + names projection
  while the human eyeballs the canvas. `texture-pipeline` §6 and Sino's
  persona/lessons document the off-path behaviour.

### Added

- **Texture pipeline Phase 3 — orchestration skill + supervisor agent.** New
  plugin skill `texture-pipeline` (`skills/texture-pipeline/SKILL.md`, registered
  in `forgeax-plugin.json`) is the top-level conductor manual: it pins the naming
  contract carrier at `<active_game>.dir/texture-pipeline/contract.json` (a
  plugin-internal SSOT in the game workspace, since the two apps'
  `FORGEAX_PROJECT_ROOT`s are isolated), gives the 8-rule autotile alignment
  table (`floor_1`/`fence_7`/`slope_9`/`bridge_horizontal_9`/`flower_bed_11`/
  `bridge_vertical_15`/`common_16`/`wall_outer_16`, all ppu=16) tiles must match,
  the object cutout flow, the per-asset publish loop, and the `topBillboard`
  verification loop. Paired with a NEW agent plugin
  `@forgeax-plugin/agent-atlas` (Atlas · map-texture supervisor) that wields BOTH
  `scene:*` and `asset2d:*` tool sets and discloses three skills on demand
  (`texture-pipeline` + `compose-sino-scene` + `generate-2d-asset`). Files:
  `skills/texture-pipeline/SKILL.md`, `forgeax-plugin.json` (scene skill reg),
  `ARCHITECTURE.md`; new plugin under `packages/marketplace/plugins/agent-atlas/`.
- **Texture pipeline Phase 2 — scene-side publish bridge
  (`scene:library.publishExternal`).** New atomic, idempotent endpoint
  `POST /api/v1/library/publish-external` (+ tool + manifest tool/surface) that
  lands a 2D-generated PNG (base64) into the active scene project's private
  `raw` zone with a renderer-shaped alias in ONE call: composes the 13 bracket
  fields (field4=`assetName`, field8=type), binds a tile's autotile rule via
  `cropTypeOriginal='瓦片组'` + `assetKind=<rule>` (covers rules the field[8]
  legacy map can't, e.g. `slope_9`), marks objects as cutout (`抠图`), records
  `provenance` (`sourceBlobId`, `source='pipeline'`), and de-duplicates on
  re-publish (same `sourceBlobId` updates in place + GCs the stale blob). This
  is the single write entry-point the supervisor agent uses instead of
  hand-stitching import→repair→field-edit→move. Files: `library/privateStore.ts`
  (`publishExternalAsset` + `PublishExternalInput`), `library/privateRoutes.ts`,
  `tool-handlers.ts`, `forgeax-plugin.json`; covered by
  `tests/library-publish-external.test.ts`.
- **Texture pipeline Phase 1 — renderer matching pool now merges private
  assets.** `GET /api/v1/library/aliases-meta` previously returned base-library
  aliases ONLY, so any imported / cross-app-published texture was invisible to
  the billboard renderer and could never be matched onto a voxel. The route now
  merges project-private records of the requested zone (mapped through the same
  `deriveAliasMeta` the base library uses, so a published tile binds to its
  autotile rule identically); a private record OVERRIDES a base one of the same
  alias (the user's asset wins). This is the foundational gap for the
  scene↔2D-asset texture-generation workflow — it lets a 2D-app-generated PNG,
  once published into the active scene project's private `raw` zone, enter the
  matching pool. `PrivateAssetRecord` gained optional `assetKind` /
  `cropTypeOriginal` / `geometryJson` / `sourceBlobId` fields so a published tile
  can carry an exact rule binding (`cropTypeOriginal='瓦片组'` + `assetKind=<rule>`,
  covering rules the field[8] legacy map can't, e.g. `slope_9`) and so
  re-publishing the same bytes stays idempotent. Files: `library/routes.ts`,
  `library/privateStore.ts`; covered by `tests/library-aliases-meta-merge.test.ts`.
- **AssetStore search-by-alias candidate dropdown (left pane).** Typing in the
  Basic Operations search box now opens a debounced list of current-zone alias
  candidates (thumbnail + alias + private badge) below the input
  (`AssetStorePanel.tsx`, `WorkbenchLeftPane.css`). Picking a candidate (click or
  ↑/↓ + Enter) fills the input and reveals that asset in the right-side grid —
  selecting it, jumping the continuous scroll to its page, and surfacing it in the
  left-pane Preview · Anchor · Collision section — **without** committing a
  grid-filtering search, so the rest of the grid stays put. Wired via a new
  `left → surface` reveal command on the localStorage control bus
  (`assetControlBus.ts` `requestReveal`/`subscribeReveal`) plus a `revealAlias`
  store action (`assetStoreStore.ts`) consumed by `AssetStoreSurface.tsx`.
  *Why:* the search box gave no feedback while typing; users had to scroll the
  grid manually to find a known alias.

### Changed

- **Scene export now reproduces the editor billboard render under the shipped
  viewer's own algorithm (render→export parity).** The cook no longer re-derives
  rules on a second code path — it routes terrain/object resolution through the
  renderer's shared resolvers (`pickFaceSpriteIndex` / `computeValidVariantIdxs` /
  `variantCandidates` / `compareBillboardDrawOrder`). Terrain converged per-cell:
  **per-layer** (not unioned) autotile neighbour keys, **sheet-aware `template_id`**
  so two same-named layers on different sheets don't collide variant filters, and
  region-gated wall variants (incl. gated-out door footprints). The cook still shifts
  the scene to a non-negative origin (the viewer's `cols×rows` grid can't store
  negative billboard coords) while the editor keeps raw coords — both internally
  correct, intentionally not aligned. See
  [`docs/scene-export-parity.md`](./docs/scene-export-parity.md) and the
  `backend/tests/scene-export-{renderer-parity,cooker}.test.ts` locks.
  (`9119b05`, `087cfdb`, `36b3a1d`). *Why:* a billboard 2D consumer must get the
  editor's exact image, and a parallel rule path inevitably drifts from the renderer.

- **Left-pane typography unified on the section-title style.** Projects header,
  New-project / Save-scene modal headings, the panel tabs (AssetStore / Preview /
  Scene Gen) and the group tabs are a full transplant of the computed "Node Info"
  heading (16px / weight 400 / 0.04em / uppercase / accent green). Panel tabs
  share the row width (grow from each label's width, centred, no wrap; the panel
  tabs drop to 12px + tight padding so all three fit one narrow line without
  truncation); the hero title drops its
  vertical `scaleY` stretch and gets a roomier line box so descenders (the "g")
  aren't clipped, and the hero is layered above neighbours. Body copy across the
  pane (Node Info, Data Types, History, Help, hints) is enlarged proportionally so
  relative sizes are preserved — Data Types reads name 15px > desc 12px, and the
  History toolbar (step count / Clear) plus entry timestamps sit at 12px, and the
  New-project wizard field labels (Name / Description / Template) are bumped to
  14px (`WorkbenchLeftPane.css`). *Why:* consistent heading
  identity and readable body text; the first pass approximated the title (smaller +
  bolder) and flattened the Data Types name/desc ratio.

- **Node Info stats are a responsive grid + centred empty hint.** Added a sixth
  tally (Selected: 0/1) and laid the stats out as an auto-fit grid that fills the
  width and reflows from 3-per-row to 2-per-row when cramped. The "click a battery"
  prompt now centres in the section, and the section's scrollbar chrome is hidden
  while keeping scroll (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`).
  *Why:* even, readable tallies and a tidy empty state without a stray scrollbar.

- **Scene Generator Help rewritten as short titled blocks.** Replaced the single
  paragraph with concise, compact titled sections (Build a scene / Inspect & edit /
  Preview & assets / Projects) carrying step-by-step guidance, EN + 中文. Titles
  are plain white (no accent, no bold, no divider) for a dense skim
  (`SceneGeneratorControlsPanel.tsx`, `WorkbenchLeftPane.css`). *Why:* the prior
  blob was hard to scan; titled steps are easier to follow.

- **AssetStore initial width decoupled from the editor battery bar.**
  `WorkbenchHost.tsx` renamed `BATTERY_BAR_WIDTH_DEFAULT` → `ASSETSTORE_WIDTH_DEFAULT`
  (now 290px) and dropped the "right edges on one vertical line" coupling.
  *Why:* the two panes are independent; tying AssetStore's default to the
  battery bar was an unnecessary cross-component constraint.

- **Merged `origin/main` into `dev`.** Integrates GitHub main-line preview inspector,
  placement projection, AI wire unwrap, and the 2d scene asset app with dev-only
  AssetStore private-library / left-pane work. *Why:* internal `dev` must track
  `main` without dropping in-flight generator features.

### Fixed

- **Dragging a layer to the very bottom now works (it no longer silently snaps
  back).** With siblings `layer 2, layer, layer`, no drag could move `layer` to the
  last position — you could only cycle between a few upper arrangements. Root
  cause: the drop translates "drag below the last row" into a move with
  `beforeName` omitted (= append last), but `moveBakedLayer` only ran
  `reorderSiblings` *when `beforeName` was set*. With it absent the moved node was
  pruned and re-inserted carrying its **stale `__order`**, so the reorder was
  skipped entirely and the displayed order never changed. Fix: `moveBakedLayer`
  now reorders **unconditionally** — `beforeName` set → just ahead of that
  sibling, omitted → appended last — and seeds the new order from the **current
  display sequence** (sorted by `__order`, via a shared `displayOrderedChildNames`)
  rather than the physical name-sorted array, so moving one node preserves the
  others' established order. Regression: `backend/tests/baked.test.ts` "move
  without beforeName appends the node last (drag-to-bottom)" (drags the middle of
  three to the bottom and asserts it ends up truly last).
  (`backend/src/baked/store.ts`).

- **Box-select now places objects (it no longer silently no-ops on object
  assets).** With an object asset selected and the Box brush active, dragging a
  rectangle did nothing — object placement existed only on the free-brush path
  (`paintAt`), while the box path (`commitBoxToKey`) hit an early
  `if (asset.type === 'object') return`. Fix: box-select on an object asset now
  **batch-places instances tiled across the dragged rectangle**, stepping by the
  object's footprint so neighbours sit edge-to-edge and skipping any cell already
  occupied (no overlap/clobber) — the most intuitive "stamp objects across where I
  dragged" behaviour. The single-placement math (footprint + column height +
  bottom-center snap + instance cells) is now a shared pure helper
  `resolveObjectPlacement` reused by both the free brush and the box fill, so the
  two paths can't drift. Regression: `renderer/framework/geometry/__tests__/objectPlacement.test.ts`
  (`resolveObjectPlacement` shape + a non-overlapping tiling-stride lock).
  (`renderer/host/RenderCanvas.tsx`, `renderer/framework/geometry/objectPlacement.ts`).

- **"+ Layer" no longer clobbers an existing layer; corrupted baked trees self-heal
  on load.** Clicking "+ Layer" could silently overwrite a populated layer (e.g. a
  913-cell layer collapsed into a fresh empty one). Root cause: a layered invariant
  break. The vendored scene tree (`vendor/shared/types/scene/tree.ts`) keeps each
  node's `children` array **strictly name-sorted** and relies on that for its
  `readNode` / `upsertCells` **binary search**. But the baked store overloaded
  *array order* and *`version`* to also encode the panel's *display order* — its
  `reorderSiblings` / `withChildren` reshuffled the children array (and renumbered
  versions) on every drag-reorder / bake, destroying the name-sorted invariant.
  Once the array was out of order, `findChildIdx`'s binary search could miss an
  existing same-name node, so `addBakedLayer`'s dedup (`uniqueChildPath` →
  `readNode('/Layer')`) reported "no collision" and `upsertCells` inserted a
  **second** `/Layer`; the frontend `buildPathTree` then mapped both to the same
  `pathKey`, the empty one winning → the populated layer "disappeared". Verified on
  the live corrupted project: stored top children were
  `["Layer","Layer 2","Layer","Layer 3","Layer 4"]` (two `Layer`s, not name-sorted).
  Fix (single source of truth, decoupled order): display order now lives in an
  explicit reserved `__order` attribute (`BAKED_ORDER_ATTR`), never in array order
  or version. `reorderSiblings` / `bakeLayers` / `addBakedLayer` / `ensurePaintTarget`
  stamp `__order` via `setAttribute` (which preserves the name-sorted array), and
  `projectBaked` sorts by `__order` (falling back to legacy `version`, then name for
  smooth migration). `version` reverts to its sole meaning — a content fingerprint
  for the renderer's dirty-check / incremental-bake contract. `withChildren` (the
  invariant-breaking array rewriter) and the now-unused `uniqueChildPath` are
  removed; `addBakedLayer` dedup gains a linear-name-scan defense
  (`uniqueChildPathSafe`). `load()` heals legacy data: it re-sorts every node's
  children by name and merges duplicate same-name siblings (keeping the richest —
  most cells, then bound asset, then highest version) while pinning the pre-merge
  display order onto `__order`; the existing corrupted project files were migrated
  in place (`*.pre-heal.bak` kept). Regression locks: `backend/tests/baked.heal.test.ts`
  (reproduces the exact on-disk corruption → asserts single merged node, preserved
  order, and that repeated "+ Layer" clicks each append a distinct node — proven to
  fail without the heal). All `backend/tests/baked.test.ts` (30) still pass.
  (`backend/src/baked/store.ts`). *Why:* sibling order and node identity must not
  share a storage channel with a structure (the sorted array / the content version)
  that another layer depends on — overloading it silently corrupted lookups.

- **Structural editable-layer changes (add / auto-sub-layer / drag-reorder /
  reparent / delete / bake / rename) now appear immediately instead of needing a
  manual reload.** Placing an object that auto-creates a sub-layer, or dragging a
  layer to a new order, often did nothing visible until refresh. Root cause: every
  structural op pulled the new backend structure with the *default*
  `refreshBakedLayers()`, which `deferIfLocalPending`-defers while ANY local paint
  edit is still dirty/persisting (the paint-protection that stops a refresh
  clobbering an in-flight stroke). A paint right before the structural op (the
  place-object → auto-sub-layer flow always has one) leaves that flag set, so the
  structural refresh was silently deferred — and its deferred replay only fires
  from a *paint* persist's settle path, which may never come, so the new layer /
  new order stayed invisible until a reload. The backend (authoritative for tree
  shape + sibling order) had already applied the change; only the frontend pull
  was lost. Fix: structural ops now **drain in-flight paint persists first, then
  force the refresh in** (`deferIfLocalPending:false`) via a shared
  `structuralBakedRefresh` helper (`surfaces/RendererSurface.tsx`); `RenderCanvas`
  publishes its `awaitPaintPersists` drain primitive through a new
  `paintPersistsRef` so the surface can flush+await without owning the paint
  pipeline. Paint-commit refresh (`handleBakedEditCommitted`) keeps the deferring
  default — only *structural* refreshes force. New locks in
  `renderer/bridge/__tests__/useBakedLayers.test.tsx`: a default refresh is still
  deferred while paint is dirty (the old "must reload" behavior), while a forced
  refresh lands the new structure (e.g. a new `/Layer/layer-1`) immediately.
  *Why:* a structural change must never collide with paint protection, and the
  panel must reflect the one authoritative backend tree without a second,
  manually-triggered sync.

- **Painting while the canvas pans/zooms no longer makes the in-progress stroke
  vanish until a refresh.** Drawing to the edge (auto/middle-button pan) or
  wheel-zooming mid-stroke would wipe everything just painted; the cells were
  safely in the store but the screen dropped them. Root cause was a *second*
  render source of truth for the baked master: an additive paint advances
  `masterRef.current` in place (a fresh master — often a grown NEW canvas) via
  `appendCellsToVoxelMaster` and deliberately does **not** bump `structuralKey`
  (so `useLayerSurface` doesn't re-bake — the O(k) draw contract), leaving the
  React-state `voxelMaster` stale. A viewport change then re-rendered and the
  full `composeFrame` redrew from that **stale** state master (old canvas/bbox),
  repainting the new cells away; only a later op that bumped `rebuildEpoch`
  ("refresh") let state catch up. Fixed by converging the render master to the
  single authoritative `masterRef.current`: `compose` now draws `masterRef`'s
  live master, and `maxRows/maxCols` are derived inline from `masterRef.current.bbox`
  each render (a ref read can't go through `useMemo`) instead of the stale
  `voxelMaster` memo (`modes/topBillboard/index.tsx`). The state `voxelMaster`
  (`useLayerSurface`) is now used only to *feed* the authoritative ref on a real
  structural rebuild, not as a parallel draw source — removing the data
  duplication that caused the desync. New lock:
  `modes/topBillboard/__tests__/billboard.paint.pan.test.tsx` paints an
  out-of-bbox cell (incremental grow → new master) then `panViewport2d`s and
  asserts the resulting full compose draws a master whose bbox spans the painted
  cell, with **no** new `buildVoxelMaster` call. *Why:* both performance
  contracts had to hold — "viewport changes only re-send the frame, never rebuild
  the surface" and "drawing is O(k) incremental, not O(N) re-bake" — so the fix
  changes only *which* master `composeFrame` reads (still one `drawImage`),
  never the bake path.


  `POST /api/v1/execute`, and the dropped group keeps its custom name.** The
  execute route (`backend/src/routes/execute.ts:13`) returns `handle.done`
  directly, so a rejected execution promise became an opaque 500 (this app runs
  Fastify with `logger:false` at `backend/src/main.ts:19`, swallowing the stack).
  The reject came from a drop-then-execute *race* in the editor: the dropped
  group's execute fired in the same tick as its `createGroup` persist, reaching
  the backend before the node existed, so the kernel's `buildExecutionClosure`
  threw `target node not found`. Fixed in the kernel (execute now resolves a
  structured `status:'error'` result instead of throwing — see root
  [`CHANGELOG.md`](../../CHANGELOG.md)) and in the editor drop path (execute now
  chains off the persist commit). New lock:
  `backend/tests/bridge.test.ts` asserts `POST /api/v1/execute` with an unknown
  `nodeId` returns `200` + `status:'error'` rather than a bare 500. *Why:* a
  client/timing input error must not present as a server fault, and the dropped
  group must round-trip its custom name.

- **Group-battery save no longer 500s on a malformed body
  (`POST /api/v1/group-templates/save`).** The save handler
  (`backend/src/routes/groupTemplates.ts:181`) had no input validation or error
  handling, so any request missing `group`/`categoryName`/`batteryName` — or
  carrying a non-string name — threw a raw `TypeError`
  (`safeName(undefined).trim` → `Cannot read properties of undefined (reading
  'trim')` at `groupTemplates.ts:101`; `req.body.group.nameEn` → `...reading
  'nameEn'` at `groupTemplates.ts:190`) which Fastify surfaced as an opaque
  **500** (the app runs `logger:false`, so the real stack was invisible). Now:
  `safeName` tolerates non-string input (`groupTemplates.ts:100`); the handler
  validates the body up front and returns a clear **400** with the offending
  field instead of a 500 (`groupTemplates.ts:183`); and the `mkdir`/`writeFile`
  are wrapped in try/catch that `log.error`s the real cause and returns a
  structured **500** carrying the message (`groupTemplates.ts:201`). The save
  still writes to `batteries/groups/<cat>/<name>/<name>.json` (unchanged落点
  semantics). Covered by `backend/tests/groupTemplates.test.ts` (200 happy path +
  three 400 validation paths). *Why:* users hit `Error:
  /api/v1/group-templates/save → 500` with no actionable message; a malformed or
  edge-case payload silently crashed the handler.

  defects fixed so the shipped (unmodified) viewer seats objects like the editor
  bake. (1) **Placement** — objects anchor via the renderer's `chooseObjectAnchor`
  (columnDz ASC, footprintDy DESC, x ASC = front row) at `(x,y)=(anchor.x,
  anchor.y−anchor.z)`, and the tsj `pivot` is emitted as the alias's **already-
  normalized** anchor fraction; `atlas.ts` previously divided that fraction by the
  tile px again, double-normalizing it and sliding multi-cell sprites (the ambulance
  "sprawl") off their cell (`e57ae13`, `a1415ad`). (2) **Occlusion** — the viewer
  paints all `objects[]` last (no per-object depth, `obj.height` unused at draw time),
  so objects could never be occluded by terrain. PPU=16 objects are now encoded as
  **elevation-keyed terrain-stack tiles** (carrier template `obj__<type>` registered
  into the terrain atlas, pushed onto the anchor cell at its footprint elevation), so
  the viewer's elevation-ascending terrain paint lets higher walls overdraw them —
  reproducing IMAGE-2-style occlusion with **no viewer change**. Coarse per-object
  (not per-pixel-sliced); PPU≠16 objects keep the legacy `objects[]` path
  (`f550e24`). See [`docs/scene-export-parity.md`](./docs/scene-export-parity.md).
  *Why:* the exported bundle must match the renderer's billboard output, including
  the multi-voxel footprint and terrain↔object occlusion.

- **Node Info "Selected" stat now reflects the real selection count.** The
  stat read the single mirrored `selectedNode` (so it was 0 or 1, and 0 for a
  marquee of ≥2). It now uses the new `stats.selectedCount` from the editor
  mirror (`SceneGeneratorControlsPanel.tsx`, `NodeInfoPanel`), so a multi-node
  marquee shows the true count. *Why:* the previous single-node source could
  never represent multi-selection.
- **Left-pane section titles: hover layout shift + drag resize cursor drift.** Draggable
  titles keep stable margin/padding in and out of `:hover`. During a drag the panel locks
  `minHeight` to its start size; height deltas cascade into sections above when the direct
  target hits its minimum (`applySectionDragDelta` + `usePanelDragMinHeight` in
  `sectionDragResize.ts`) so handles track the pointer without sticking at one boundary.
  *Why:* hover-only padding and drag math regressed after the shared `controlSections`
  chrome landed.

### Changed

- **AssetStore left pane: five English sections with Scene Generator chrome.** Menus
  are reorganized into Basic Operations (search, import, repair, batch), Asset
  Preview · Anchor · Collision, Filters, Library Info, and a dedicated Help (separate
  from Scene Generator). `AssetStorePanel.tsx` uses `editor-controls-panel` with
  shared `controlSections.tsx` (drag heights, collapse triangles, persisted state);
  `WorkbenchLeftPane` wraps the panel in `scene-left-pane__section--controls`; CSS
  aligns accent tokens with the generator panel. Private assets can PATCH
  `alias` / `anchorX` / `anchorY` via `privateStore` + `privateRoutes`. *Why:* match
  the Scene Generator UX and group related asset-library actions in one place.

### Added

- **Scene export cooker for baked workbench layers.** The backend can now cook
  the active project's baked scene into a reference-style `scene.zip` plus an
  unpacked mirror under `exports/scene/<bundleId>/`, with terrain/object JSON,
  atlas metadata, a static viewer bundle, and edit-mode attribute templates for
  export metadata. *Why:* billboard 2D engine consumers need a self-contained
  bundle that reflects the Preview baked-layer scene.
- **AssetStore left-pane menus + a writable project-private asset library.** The
  AssetStore group of the left nav (`frontend/src/workbench/AssetStorePanel.tsx`)
  gains six menus: 搜索, 过滤标签 (13-field, ported from the legacy CategoryNav),
  资产操作 (本地导入 + 资产修复), 批量操作 (移入回收站/恢复/永久删除 over the grid's
  selection), 资产预览 (缩略图 + 可编辑别名 + 单项操作), 资产库信息 (merged monitor).
  Because the shipped `library.db` is read-only, user imports/edits live in a new
  per-project store `backend/src/library/privateStore.ts`
  (`<activeProject>/private-assets/{index.json,blobs/}`); `privateRoutes.ts` adds
  `/api/v1/library/{import,private/*,monitor,field-values}`, and `routes.ts`
  merges private records into `/list`,`/zones`,`/facets`,`/serve` flagged
  `private:true` (grid badges them「私」). Left pane ↔ grid (sibling iframes) sync
  over `frontend/src/surfaces/library/assetControlBus.ts` (control / selection /
  refresh). Tests: `backend/tests/privateLibrary.test.ts`,
  `frontend/src/surfaces/library/__tests__/assetControlBus.test.ts`. *Why:* the
  new generator pane had a read-only AssetStore with no left menu, so users could
  not import their own art, fix non-standard names, bulk-clean, or inspect library
  stats the way the legacy AssetStore allowed.

- **Placement projection feedback for Billboard edit mode.** The Preview now treats
  the cursor as the target voxel's front/bottom face, highlights the actual target
  face, shows the nearest lower top-face projection (or a ground fallback), and
  connects the two with a dashed arrow. The Selected Layer inspector also has
  stronger visual grouping plus matched-asset thumbnails/fallback states. *Why:*
  authors need to see both where the voxel will be placed and what it is aligned
  above.
- **Preview panel inspector redesign.** The left Preview group now splits permanently
  into **Edit tools** (mode-aware: Z layer only in Billboard + Asset edit mode) and
  **Selected layer** (scene node summary, voxel ranges, read-only reserved attributes,
  editable custom attributes on baked layers, seed template apply). The renderer publishes
  multi-selection snapshots via `selectedLayerBus.ts`; baked custom attrs persist through
  `PATCH /api/v1/baked/layers/attributes`. *Why:* authors need full layer metadata and
  batch attribute tooling without leaving the workbench.
- **Asset mismatch confirmation for Preview edit mode.** Painting an asset onto
  an editable layer already bound to a different asset now opens a renderer-pane
  dialog showing the current layer asset and the target paint asset, lets the
  user name a new child layer, then selects that layer and continues the first
  stroke. *Why:* automatic sub-layer routing could stall the first paint and made
  layer ownership unclear.
- **Collapsible editable/output layer trees and selected-layer asset highlight.**
  Both Layers-panel sections now render a shared path tree with carets on parents
  that are real layers, and the Asset Store highlights the asset bound to the
  active editable layer. *Why:* large scenes need navigable layer hierarchy and a
  visible link between selected layer and source asset.
- **Z-layer editing for Preview edit mode.** The left pane's Preview edit tools
  now publish an integer **Z Layer** via `frontend/src/surfaces/library/editToolbarBus.ts`,
  mirrored into `frontend/src/renderer/store.ts`; `RenderCanvas` passes that z to
  the active renderer plugin's edit mapping before writing baked cells. *Why:*
  hand-editing should support authoring voxels at multiple heights, not only the
  former hard-coded z=0 plane.
- **Asset Store folder taxonomies — browse a flat zone as nested folders.** The
  store previously piled a whole zone into one continuous scroll grid; assets now
  bucket into folders by any of 5 schemes derived from the alias's bracket fields
  (`[f0]…[f12]`): **类型** (f8: 抠图/tilemap/forest/…), **场所** (two-level: f1
  室内/室外 → f3 房间), **风格** (f6), **尺寸** (f9), **适用场景** (f0, a `-`-joined
  multi-value tag list → overlapping folders). Backend adds
  `GET /api/v1/library/facets?zone=&by=&parent=` (`listFacets` groups in JS for
  multi-value + 4-sample covers) and extends `/library/list` with `by/value/parent`
  filters (`facetClause`, reusing the `bracket_value` SQLite UDF; scene matches
  whole dash-delimited tokens via `'-'||f0||'-' LIKE '%-tok-%'`). Frontend gains a
  「分类方式」titlebar dropdown, a breadcrumb, and Windows-explorer-style folder
  cards that peek up to 4 thumbnails inside. `taxonomy: null` keeps the legacy flat
  behaviour (zero regression). See `backend/src/library/{service,routes}.ts`,
  `frontend/src/surfaces/library/{libraryApi,assetStoreStore}.ts`,
  `frontend/src/surfaces/AssetStoreSurface.{tsx,css}`, with tests in
  `backend/tests/library.test.ts` and `frontend/src/surfaces/library/__tests__/
  assetStoreStore.test.ts`. *Why:* with thousands of look-alike pixel assets in one
  zone, a flat 600+-page scroll made finding anything by type/room/style hopeless.

- **"Node Info" panel above History in the Scene Generator controls.** A new top
  section shows whole-canvas tallies as plain inline text (batteries /
  connections / annotations / groups / frames) and, when a battery is clicked on
  the canvas, a faithful miniature of its node: the accent-green card with its
  title, input ports on the left edge and output ports on the right edge, each
  connected port drawing a short colour-typed wire out into the gutter to plain
  text naming the peer node + port (upstream for inputs, downstream for outputs).
  No boxes or icons around the peers — text only. Fed by the editor sync bridge's
  new `stats` / `selectedNode` snapshot fields (cross-iframe, so the side pane
  needs no pipeline store of its own); port dots use `getPortTypeColor` with the
  pane's `scenePortTypes`. The section is collapsible and its height drag-resizes
  (cascading into the sections below). See
  `apps/wb-scene-generator/frontend/src/workbench/SceneGeneratorControlsPanel.tsx`
  (`NodeInfoPanel` / `SelectedBatteryDiagram` / `PortRow`) and the `.scene-node-info*`
  / `.ni-*` styles in `WorkbenchLeftPane.css`. *Why:* users had no at-a-glance
  read of canvas composition, and inspecting a node's wiring meant tracing edges
  on the canvas.

- **Brush tools for edit mode: free brush + box-select, with per-asset
  sub-layer routing and a translucent ghost preview.** The left pane's Edit tools
  gains a **Free brush / Box select** toggle (crosses panes via the new
  `brushMode` channel on `editToolbarBus`). Painting routes by asset: an asset
  matching the active layer (or an empty layer) writes into it; a *different*
  asset auto-creates/reuses a `layer-n` **sub-layer** bound to that asset
  (backend `ensurePaintTarget` + `POST /api/v1/baked/target`; the renderer
  resolves the target synchronously when it can, else creates on first stroke).
  A dedicated overlay canvas (`mode-top-billboard-overlay`) draws a **half-opaque
  sprite** at the hovered cell (tile → its rule's base sprite, object → the whole
  image) and a rubber-band rectangle while box-selecting. **tile vs object** is
  derived from the alias's `tileType` in `aliasMetas`: a rule-bearing tile binds
  `asset_type='tile'` (autotile auto-applies via the existing render pipeline); a
  rule-less prop binds `asset_type='object'` (plain placement). Box-select fills
  every cell in the rectangle for both. *Why:* edit mode could only free-paint a
  single asset per layer; real authoring needs multi-asset layers, area fills,
  and a live preview of what you're about to drop.
- **Preview "edit mode" + a second, graph-independent "baked scene-layer"
  service.** Two independent logics now meet only in the preview canvas
  (visualisation) and at the Bake snapshot — mirroring Rhino's GH-preview vs
  bake-to-document model. *Why:* the node editor's output is a live, recomputed
  *preview* (not hand-editable); users needed real, persistent, hand-editable
  layers.
  - **New backend service** `backend/src/baked/` (`store.ts` + `routes.ts`,
    registered in `main.ts`). Persists a scene-tree JSON (`baked-scene.json`) in
    the **active project's folder** — resolved via the new `getActiveProjectDir()`
    in `runtime.ts` (handles the legacy `main` project) — completely separate
    from `state/graph.json`. Reuses the SAME vendored tree helpers + voxel
    projection the `scene_output` battery uses (`upsertCells` / `setAttribute` /
    `upsertSubtree`; ambient-typed via `baked/vendorScene.d.ts` since the dist
    bundle ships no `.d.ts`), so baked layers render identically to graph layers.
    Routes: `GET/POST /baked/layers`, `POST /baked/sublayer`,
    `PATCH /baked/layers/cells`, `PATCH /baked/move`, `DELETE /baked/layers`,
    `POST /baked/bake`; each broadcasts + logs `[baked] …`.
  - **Renderer** gains a `bakedLayers` store bucket (key `baked:<nodePath>`),
    fed by `useBakedLayers` from the new service. The graph-refresh GC
    (`retainVoxelNodes`/`retainPreviewLayers`) never touches it, so **baking does
    not remove the original Output layer — the two coexist as independent
    layers.** The billboard+asset pipeline renders both buckets through one
    master bake.
  - **Edit mode toggle** (✎, gated to Billboard view + Asset draw mode): paint
    with the AssetStore-selected tile directly on the canvas at **z=0**
    (`screenToEditCellZ0`), optimistic local update + debounced persist. Selected
    paint tile crosses panes via `paintAssetBus` (localStorage + `storage`).
  - **Layers panel split into Editable vs Output.** Editable layers support
    multi-select (click / ⌘-ctrl-toggle / shift-range), **drag-to-reorder** and
    **drag-to-reparent** (drop on a row's top/bottom edge = reorder, middle =
    nest as child; backed by `PATCH /baked/move`), `+ Layer`, `+ Sub`, and batch
    **Delete (N)**. Selected-layer detail is published to the left pane's Preview
    tab via `selectedLayerBus`.
- **"Rules" pseudo-zone in the AssetStore + rule detail in the left pane.**
  Tilemap stitching (autotile) rules — vendored JSON under `assets/rules/` and
  previously only reachable indirectly via a tile's `tileType` — are now a
  browsable category. New backend `GET /api/v1/library/rules` (normalises v1/v2
  rule schema into one `RuleListItem`); the AssetStore zone dropdown gains a
  **Rules** entry rendering metadata cards; selecting one shows its detail
  (schema/ppu/sprites/faces/regions) under the left pane's AssetStore group via
  `rulesApi`'s cross-pane bus. *Why:* rules were invisible in the UI.
- **Edit toolbar in the left pane's Preview tab (collapsed unless editing).** A
  new `editToolbarBus` (localStorage + `storage`, same pattern as the other
  cross-pane buses) carries two facts in opposite directions: the renderer pane
  publishes `editMode` (it owns the ✎ toggle) so the toolbar only expands while
  editing; the toolbar publishes `showGrid` back, mirrored into the render store.
  First tool: **Show grid lines** — an *infinite*, viewport-spanning alignment
  grid (`compose.ts` `drawInfiniteGrid`, cell-aligned to the same origin as the
  content and the coordinate readout, with the col-0/row-0 axes emphasised; it
  bails out when cells get sub-4px to avoid a dense smear). Drawn **last**, so it
  overlays every layer as a guide rather than being hidden behind content.
  *Why:* edit mode needed an alignment aid, and the toolbar gives later edit
  tools a home.

### Fixed

- **Editable layer drag-reorder now stays in the order returned by the baked
  layer service.** The shared path-tree helper no longer alphabetically sorts
  siblings after refresh. *Why:* the backend persists drag order via layer
  versions, and the frontend must not overwrite that order while rendering the
  collapsible tree.
- **The first stroke no longer disappears when changing assets.** Asset mismatch
  no longer calls the async auto-target route from the pointer path; the stroke
  waits for user confirmation and then paints into the newly selected child layer.
  *Why:* first-paint behavior must be deterministic even when a new asset layer is
  needed.
- **Preview object placement no longer lands one billboard cell above the cursor.**
  `frontend/src/renderer/framework/geometry/topBillboard.ts` now defines the edit
  conversion from selected top-face cell + z to voxel coordinates, and object
  sprites anchor to the footprint/front face in
  `modes/topBillboard/buildVoxelMaster/paintCell.ts`. *Why:* the ghost preview
  used the intended cell, but actual object rendering used the raised top face
  (`y - z - 1`), producing a one-row upward offset at z=0.
- **Painting produced nothing visible.** Two causes: (1) the AssetStore published
  the *full alias* as the paint `name`, but the renderer's `matchAssetEntry`
  (fuzzy=false) keys layers by the alias's item-name field — so no asset ever
  matched and asset-mode `paintCell` skip-renders unmatched cells; (2) the
  optimistic store update added cells but never bound the layer's `asset_name`,
  so the sprite couldn't resolve until a backend round-trip. Now the AssetStore
  publishes `name = aliasItemName(alias)` (field 4) and the paint flow
  optimistically binds `asset_name`/`asset_type` on the target layer
  (`bindBakedLayerAsset`), so strokes render immediately.

### Changed

- **Asset Store folder view honours the List view mode.** Picking a taxonomy
  (e.g. By Scene) previously forced a folder grid and ignored the View toggle;
  folders now render as wide list rows in `list` mode — left cover thumbnail,
  folder name + count on top, a sampled content preview below — while `grid`
  keeps the explorer-style cards. See `AssetStoreSurface.tsx`/`.css`
  (`FolderRow`, `.folder-row`).

- **Asset Store taxonomy selector: English, icon-only trigger, per-scheme
  icons.** The "分类方式" dropdown is now English; the titlebar trigger keeps only
  its icon (no inline label) and that icon reflects the active scheme, and each
  scheme renders as icon + label without the explanatory hint (All, By
  Type/Place/Style/Size/Scene), mirroring the View dropdown. New glyphs in
  `library/icons.tsx`; wired in `AssetStoreSurface.tsx`/`.css`.

- **Node Info miniature: English labels in EN mode, live port values, no
  sideways scrollbar.** The selected-battery diagram now honours `langMode` —
  title uses the battery's `nameEn` (falling back to an id-derived label) and
  port rows use the English port name — and each port's lead-out shows its
  *current value* (formatted host-side) instead of the connected peer's
  node/port. The connection wire is drawn **only for actually-connected ports**,
  so unconnected ports with a default value no longer look wired; unconnected
  ports show their value too (kernel falls back to the catalog default). The
  wire's slot is always reserved (painted only when connected) so wired and
  unwired values line up. The layout is **adaptive**: the node card grows to use
  the pane width (gutters bounded to ~26%), each value box fills its gutter, and
  rows grow to fit via a measuring layout effect + `ResizeObserver`. Values
  render as a **kind label + value on two lines** (`grid` / `979×979`, `Value` /
  the number), and **port names wrap at word boundaries** (zero-width breaks at
  camelCase, e.g. `mainRoad​Grid`) instead of truncating. See
  `frontend/src/workbench/SceneGeneratorControlsPanel.tsx` +
  `WorkbenchLeftPane.css`, backed by the kernel `SelectedNodeView`/
  `SelectedPortView` fields below.

- **Preview left tab now uses the Scene Generator controls-panel layout.**
  Edit tools, Selected layer, and Help render as collapsible, resizable sections
  with their own persisted layout state. *Why:* Preview and Scene Generator share
  the same left-pane shell, so their controls should feel like one UI system.
- **Preview edit mode no longer auto-creates asset-mismatch sub-layers.**
  `RenderCanvas` now paints only into an empty/same-asset active layer, or waits
  for `RendererSurface` to confirm a named child layer. *Why:* one editable layer
  should have one clear asset binding, and the user should choose when a new
  asset layer is introduced.
- **Editable baked layers now render through every Preview renderer mode.**
  `frontend/src/renderer/framework/layerKeys.ts` centralises output+editable key
  ordering, and top / billboard / iso / free3d consume the same buckets instead
  of leaving baked layers billboard-only. *Why:* the editable scene tree is shared
  scene-layer data; only the current editing interaction is billboard-specific.
- **Preview Layers panel sections are resizable.**
  `frontend/src/surfaces/RendererSurface.tsx` adds an accessible splitter between
  Editable and Output, replacing the fixed 180px editable-list cap in
  `RendererSurface.css`. *Why:* users need to freely allocate space between
  authoring layers and live output layers.
- **Open / Save relocated into the Projects panel; Save dialog restyled to match
  the pane.** The standalone left-pane Open/Save row is gone. **Open** is now a
  compact icon button immediately right of the Projects "+" glyph (`ProjectPanel`
  `headerActions` slot): it
  imports a JSON as a *brand-new project named after the file* (wrapper `name`,
  else filename sans extension) and opens it via `createProject` → inline import,
  instead of replacing whatever project was open. **Save** is now a per-project
  action button on each project card (`ProjectPanel` `renderProjectActions` slot
  → `ProjectCard` `extraActions`); it activates the target project if needed so
  `getPipeline()` reads *its* graph, then surfaces the re-importable
  kernel-graph-v1 JSON in a copyable modal whose chrome now reuses the project
  wizard/delete palette (accent-green primary `.proj-btn`, muted secondary).
  *Why:* a single global Open/Save was ambiguous in a multi-project pane and the
  modal looked foreign; tying both to projects makes intent explicit and matches
  the rest of the surface. Kernel: `packages/.../chrome/ProjectPanel.tsx` and
  `projectViews.tsx` gain backward-compatible optional slot props only.
- **Ghost preview and object placement honour PPU + anchor.** An object asset
  (no autotile rule) is no longer stretched to the cell: it renders at its real
  size — `imagePx / PPU` cells (PPU from alias field 9) — with its library anchor
  (`anchorX`/`anchorY`) aligned to the cell-footprint centre, drawn once. The
  edit-mode ghost previews exactly that, so what you see is what gets placed.
  Autotile tiles are unchanged (cell-aligned by their rule). `matchAssetEntry`
  now also surfaces `ppu`; `paintCell` gains `drawAnchoredObject`.
- **Baked layer order is now stable across mutations.** Adding a sub-layer (or
  painting an existing layer) no longer shoves the parent to the end of its
  sibling order. Root cause: the vendored `rewriteAtPath` stamps the fresh
  version onto every node on the mutated path, and `projectBaked` orders siblings
  by version. Fix: after a mutation, restore the version of every pre-existing
  node touched (ancestors always; the leaf if it already existed) — only brand-new
  nodes get the appending version (`setNodeVersion`/`restoreAncestorVersions` in
  `baked/store.ts`). This is also a prerequisite for auto-sub-layer painting.
- **AssetStore no longer hard-codes the paint asset's type as `'tile'`.** It has
  no rule metadata; the renderer now derives tile-vs-object from `aliasMetas` at
  paint time, so object props bind `asset_type='object'` instead of being
  mislabelled tiles.
- **Bake preserves the selection's parent/child hierarchy and order.** Baking a
  set of output layers grafts each at its original `nodePath` (intermediates
  auto-created) in DFS order, remapping only a colliding top-level root so
  re-bakes don't clobber existing editable layers. Previously every layer was
  flattened to a top-level node, losing the `/House → /House/Roof` nesting.
- **"Bake" moved from a per-row button to a header "Bake selected (N)" action**
  over the multi-selected Output layers.
- **Baked-layer operation failures now surface in the console** (`[baked] …`
  warnings) instead of being silently swallowed — surfaced during debugging of a
  stale-backend 404.
- **Baked-layer stacking order fixed (was inverted).** The billboard painter now
  draws baked layers in true tree z-order via `orderBakedKeysForRender`: a child
  renders **on top of** its parent, and an upper-listed sibling renders **on top
  of** a lower one (whole subtrees stack as a unit). Previously the panel's
  top-to-bottom order mapped to bottom-to-top on the canvas. Graph/Output layers
  keep their existing order and stay beneath the baked layers.
- **Billboard coordinate readout is now global.** `screenToCell` no longer clamps
  to the content bbox, so the cursor reports a grid cell anywhere on the canvas
  (may be negative) — the grid is just default alignment, not the coordinate
  domain. *Why:* coordinates vanishing the moment the cursor left the painted
  region was confusing; a stable global frame is expected.

### Removed

- **"Drag batteries into the editor and run" canvas empty-state hint.** *Why:* it
  carried no useful information and cluttered an empty preview.
- **Preview toolbar settings (gear) dropdown.** Its only non-redundant control,
  "回正视角" (reset view), is now a direct toolbar button; zoom stays on the
  canvas wheel (centered on cursor). *Why:* the dropdown wrapped one useful
  action behind an extra click.

### Added

- **Open / Save buttons in the left pane — local import/export of the canvas
  graph JSON.** Restores a direct round-trip for the node graph that does not go
  through server-side template files. **Save** reads the live graph
  (`client.getPipeline()` + `client.listGroups()`) and assembles a
  `kernel-graph-v1` payload — the *same* shape the backend `/api/v1/pipeline/export`
  route writes (`{ format, name, graph: { id, nodes, edges, groups?, metadata? } }`),
  so it is re-importable and interchangeable with server templates. The studio
  wraps each plugin pane in a sandboxed iframe **without `allow-downloads`** (and
  sandboxed popups can't escape it), so a programmatic file download is silently
  blocked here; Save therefore shows the JSON in a copyable modal
  (`.scene-left-pane__save` + a Copy button) for the user to save manually,
  rather than a (blocked) download. **Open** uploads a JSON via the browser file
  dialog and imports it **inline** (the backend `/api/v1/pipeline/import` route
  already accepts a `{ format, graph }` body) with `mode:'replace'` after a
  `window.confirm`; the kernel broadcasts `graph:applied` over `/ws`, so the
  canvas + preview refresh live (no manual reload). Buttons reuse the existing
  `editor-controls__btn` style. App-only — no kernel change here: the inline
  import is a new `importPipelineInline` method on the app's `HttpApiClient`, not
  on the kernel `ApiClient` interface. On a rejected import (HTTP 422) it reads
  the body and surfaces the kernel's `reason` + `diagnostics` (e.g. `unknown opId
  'foo'`) instead of a bare status code, so a file referencing ops this backend
  doesn't have explains itself. (The kernel side — exempting the `__relay__` wire
  sentinel from import validation so reroute graphs round-trip — is recorded in
  the root `CHANGELOG.md`.) See
  `frontend/src/workbench/WorkbenchLeftPane.tsx` (`handleSave` / `handleOpen` /
  `onFileChange`), `frontend/src/api/HttpApiClient.ts` (`importPipelineInline`),
  `WorkbenchLeftPane.css` (`.scene-left-pane__io`), and
  `frontend/src/workbench/__tests__/openSave.smoke.test.tsx`.

- **GTA / worldmap scene30 batteries migrated from legacy `wb-scene`.** Ported the
  remaining Vice City pipeline ops (`city_grid`, `coastal_*`, `connected_roads`,
  `road_trim`, `gta_land`, airport/harbor/heightmap/park/remote_island overlays)
  and refreshed existing `gta_*` / `worldmap_render_layers` implementations to
  match `origin/wb-scene` through `3747d58b`.

- **`pnpm dev` HMR launcher (`scripts/dev.mjs`).** Runs the backend
  (`tsx --watch src/main.ts`) and the frontend (Vite dev server, which proxies
  `/api`,`/ws` to the backend via `vite.config`) together — the hot-reloading
  counterpart to `serve` (built dist). Builds `vendor/dist` first if missing
  (the `tsx --watch` path skips the backend `prebuild` that `serve` gets). Both
  halves share one process group so the host can group-kill the watcher tree on
  teardown. The studio `scripts/run.sh` now prefers `pnpm dev` for standalone
  plugins by default (set `FORGEAX_PLUGIN_HMR=0` for the `serve`/dist path), so
  editing plugin/kernel source hot-reloads the iframe instead of requiring a
  rebuild.

### Changed

- **Left workbench controls migrated from the legacy dev branch.** The left pane
  now uses the resizable Projects section plus `SceneGeneratorControlsPanel`
  (History / Data Types / Help) from the standalone scene-generator dev commit,
  while keeping node-editor's newer direct Preview reset-view toolbar behaviour.
  AssetStore chrome also drops the old settings gear in favour of the simplified
  fullscreen-only right cluster.
- **Previewer toolbar slimmed (`surfaces/RendererSurface.tsx`).** Dropped the
  settings (gear) button and its dropdown — including the `- 100% +` zoom
  buttons (canvas wheel already zooms around the cursor, so no capability lost) —
  and promoted **Reset view / 回正视角** to a direct toolbar button in the gear's
  old slot (screenshot · layers · reset-view · fullscreen). Removed now-dead
  state/logic (`showSettings`, `settingsRef` + its outside-click effect, `zoomBy`,
  `zoomPct`, `scale`, `setViewport2d`), unused imports (`zoomViewportCentered`,
  `Settings`/`ZoomIn`/`ZoomOut`), and the orphaned `.renderer-settings-*` /
  `.renderer-zoom-*` CSS. Smoke test updated to assert reset-view is a direct
  button. typecheck clean, smoke 7/7.
- **Kernel source now hot-reloads in dev (no `pnpm -r build` needed).** The
  frontend imported the kernel via package `exports`→`dist`, so editing
  `node-runtime` / `node-runtime-react` only took effect after a rebuild +
  restart. `frontend/vite.config.ts` now adds a dev-only `resolve.alias` mapping
  `@forgeax/node-runtime-react` (`.`, `/editor`, `/themes`) and
  `@forgeax/node-runtime` (`.`, `/layer1`) to their `src/*.ts`, with
  `optimizeDeps.exclude` (serve unbundled) and `dedupe: [react, react-dom,
  reactflow, zustand]` (single React across app + kernel source). `scripts/dev.mjs`
  runs the backend's `tsx --watch` with `--conditions=source` so the kernel's
  new `"source"` export condition resolves backend imports to `src` too — kernel
  edits hot-restart the backend. Both verified live with zero build. `serve`
  (dist) is untouched.
- **Docs realigned to monorepo reality.** Rewrote `ARCHITECTURE.md`,
  `AGENTS.md`, `README.md`, `CONTRIBUTING.md`, and
  `docs/architecture/{backend,frontend,extension-and-contracts}.md` to reflect
  that the kernel is `workspace:*` packages in `packages/*`, not an
  `external/forgeax-wb-node-core` submodule consumed via `link:`. Removed all
  references to `external/`, `kernel:setup`, `kernel:build`, and submodule pin
  SHAs. Updated `docs/architecture/extension-and-contracts.md` to reflect that
  `resolveBatteryScanRoots` lives in `@forgeax/editor-host/backend` and always
  resolves both roots from the monorepo (no fallback probing). Removed dead
  `.gitmodules` + `.cursor/rules/kernel-cascade.mdc` references. Repointed
  acceptance-loop CLI bin to `packages/node-runtime-cli/dist/bin.js`. Hygiene
  `external/` submodule guard removed from `scripts/hygiene-check.mjs`.

### Removed

- **Removed the obsolete `texture_bind` battery (kernel cascade: `f831fe6`).** The
  stale `asset_grid` port type is retired in lockstep with `forgeax-wb-node-core`;
  texture helpers now expose only generic `image` / `dict` outputs and no longer
  advertise a texture-grid binding node.

### Fixed

- **`batteryRoots` loads shared common batteries from `external/forgeax-wb-node-core`.**
  Monorepo / marketplace checkouts pin the kernel under `external/`; the loader
  previously only scanned a sibling `../forgeax-wb-node-core` path (forgeax-studio
  layout), so the `batteries-common` pack was missing. Tries `external/` first,
  then sibling, then plugin `batteries/`.

### Added

- **Saved group batteries default to a GROUPS tab in Develop** (kernel cascade —
  bump `external/forgeax-wb-node-core` to `afd18d0`; see its CHANGELOG Unreleased).
  - The group **Save** button now writes a normal group battery to
    `batteries/groups/<category>/` (was `batteries/templates/`), and
    `GET /api/v1/group-templates` lists **both** `groups/*` (Develop → GROUPS,
    sub-categorized by the save-time tag) and `templates/*` (Templates mode — a
    special curated subset; not every group is a template). `findTemplateFile` +
    `/categories` updated to search/list the `groups/` root too
    (`backend/src/routes/groupTemplates.ts`).
  - Kernel `isTemplateBattery` now keys off the big label (`getBigLabel !==
    'groups'`) instead of an exact `displayGroup` match, so `groups/<cat>`
    batteries stay in Develop with sub-categories while `templates/*` stay in
    Templates mode (backward compatible). This also surfaces the previously
    dormant `batteries/groups/` library (architecture / main / tools / general).

- **Multi-project management in the left pane + per-agent project lock** (kernel
  cascade — bump `external/forgeax-wb-node-core`; see its CHANGELOG Unreleased).
  - The left pane (`frontend/src/workbench/WorkbenchLeftPane.tsx`) now mounts the
    kernel **`<ProjectPanel>`** (cards: switch / create / delete) as its top section;
    it configures its own editor transport + `subscribeProjectActivation()` so it
    stays live with the center editor. The old read-only "Recent projects" list was
    removed (superseded by the interactive panel). The static workflow / preview /
    tips sections are kept.
  - New AI tool **`scene:projects.close`** (release the exclusive lock) +
    backend `POST /api/v1/projects/:id/close` (`backend/src/routes/projects.ts`).
    Open-then-operate: an agent opens (locks) a project, operates, then closes;
    it cannot open a second project until it closes the first, and cannot open a
    project another agent holds. Tool calls forward the caller via
    `x-forgeax-caller-*` headers (`backend/src/tool-handlers.ts`); the activate +
    batch/execute/import routes enforce the lock (`ensureMutationAccess`).

### Changed

- **The canvas top-right "projects" button + modal were removed** in favour of the
  left-pane `<ProjectPanel>` (`frontend/src/workbench/WorkbenchHost.tsx`). *Why:*
  one project-management surface, in the left pane, for both the human and the LLM.

### Fixed

- **`serve` now self-builds missing dist artifacts before boot.** Mirrors the
  lowpoly plugin host contract: a cold checkout with no `frontend/dist` runs
  `pnpm -C frontend build` before serving the bundled UI. Scene keeps its
  existing dist-backed backend path, so a missing `backend/dist/main.js` now
  also runs `pnpm -C backend build` instead of failing with a manual-build
  instruction.

### Changed

- **Asset store de-submoduled → built-in `materials/asset-store/`.** *Why:* the
  asset library was a git submodule pointing at an external repo
  (`dev/assetstore`); that coupled the plugin to a separate repo's
  availability/permissions and complicated clones. It is now a plain in-repo
  directory mirroring the legacy `forgeax-wb-scene` layout (`materials/asset-store/`
  with `library.db` + content-addressed `blobs/`), with **no remaining link to the
  upstream repo**. Removed the submodule from `.gitmodules`/`.git/config`/`.git/modules`,
  dropped the now-obsolete `assets:setup` script, and repointed `ASSET_STORE_DIR`
  in `backend/src/library/db.ts` from `external/asset-store` → `materials/asset-store`
  (the only code path constant; `service.ts` consumes it). SQLite WAL sidecars
  (`library.db-shm/-wal`) stay untracked via the dir's `.gitignore`.
  `external/forgeax-wb-node-core` (the kernel) remains the only submodule; SSOT
  model unchanged. Verified: build:vendor / typecheck / build / hygiene green,
  scene frontend `79 passed`, backend `32 passed`, and the `/api/v1/library/*`
  routes still serve assets from the new path.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `1441ca5`.** Picks up
  the debounced-persist editor change (`schedulePersistSession` + skippable
  `incrementalExecute({ persist:false })`) — the editor half of upstream
  `7bccdc20`. Coalesces persist storms during node/frame drags, panel resizes and
  multi-step canvas edits. Editor-only kernel change; no scene backend/frontend
  source change beyond the submodule pin. Kernel dist rebuilt under `external/`.
  Pin matches the 3d plugin. Verified: scene frontend `79 passed`, backend
  `32 passed`.

- **Kernel cascade: bump `external/forgeax-wb-node-core` → `a2a848e`.** Picks up
  the upstream `wb-scene` editor-parity batch (i18n preview labels `7c1206cd`,
  relay fork-delete `e0c567d7`, relay capsule `09388e3f`, preview-disabled ring
  `b2beda9e`, group-view overlap `1506493a`, port handle z-index `e75d91aa`,
  annotation Ctrl-drag/copy `440da6a5`, the bbox/frame chain
  `3b907c5c`/`0993136a`/`40f27e51`, favorites context-menu affordances
  `51dceee2`, and frame-persistence reconciliation `f3414fe1`). Editor-only
  kernel change; no scene backend/frontend source change required beyond the
  submodule pin. Kernel dist rebuilt under `external/`.

- **Renderer: upstream visualization parity (top mode).** Ported renderer
  changes from the legacy implicit-list upstream (`wb-scene`): `efa4f925`
  (selected layers now draw a thin solid mask outline plus a dashed
  whole-layer bbox to distinguish the two — top mode; the legacy topBillboard
  grid-layer stroke path does not exist here, see note); `c40a7ed0` (multi-value
  `wire` rendering — per-value alpha banding and per-cell outlines on sub-value
  selection — for the GTA zones batteries; the legacy `cellSource` change is a
  no-op for us since our `cellSource` already computes accurate `isMultiValue`
  directly); `b4936837` (preview bridge now also collects grids from
  `any`/`array`/`list` ports so pass-through batteries with dynamic `any`/`tree`
  outputs still render). Frontend-only, no kernel cascade.

### Added

- **Upstream batteries: worldmap + GTA series (`scene30/`).** Ported the
  converged upstream `SCENE 3.0/worldmap`, `gta`, and `gta_cities` battery
  groups (20 self-contained grid ops) from the legacy implicit-list upstream
  (`wb-scene` branch) commits `b4936837` (worldmap group), `0a646ecc` (gta group +
  worldmap fixes), `0cbed07f`/`d47b24f9` (gta main-road), `89136f0f` (gta
  aux-road), `c40a7ed0` (gta zones), `bc92857b` (gta_cities series) into
  `batteries/scene30/{worldmap,gta,gta_cities}`. Ops are self-contained (no
  `_shared`/external imports), no id collisions, and the loader reports the new
  ops with zero new skips. Pure-additive, no kernel cascade.

- **Architecture docs.** Added [`ARCHITECTURE.md`](./ARCHITECTURE.md),
  [`docs/architecture/`](./docs/architecture/) (backend · frontend ·
  extension-and-contracts) and [`AGENTS.md`](./AGENTS.md): a code-grounded map of
  the scene plugin (backend routes/runtime/library/agent, the renderer
  subsystem, the scene domain seam) and a read-before-write protocol.

### Fixed

- **Kernel bump → `483431c`** (cascade). Bumped `external/forgeax-wb-node-core`
  for the deterministic battery scan + first-wins duplicate-id guard. Scene now
  loads `290 ops (0 skipped)` with the `scenealg/*` (`alg_*` id) and legacy
  same-basename ops coexisting deterministically; documented in
  `docs/architecture/extension-and-contracts.md`.

- Bumped the shared editor kernel so grouped nodes persist as real kernel
  groups across live-sync/refetch instead of immediately expanding back to
  member nodes.
- Bumped the shared editor kernel so double-clicking a wire reliably hits the
  ReactFlow edge interaction path and inserts a typed Relay in the browser.

### Added

- Added scene group-template REST support (`/api/v1/group-templates*`) so the
  shared editor can save collapsed groups as reusable template batteries, list
  them in Templates mode, and instantiate them back onto the canvas.
- **Relay double-click parity.** Bumped the shared editor kernel to restore the
  legacy relay interactions inherited by scene-generator: double-click a wire to
  insert a typed relay, double-click a relay node to remove it and restore the
  direct wire when possible.

- **Shared editor chrome.** `WorkbenchHost` now imports `PipelineFileDialog` and
  `ProjectsDialog` from the shared kernel editor package instead of carrying
  scene-local copies. Scene-specific state remains limited to renderer/asset-store
  preview wiring, scene panel renderers, and `scene` project defaults.
- **Shared editor probe / relay affordances.** Bumped the kernel submodule so the
  inherited editor exposes the data-probe toggle directly in the toolbar and adds a
  Canvas quick-search **Relay** entry that creates the kernel `__relay__` sentinel.
  Relay remains kernel/editor infrastructure rather than a common battery pack item.
- **Shared `common` batteries.** The generic number/list/datatree/input batteries
  plus generic grid/annotation preview panels now load from the shared
  `forgeax-wb-node-core/packages/batteries-common` pack instead of living under
  this downstream's `batteries/special/**`. Existing op ids such as
  `number_const`, `range_list`, and `tree_merge` are unchanged, while the palette
  and `/api/v1/ops` now expose them under `common/*` categories. The category
  scanner now accepts multiple battery roots and treats every scan-root top-level
  folder as an automatic palette tab.
- **Keyboard Undo/Redo (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z) is now reversible
  end-to-end.** Inherited from the kernel submodule bump: the shared editor
  (`node-runtime-react`) gained `useCanvasUndoRedo`, which restores the History
  snapshot at the cursor — including the now-visible AI/CLI `batch_applied`
  entries — authoritatively through the kernel (`importPipeline` replace, actor
  `undo`/`redo` → `applyBatch → graph:applied → loadPipeline → reconcile → preview
  refresh`), with `undo`/`redo` marked history-suppressed so restores never loop or
  double-advance the cursor. See the kernel CHANGELOG for the contract.
- Added an end-to-end REST smoke (`scripts/smoke-undo.mjs`, `pnpm smoke:undo`,
  isolated temp root + alt port 9579) proving: an AI batch (`actor:'ai:test'`) is
  applied, UNDO via the canonical import/replace path with `actor:'undo'` returns
  `GET /api/v1/pipeline` to the pre-batch graph, REDO (`actor:'redo'`) moves
  forward, and `undo`/`redo` are history-suppressed.

### Fixed

- **Multi-layer scene assembly produced empty output.** Wiring two `grid2node`
  scene outputs into a `tree_merge` battery yielded empty downstream. Three
  coupled defects fixed:
  - `batteries/special/datatree/tree_merge/index.ts`: the structural-pack default
    branch used `value instanceof DataTree`, which fails across module boundaries
    (the dispatcher's `DataTree` class ≠ the dynamically-imported battery's copy).
    Now uses the same `isDataTree()` duck-type as the item-concat branch.
  - Kernel submodule bump: restores the `tree_merge` `inferredAccess` connect-hook
    in `node-runtime-react`'s `useCanvasConnect` (see kernel CHANGELOG) so
    `access:'item'` scene inputs take the item-concat branch.
  - The correct battery for assembling multi-layer scene trees is **`add_child`**
    (grafts each scene under a parent path), not `tree_merge` (DataTree
    wire-algebra). `tree_merge` now returns an actionable error pointing at
    `add_child` when scene values are wired into it, instead of silently emitting
    empty output.
- Added backend tests (`backend/tests/scene-assembly.test.ts`) covering
  `add_child` + `node_explode`, nested assembly, the `tree_merge` cross-module
  regression, and the scene-misuse guard; plus an end-to-end REST smoke
  (`scripts/smoke-scene-assembly.mjs`, `pnpm smoke:assembly`) proving a
  `grid2node → add_child → scene_output` pipeline yields a 2-child scene and 2
  non-empty voxel layers.

### Added

- **Multi-project management (new/open/delete/switch).** Faithful port of the
  legacy `forgeax-wb-scene` project flow onto the kernel `ProjectRegistry`, with an
  LLM/CLI-callable HTTP API:
  - `GET /api/v1/projects` (list), `POST /api/v1/projects` (create —
    `{ type, name, fromTemplate? }`, fromTemplate resolved against the templates dir
    and seeded via the kernel `importPipelineGraph`), `GET /api/v1/projects/:id`,
    `PUT /api/v1/projects/:id` (rename/update), `DELETE /api/v1/projects/:id`
    (`?assetPolicy=detach|delete`), `POST /api/v1/projects/:id/activate`,
    `GET/PUT /api/v1/workspace`. Registered in `backend/src/main.ts`.
  - **Activate** persists the outgoing project's graph, hot-swaps the active runtime
    to the target project's isolated `state/graph.json` + `history.jsonl` + `outputs/`,
    then forwards `graph:applied` over `/ws` so the canvas refetches live — graph swaps
    reuse the exact `applyBatch`/`loadPipeline → graph:applied → pipelineRevision++ →
    useCanvasGraphSync reconcile → preview refresh` cascade. WS subscriptions re-bind to
    the new runtime (`rebindWsSubscriptions`).
  - **Backfill:** the existing implicit `main` graph at `.forgeax-runtime/state/graph.json`
    is auto-registered as a default project on first run — current users keep their work.
  - Frontend: a `ProjectsDialog` (projects modal + new-project wizard + delete dialog)
    in `WorkbenchHost`, opened from a toolbar button showing the active project name;
    switching remounts the preview iframe and posts `workbench:project-changed` so the
    renderer clears/reloads. `activeProjectType` still filters the battery palette.
  - CLI: `forgeax project list|create|open|delete`.
  - Covered by `scripts/smoke-projects.mjs` (`pnpm smoke:projects`): backfill + two
    isolated projects (graph + history) + activate switching reflected in
    `GET /api/v1/pipeline` + the AI create/open/batch/screenshot path + safe delete.
- **Import a node-connection graph from a file.** Faithful port of the legacy
  `forgeax-wb-scene` `savePipelineAs` / `saved-files` / `load-file` flow onto the
  kernel-batch architecture, with an LLM/CLI-callable HTTP API:
  - `POST /api/v1/pipeline/import` — body is either inline `{ format, graph, options }`
    or `{ file: { path, source }, options }` (server reads from the templates dir).
    `options`: `{ mode:'replace'|'merge', remapNodeIds, idRemap, executeAfter:
    'none'|'downstream'|'full', actor, label }`. Delegates to the kernel
    `importPipelineGraph`, then on success forwards `graph:applied` over `/ws` (so the
    canvas refetches live, identical to `/api/v1/batch`) and, per `executeAfter`, runs
    the affected/whole graph so previews refresh via the existing
    `useNodePreviews`/`exec:completed` path. Replace flows through `applyBatch →
    graph:applied → loadPipeline → pipelineRevision++ → useCanvasGraphSync reconcile`,
    NOT an ad-hoc canvas wipe.
  - `GET /api/v1/pipeline/templates` — scans `<projectRoot>/templates/` and returns
    `{ path, name, source?, format? }[]`. Path traversal is rejected.
  - `POST /api/v1/pipeline/export` — writes the current graph as `kernel-graph-v1`
    (incl. `viewport`/`annotations`/`frames` metadata) to a template file, enabling a
    round-trip (export → re-import → identical graph).
  - **Frontend**: `HttpApiClient` implements `listImportTemplates` /
    `importPipelineFile` / `exportPipelineFile`; `WorkbenchHost` wires the editor
    `Toolbar` `onOpen` / `onSave` to a new `PipelineFileDialog` (open template → import
    → live cascade; save → export).
  - **Headless / LLM**: an agent can `POST /api/v1/pipeline/import` with inline JSON,
    `mode:'replace'`, `executeAfter:'full'`, `actor:'ai:import'`, `label:'…'` to swap
    the canvas + previews live; the `forgeax pipeline import` CLI wraps the same kernel
    function (see kernel CHANGELOG).
  - **Kernel submodule bump** — adds `node-runtime` `importPipelineGraph`,
    `node-runtime-react` `legacyPipelineToOps` + adapter import/export + Toolbar
    `onOpen`/`onSave`, and the `node-runtime-cli pipeline import` subcommand.
  - New `scripts/smoke-import.mjs` (`pnpm smoke:import`, isolated temp project root +
    alt port 9575): imports a saved template (replace, execute full), asserts the
    imported nodes/edges land in `GET /api/v1/pipeline`, a History entry
    (`actor:'import'`) exists, outputs were produced, the export→re-import round-trip is
    identical, and the inline `actor:'ai:import'` path lands + is history-bridgeable.
- **History panel reflects AI/CLI-driven operations.** Programmatic mutations
  (`POST /api/v1/batch` from an AI agent / CLI / another client) now surface in the
  editor's History panel, not just local UI clicks. The `/api/v1/batch` route
  forwards `opts.actor` **and** an optional `opts.label` into the kernel history
  entry, so AI callers can annotate a batch (e.g. `{ actor: 'ai:agent', label:
  'AI: 创建山脉 ×2' }`); the kernel bump (below) adds the history bridge that records
  these committed batches into the editor `useHistoryStore`, while local `editor`
  ops are skipped to avoid double-recording. New `scripts/smoke-history.mjs`
  (`pnpm smoke:history`, isolated temp project root + alt port 9577): POSTs an
  `actor:'ai:test'` batch, asserts `GET /api/v1/history` persists actor + label +
  ops + batchId and that `graph:applied` carries the batchId (the data the bridge
  needs), and that a local `editor` batch is classified as skip-by-the-bridge.
- **Kernel submodule bump** — adds the `node-runtime-react` History bridge
  (`subscribeLiveSync` records non-local committed batches into `useHistoryStore`,
  capturing the pre-batch snapshot and labelling by actor/ops) and the additive
  `node-runtime` `HistoryEntryV1`/`ApplyBatchOptions` `label` field. No regression
  to incremental canvas reconcile, external/LLM live-sync, or tree_merge/add_child
  (see kernel CHANGELOG).
- **Faithful UI replica — kernel bump.** Bump kernel submodule to the faithful
  editor build that adds `Editor` `showRunControl` / `statusBar` props, a wired
  `connectionStatus`, and a battery catalog that honours on-the-wire `category`
  hints.
- **Workbench host** (`frontend/src/workbench/`): legacy-style layout that mounts
  the kernel `Editor` (Run/Stop hidden — the scene generator auto-executes) and
  embeds the renderer + asset-store panes as same-origin iframes, with focus,
  resize, and an aggregated status bar. `App.tsx` routes by `?pane=`.
- **Renderer pane** (`surfaces/RendererSurface`): faithful Preview toolbar
  (view-mode dropdown + Wire/Color/Asset segment), empty-canvas hint, layer side
  panel, screenshot, and WS-driven refresh over the 4-mode render canvas.
- **Asset store pane** (`surfaces/AssetStoreSurface`): zone selector, search,
  grid/list views with per-asset size badges, and centered numbered pagination,
  over new read-only `/api/v1/library/{zones,list}` routes.
- **Battery category projection** (`backend/src/routes/batteryCategories.ts`):
  scans the on-disk `batteries/` tree and re-attaches each op's
  `category`/`displayGroup` to `GET /api/v1/ops`, restoring palette grouping
  (8 big categories: scene30, alg_store, special, components, basic, scenealg,
  scene, ai) that the kernel deliberately strips from `OpSpec`.
- `setLayerVisible` action on the render store for per-layer visibility toggles.

- **Stage-2a (scene battery migration).**
  - Bump kernel submodule to `node-runtime-cli-v0.1.0` (bundles
    `@forgeax/node-runtime` v0.3.0 + the implemented `forgeax` CLI).
  - Vendor `shared/types` under `vendor/` with a `build:vendor` compile step
    (emits `vendor/dist/shared/types/`), so battery `.ts` files loaded via Node
    type-stripping can resolve their `shared/types/index.js` imports.
  - Migrate in-scope scene batteries (copy + import rewrite): `special`, `scene`,
    `scenealg`, plus `scene30`, `basic`, `components`, `alg_store`, `templates`,
    `ai`, `json`, `groups`. Excludes 3D-modeling and image-processing batteries.
  - Headless loop proven: the kernel loader scans the migrated tree with 0 errors
    for the must-run set (`special` except `sort`, `scene`, `scenealg`);
    `pnpm smoke:batteries` runs `executeNode` over the loaded ops; `pnpm accept`
    drives the `forgeax` CLI end-to-end with a deterministic output hash.

- **Scaffold.**
  - Initial scaffold consuming `@forgeax/node-runtime` via git URL dependency.
  - Backend / frontend / batteries / schemas directory skeleton.
  - ForgeaX plugin manifest with split surface layout.
  - Hygiene check, ESLint, Prettier, CI workflow.

### Changed

- **Asset store UI fidelity pass** (`surfaces/AssetStoreSurface.{tsx,css}`): aligned
  the pane to the legacy AssetStore chrome (the design source of truth).
  - Titlebar: replaced the wide plain `<select>` zone field with a compact,
    zone-tinted dropdown (raw→"Ra", staging→"St", …); replaced the plain
    `Grid`/`List` text buttons with an icon-only view-mode dropdown; added the
    legacy settings gear; the search field now lives inside the gear (with a
    clear button and an active-search dot on the gear), and the gear also holds
    the relocated status (zone · total · page · selection) plus a Refresh action.
  - Icons: introduced hand-ported Lucide-style inline SVGs
    (`surfaces/library/icons.tsx`) for the gear, view-mode, fullscreen,
    pagination chevrons, search/clear and refresh glyphs, replacing the prior
    ASCII/emoji arrows and text labels.
  - Grid: dropped the non-legacy checkerboard thumbnail background in favour of
    the legacy solid `--color-bg-secondary` tile, with pixelated image rendering
    and the legacy hover-lift / accent selection treatment.
  - Status/pagination: the bottom bar is now pagination-only (centered numbered
    pages with first/last edges + ellipsis + chevron arrows) and hides on a
    single page; the old "zone · N assets" / "No selection" footer text moved
    into the gear status block.
  - Styling now consumes the shared kernel design tokens (`--color-*`,
    `--radius-*`, `--transition-*`, `--titlebar-height`).
  - Operation logic is unchanged and stays API-backed: zone switch →
    `/api/v1/library/zones` + `/library/list`, search/paging → `/library/list`,
    thumbnails → `/library/serve`; view-mode and selection remain local view
    state. Legacy gear features without a backing route in this read-only backend
    (project filter, upload, batch repair/ops, 13-field review filters, monitor)
    are intentionally omitted rather than shipped as dead buttons.
- **Asset store continuous-scroll pagination** (`surfaces/AssetStoreSurface.tsx`,
  `surfaces/library/{assetStoreStore,pagination}.ts`): replaced the discrete
  one-batch-per-page model with the legacy continuous-scroll model. The store now
  loads the WHOLE active zone (looping the page-capped `/library/list` route in
  500-row batches) into one list; the grid is a single scroll area over every
  asset. `pageSize` is derived from the live viewport (columns × visible rows via
  a `ResizeObserver`, with a window-resize fallback), the page indicator tracks
  scroll position (`setPageFromScroll`), and clicking a page number smooth-scrolls
  to that page's first card (`goToPage` → `pendingScrollToPage`) instead of
  swapping a batch. Scroll vs. programmatic-scroll fights are avoided with a
  short scroll lock. All loading stays API-backed; scroll position / current page
  / pageSize are pure local view state.
- **Renderer/preview UI fidelity + viewport interaction.**
  - **Layers panel is scene-output-only again** (`surfaces/RendererSurface.tsx`):
    removed the `GridLayerRow` that wrongly listed node grid-output previews (e.g.
    `978806ea… 128×128`) in the panel. The panel now lists ONLY `scene_output`
    voxel layers, matching the legacy `LayersSidePanel`, with the legacy empty
    state ("No scene output layers" / "Connect a Scene Output battery to see its
    layers here."). Grid previews still render live on the canvas (the `top` mode
    keeps projecting them via `useNodePreviews`); they are simply no longer listed.
    The canvas empty-state ("Drag batteries into the editor and run") and the
    status layer count still consider both buckets, matching legacy.
  - **Mouse/viewport interaction** restored to match legacy. The host
    `renderer/host/RenderCanvas.tsx` now owns the interaction layer for the 2D
    modes (top / topBillboard / iso): left-drag pan and wheel zoom centered on the
    cursor, both writing the shared `viewport2d` store so every 2D mode benefits;
    `free3d` is left to its own `OrbitControls`. Added a pure, unit-tested
    `renderer/framework/viewport2d.ts` (legacy zoom-around-cursor anchor math,
    nice-step quantization, `MIN_SCALE`/`MAX_SCALE` clamps) plus `panViewport2d` /
    `resetViewport2d` store actions. A top-left overlay shows the cursor cell +
    zoom % readout (legacy `canvas-coords`). Verified `screenToCell`/`cellToScreen`
    still invert the compose transform.
  - **Toolbar fidelity** (`surfaces/RendererSurface.{tsx,css}`): gradient "Preview"
    title, a "Ready" status pill, a scene-layers-panel toggle, a settings gear
    (View zoom −/%/+/reset + Save screenshot), and an icon fullscreen toggle —
    replacing the plain `Reset`/`Shot` text buttons and the ASCII `▾`/`⤢`/`↙`
    glyphs. Hand-ported Lucide-style inline SVGs (`surfaces/icons.tsx`: Layers,
    Settings, Maximize2/Minimize2, ZoomIn/ZoomOut, Home, Camera, Eye/EyeOff, Box,
    ChevronDown) give the legacy icon treatment with no new dependency.
  - **Layers panel row fidelity**: golden-angle value color swatch, node/path
    label, voxel cell count, Eye/EyeOff visibility toggle, hidden-row dimming, and
    a local selection highlight — matching the legacy leaf rows.
  - All styling consumes the shared kernel theme tokens (`--color-*`, `--radius-*`,
    `--spacing-*`). View state (viewport offset/scale, view/draw mode, layers-panel
    open, selection) stays local to the renderer; nothing here mutates graph or
    runtime state. Legacy gear features without a backing API in this build
    (manual refresh / clear-cache / asset-library picker / 3D params / auto-refresh
    toggle) are intentionally omitted rather than shipped as dead buttons.
- **Renderer editor-selection highlight + toolbar height/colour.**
  - **Editor-selection highlight wired end-to-end** (view-only; no graph mutation).
    The legacy renderer learns the editor selection from an `editor:selection` WS
    event → `renderStore.selectedEditorNodeIds`, then strokes the selected node's
    layers green (`SELECT_EDITOR_COLOR`) and highlights their Layers-panel rows.
    This backend emits no such WS event (kernel selection is client-side in the
    host's pipeline store), so the workbench host now reads
    `usePipelineStore.selectedNodeIds` and forwards it to the renderer iframe over
    a new `workbench:editor-selection` postMessage (seeded on iframe load, then on
    every selection change); the renderer mirrors it into a new
    `renderStore.selectedEditorNodeIds`. The highlight is applied across all modes:
    `top` (success-green outline in `compose`, for BOTH voxel layers AND grid
    previews — so selecting a preview battery highlights its grid preview), `iso`
    and `topBillboard` (per-cell green via the master surface inputs + cache key),
    and `free3d` (mesh brighten — its mesh builder has no separate green channel,
    noted as an approximation), plus the green `is-editor-selected` Layers-panel
    row (`RendererSurface.{tsx,css}`).
  - **Screenshot moved to the top toolbar** (`surfaces/RendererSurface.tsx`): the
    (non-legacy, our-addition) screenshot capture is now a `Camera` icon button on
    the toolbar instead of an entry inside the gear menu's Actions section.
  - **Toolbar height & colour matched to legacy** (`surfaces/RendererSurface.css`):
    the Preview toolbar was too tall / off-colour (`6px 8px` padding over
    `--color-bg-secondary`). It now uses the exact legacy values via shared kernel
    tokens — `height: var(--titlebar-height)` (32px, consistent with the editor
    titlebar), `padding: 0 var(--spacing-md)` (12px, no vertical padding), the
    titlebar gradient `linear-gradient(180deg, var(--color-bg-titlebar) #050806 →
    var(--color-bg-titlebar-gradient) #0b120d)`, a `rgba(255,255,255,0.06)` bottom
    border and the legacy drop shadow.
  - **Other parity audit**: implemented selection (above). Intentionally skipped,
    for lack of a data source/API in this build (not legacy-faithfulness gaps in
    intent): the Layers panel's collapsible sink/path TREE with per-value sublayer
    rows + sublayer visibility (the `scene_output` projection yields one value per
    layer key here, so there are no sublayers to nest/toggle); editor-driven
    per-node preview on/off reflected on canvas (legacy `preview:change` WS — not
    emitted here; the per-voxel-layer Eye toggle already covers local visibility);
    and the AI-agent renderer commands (set-view-mode / select-layer / open-all
    sublayers WS) which have no channel on this backend. Hover row highlighting,
    z-ordering by `updatedAt`, and the cursor cell/zoom readout were already
    present.
- **Node editor host chrome fidelity (top-right controls + status).**
  - **`frontend/src/workbench/WorkbenchHost.{tsx,css}`** aligned the kernel-Editor
    host chrome to the legacy editor (the design source of truth), whose top-right
    is just a settings gear + a fullscreen toggle, with embed toggles and status
    living inside the gear menu:
    - Moved the **Render / AssetStore embed toggles** off the top bar and into the
      gear dropdown (kernel's new `settingsActions` slot), rendered as legacy
      `.settings-action-button`s with hand-ported Lucide `Monitor` / `Package`
      inline SVGs — replacing the prior top-bar plain-text `Render` / `Assets`
      buttons.
    - **Fullscreen** now uses the kernel toolbar's Lucide `Maximize2` /
      `Minimize2` control (wired via the new `isFullscreen` / `onToggleFullscreen`
      Editor props) instead of the ad-hoc `⤢` / `↙` glyph button.
    - **Removed the bottom status bar** (`.wb-statusbar`): the legacy editor has no
      status bar and surfaces connection / selection / node-edge counts through the
      gear → Status panel. Embedded Renderer / AssetStore live status now rides into
      that same panel via the kernel's new `settingsStatusExtra` slot.
  - Bump kernel submodule to `dd9ff27` (gear-menu `settingsActions` /
    `settingsStatusExtra` slots + forwarded fullscreen control; faithful 1:1 ports
    of the BatteryBar palette, canvas grid/node cards/edges, minimap and zoom slider
    were already in place and needed no change).
  - **Develop / Templates tabs**: intentionally still not added — the new backend
    has no template system, so a Templates tab would be a dead/empty page; the
    palette stays in its single (Develop) mode and the toggle is omitted rather than
    shipped as a dead control.

### Fixed

- **Dragging in one battery reloaded ALL batteries / fully redrew the preview**
  (regression vs the legacy incremental engine). Root cause was the kernel
  editor's `pipelineRevision`-keyed *blanket* canvas rebuild: every committed
  batch — including a local drag-add's own `incrementalExecute → updatePipeline`
  persist, which the backend broadcasts as `graph:applied` — round-tripped into
  `loadPipeline() → pipelineRevision++ → setNodes(built)`, handing every node a
  fresh object so `memo(BatteryNode)` re-rendered for the whole canvas. The
  legacy editor never blanket-rebuilt on a graph mutation; it only rebuilt on a
  gated session-restore signal and drove local edits incrementally. Ported that
  contract — the canvas now diff-reconciles (`reconcileCanvasNodes` /
  `reconcileCanvasEdges`, in the kernel submodule) so only added/changed/removed
  nodes update and untouched batteries keep their identity (external/LLM/CLI
  live-sync still works). **Evidence:** adding 1 battery to a 24-node canvas now
  rebuilds 1 node object instead of 25 (0/24 unaffected re-render); the kernel
  already scopes execution to the new node's closure (full run = 6 nodes, add =
  1 node executed, 0/6 existing recomputed). Requires the kernel submodule bump.
- **Preview window fully redrew on every graph change.** `useNodePreviews`
  re-pulls every node's output on each `graph:applied` / `exec:completed` and
  re-wrote every layer object, breaking the per-layer subscription contract
  (`useGridLayer` / `useVoxelLayer` are designed so untouched layers keep a
  stable reference). The render store `setPreviewLayer` / `setLayers` now skip
  the write when the re-pulled content is identical, so only the genuinely
  changed region re-renders — the legacy "partial redraw" behaviour. Covered by
  `renderer/__tests__/store.test.ts`.
- **External / LLM-driven graph edits never appeared in the editor** (the
  North-Star "watch the AI work" loop was broken). Two root causes: (1) the
  backend `POST /api/v1/batch` route applied ops but never broadcast a WS event,
  and the kernel bus emits nothing on `applyBatch`, so a batch from any
  out-of-browser actor (CLI / LLM / another tab) produced zero live-sync traffic
  — only the originating browser self-refreshed via a local synthetic event.
  `mutations.ts` now broadcasts a real `graph:applied` RuntimeEvent to every
  connected client after a committed batch. (2) The editor canvas
  (`useCanvasGraphSync`) rebuilt its ReactFlow layer only when
  `currentPipeline.id` changed, but the id is the constant `'main'`, so every
  refetch (with new content, same id) was a no-op. The store now bumps a
  `pipelineRevision` counter on each `loadPipeline()` and the canvas keys its
  rebuild on that (selection preserved across rebuilds).
- **Editor showed an empty canvas after a refresh even though the graph was
  persisted**: on mount `loadBatteries()` and `loadPipeline()` race, and
  `buildCanvasNodes` drops any node whose battery isn't in the catalog yet. When
  the snapshot resolved first, the single rebuild produced 0 nodes and never
  recovered. The canvas now also rebuilds when the battery catalog first becomes
  available. Covered by `canvasGraphSync.rebuild.test.tsx`.
- **Duplicate first page in the Asset Store pager**: for small page counts the
  pager rendered two highlighted "1" buttons ("1 1 2 3 4"). Root cause: the
  centred page window was clamped with `Math.min(centerStart, totalPages-…)`,
  which pulled `windowStart` back to 1 so the always-rendered leading edge "1"
  and the window's first page collided. Replaced the generator with `pageItems()`
  (`surfaces/library/pagination.ts`), which emits each page exactly once — flat
  `[1..n]` for ≤7 pages, else `1 … [window clamped to 2..n-1] … n` — covered by
  new unit tests.
- **Empty preview window**: the renderer only projected `scene_output` voxel
  layers, so wiring up an intermediate chain (e.g. `cellular_noise →
  max_rectangle`) rendered nothing until a scene-output battery was connected —
  diverging from the legacy "watch as you build" preview. Restored the dense 2D
  grid-preview path: a new `previewLayers` store bucket, a `gridLayerCellSource`
  adapter, grid instances in the top render mode, and a `useNodePreviews` bridge
  that pulls every executed node's `grid` output (gated by per-node
  `previewEnabled`, default on) alongside scene-output voxels. The Layers panel
  now lists both grid and voxel layers.
- **Previews crashed / went blank on a NON-EMPTY scene** (`layer.cells is not
  iterable`): `flattenWire` unwraps only one DataTree level, but the kernel
  serializes `scene_output.layers` (`voxel_layers`) and `.names` (`name_list`)
  as `DataTree.fromItem(T[])` — i.e. the whole list is a single item, so the
  wire is DOUBLE-wrapped (`[{path, items:[[ …layers ]]}]`). `flattenWire` then
  returned a one-element array whose element was itself the layer list, and
  `setLayers(… that array)` blew up in the renderer. (Earlier tests only used
  blank scenes, so it was hidden.) Added `flattenWireList` (unwraps the DataTree
  level, then spreads the list-valued leaf) and switched the `voxel_layers` /
  `name_list` call sites (`bridge/useNodePreviews.ts`, `scripts/preview.mjs`,
  `scripts/north-star-loop.mjs`) to it. `grid` stays on `flattenWire` (its
  `fromItem(number[][])` leaf IS the entity and must not be spread), so
  single-wrap grids and double-wrap voxels no longer regress each
  other. Verified against the live 5-node demo scene (`out1`, 380 voxels): the
  preview now renders the real isometric scene instead of crashing. Covered by
  new `flattenWire`/`flattenWireList` unit tests and a non-empty-scene
  `useNodePreviews` regression test.
- **Empty BatteryBar at `:9555`**: caused by `opSpecToBattery` crashing on ops that
  ship no `params` (the whole catalog load rejected). Fixed kernel-side; the
  scene generator now loads all 290 batteries.
- **Editor StatusBar no longer stuck on "Disconnected"** (kernel now drives
  `connectionStatus` from the transport round-trips).
- **Stale preview on node deletion** (`bridge/useNodePreviews.ts`).
  - Deleting a battery/node left its grid/voxel preview on the canvas (stale).
    Root cause: `useNodePreviews` only refreshed on `exec:completed`, and its
    staleness GC (`retainPreviewLayers` / `retainVoxelNodes`) only runs inside
    `refresh()`. Deleting a node with no downstream triggers NO execution, so
    `refresh()` never ran and the orphaned layer was never pruned.
  - Fix: also subscribe to the `graph` channel and re-run `refresh()` on
    `graph:applied`. The backend emits `graph:applied` on every `applyBatch`
    (Layer-2 `apply-batch`) and forwards it over WS, so the renderer iframe
    (subscribed to `graph`/`execution`/`asset`) now re-runs the GC on any graph
    mutation: `listNodes()` is the post-mutation source of truth, so a deleted
    node's grid preview AND voxel layer are both evicted, and a node that loses
    its renderable output (disconnect → empty output) is cleared via the existing
    empty-output `clearLayers` / `retainPreviewLayers` paths. This is the faithful
    analog of the legacy eviction (`removePreviewLayer` + `clearLayers` on the
    `preview:change {remove:true}` delete path, and `clearStale*` on full-exec).
  - Bursts (a delete that also re-executes downstream) are coalesced via a 30ms
    debounce with a single-in-flight guard, so redundant refetches are avoided
    without sacrificing correctness. Live grid-preview-on-connect and the
    editor-selection highlight are unaffected (connect also fires `graph:applied`
    → re-projects; selection is a separate store field/channel).
- **Node editor wire data-probe + annotation parity (kernel)**.
  - Bump kernel submodule to `112c407`: the wire **data-probe** (`ProbeEdge`),
    port tooltips and preview nodes again show real per-connection data. The probe
    reads per-port values from the editor's `nodeOutputs` cache, but nothing
    populated that cache for server-executed nodes (only client-side AI nodes wrote
    to it), so probes rendered the type badge with an empty value. The legacy editor
    fed the cache from a bespoke WS `NODE_OUTPUT` push; the kernel now sources the
    same data through the generic `ApiClient.getNodeOutput(nodeId, portId)`:
    `subscribeLiveSync` listens for `node:output` (fetch + cache the value) and
    `exec:completed` (refresh every connected source port), and a new
    `refreshConnectedOutputs()` seeds the cache from the backend's retained values
    on load and after each graph mutation — so probes update after execution like
    the legacy. Fix lives entirely in the shared kernel editor and stays
    domain-agnostic (the scene-generator host already serves `getNodeOutput` via
    `/api/v1/nodes/:id/outputs/:portId`).
  - Same bump closes a canvas **annotation** parity gap: sticky-note annotations are
    now rebuilt by `buildCanvasNodes` (so they survive a live-sync refetch / reload
    instead of vanishing), and their drag (`moveAnnotation`) and delete
    (`removeAnnotation`) are routed to the store rather than dropped or mistaken for
    graph nodes. Other legacy canvas behaviours (edge colour-by-port-type, marquee
    multi-select with Full/Partial direction, copy/paste, groups + group-view,
    frames, snap guides, ctrl-drag duplicate, double-click search popover, node /
    selection context menus, preview toggle) were already faithfully present and
    needed no change.
