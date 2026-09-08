# 电池/管线领域地图（BATTERY & PIPELINE MAP）— wb-2d-scene-asset-generator

> **这是什么。** 一张专为「**2D 资产生成领域逻辑**」快速定位而生的索引：电池怎么分组、
> 一个 op 怎么从 `meta.json + index.ts` 被加载执行、像素计算/AI 生成这类重活落在哪、
> 数据契约长什么样。它**补齐**已有三件套未覆盖的一层——
> [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) / [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) /
> [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) 讲「前后端怎么连、数据怎么传」，
> **本文讲「领域算子本身在哪、怎么跑、靠谁算」**。
>
> **它不替你判断 bug。** 只给准确地形：电池分组 → 落点文件、执行模型、宿主服务注入点、契约定义处。
> 定位方向自己判断。
>
> **怎么维护。** 新增/删除电池分组、改 op 执行约定、改 `asset2d` 服务签名、改 AI 网关路径，
> **回来改对应条目**（连同该 app `ARCHITECTURE.md` 与 `docs/architecture/extension-and-contracts.md`）。
> 引用带 `file:line`，行号会漂，以「文件 + 符号名」为准。
>
> 所有路径相对本 app 根：`packages/marketplace/plugins/node-editor/apps/wb-2d-scene-asset-generator/`。

---

## 0. 先建坐标系：领域逻辑只有两个落点

这个 app 的领域逻辑（「怎么生成 2D 资产」）**只在两处**，其余全是内核（见
[`apps-overview.md`](./apps-overview.md)）：

| 落点 | 是什么 | 你为什么会来这 |
|---|---|---|
| **`batteries/`** | 文件式电池（op）——画布上每个领域节点的算法 | 改/查「某个节点算错了 / 没输出 / 不在调色板」 |
| **`backend/src/{ai,assets,library,baked,utils}/`** | 电池调不动的重活（AI 网关、PNG 编解码、资产 I/O） | 改/查「图没生成出来 / 抠图错 / 图存哪了」 |

> ⚠️ 画布怎么连线、图怎么拓扑执行、`applyBatch`、电池怎么被扫到——**全是内核**（`packages/node-runtime*`），
> 不在本 app。那类问题去根 [`ARCHITECTURE.md`](../ARCHITECTURE.md)。

---

## 1. 电池分组地图（`batteries/<bigTag>/<smallTag>/<id>/`）

内核 loader 以 `flexible` 布局递归扫 `batteries/`（`runtime.ts:66-72`），每个含 `meta.json` 的叶子目录注册成一个 op。
本 app 的领域电池按**四大组**组织（另有内核 `@forgeax/batteries-common` 的 45 个通用 op 自动并入）：

| 组（`bigTag`） | 子组（`smallTag`） | 干什么 | 代表 op id |
|---|---|---|---|
| **`ai/`** | `providers` / `relevant` / `data_trans` | AI 生成与文本处理 | `image_gen`、`text_gen`、`name_list_gen`、`promptDealer`、`grid_value_to_mask` |
| **`helper/`** | `data_transform` | 辅助类纯数据转换算子（无图/无 AI） | `grid_json_to_size`（网格 JSON→灰度图宽高，每格 16px） |
| **`image/`** | `basic` / `processing` / `tiles` / `cliffs` | 图像源/预览 + 像素后处理 + 拼瓦/无缝/地形/悬崖 | `image_source`、`image_preview`、`image_output`、`image_resize`、`image_remove_bg`、`image_atlas_compose`、`make_seamless_moisan`、`image_seamless_poisson`、`image_terrain_extract`、`cliff_atlas_extract` |
| **`pipelines/pcg/`** | — | PCG 素材批量生成管线（由原 Python `pcg_generation` 重构为 TS） | `pcg_parse_input`、`pcg_parse_asset_list`、`pcg_generate_run_csv`、`pcg_match_assets`、`pcg_process_image`、`pcg_filter_image`、`pcg_judge_remove_holes`、`pcg_update_total_csv` |
| **`pipelines/dec_house/` · `pipelines/ui_items/`** | — | 装饰房/UI 物品的领域管线节点 | `dec_semantic_partition`、`ui_load_prompt` |

> 精确电池清单与数量会随代码漂移——**以 `GET /api/v1/ops` 实际返回 + 文件树为准**，不在本文写死数字。
> 想要一份「给 AI 编排 pipeline 用」的电池目录，看 `skills/compose-scene-pipeline/battery-catalog.md`（注意那是**运行期操作指南**，不是开发地图，见 [`apps-overview.md`](./apps-overview.md) §4）。

### 1.1 共享算法 helper（电池之间复用，非 op）

| 文件 | 提供什么 | 谁用 |
|---|---|---|
| `batteries/image/_shared/asset2d.ts` | `processImage` / `processImages` / `copyImage`——把电池 `image` 输入解码 → 跑纯像素 transform → 编码落盘，包装宿主 `ctx.services.asset2d`（§3） | 所有要碰像素的 image/pcg 电池 |
| `batteries/pipelines/_shared/{csv.ts,png.ts}` | PCG 管线的 CSV / PNG 工具 | `pcg_*` 电池 |

