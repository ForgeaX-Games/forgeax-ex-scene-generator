# GTA 电池组

该小分类用于放置 GTA / 开放世界城市地图相关电池。电池目录仍保持自包含：每个电池自己的 `index.ts` 内包含所需辅助函数，不依赖 `_shared` 或兄弟电池目录。

当前电池：

1. `gta_roads`：从国家/陆地轮廓生成 GTA 风格城市路网（中心环路、主干路、片区网格街道）。
2. `gta_mainroad_zones`：保留旧版 `gta_zones` 逻辑，作为当前效果稳定的 `gta_main_roads` 前置约束底图。
3. `gta_zones`：新版城市规划功能区，基于地形分析、规划锚点和区域生长生成完整商业/住宅/工业/绿地/郊区片区。
4. `gta_main_roads`：可接入 `landGrid` 以整片陆地作为主路通行范围，基于外围锚点、陆地连通块极值锚点、片区锚点、距离海岸的内缩环线和高度成本寻路生成连续主干路，并把主路组件接回最大骨架。
5. `gta_aux_roads`：基于新版功能区和主路骨架生成三类辅路：城市片区肌理、绿地/海岸轮廓路、核心区高速连接；最后校验接入主路。
6. `gta_local_roads`：在住宅/商业地块内补小路，并对最终路网做连通性修复。
7. `gta_buildings`：在道路划分出的地块中放置方盒子建筑。

基础流程可用 `gta_roads` 替代 `worldmap_roads`：把 `landGrid/countryGrid/heightMap` 接入 `gta_roads`，再把它的 `roadGrid` 接到 `worldmap_render_layers.roadGrid`。

当前主路效果若需要完全保持，建议使用稳定流程：`gta_mainroad_zones -> gta_main_roads -> gta_aux_roads -> gta_local_roads -> gta_buildings`。其中 `gta_mainroad_zones` 是旧版 zones 的保留版，专门服务当前满意的主路骨架。

新版城市规划流程建议使用：`gta_zones -> gta_aux_roads -> gta_local_roads -> gta_buildings`，或在确认主路适配后再切换为 `gta_zones -> gta_main_roads -> ...`。新版 `gta_zones` 不再逐格噪声分类，而是先把山地/水岸/陡坡作为绿地缓冲，再在可开发连通块内放置商业核心、工业港区、住宅和郊区锚点，通过地形代价区域生长生成完整片区。
