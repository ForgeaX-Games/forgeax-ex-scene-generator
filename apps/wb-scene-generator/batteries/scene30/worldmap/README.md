# Worldmap 电池组

该组电池把 `generate_scene_by_steps/plugins/world_map` 的流程拆成可串联的 Scene Generator TS 电池：

约束：该目录下每个电池必须自包含，不使用 `_shared` 目录，也不从兄弟电池目录导入工具函数；需要的网格、噪声、绘制、寻路等辅助逻辑应保留在各自电池的 `index.ts` 内。

1. `worldmap_height`：高度图与早期海陆预览。
2. `worldmap_land`：海平面阈值与海岸平滑。
3. `worldmap_countries`：按陆地连通块分配种子，再用地形代价区域生长生成连续国家区域。
4. `worldmap_boundaries`：国界与海岸线提取。
5. `worldmap_cities`：首都与主要城市放置，所有城市只占 1 个格子且必须落在陆地上；城市总数包含首都，小于 `minRegionArea` 的小区域不会生成城市，大区域可按面积容纳多个城市。
6. `worldmap_roads`：城市间连续自然曲线路网，先用轻量候选边构建连通网络，再对最终边做 `heightMap + landGrid` 地形代价寻路，经路径抽样和 Chaikin 平滑后映射到网格；默认关闭城市局部十字小路，跨海部分单独输出 `tunnelGrid` 海底隧道层。
7. `worldmap_road_smooth`：道路后处理平滑，可选 `close_gaps`、`majority`、`continuous`，补齐断缝并输出平滑后的 `roadGrid/tunnelGrid`；默认使用细笔刷，避免路口变粗。
8. `worldmap_render_layers`：合成 renderer 可直接显示的分层输出。

推荐连接顺序：`rect_grid.grid -> worldmap_height.grid -> worldmap_land.heightMap -> worldmap_countries.landGrid -> worldmap_boundaries.countryGrid`，同时把 `heightMap` 也接入 `worldmap_countries.heightMap`，国家边界会更倾向沿高地与地形梯度弯折。再把 `heightMap/landGrid/countryGrid` 接到城市与渲染分层节点，最后把 `landGrid + cityPoints + heightMap` 接到道路节点；道路输出建议先经过 `worldmap_road_smooth`，再把平滑后的 `roadGrid/tunnelGrid` 接入 `worldmap_render_layers`。
