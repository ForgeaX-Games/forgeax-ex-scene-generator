# Layered territory（多层场景项目）

Continent → Valley → Plaza。每个文件只写 **自己底板的局部米**。

现网可编译版本用已有电池（`rectangularGrid` / `defineGroup` / Alpine 白盒）。`basePlane` / `workGrid` / `extractPlane` / `place` 落地后，把大陆 `place(valley, { at: [960, 960] })` 接上即可。

合同：[产品设计 20](../../../../../../../../../../scene-generator-design/20-world-frame-and-work-grid.md)、[21](../../../../../../../../../../scene-generator-design/21-layered-territory-template.md)。

Default 里用 Layers / Effects 的 **全局标架** 看世界米网格；场景里的 ContinentFrame / ValleyFrame / PlazaFrame 是底板矩形，不是作业 `grid` 场。
