---
name: compose-scene-script
description: 用 Scene Script 写递归场景树：选定操作几何，执行脚本，展开子结构。
---

# Scene Script 原生创作

流程真值见 [`docs/scene-generation.md`](../../../../docs/scene-generation.md)。

Agent 写 TypeScript，对选定的操作几何执行脚本，展开成更细的结构。
这些脚本互相引用，长成一棵大规模场景树。
平台只提供可调用的库、可视化投影、以及足够清晰的编译/运行反馈。

## 写什么

> [!IMPORTANT]
> 专注场景建模和环境设计，包括地形、建筑、道路、植被、道具及空间布局。禁止制作人物、NPC、玩家角色及其他角色模型，包括简化人群和用于表现比例的人形。通过摊位、商品、招牌、家具和环境布置表现生活气息。

`.scene.ts` 组装和引用。
Agent 可以在任意 `.ts` 里写求解器；`.generator.ts` 只是常见落点，不是「求解职责」。
平台库是逐步减负。模糊事实靠 Authoring warning / error，不要只写在提示词里。

编写可复用的建模操作前，根据场景需求查看相关电池。建筑开间、柱列和围栏可以参考 `allocateSpans`、`segmentRun`、`localFrame`、`fitAnchor`；地形可以参考 Grid 噪声、`geometryMask`、`heightfield`、`heightfieldMesh`；地面接触和贴地路径可以参考 `sampleHeight`、`sampleSurface`、`placeOnGround`、`liftToSurface`、`surfaceBand`。只阅读与当前设计有关的函数及其依赖。

源码可访问时，在提供的工具包中按函数名定位 `scene.contract.ts`，阅读同目录的 `index.ts` 及其引用的实现，相关算法通常位于 `_shared/`。源码仓库入口为 `apps/composition/batteries/`；独立安装包入口为 `modules/composition/batteries/`，其中入口文件为编译后的 `index.js`。同时参考相关示例和测试，确认参数、返回值、单位和坐标约定。

适合直接使用的函数通过 `@forgeax/scene` 调用。需要调整算法时，可以选取相关代码，在项目自己的 `.ts`、`.generator.ts` 或建筑样式 `.scene.ts` 中改写，包含必要依赖、保留适用声明，使用项目相对路径引用，并验证坐标、随机种子、返回类型和错误处理。自主编写几何、求解器和设计规则同样重要，可以与库函数及改写的代码自由组合；根据设计质量选择，不要求工具数量或复用比例。源码不可访问时继续使用公开函数和项目代码。相关模块统一经过场景执行和导出验证。