---

## 2. 一个电池的执行模型（op 怎么从文件变成画布上的一次计算）

```
扫描期（后端启动一次）
  runtime.ts:buildSharedOps() → createBatteryLoader(scanDirs).scan()
    → 每个 batteries/.../meta.json  → metaToOpSpec（OpSpec 契约）
    → 动态 import 同目录 index.ts   → 取小写命名的导出函数作 execute
    → registry.replace；日志 "loaded N ops (M skipped)"   runtime.ts:74
  dev 下同一 loader 起 chokidar watch：改 meta/index 热重载 + 广播 ops:changed（runtime.ts:49-58/75-79）

执行期（一次 POST /api/v1/execute，内核驱动）
  内核拓扑排序 → 对每个节点调它的 index.ts 导出函数：
    fn(input: Record<string,unknown>, ctx) → outputs: Record<string,unknown>
    input  = 各输入端口的值（端口 name → 值）
    ctx    = { services: { asset2d: {...} }, ... }   ← 宿主在 runtime.ts 注入（§3）
    outputs= 各输出端口的值（端口 name → 值），写入内核 outputs 缓存
```

**电池作者铁律**（呼应该 app `AGENTS.md` 与 `extension-and-contracts.md`）：

- `index.ts` **只导出一个小写开头的入口函数**，签名 `(input, ctx?) => outputs | Promise<outputs>`。
  入参/出参都是 `Record<string, unknown>`，**key 必须与 `meta.json` 的端口 `name` 对齐**。
  例：`pcg_parse_input/index.ts:89` `pcgParseInput`、`pcg_process_image/index.ts:46` `pcgProcessImage`。
- **import 内核只能按包名** `@forgeax/node-runtime`，**禁止**深相对路径进 `packages/`（hygiene 会拦）。
- op `id` = `meta.json.id`，**保持稳定**（图迁移后才解析得到 op；同 basename 重名见 `extension-and-contracts.md` 的 `scenealg` 注记）。
- 电池**只做编排/纯算法**；重型像素计算与 AI 调用**委托 `ctx.services`**（§3），别在电池里直接读写磁盘/发网络。
- 失败**返回 `error` 端口字符串而非抛异常**（成功置空串），是本 app 电池的统一约定。
  例：`pcg_parse_input/index.ts:92/97/103`、`asset2d.ts:44/47`。

### 2.1 `meta.json` 关键字段（定位时常看）

| 字段 | 含义 | 例 |
|---|---|---|
| `id` / `label` / `name-en` | op 唯一标识 / 中英标签 | `image_gen` / `AI 图像生成` |
| `inputs[] / outputs[]` | 端口名 + `type`（`string/number/json/image/...`）+ `access`（`item`/...） | ImageGen `meta.json:12-48` |
| `params[]` | 节点上的可编辑参数（非连线输入） | `image_source/meta.json:42-59` |
| `projectTypes` | 限定项目类型（本 app 为 `asset2d`） | `pcg_parse_input/meta.json:10` |
| `manualTrigger` / `autoIterate` | 节点是否带手动 Run 按钮 / 是否参与自动迭代 | `image_gen/meta.json:10-11` |
| `frontend.nodeType` | 用本 app/内核哪个画布节点渲染器 | `image_source/meta.json:28-30` |
| `tags` / `tag_labels` / `alg_tag` | 调色板分类与检索词 | 各 meta 末段 |

> ⚠️ **契约不在 `schemas/`**：该目录基本是空占位（见 [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) §4）。
> `OpSpec` 真正定义在内核 `@forgeax/node-runtime` 的 `layer1/types/op-spec.ts`。

---

## 3. 宿主服务注入：电池调不动的重活在哪

电池是纯/轻的；**像素计算与 AI 生成**由后端经 `createExecutionContext` 注入到 `ctx.services`，
电池通过 `ctx.services.asset2d.*` 调用。注入点**唯一**：`backend/src/runtime.ts:122-203`。

| `ctx.services.asset2d.*` | 干什么 | 后端实现落点 |
|---|---|---|
| `decodeImage(image)` | ImageRef → 解码 RGBA | `runtime.ts:134-138` → `utils/png_codec.ts:decodeImageBytes` + `assets/generatedAssets.ts:readImageBytesFromRef` |
| `processImage(image, opts, transform)` | 解码 → 跑纯像素 `transform` → 编码 → 落盘，返回新 `image` alias | `runtime.ts:139-167`（编码 `utils/png_codec.ts:encodePng`，落盘 `assets/generatedAssets.ts:writeProcessedImage`） |
| `processImages(images, opts, transform)` | 多输入版（如 atlas 合成 terrain+template） | `runtime.ts:168-200` |
| `copyImage(image, opts)` | 复制/重命名一张图到 processed 区 | `runtime.ts:127-133` → `copyGeneratedImage` |
| `generateImage(input)` | **AI 文/图生图**，见 §4 | `runtime.ts:201-202` → `ai/imageGeneration.ts:generateImageAsset` |

