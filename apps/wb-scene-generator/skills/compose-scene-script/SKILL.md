---
name: compose-scene-script
description: 用米制、多模块 Scene Script 和项目 Generator 设计、修改并验收完整场景。
---

# Scene Script 原生创作

## 设计模型

场景是空间关系，不是物件清单。先确定体验、入口与目的地、地貌骨架、区域角色、主路径、地标、密度梯度和必要留白，再选择表示。

Terrain → Regions → Routes → Parcels → Blockout → Geometry → Materials → Dressing → Review 是复杂场景的依赖启发式，可以合并或按垂直切片推进，不是后端阶段机。上游应输出下游可消费的真协议；例如道路是连通 `RoadNetwork`，放置是受约束 `PlacementSet`。

世界坐标使用米。`basePlane` 定义范围，`workGrid.cellSize` 定义采样精度；改变精度不得移动设计几何。Scene Script 与 Generator 源码是作者真值。

## 三路创作分流

1. 小而可见的静态步骤：在 `.scene.ts` 使用声明式调用、`choose` 或小规模 `repeat`。
2. 无主题的通用空间操作：使用合同中公开的平台原语。
3. 场景专属求解、循环、搜索、几何、优化或大量实例：创建一个 `.generator.ts`，通过 `defineGenerator` 暴露真输入输出协议。

一个 Generator 解决一个算法问题，使用显式 seed、稳定排序和可解释参数。`run` 只在沙箱中执行；合同由静态 `defineGenerator` 读取。允许从 `@forgeax/project-generator`、其 `sdk` / `geom` 入口和项目内 `.generator-lib.ts` 导入。

`.scene.ts` 只负责组合。入口保留唯一 `sceneOutput`。推荐按语义层拆模块，并把对设计有意义的数值、Curve、Region 和 Grid 暴露成 Control Surface。

## 地形表示

地面是连续 Mesh，不是俯视色块。

- 地形：height Grid（`valleyHeightfield` 或 Generator 输出）→ `heightfieldMesh` → `meshSceneNode`。
- `gridSceneNode` 只做占用/分区叠加。删掉 scaffold 的 `heightfieldMesh` 等于没有地形。
- 评审用 Default 或 `3DMesh`。`top` 视角的 voxel 色块是分区图，不能当作地形完成。

## 紧凑工作循环

1. 找到并打开项目。记住 `projectId + projectRevision + 目标文件 revision`，恢复时优先复用，不要重新 list/open/get bootstrap。读取入口或目标文件；`scene:script.get` 同时返回紧凑 manifest、依赖和语义大纲。已知 revision 时必须传 `ifRevision`。相同 revision 的重复读取只会返回短提示。
2. 只在需要精确签名时读取合同；`defineGenerator` 可直接按名称查询。`scene:script.references` 只用于迁移参考场景的不变量和协议。
3. 新模块、新 Generator 或跨文件协议修改使用 `scene:script.commitProject` 原子提交相关文件。它会编译并执行同一 revision；编译或运行失败时 Renderer 保留 last-good。
4. 已有 statement 的参数、连接或局部结构修改，先用 `scene:authoring.lens` 取得有界源码与一跳影响，再用 `scene:authoring.applyCommands` 提交 `AuthoringCommand`。不要为局部修改回传整个项目。
5. `scene:script.draft` 只用于高风险算法替换或视觉调参；不是每次提交的前置门。
6. 根据返回的 `SceneDiagnostic` repair slip 修复 `file/span/statementId/operation` 指向的问题。使用 semantic diff 和 invalidated modules 判断脏闭包，不用节点图猜影响。
7. 用 `scene:script.verify` 检查 source、artifact、execution 与 Renderer 是否对齐当前 revision。截图是视觉评审证据，不是固定完成收据。连续只读且 revision 未变时，下一步只能是 mutation、verify，或明确报告 blocker。

## 验收

通用验收只包括：合同与编译通过、唯一可达 `sceneOutput`、无 runtime failure、执行和 Renderer 对齐当前 revision、last-good 状态清楚。

再按输出协议做领域验收：

- `RoadNetwork`：入口与目的地连通，层级、坡度和障碍约束成立。
- `ParcelSet` / `PlacementSet`：规模、边界、间距、朝向和用途约束成立。
- Terrain / Mesh：范围、采样和可见几何一致；`meshLayers > 0`。占用 voxel 色块不算地形完成。
- Control Surface：参数变化使预期下游失效、重编译并产生可见响应。

最终判断还要满足用户 brief 和视觉 review。非空、mesh 数、截图或某个设计阶段单独都不能宣告完成。

## 边界

不操作底层节点、端口、Graph JSON、Runtime Graph 或存储文件；不读取平台源码；不靠 validate 探函数名；不通过新建替代项目绕过诊断。只询问会改变场景类型、规模或核心体验的问题。
