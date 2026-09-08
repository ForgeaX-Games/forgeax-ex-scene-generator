# village_idyll-2026-05-19T20-39-47

新格式地图 bundle。本目录内的文件可**独立渲染和查询**，不依赖老版本数据。

> 结构对齐策划三文档：`terrain-design.md` / `scene-object-design.md` / `object-type-classification.md`，
> 工程补充见仓库 `design_docs/terrain/0-world/REVISION-terrain-format.md`（当前 = 修订 1～10）。

## 文件清单（策划 §四 文件组织：terrain.json + terrain-config.json + object-type-config.json，本工程额外补 atlas + viewer）

| 文件 | 说明 |
| --- | --- |
| `viewer.html` + `viewer.js` | 可视化浏览器页面（通过启动器脚本打开） |
| `serve.py` / `serve.sh` / `serve.bat` | 本地 HTTP 服务器启动器（三选一，见下） |
| `terrain.json` | 场景主文件：`cells`（15649 格：e-99=448 / e-2=1609 / e0=3472 / e1=6757 / e2=3355 / transition=8）+ `objects[1019]` |
| `terrain-config.json` | 地形模板配置（33 个 template，含 `placement: deterministic` 桥/坡模板） |
| `object-type-config.json` | 对象类型配置（140 个 typeId，其中 pickup 7 个，玩法元数据合并到 `pickup` 子结构 — 修订 10） |
| `terrain_atlas.png` + `.tsj` | 地形 atlas 贴图 + tile 索引（含 pivot/collider；桥/坡已切片为 sub-tile） |
| `object_atlas.png` + `.tsj` | 对象 atlas 贴图 + tile 索引（pickup 已 2× 上采样到 PPU=32） |

## terrain.json 结构（修订 8.3 + 修订 9 + 修订 9.1 + 修订 9.2）

```jsonc
{
  "version": "2.0",
  "cols": <W>, "rows": <H>,
  "cells": {
    "-2":         [ /* MapCell, MapCell, ... 1D 扁平数组，按 (y, x) 升序 */ ],
    "0":          [ ... ],
    "1":          [ ... ],   // 桥面 cell 落在这里（template_id="bridge_stone_01" / "bridge_wood_01"）
    "transition": [ ... ]    // ★ 修订 9：坡的过渡层，每个 cell 自带 `slope` 子结构
  },
  "objects": [ /* ObjectInstance 数组，已按 (layer, y, x) 排好，渲染端直接按顺序绘制 */ ]
}
```

每个 cell 形如：

```jsonc
{
  "x": 65, "y": 51,
  "height": 1,                                      // 修订 9.1：cell 固有高度，组内一致
  "template_id":   ["bridge_stone_01"],
  "graphic_index": [4],
  "areaTags": ["area_L0/area_L1/..."]
}
```

- **`cells` 是分组字典**（修订 9.2）。当前导出按"高度 + 过渡层"分组，每组 key 是 `"<int>"` 或 `"transition"`，值是该组的 1D 扁平 cell 数组（按 `(y, x)` 升序）。不再做 `worldH` 长度的稀疏 2D 包裹，避免大量空 row 出现在 JSON 里；
- 同一 (x, y) 在不同 group 上可同时存在 cell（**渡河石桥/木桥所在的格子在 `cells["1"]` 是桥面，在 `cells["0"/"-1"/"-2"]` 仍是水**）；
- **MapCell 自带 `height` 字段**（修订 9.1）。组内 `height` 一致：数字层 == key 数值，过渡层 == `slope.elevationHigh`。`height` 是 cell 固有属性，与"分组方式"解耦——引擎/编辑器不必先解析 key 再推高度；
- **导出的 cell 仅是"显示的有效 cell"**（修订 9.1，与可视化一致）：当某格在 E 与 E+1 都有 cell 时，E 层默认剔除该格；但若该格位于 E+1 mask 的"上边缘"（北侧无 E+1 cell），则 E 层保留。桥（悬空结构）已豁免该筛选，所以桥下方水/沙 cell 仍出现在 E0/-1/-2；
- 桥模板 `bridge_*` 的 `placement = "deterministic"`，按 `cell.graphic_index` 直接取 `graphic_id[idx]`，无随机变体；
- **`cells["transition"]`（修订 9）** 承载坡 cell；该层 cell 必含 `slope: { direction: "ns/sn/ew/we", elevationLow, elevationHigh }`，第一字母是低端方向、第二字母是高端方向（低 → 高）；坡 cell **不属于任一 elevation**，但 `height = elevationHigh`（视觉所在层），同 transition 分组的 cell `height` 也一致；引擎在玩家进入时按"上一步在哪一端"决定记到 elevationLow 还是 elevationHigh；
- viewer 顶部"过渡"按钮高亮过渡层、其他层半透明；点击坡 cell 会显示"坡 SN E0→E1"专属 tab，列出 4 向 direction、低/高端、模板与 sub-tile 详情。

## 打开 viewer.html

浏览器在 `file://` 协议下禁止读取同目录文件（CORS / unique security origin），所以**不能直接双击 viewer.html**。本目录同时提供了启动器脚本，三选一：

| 平台 | 操作 |
| --- | --- |
| Windows | 双击 `serve.bat` |
| macOS / Linux | 终端里 `./serve.sh`（首次需 `chmod +x serve.sh`），或双击 |
| 任意平台 | `python3 serve.py` |

启动器会在若干候选端口（8765, 18765, 28765, 38765 …）里挑一个可用的绑定，成功后自动打开浏览器。Windows 上的 `WinError 10013` 通常是 Hyper-V/WSL 保留端口导致的，脚本会自动跳过，无需手动调整。

想强制指定端口：

```
python3 serve.py 12345      # 任意平台
serve.bat 12345             # Windows
```

若没有 Python，也可以用任意 HTTP server 指向该目录：

```
cd new-version-default-20260426-031046
npx serve -l 8765     # Node.js（换端口即可避开占用）
php -S 127.0.0.1:8765
```

按 `Ctrl+C` 停止服务。

## 坐标与 PPU 约定

- 所有 `pivot` / `collider` 坐标：**归一化 [0,1]**，原点图像左下，Y 轴向上
- 地形瓦片、场景对象：PPU = 16（美术 16px/cell）
- 拾取物（interaction=pickup）：PPU = 32（atlas 中已 2× 上采样；美术 32px/cell）
- CELL_SIZE = 64（屏幕渲染像素/格）
- 资产缩放 = CELL_SIZE / PPU（地形/对象 ×4，拾取 ×2）

生成时间：2026-05-19 20:39:47 +0800