> **定位提示**：电池报 `asset2d.processImage service unavailable`（`asset2d.ts:47`）= 跑在没注入 services 的环境（如脱离 runtime 的单测）；
> 报 `image not found` / `decode failed`（`runtime.ts:145/150`）= 输入 ImageRef 解析或 PNG 解码出错，去 `assets/generatedAssets.ts` + `utils/png_codec.ts`。

---

## 4. AI 生成链路（图/文都经 Studio 网关，不在本仓直连模型）

本 app **不直接调 Gemini**；统一打到 **forgeax Studio server 的 `__ce-api__` 网关**，由它选 vendor/model。

```
图：electric image_gen 节点 Run 按钮 / 下游执行
  → 后端 POST /api/v1/ai/image            ai/routes.ts:28
  → generateImageAsset(rt, {...})          ai/imageGeneration.ts:52
  → 解析参考图 alias→base64                ai/imageGeneration.ts:36-50（readGeneratedAsset / parseImageRef）
  → POST <studio>/__ce-api__/generate-image  imageGeneration.ts:60
        studio base = FORGEAX_STUDIO_API_BASE_URL > FORGEAX_SERVER_URL > 127.0.0.1:18900（:22-28）
  → 结果 base64 → importGeneratedImage 落 assets 库（folder 'ai'）  imageGeneration.ts:75-83
  → 手动触发时 writeNodeOutput(rt,nodeId,'image',alias) 写回输出缓存  ai/routes.ts:51-53
        （这样下游增量执行直接 hydrate，walker 不重复触发 image_gen——见注释 :45-50）

文：POST /api/v1/ai/text → POST <studio>/__ce-api__/gemini-text   ai/routes.ts:60-87
```

> **定位提示**：图生不出来先分三段排查——
> ① 网关地址对不对（看 `FORGEAX_STUDIO_API_BASE_URL` / server 是否在 18900）；
> ② 网关回了什么（`StudioImageResponse.error` → 后端转 502，`imageGeneration.ts:71-73`）；
> ③ 落盘成功但下游没拿到 → 看手动触发的 `writeNodeOutput` 是否带了 `nodeId`（`ai/routes.ts:51`）。

---

## 5. 资产数据落到哪（生成图 vs 只读素材库，别混）

领域产物的存储分两套（与 [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) §5 同一事实，这里从**电池/生成视角**复述）：

| 体系 | 谁写 | 落点 | 读写性 |
|---|---|---|---|
| **generated-assets**（AI 生成 + 像素处理产物） | `image_gen` / `asset2d.processImage` 等 | runtime 项目目录的 assets（`assets/generatedAssets.ts`） | 可写 |
| **只读 library**（内置素材库） | 离线导入，app 代码**绝不写** | `materials/asset-store/{library.db,blobs/}` | 只读（`better-sqlite3` readonly） |

> ImageRef 在电池间以「`{alias,blobId}` JSON 或 data URL」字符串流动（`image_source/meta.json:48`），
> 由 `parseImageRef` 解析（`ai/imageGeneration.ts:2` import）。看到 image 端口里是这种串就对了。

---

## 6. 速查：领域问题三连定位

1. **「某节点算错/没输出」** → 找它的 op id（画布或 `/api/v1/ops`）→ `batteries/<...>/index.ts`（算法）+ `meta.json`（端口/参数契约）。先看它是否返回了 `error` 端口（§2 铁律）。
2. **「图/文生不出来」** → §4 三段排查（网关地址 / 网关响应 / 写回 nodeId）。
3. **「抠图/缩放/拼瓦像素错」** → 电池 `index.ts` 只做编排，真算法在它传给 `asset2d.processImage` 的 `transform` + 后端 `runtime.ts` + `utils/png_codec.ts`。

> 若问题其实在「画布连不上线 / 执行顺序 / 改了参数没重算 / 撤销重做」——那是**内核**，不在本文，去根 [`ARCHITECTURE.md`](../ARCHITECTURE.md)。

---

## 7. 索引导航

| 你想看 | 去 |
|---|---|
| 前后端怎么连、数据走 REST/WS/iframe 哪条通道 | [`wb-2d-wiring-index.md`](./wb-2d-wiring-index.md) |
| 前端某区域由后端哪里驱动 | [`wb-2d-frontend-map.md`](./wb-2d-frontend-map.md) |
| 后端有哪些 REST/WS 端点、契约在哪定义 | [`wb-2d-backend-map.md`](./wb-2d-backend-map.md) |
| 文件树 + 「改 X 看哪」反向索引 + 加电池/加 mode 步骤 | [`../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md`](../apps/wb-2d-scene-asset-generator/ARCHITECTURE.md) |
| 电池/op 加载契约细节、`scenealg` 重名注记 | [`../apps/wb-2d-scene-asset-generator/docs/architecture/extension-and-contracts.md`](../apps/wb-2d-scene-asset-generator/docs/architecture/extension-and-contracts.md) |
| 给 AI 编排 pipeline 的电池目录（**运行期**操作指南，非开发地图） | [`../apps/wb-2d-scene-asset-generator/skills/compose-scene-pipeline/`](../apps/wb-2d-scene-asset-generator/skills/compose-scene-pipeline/) |