从 `@forgeax/scene` 导入第一批库：`point2d`、`basePlane`、`polyline2d`、`spline2d`、`polygon2d`、`network2d`、`point3d`、`polyline3d`、`spline3d`、`polygon3d`、`network3d`、`geometryMask`、`createGrid`、`gridFill`、`gridGradient`、`gridDiamondSquare`、`gridMidpoint`、`hashNoise`、`valueNoise`、`valueCubicNoise`、`perlinNoise`、`openSimplex2Noise`、`openSimplex2sNoise`、`cellularNoise`、`gridAdd` / `gridBlur` / `gridDilate` / `gridErodeMorph` / `gridSlope` / `gridThreshold` 以及其余 Arith / Filter / Morph / Derive、`gridComponents` / `gridZonalMean` / `gridStats` / `gridDistance` / `gridResize`、`heightfield`、`heightfieldExplode`、`heightfieldSetMask`、`heightfieldMesh`、`box`、`transform`、`placeOnGround`、`liftToSurface`、`surfaceBand`、`sampleHeight`、`sampleSurface`，以及 Scene 标签下的 `emptyScene`、`sceneNode`、`addChild`、`sceneOutput`。
可以用普通 `if` / `for` / helper。不要写 `choose` / `repeat`。
`point2d({ x, y })` 是平面站点。`point3d({ x, y, z })` 是世界站点，不要在 2D kind 上偷填 z。平面只是世界米框。`polyline2d` / `spline2d` / `polygon2d` 是曲线或区域；payload kind 仍是 polyline / spline / polygon。`network2d` 是节点 + `{ from, to }` 边，不是曲线袋子。3D 对应 `polyline3d` / `spline3d` / `polygon3d` / `network3d`，点必须带 z。都不带宽度或用途。要选区就 `geometryMask({ plane, geometry, columns, rows, width?, feather? })`，吐一张 0–1 Grid；宽度和羽化写在这一口上。街、楼、高架是消费这些几何的 `.scene.ts`，不是平台路工具。贴地道路模块写断面并 `surfaceBand`；高架模块端点落地、跨中写梁板栏杆和墩柱，上层选定 network 再调用。不要把 `surfaceBand` 当路本身。站点是另一块操作几何，不是 `subPlane`。
`createGrid` 只出 `number[][]`。采样噪声写 `perlinNoise({ columns, rows, frequency, … })`，不要 `gridNoise.perlin`。同格场运算写 `gridAdd` / `gridBlur` / `gridDilate` / `gridErodeMorph` / `gridSlope`。分区 / 区统计 / 格距 / 改划分写 `gridComponents` / `gridZonalMean` / `gridDistance` / `gridResize`。Filter / Morph 的 `radius` 是格（1–16），不是米；`gridSlope` 是 Δvalue/格，不是度/米；`gridDistance` 是格距（到不了是 `1e9`）；噪声 `frequency` / `scale` 是下标空间。要用米就先换算：`Math.max(1, Math.round(metres / (plane.width / columns)))`。归一化用 `gridStats` + `gridRemap`，不要另找 `gridNormalize`。不要给电池加单位开关。`gridErodeMorph` 不是水力侵蚀。侵蚀、山 / 岛菜谱写在 `.generator.ts`。Grid 不能挂进 SceneTree。
`heightfield({ geometry, height, mask?, attributes? })` 绑成一份区域 + 划分 + 高度 + mask + 具名属性 dict。mask 默认全 1。Heightfield 不是 mesh，不能挂进 SceneTree。Default 把 `plane + height` 织成地形 overlay；包上 mask 不是缺省全 1 时画红晕。
`heightfieldExplode({ heightfield })` 拆开数据包。下游只吃 Grid 的核从这里取 `height` / `mask` / `attributes`（dict）。
`heightfieldSetMask({ heightfield, mask })` 只换包上的 mask，带走其余通道。不同格就 `{ error }`。
`heightfieldMesh({ heightfield })` 把包里的 `plane + height` 织成 Geometry `kind: 'mesh'`。顶点 Z 和平面 UV（0–1）与 `sampleHeight` 同一套双线性。mask 不打洞。进 SceneTree 必须 `sceneNode({ geometry: mesh })` 再 `sceneOutput`。
`box({ width, depth, height })` 是局部 mesh，原点在底面中心。建筑规则写在项目 `.ts` 里拼局部几何；场景里调函数、给参数、放到位置。
`transform({ geometry, x, y, z, yaw? })` 把局部原点放到世界坐标，偏航绕 +Z，保持竖直。
`placeOnGround({ geometry, heightfield, x, y, yaw?, offset? })` 把 mesh 底面贴到同一份 `sampleHeight` 上。投放循环仍用 `sampleHeight`，不要为每个点长一个图节点。
`liftToSurface({ geometry, surface })` 把 2D 操作几何竖直升到 Heightfield，吐匹配的 3D kind。保住 network 节点下标。场外 `{ error }`。
`surfaceBand({ mesh, geometry, width, widths?, metric?, offset? })` 把贴在 hangable mesh 上的 3D 骨架按宽度做成 Minkowski 带宽：自己算偏移点、织独立网格，再把顶点落到曲面上。不要剪输入三角网。宽度是这个口上的米。不是 road kind。
`sampleHeight({ heightfield, x, y })` 读同一份包的高度通道。投放贴地用它，不要另写一套高度函数。这是查询，不会变成图节点。
`sampleSurface({ surface, x, y })` 返回 `{ point, normal, uv, face }`。同样不上图。
用 `sceneNode({ name, geometry, structure?, part? })` 把 Geometry 挂成 SceneTree 节点。几何只有一份 `Geometry`，用 `kind` 区分。道路结构用 `structure: 'road'` 加上 `part: 'pavement' | 'shoulder' | 'girder' | 'pier'` 标注，Authoring 才能找到并检查路面是边连通的一块三角网 / 16 m 弦坡度。不是新 Geometry kind。操作几何：point2d / plane / polyline / spline / polygon / network，以及 point3d / polyline3d / spline3d / polygon3d / network3d。可挂：mesh / voxel。新形状加 kind，不要再写 Mesh / Voxel / Road 平行类型。`addChild` 挂任何 SceneTree：叶子或模块树。入口再 `sceneOutput`。宿主 `{ error }` 会失败这次 run。
verify / `verification.ok` 只表示脚本跑通且失败类空间门没响。必须看 Default。
不合理：退化的操作几何（`SCENE_GEOMETRY_DEGENERATE`）、两份挂上的 mesh 穿模比过高（`SCENE_MESH_INTERSECTS`）、地上物在地形 XY 外或 Y 反号（`SCENE_GROUND_MISALIGNED` / `SCENE_FRAME_MISALIGNED`）、道路路面不是边连通的一块三角网（`SCENE_ROAD_PAVEMENT_SPLIT`；一个 network 不能按边分段织网）、16 m 弦坡度 ≥ 35%（`SCENE_ROAD_GRADE_FAULT`，带世界米坐标）。
`SCENE_Z_CLEARANCE` 只报离地数据；高架和隧道合法。诊断会写出名字、文件行号、AABB / 穿模比。
`SCENE_NOT_ON_GROUND` 表示底面没坐在 `sampleHeight` 上；本意贴地就 `placeOnGround`。
`SCENE_NOT_ON_SURFACE` 表示 3D 操作几何 XY 在场内但 authored Z 不在采样面上；本意贴面就 `liftToSurface`。Default 把 2D 曲线贴到 Heightfield 上，3D 曲线画在 authored Z，不再贴一次。
`SCENE_ROAD_UNMARKED` 表示只有 `role: 'road'`、没有 `structure: 'road'`。`SCENE_ROAD_GRADE` 是 18–35% 的坡度警告，同样带坐标。
不要写 `numberValue()` / `textPanel()` / `booleanValue()`。
不要调用 `composeHeightfield`、`subPlane`、`fieldComposite`、`meshSceneNode`、`grid2node`。
没有 `sceneOutput`、或 `sceneOutput` 拿到空树，仍可 authoring；跑完会收到 `SCENE_OUTPUT_INCOMPLETE`：任务没结束。Heightfield 包没挂进 SceneTree 会收到 `SCENE_HEIGHTFIELD_NOT_IN_SCENE`：下一步 `heightfieldMesh` → `sceneNode` → `sceneOutput`。嵌套模块只导出树。落盘真值是 `.scene.ts`，不是 Graph JSON。视觉验收只看 Default，不要追 heatmap 或 `verification.ok`。
单口函数返回值本身：`point2d` / `point3d` / `basePlane` / `createGrid` / `valueNoise` / `heightfield` / `heightfieldSetMask` / `heightfieldMesh` / `box` / `transform` / `placeOnGround` / `liftToSurface` / `surfaceBand` / `emptyScene` 的 `const` 就是 Geometry / Grid / Heightfield / mesh / SceneTree。不要写 `origin.geometry`、`hills.grid`、`emptyScene().scene`。多口才取字段：`heightfieldExplode`、`gridBBox`、`gridStats`、`sceneNode.scene`。可以嵌套单口调用，例如 `heightfield({ height: valueNoise({ columns, rows }) })`。具名 `const` 仍有利于图上认线。

每个 `.scene.ts` 先选操作几何。
然后执行脚本，展开成子区域和子结构。
子结构仍是 `.scene.ts`，继续引用。

不操作底层节点、端口、Graph JSON 或 Runtime Graph。
不通过新建替代项目绕过诊断。

## 怎么提交

打开项目后直接写设计。
记住 `projectId + projectRevision`。
读取时已知 revision 必须传 `ifRevision`。

新模块用 `scene:script.commitProject`。
已有语句的局部修改，先用 Authoring Lens，再用 `scene:authoring.applyCommands`。
`scene:script.draft` 只用于高风险试跑，不是每次提交的前置门。

每次提交后阅读 `diagnostics`。
error 会回滚。
warning 时结果已上屏。
若已有新 `projectRevision`，随后只有 `channel-error` 或 `SCENE_EXECUTE_SUMMARY_CHANNEL`，源码已经落盘。
`scene:script.verify` 只确认脚本跑通且空间门没响。看 Default（透视 + 俯视）。对得上 brief 才算完成。
需要三角网资产再 `scene:export.glb`。
体素场景不必为了验收再织一层 mesh。
