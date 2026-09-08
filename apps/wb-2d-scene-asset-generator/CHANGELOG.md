# Changelog — `wb-2d-scene-asset-generator`

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

### Changed
- **Release identity now belongs to the Scene Generator package.** This app is published inside `@forgeax-extension/scene-generator` as the `2d-assets` module; it is no longer an independently published npm package. *为什么：* the three workbenches share one product lifecycle.

- **Comment on group-template instantiate names the project-scoped batch path.** `backend/src/routes/groupTemplates.ts` now says it does not route through `POST /api/v1/projects/:projectId/batch`. *为什么：* the leftover unscoped `/api/v1/batch` comment contradicted the live write entry.
- **Aligned architecture maps with 42 domain batteries, 45 common ops, and project-scoped batch.** `README.md` / `ARCHITECTURE.md` / `docs/architecture/{backend,extension-and-contracts}.md` / `AGENTS.md` now describe `POST /api/v1/projects/:projectId/batch` via `registerProjectPipelineRoutes` and mark `mutations.ts` as an empty stub. *为什么：* docs still copied scene-generator's ~276+32 and unscoped `/api/v1/batch`.

### Fixed

- **Windows 安装路径修复覆盖全部已发布的 2D batteries 预览图。** 将 `dechouse_gen`、`image_to_image`、`text_to_image` 与 `filter` 中仍含提示词和运行 ID 的 7 个 PNG 文件统一改为目录内的 `preview.png`。*为什么：* 0.2.4 只修复了首次报错的 `tile_gen`；IDE 的全包 preflight 随后暴露了第二个 261 字符路径，说明必须按发布包整体扫描，而不能逐个修最终安装错误。
- **Windows 桌面安装不再被模板预览资源的生成式长文件名阻断。** 将 `batteries/templates/pipelines/(pixel)tile_gen/` 下包含提示词、节点 ID 与运行 ID 的 89 字符 PNG 名改为稳定的 `preview.png`，并同步 `_gen_image.alias`。IDE 的统一 product-runtime 路径 preflight 会在编译和 NSIS 打包前扫描所有扩展包及递归生产依赖。*为什么：* 生成时的描述性别名泄漏进 npm 包，在 `%LOCALAPPDATA%\\ForgeaX Studio\\resources` 下超过 Win32 `MAX_PATH`，此前只有最终安装时才暴露。
- Removed duplicate `asset2d:templates.list` and `asset2d:templates.get` declarations while retaining the richer existing descriptors (`forgeax-plugin.json:487`). Duplicate IDs caused the entire Scene Generator package, including Sino, to be rejected. Regression: `scripts/release-tools.test.mjs:9`.
- **Slug-root `package.json` no longer declares `workspace:*`, so Studio `bun install` can install this directory.** `@forgeax/node-runtime` stays `workspace:*` on `backend`/`frontend` only. Tests: `scripts/standalone-plugin-dependencies.test.mjs`, `scripts/serve-dist.test.mjs`. Cold start: `scripts/dev.mjs` / `serve-dist.mjs` call `ensureWorkspacePackages`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* Studio `prepare.ts` bun-installs the marketplace symlink to this slug root and cannot be changed this round.
- **Correction: `file:` in this app's `package.json` is not the install path.** The Unreleased bullet below that switched `@forgeax/node-runtime` to `file:../../packages/node-runtime` for Studio `bun install` is superseded. Apps keep `workspace:*`; Studio installs `@forgeax-extension/2d-scene-asset-generator` from `release/`. SSOT: [`docs/development-and-release.md`](../../docs/development-and-release.md). *为什么：* relative `file:` dies outside this tree; mixing a pnpm workspace member with a Bun-installable extension already failed twice.
- **Standalone installs no longer depend on pnpm's workspace protocol.**
  `package.json` now resolves `@forgeax/node-runtime` through the repository-local
  `file:../../packages/node-runtime` path, so Studio's direct `bun install` can
  install this plugin. Regression: `scripts/standalone-plugin-dependencies.test.mjs`.
  *为什么：* Studio installs a plugin directly rather than through pnpm's
  workspace resolver.
- **Vite dev 默认端口改回 9575→9577（此前误抄 3d-lowpoly 的 9565/9567）。**
  `frontend/vite.config.ts`：`VITE_DEV_PORT` 默认 9575、`VITE_API_TARGET` 默认 `http://localhost:9577`。
  *为什么：* 脱离 `bun fx start` 单独 `pnpm dev` 时会与 lowpoly 抢端口或代理到错误后端，iframe 空白。

- **用户「保存到模板」的小标签失效——保存路径补一层「模板文件夹」使其与内置模板同构。**
  此前 save-user 写到 `templates/My templates/<smallTag>/<name>.json`，与扁平内置模板结构相同，
  前端 `getTemplateSmallLabel` 把 `<smallTag>` 误判为模板文件夹 → 小标签丢失。现改写到
  `templates/My templates/<smallTag>/<name>/<name>.json`（`backend/src/routes/groupTemplates.ts` save-user），
  与内置 `templates/{大}/{小}/{模板}/file.json` 同构，小标签恢复；删除路径自下而上清理变空目录。
  *为什么：* 模板支持二级标题后，用户模板因少一层目录被误判，小标签整体失效。

### Added
- **`/api/v1/group-templates` 列表返回模板的 `version` / `author` / `createdAt`，供前端 Templates 行展示。**
  `backend/src/routes/groupTemplates.ts`：`collectCatalogItems` 从模板 JSON 顶层读 `version`（缺省 `1.0.0`）、`author`、`createdAt`（缺省回退文件 mtimeMs）；
  `GroupTemplateBattery` 接口同步新增 `author?` / `createdAt?`。保存路径（`/save`、`/save-user`）经新增 `stampTemplateMeta` 把 `version`/`createdAt`（缺省 `Date.now()`）落盘进模板 JSON（已有值保留）。
  *为什么：* 模板列表要显示版本、作者、制作时间，需后端从模板 JSON 读取并在保存时持久化。

### Changed
- **Workbench manifest migrated to the Page contract.** `forgeax-plugin.json`
  now contributes one Page, one reusable panel type, explicit sidebar/workspace
  placements, and a horizontal left/right Page layout instead of `provides.workbench`
  split metadata. *为什么：* panel availability and position must have one Page-owned SSOT.
- **`scene_asset_pixel` 电池强化 2.5D 纯俯视视角约束**：新增核心约束第 6 条 + 独立「视角要求」段 + 验收勾选项，强制**只可见顶面与正面、绝不可见左右两个侧面**，禁止 3/4 斜角/等距/透视露出侧壁。`prompts/scene_asset_pixel.json`。
  *为什么：* 资产需与 2.5D 俯视场景无缝摆放，侧面露出会与场景透视冲突；此前模板未约束视角，模型常默认出 3/4 视角。

### Added
- **新增 4 条四方连续/俯视场景提示词电池**（A 组），提炼自 `Four_Way_Seamless_Scene_Assets` skill 的 Prompt Inserts，落到 `prompts/`（builtin 只读，小标签 `four_way_seamless`）：`material_seamless`（无语义地表四方连续材质）、`decal_sprite`（平躺地面语义贴花，不可平铺）、`modular_tileset`（可对齐拼接结构 tile）、`prop_sprite`（透明底俯视独立道具）。画风做成 `[style]` 变量、视角做成 `[view]` 变量，纯提示词不掺运行时 metadata；每条都内置 skill 的路由防混淆约束（语义物禁入材质、贴花禁平铺、tile 禁烘焙 prop、prop 禁烘焙地面）。
  *为什么：* 把 skill 里散落的提示词范式固化为可拖拽电池，复用 skill 的"分类路由 + 防烘焙"经验，避免 agent 每次重写提示词导致语义物被平铺等已知翻车。`vars` 经校验与模板 `[占位符]` 解析逐一一致（端口生成正确）。
- **新增 3 条横版 side-scroller 提示词电池**（B 组），提炼自 `2D_sidescroller_assets` skill 的 Prompt Templates，落到 `prompts/`（builtin，小标签 `side_scroller`）：`parallax_background`（三层视差背景，左右无缝、无独特天体/地标、无可站立地面条）、`side_platform`（纯正侧视薄板浮空平台，禁 3/4 透视）、`side_prop`（横版装饰物）。画风用 `[style]` 变量、可去底背景用 `[source_background]` 变量（绿色系→magenta/hot-pink 的选色规则留待 C 组/用户填充），纯提示词。`vars` 经校验与模板占位符一致。
  *为什么：* 与 A 组同源思路，把横版侧视相机的背景/平台/道具范式固化为电池，内置 skill 的无缝平铺与纯侧视防错约束。
- **新增 1 条前景抠图源图背景色规则电池**（C 组），提炼自 `Foreground_AI_Matting_Workflow` skill，落到 `prompts/`（builtin，小标签 `matting`）：`foreground_matting_bg_rule` 输入主体描述 `[subject]`，输出"生成前按语义选源图背景色"指引（绿色系→magenta/hot-pink、glow→black、其他→green/高对比纯色）+ 源图生成要求 + 仅 AI 抠图/RGB 中和/不无限重试的验收。作为可注入 A/B 组各 sprite `[source_background]` 的跨切面片段。
  *为什么：* 抠图背景色选择是 A/B 两组透明类资产共用的前置决策，单独成片段便于复用，根治绿色主体被绿底误删等已知抠图翻车。

### Changed
- **`generate-2d-asset` skill 的"触发生图"步骤重写，根治 agent 把 `pipeline.execute` 当触发器用而全流程翻车的问题。** 实测复盘（Mira 真实运行 + 直连后端复刻）确认：模板链「实例化→喂参数→生图→后处理」整条**后端完全可跑通**（已端到端产出 32×64 绿萝：`out_4` 贴图 PNG、`out_5` 碰撞 mask、`out_7` 几何 `{object_height,collision_mask,pivot}`），唯一卡点是 **skill 没讲清"触发生图只能用 `generation.generateImage({nodeId})`"**——agent 误用 `pipeline.execute` 去触发组内 `image_gen`（manualTrigger 按设计被跳过 / 组内节点顶层寻址不到 `target node not found`），便误判"没有触发工具"并放弃模板。
  `skills/generate-2d-asset/SKILL.md`：明确「触发生图 = `generation.generateImage({nodeId=runButtons[].nodeId})` = 点 Run」，新增「⛔ 三条死路」表逐条列出 Mira 走过的错误触发路径及其"按设计如此、非 bug"的原因；铁律 2 强化为"生图唯一入口"，并澄清 asset_generation 不接参考图 = 合法文生图（此前"几毫秒空转"是误用 execute、非缺参考图）。
  **并补上正确节奏：生图前后各跑一遍管线**——第 3 步 `execute({})` 预热（把喂进的常量算进上游缓存，否则 `generateImage` 按缓存解析会拿到空参数）→ 第 4 步逐个 `generateImage` → 第 5 步 `execute({})` 跑后处理；`pipeline.execute({})` 该跑但永不出图。
  *为什么：* 经验证后端触发机制（`generation.generateImage` 跨组解析内部 `image_gen`）正确且可用，问题纯在 skill 表述；故只改文档、不动后端。

### Changed
- **`generate-2d-asset` skill 重写为「操作模板电池」**（不再手搭单个电池）。`skills/generate-2d-asset/`：
  `SKILL.md` 改为五模板路由表 + 通用操作流程（`groups.list/get` 发现模板组 → 连常量电池喂暴露 `in_N` → 对 `runButtons` 里每个内部 image_gen 调 `generation.generateImage` → `pipeline.execute` → 读暴露 `out_N`）+ 铁律；
  每个模板一个子文档 `templates/{asset_generation,conceptual_scene_design,dechouse_gen,tile_gen,ui_item_gen}.md`（列各自暴露端口的**稳定 `in_N`/`out_N` 端口名 + 含义 + 喂什么** + Run 数量）。
  端口名稳定（随模板固化），agent **照子文档连线、无需逐实例查对外端口**；只有 `groupId` 与 `runButtons.nodeId` 是运行时值，从 `groups.list` 取。SKILL.md 另加「模板在哪儿」（仓库 `batteries/templates/pipelines/` + 编辑器 Templates 栏）与「多 image_gen 必须串行」。
  删除旧的手搭文档 `battery-catalog.md`/`pipeline-schema.md`/`tile-pipeline.md`/`notes/common-base.md`/`executions/part-a|b|c.md`。
  *为什么：* 五套流程已固化为画布上的组合电池（模板），agent 应只操作模板而非逐电池连线；配合本次新增的 `groups.list/get`。

### Added
- **新增 MCP 工具 `asset2d:templates.list` / `asset2d:templates.get` / `asset2d:groups.instantiateTemplate`，让 agent 能自己把模板组放上画布（不必等人拖入）。**
  此前 `groups.list/get` 只看见画布上**已实例化**的组——空画布时 agent 拿不到任何模板，skill 只能「提示用户拖入」，agent 无法自主操作模板。现补齐两条能力：
  ①**库发现**：`templates.list`（转发 `GET /api/v1/group-templates?scope=templates`）列出随插件发布的 5 套模板 + 用户模板的 `id/name/category`；`templates.get` 读单个模板完整定义（`exposedInputs/Outputs` 即 `in_N/out_N` 端口契约）。均剥离内联预览图（`stripInlineImages`）。
  ②**一步实例化**：`groups.instantiateTemplate` 转发新路由 `POST /api/v1/group-templates/:id/instantiate`——读模板 JSON → `buildTemplateOps` 重映射内部 node/edge/group id（同模板可重复实例化不冲突、对外 `in_N/out_N` 端口名稳定）→ 盖 `__groupIsTemplate` provenance → 一条原子 `applyBatch` 落地为一个 `__group__` 顶层组节点，返回运行时 `groupId` + 端口清单供接线。
  新增 `backend/src/lib/templateOps.ts`（`buildTemplateOps`/`splitTemplate`，与 `wb-scene-generator` 同名 lib 及 CLI `node-create-template` 保持等价）；路由加在 `backend/src/routes/groupTemplates.ts`（复用 `findGroupFile`/`readGroup`/`categoryFor`/`templateRoots`，经 `ensureMutationAccess` 走同一把 per-agent 项目锁）；三工具声明于 `forgeax-plugin.json`。
  配套把 `skills/generate-2d-asset/SKILL.md` 的操作流程从「等用户拖入模板」改为「`templates.list` 发现 → `groups.instantiateTemplate` 自实例化 → `groups.get` 取 runButtons → 喂入参 → 触发 → execute → 读产出」，并更新 id 来源铁律（`groupId` 取自 instantiate 返回、`runButtons.nodeId` 取自 `groups.get`，禁止手拼展开模板）。
  *为什么：* 把 `wb-scene-generator` 早有的 `templates.*` + `instantiateTemplate` 通路移植到 2D app，补齐 agent 自主操作模板的最后一环。验证：`backend/tests/templateInstantiate.test.ts`（4 项，含把内置 `conceptual_scene_design` 模板实例化进 app runtime、断言 `__group__` 影子节点 + 稳定 `in_N/out_N` 端口 + 同模板二次实例化不撞 id）；既有 `tool-handlers`/`group-templates` 测试不受影响。
- **新增 MCP 工具 `asset2d:groups.list` / `asset2d:groups.get`，让 agent 能像人一样驱动画布上的组合电池（模板组）。**
  `backend/src/tool-handlers.ts` 两个工具转发已存在的只读路由 `GET /api/v1/groups`、`/api/v1/groups/:id`：
  `groups.list` 返回每个组合电池的 `id/name/exposedInputs/exposedOutputs` 及 `runButtons`；`groups.get` 返回单个组的完整（去内联图/`_gen_*` 大字段）定义 + `runButtons`。
  `runButtons` 复刻前端 `GroupNode.tsx` 外侧映射 Run 按钮——**组内每个 `manualTrigger` 电池（image_gen/text_gen）各出一个可单独触发的入口**（`{nodeId, opId, kind:image|text}`），
  agent 据此对内部节点 id 调 `generation.generateImage` 即与人点外侧 Run 走完全相同的后端路径（`ai/routes.ts` 的 `findNodeWithGroup` 跨组解析）。
  *为什么：* 此前 `pipeline.get` 只返回顶层 nodes/edges，组合电池内部的 `image_gen` 节点 id 既不可见又在实例化时被重映射，agent 无法定位并触发模板组的内部生图。
  `forgeax-plugin.json` 声明这两个工具。验证：`backend/tests/tool-handlers.test.ts` 新增用例（建 text_panel→image_gen 组合电池，断言 `groups.list/get` 暴露端口齐全且 image_gen 出一个 `kind:image` 的 runButton），3 项全过。
- **`image_atlas_compose` / `cliff_atlas_extract` 新增 `enable` 开关输入端口（bool，默认 true）。** 端口为 false 时跳过加工、所有输出端口返回空（execute 顶部 `if (!enable) return {}`，先于必填校验/IO，故关闭时即使未连源图也不报错）；默认开，行为与原先一致。`batteries/image/tiles/image_atlas_compose/{meta.json,index.ts}`、`batteries/image/tiles/cliff_atlas_extract/{meta.json,index.ts}`。*为什么：* 便于在流水线中按条件门控这两步重计算。
- **新增 helper 电池 `tile_type`（Tile 种类下拉框）。** `batteries/helper/tile_type/`：输入端口 `tile`（带 `options` 下拉：floor / cliff / forest / flower_bed / tilemap / slope，默认 floor）原样输出到字符串端口 `value`（`index.ts:tileType`，非法值兜底 floor）。*为什么：* 供下游按统一的 tile 种类字符串选择/路由资产生成分支。
- **右侧 Preview 资产信息新增「生成时间」行（`Created`）。** `frontend/src/surfaces/ImagePreviewSurface.tsx`
  新增 `formatCreatedAt()`，把记录里的 `createdAt`（ISO 时间戳）格式化为本地 `YYYY-MM-DD HH:mm:ss`
  与 `Location` 同处一行（左 Location、右 Created）显示（不可解析时回退原值，缺失显示 `-`）。*为什么：* 之前 Preview 只展示
  Alias/Prompt/Source/Size/Blob/Location，无法看出资产何时生成。

### Fixed
- **Asset Store 现在能实时显示新生成的图片（含 `All` 列），无需手动切换标签刷新。**
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` 新增一个 2s 轮询：复用 Preview 的廉价信号
  `latestPreviewAsset()`（`GET /api/v1/preview/latest`，单条记录），当最新 alias 变化即代表有新资产生成，
  随即 `setReloadKey(k+1)` 重新拉取 folders+assets；并以 `interactingRef`（重命名/右键菜单/文件夹菜单/
  新建弹窗/确认弹窗/导入/拖拽中）守护，交互进行中不强制刷新以免抢走焦点。
  *为什么：* 此前列表只在切换 `folder` 或本地变更（导入/删除等）时 re-fetch，AI 图像节点产出的新图不会进入网格，
  用户必须点一下标签才显示；Preview 因为本就在轮询故能实时更新。改为同样轮询，二者行为一致。

### Changed
- **房子路由改默认走 `dechouse_gen`（不再当 PART A 小 sprite）。** `generate-2d-asset/SKILL.md` 路由表把「房子/小屋/建筑」单列一行→ PART C（`dechouse_gen` 一键模板）置顶，PART A 限定为「小物件（植被/道具/图标/小件）」；改写 line 36 路由说明与 `notes/common-base.md` PART C 段，去掉「专属/非默认/仅当用户明确要 billboard」框定。*为什么：* 用户实测 Sino 做村庄时房子全走了 PART A、完全没调 `dechouse_gen`；根因是路由文档把正确路径 gate 成「非默认」。配套场景侧改动见 `wb-scene-generator` CHANGELOG。

### Added
- **2D 侧补齐 `instantiateTemplate` 能力（与场景侧对等）：`asset2d:pipeline.instantiateTemplate` + `asset2d:templates.list` / `asset2d:templates.get`。**
  此前 2D agent 工具层**没有**实例化模板组的入口（只有 `pipeline.applyBatch`），导致文档只能让 AI「手搭等价链」来生成建筑——
  与「生成场景用模板组一键实例化」的产品做法不一致、且过时易错。本次把 `wb-scene-generator` 的同名能力**逐份移植**到 2D：
  ① 新增 `backend/src/lib/templateOps.ts`（`buildTemplateOps`/`splitTemplate`，与场景侧 / CLI `node-create-template` 字节级等价的 backend twin）；
  ② `backend/src/routes/groupTemplates.ts` 新增 `POST /api/v1/group-templates/:id/instantiate`（仅扫 `templates/`，经内核 `applyBatch` 一次性把模板组落成
  **单个锁定组节点**并回填 `__groupIsTemplate` provenance，受 `ensureMutationAccess` 项目锁保护）；
  ③ `backend/src/tool-handlers.ts` 新增 3 个 op handler（`templates.list`/`templates.get` 走 `?scope=templates` 并 `stripInlineImages` 防 base64 污染上下文；
  `pipeline.instantiateTemplate` 转发 `/instantiate`）；④ `forgeax-plugin.json` 声明这 3 个 `exposedToAI` 工具及 schema。
  *为什么：* 用户指出「生成建筑只需一个 `dechouse_gen` 模板电池，手搭一系列节点连接是过时错误做法」——2D 必须像场景侧一样支持一键实例化模板组。
  验证：`backend/tests/group-templates.test.ts` 新增「实例化内置 `dechouse_gen` 得到单组节点 + 对外 `in_0`/`out_3`/`out_4` 端口」「不存在的模板 404」两例；
  `tsc --noEmit` 对新增 3 份文件干净（既存 `src/ai/*` 的 `findNodeWithGroup` 报错为环境内核未重建，与本改动无关）。

### Changed
- **装饰性房屋占地尺寸写明「铁律」：推荐 ≥`10×10` 格（常规 10×10～16×16），`4×4` 太小不成形、别过大。**
  此前 PART C / `house_template` 文档示例多用 `[[0,2,0],[1,1,1]]`、`[[1,1,1],[1,1,1],[1,1,1]]` 这类 2×3 / 3×3，
  容易让 AI 误以为掩码就该这么小——实际太小的格数渲出来门/窗/屋脊挤成一团、整栋贴图细节稀碎。
  在 `executions/part-c-shaped-house.md`「形状从哪来」+ `dechouse_gen.in_0` 端口行、`batteries/grayscale/house/house_template/README.md`
  spec 行都补上尺寸铁律，并注明小数组**只是 0/1/2 语义示意、非推荐尺寸**。*为什么：* 用户明确「装饰性房屋至少 10×10，4×4 是瞎扯淡」。
- **PART C / generate-2d-asset 技能文档全面改为「一键 `instantiateTemplate({templateId:\"dechouse_gen\"})`」，更正上一条「2D 工具层暂无 instantiateTemplate / 用 applyBatch 复刻等价链」的说法。**
  随上面新增的 2D `instantiateTemplate` 能力，把 `skills/generate-2d-asset/SKILL.md`（PART C 摘要新增「生成建筑=一键模板，别手搭」lead-in）、
  `executions/part-c-shaped-house.md`（「C-阶段零」改写「怎么用」为一键实例化 + 三步收尾；C-阶段一/二加 banner 标注为「内部原理/极端兜底」）
  统一为：常规生成建筑一律 `asset2d:pipeline.instantiateTemplate`，逐节点手搭仅在魔改模板内部时参考。*为什么：* 文档曾因当时缺 op 而教 AI 手搭链，
  现能力补齐，必须改回与场景侧一致的一键实例化（append-only 更正，不改写上一条历史）。

- **PART C 技能文档新增「C-阶段零 · 一键模板 `dechouse_gen`」端口契约节，作为 Scene 建筑 → 2D 贴图的对接真相源。**
  核对了新加的成组电池模板 `batteries/templates/2D/dechouse_gen`（id `group_1781717536593_kh58a`，内部 = `house_template`
  + `house_footprint` + `grid_json_to_size` + `image_gen` + remove_bg/pixel_fix/despeckle/cut_by_mask + `image_output` 一整条）
  的输入/输出端口，并在 `skills/generate-2d-asset/executions/part-c-shaped-house.md` 写明：`in_0`(json_mask) 内部同时喂
  `house_template.spec`/`house_footprint.spec`/`grid_json_to_size.json`——**正是 Scene 侧 `building_footprint_mask → grid_to_json`
  输出的同一份 0/1/2 占地 JSON**；`in_1`=height、`in_15`=roofType → `out_3`=建筑贴图、`out_4`=碰撞掩码。*为什么：* Scene 侧
  「手动放楼（PointSampleBuilding）→ 取占地 json → 建筑贴图 + collision mask 导出」要有一份明确的端口契约，sino 才能照着对接；
  并提示 2D 工具层暂无 `instantiateTemplate`，AI 用 `asset2d:pipeline.applyBatch` 复刻等价链（或 UI 拖模板）。

- **`image_atlas_compose.template` 改为可选，留空时自动加载内置标准模版。** 根因：`template`
  此前 `required:true`，做标准 tile（`common_16`）也必须建一个模版 `image_source` 并填内置模版
  `preset:tiles/tile模板.png` 的 `{alias,blobId}`——但 `preset:` 是 alias 前缀、对应的虚拟文件夹叫
  `presets`（复数），且 `assets.list` 返回巨量条目，agent 反复 `openFolder preset`(单数)/翻列表数十次都找不到，
  纯属设计摩擦。改动：`batteries/image/tiles/image_atlas_compose/index.ts` 在 `template` 端口未连线（输入缺省）
  时，自动注入内置 `preset:tiles/tile模板.png`（4×5 → 64×80，对齐场景 `common_16`），其 `blobId` 用与
  `assets/presetAssets.ts` 一致的 `sha256('presets/<rel>')` 确定性派生；`meta.json` 将 `template`
  置为 `required:false` 并写明默认行为；显式接入的自定义模版仍优先。*为什么：* 标准 tile 的模版恒为同一张内置图，
  让 agent 去「找模版」是这类资产生成里最大的 token 黑洞——把它变成零配置默认即可根除。验证：
  `backend/tests/image-processing.test.ts` 新增 2 项（缺省→注入内置模版 ref；显式 ref 优先）+ 原算法用例全通过；
  `tsc --noEmit` 干净。同步更新 generate-2d-asset 技能文档（SKILL/part-b-tileset/tile-pipeline/battery-catalog/
  notes/common-base）：标准 tile 不接 `template`、**不要**为找模版翻 `assets.list`。
- **`image_preview` 电池：输入含多张图片时改为逐张缩略图展示（与 `ImageBatteryNode` 多输出预览一致），而非只显示第一张。**
  `frontend/src/workbench/ImagePreviewNode.tsx` 把 `firstImageRef` 换成 `collectImageRefs`（递归收集 DataTree/数组里的全部图像 ref），
  >1 张时渲染 `.ip-preview__grid` 网格、每格带序号 caption；单张仍走原大图预览，0 张仍显示占位提示。配套样式见 `ImagePreviewNode.css`。
  *为什么：* 预览电池接到多图输出（如 RemoveBG 的 image/mask）时只看到一张，无法核对其余图；改为多图缩略图与画布上电池自带的多图预览观感统一。
  验证：`frontend/src/workbench/__tests__/ImagePreviewNode.test.tsx` 新增多图用例（数组输入 → 渲染 2 张缩略图），单图/空态用例不变，3 项全过。

### Added
- **接上组合电池内部视图的只读探针 `GET /api/v1/groups/:id/probe`（内核已支持，本 app 此前漏接）。**
  `backend/src/routes/queries.ts` 引入并挂载 `probeGroupInner`；`frontend/src/api/HttpApiClient.ts` 增加 `probeGroupInner()` 方法。
  *为什么：* 组以黑盒执行、内部中间值跑完即丢，前端进组靠该探针重跑内部子图回填 `nodeOutputs[innerId]`，驱动内部线/壳端口/内部 AI 预览。
  此前 2D app 两处皆缺，`probeGroupInnerOutputs` 直接空转 → 进内部视图后 external input/壳/端口/内部 image_gen 全空。内核改动见根 `CHANGELOG.md`。
- **最底层 AI 网关路由加锁，防止失控循环/误调用把 Studio 生图/生文接口疯狂批量打爆。** 新增 `backend/src/ai/rateLock.ts`
  （`createAiRateLock`），在 `backend/src/ai/routes.ts` 的 `POST /api/v1/ai/image|text` 入口、任何 resolve/generate 之前拦截：
  ①同一节点（或匿名）请求在途时拒绝并发重复；②同 key 在 `minIntervalMs`(600ms) 内再次请求拒绝；③`burstWindowMs`(1s) 内
  累计超过 `burstMax`(10) 次即触发 `lockMs`(3s) 全局冷却锁，期间一律返回 429。两条路由共用一把锁（全局 burst 统计），
  锁状态按 app 实例创建——生产单进程=一把进程级锁，测试每例新建 app 天然隔离。阈值（10/1s）远高于前端并发上限(2)，
  不影响正常人点/agent 批量。*为什么：* 作为前端守卫之外的最后一道防线，确保任何 bug 都无法把昂贵的 AI 网关反复批量调用。
  验证：`backend/tests/rateLock.test.ts`（在途/过快/burst 冷却/拒绝不计入窗口，5 项）；`ai-routes.test.ts` 既有用例不受影响。
- **新增内置提示词模板「灰度图生成像素房屋」（`prompts/house_from_grayscale_pixel.json`）。** 输入图1像素风格参考场景 + 图2房屋灰度图，
  约束大模型生成纯白色背景、像素风格、严格遵守灰度图轮廓（不超出、不缺少）的 [item name] 房屋图片；文本变量 `item name` 自动解析为一个 `str` 输入端口。
  *为什么：* 提供「场景风格 + 灰度轮廓」双参考的房屋生成专用提示词，复用既有 builtin prompt store 机制（`backend/src/prompts/store.ts`）即时出现在「Prompts」电池栏。
- **AI 生图/生文路由支持「运行组合电池内部的 manualTrigger 节点」，使组合电池外部映射运行按钮与 agent 调用走同一套流程。**
  `backend/src/ai/routes.ts`：`POST /api/v1/ai/image|text` 在 `nodeId` 命中组内内部节点（`findNodeWithGroup` 返回 `groupId`）时，跨组边界解析其输入
  （`resolveInnerNodeImageInputs`/`resolveInnerNodeTextPrompt`，新增于 `backend/src/ai/imageGeneration.ts`），生成后由 `persistManualRun` 把 `_gen_image`/`_gen_result`
  以 group 感知 `updateNode` 写回内部节点，并把结果写到该组绑定此内部端口的暴露输出缓存（`writeNodeOutput(groupId, exposedPort)`），使折叠组下游刷新；顶层节点行为不变。
  *为什么：* 内部带运行按钮的电池（如 `image_gen`）此前在组内永远被 `manualTrigger` 跳过、无法运行；现人点外部映射按钮与 agent 名内部 id 调 `generation.generateImage` 完全等价。
  依赖 kernel 新增 `findNodeWithGroup`/`resolveGroupInnerNodeInputs`/组子图水合（见根 `CHANGELOG.md`）。
- **「Prompts」电池栏提示词改用图标区分「预设 / 用户」（不再统一显示 ⚡ 兜底）。** 新增两枚随插件发布的
  线性图标文件 `prompts/_preset.icon.svg`（书签+勾，预设）与 `prompts/_user.icon.svg`（人像，用户保存）。
  `backend/src/prompts/store.ts` 按 `builtin` 懒读这两枚 SVG 并挂到 `PromptEntry.iconSvg`（`createPrompt`/`listPrompts`
  同步带出），随 `GET /api/v1/prompts` 透出。*为什么：* 让用户一眼区分官方预设与自己保存的提示词。验证：
  `prompts.test.ts` 断言预设/用户图标各自存在且互不相同，5 项通过。配套 kernel 改动见根 `CHANGELOG.md`。
- **新增内置预设提示词「背包物品图标（64px 像素）」。** 落点 `prompts/ui_item_icon_pixel.json`，从
  `pipelines/UI_items_generation/config/template_text_to_image_gen.json` 的 `prompt_template`（图标生成主模板）
  整理而来：占位符由 `{merged_input.xxx}` 改写为编辑器 `[xxx]` 语法，得 6 个输入端口
  `[name]/[label]/[level]/[tooltip]/[background]/[visual]`，正文（像素颗粒度/纯白底/黑描边等核心约束）原样保留。
  归在「Prompts」大标签的 `UI图标` 子分组，作为只读预设（`builtin:true`，不可右键删除）。*为什么：* 把管线里
  沉淀的图标提示词提升为图编辑器内可拖拽复用的预设。验证：JSON 解析通过且 `[占位符]` 与 `vars` 完全一致；
  `prompts.test.ts` 5 项仍通过。
- **用户模板删除接口 `DELETE /api/v1/group-templates/user/:id`（仅限 `.forgeax` 用户内容，预设只读）。**
  `backend/src/routes/groupTemplates.ts`：列表项新增 `builtin` 标记（`root !== userTemplateRoot()` →
  内置 `true` / 用户 `false`）；新增 `findUserTemplateFile()` 只在 `userTemplateRoot` 下按 group id 定位，
  从根上保证内置 `templates/` 与 `groups/` 永不可达、预设永不可删；删除 json 后顺手清理变空的小标签目录。
  `frontend/src/api/HttpApiClient.ts` 增加 `deleteUserTemplate()` 走该路由。*为什么：* 配合电池栏右键
  「删除用户模板」，与既有用户提示词删除（`prompts`）对齐。验证：`backend/tests/group-templates.test.ts`
  新增 3 项（用户模板 `builtin:false`、按 id 删除后消失、删除缺失/预设返回 404）全通过。

### Fixed
- **dev→main 合并：`groupTemplates` 列表保留 main 的 `scope` 查询 + dev 的 `builtin` 标记。**
  冲突处取 `collectCatalogItems(parseCatalogScope)` 架构，并在 `collectCatalogItems` 内恢复
  `builtin: root !== userTemplateRoot()`，保证用户模板可右击删除、预设只读（`groupTemplates.ts`）。
- **`battery-catalog.md` 合并两侧条目：** 保留 main 的 collision mask 链（CutByMask/RemoveWireframe）
  与 dev 的 `image_filter_style`。
- **`image_filter_style` 的 `blend_mode`/`style` 下拉框无法点击 → 修复输出端口重名。** 根因：把
  下拉输入 `style` 同名地又声明成了输出端口，导致同一节点上出现两个 `id="style"` 的 ReactFlow
  Handle（一个 target、一个 source），节点 Handle 注册冲突、内联下拉选择器失效。对照可用电池：
  `furniture_template`（双下拉、无重名）正常，`image_resize`（单下拉、仅 `image` 约定重名）正常——
  唯独本电池让「下拉输入名」与「输出名」相撞。修复：输出端口 `style` 改名 `applied_style`
  （`meta.json` outputs + `index.ts` 返回值），保留 `image` 输出重名（下游链式约定，已证无害）。
  生效后 `/api/v1/ops` 重名仅剩 `{image}`，与可用的 `image_resize` 一致。

### Changed
- **`image_filter_style` 罩色改为 Photoshop 风格混合模式图层，根治「糊一层面罩」。** 此前罩色用
  正常平涂（`out=base*(1-s)+tint*s`），会均匀压低局部对比、把整张图蒙上一层不透明色膜，画面发闷
  发暗。改为支持 normal/multiply/screen/overlay/soft_light（W3C/PS 公式，`blendChannel`），罩色
  按「混合模式 + 不透明度」叠加：叠加/柔光只染中间调、保留高光与暗部 → 通透；正片叠底在阴影处加重
  色调（落点 `batteries/image/processing/image_filter_style/index.ts` 的 `applyTint`/`blendChannel`）。
  12 套风格预设全部重配混合模式与参数（`_STYLE_PRESETS` 新增 `tint_blend`），并新增 `blend_mode`
  下拉输入可手动覆盖（跟随风格/正常/正片叠底/滤色/叠加/柔光，见 `meta.json`）。验证：
  `backend/tests/image-processing.test.ts` 新增 4 个单测（multiply 压暗、soft_light 比平涂保留更大
  明暗跨度=更少面罩、`blend_mode` 覆盖生效、每个带罩色预设都声明混合模式），`vitest run` 共 28 项
  全通过；并以 decoration_house 素材离线生成「原图/旧平涂/新混合」对比图肉眼确认面罩消除。

### Added
- **新增 `image_filter_style` 电池：按既定风格对图片调色。** 落点
  `batteries/image/processing/image_filter_style/{index.ts,meta.json,icon.svg}`。从 `pcg_generation`
  管线的 `filter_image` 步骤（`apply_filter_agent.py` + `palette_rules.json`）迁移为图编辑器电池：
  输入一张图片、用 `style` 下拉框选一个既定风格（中式仙侠/赛博朋克/废土黄沙等 12 种 + "原图"），
  按该风格预设链式处理 → 输出 `image`。调色链严格沿用 Python 原顺序 hue→saturation→brightness→
  contrast→tint→sepia，每步公式对齐 PIL（`ImageEnhance.Color/Brightness/Contrast` 与 hue/tint/sepia），
  且只作用 RGB、逐字节保留 alpha（不破坏抠图后的透明边）。I/O 经 `_shared/asset2d.ts` 的
  `processImage` 委托后端 asset2d 解码/编码/写 generated 区。验证：`backend/tests/image-processing.test.ts`
  新增 4 个单测（预设齐全、"原图"零改动、调色后 RGB 变而 alpha 不变、亮度 >1 提亮 <1 压暗），
  `vitest run image-processing` 共 24 项全通过。纯函数加 `_` 前缀导出（`_applyStyle`/`_STYLE_PRESETS`），
  避免 loader 入口正则 `/^[a-z]/` 误选作 execute 入口（沿用 `image_pixel_scale` 同款约定）。
- **新增 `image_despeckle` 电池：修复抠图残留的孤立白/灰杂点。** 落点
  `batteries/image/processing/image_despeckle/{index.ts,meta.json,icon.svg}`。背景移除后常残留
  「蒙版没抠干净」的孤立白点/灰点（本应是主体色却保留为低饱和白/灰）。算法为 Photoshop
  「内容识别填充」的轻量、确定性版本：① 候选检测 = 不透明 + 低饱和（白/灰，`satVal`）+ 局部离群
  （与邻域非候选像素中位色的 RGB 距离超阈值，避免误删大片正当灰色）；② 连通块面积过滤
  （`detectSpeckles`，只清面积 ≤ `max_speck_size` 的点状块，保留线/面）；③ 内向传播填充
  （`despeckle`，对杂点反复取 8 邻域有效像素平均 normalized convolution，逐圈补间融入邻近色），
  只改 RGB、保留 alpha。I/O 经 `_shared/asset2d.ts` 的 `processImage` 委托后端 asset2d 服务。
  参数 `sat_threshold`/`value_min`/`outlier_threshold`/`max_speck_size` 均带默认值开箱即用。
  验证：`backend/tests/image-processing.test.ts` 新增 3 个单测（检测白/灰杂点不误伤纯色场、
  填充后融入邻近色且 alpha 不变、大块低饱和区域因面积过滤被保留），`pnpm --filter backend test`
  共 20 项全通过。纯函数命名加 `_` 前缀（`_detectSpeckles`/`_despeckle`），避免 loader 入口正则
  `/^[a-z]/` 误选第一个小写函数作 execute 入口而导致节点无输出（见 `image_pixel_fix` 同款约定）。

### Changed
- **`house_template` 坡屋顶屋脊拓扑修正为 Chebyshev 距离场，T/L/十字得到正确屋脊。**
  此前 `ComputeRoof` 用 L1（4 邻接）距离，宽顶条中央会朝两个凹角排水、屋脊在交接处下凹成
  M，不成 T。改用**到最近屋檐的 Chebyshev(L∞) 距离**作 45° 坡屋面高度场
  （`batteries/grayscale/house/house_template/index.ts` 两遍八邻接倒角）：宽顶条得横屋脊、
  窄竖条得竖屋脊、二者垂直相交即 **T 形**，L 形得 L 脊、十字得十字脊、矩形得直脊，四角斜脊
  45° 连到中轴、凹角天沟自然成立。坡面朝向改取「最矮相邻格方向」（顺坡下泄）。本地
  矩形/L/T/十字（pitched）+ 矩形（flat）渲染验证：屋脊拓扑与预期一致。
- **`house_template` 灰度图三项观感修正（立体女儿墙 / 窄窗 / 门内缩）。** 落点
  `batteries/grayscale/house/house_template/index.ts`：① **女儿墙立体化**——平屋顶外缘由单层收边
  改为「顶帽(`COLOR_PARAPET`158)→内侧投影带(`COLOR_PARAPET_SHADOW`96)→屋面板」三层（新增类别
  `K_PARAPET_SHADOW`），描边在顶帽下方自动勾出一条「看线」、投影带提供阴影，读作有厚度的女儿墙；
  深度随 size 自适应（cap≈1.2%·size、shadow≈2.2%·size）。② **窗变窄**——`stampWindowsInBox` 窗宽系数
  0.56→0.26（落在原 1/4–1/2 区间），窗呈竖向窗洞、不再像整面墙。③ **门内缩**——新增 `InsetDoors`
  在缩放后的像素网格上把每扇门横向两侧各内缩 `max(2, size/120)` 像素并以立面回填，门与墙体/墙角间
  留出立面边框，避免门框与墙轮廓糊成一片（修正反馈图）。验证：临时 tsx 渲染 flat/pitched PNG 目检通过（已删）。
- **`house_template` 门改由掩码控制，不再随机生成。** 输入掩码新增约定值 `2`：把某列底部的
  `1` 改成 `2`，即在该列立面墙脚开一扇**固定 1 格高**的门（相邻列的 `2` 连成更宽的门），结果
  **完全确定、无随机**。落点 `batteries/grayscale/house/house_template/index.ts`：删除随机加门
  (`AddDoors`/`findWallFronts`/`addDoorToFront`/`mulberry32`/`Rng`/`DOOR_*` 比例常量)，新增
  `PlaceDoorsFromMask`（门标记 `(r,c)`→立面 `(r+height,c)` 置 `V_DOOR`）+ `ExtractDoorCells` +
  `ParseMaskEntries`（解析房顶与门标记；`ParseMasks` 改为其投影、向后兼容 `house_footprint`）。
  门在缩放前的掩格域开、随 `ResizeMask` 一并缩放，门尺寸只由掩码+`height` 决定。`MaskToHouseGray`
  签名改为 `(roof, doors, height, size, roofType)`；移除 `doorCount` 输入端口与 `seed` 参数。
  同步 `meta.json`/`README.md`。验证：临时 tsx 脚本确认门精确落在 2 标记列的墙脚、1 格高、列号正确（已删）。
- **`generate-2d-asset` skill 的 PART C（指定形状房屋）补充屋顶类型选择与底面输出。**
  装饰性房屋新增两点：① 先定**平屋顶/坡屋顶**并落到 `house_template.roofType`（`flat`/`pitched`）；
  ② 默认再接 `house_footprint`（吃同一份 `spec`＋同一 `height`、`imageSize` 一致）旁路输出建筑底面黑白图，
  单独 `image_preview → image_output` 入库、不进图生图链、与成品逐像素对齐。同步更新
  `skills/generate-2d-asset/{SKILL.md,battery-catalog.md,notes/common-base.md,executions/part-c-shaped-house.md}`。
- **`house_template` 平屋顶女儿墙/檐口收边改为极薄（恒 1 mask 格）。**
  原 `parapetDepth = max(1, round(min(屋顶高,宽) * 0.16))` 在较大屋顶上会算出很粗的女儿墙带；
  改为恒 `parapetDepth = 1`，平屋顶外缘仅描出一道细收边线，不再有粗亮边带。同时移除不再使用的
  屋顶包围盒 `rTop/rBot/rLeft/rRight` 计算。`batteries/grayscale/house/house_template/index.ts`。
  验证：临时 tsx 渲染矩形与 T 形平屋顶 PNG 目检，女儿墙仅剩极薄一圈（已删）。

- **图像预览框路由改为「按 image 输出口」而非「按大类 image」。** 电池挪到 `grayscale/`
  等非 `image` 大类后丢失预览框（`asset2d_image_battery`）。改 `backend/src/routes/batteryCategories.ts`：
  非 `ai/` 电池只要 `meta.outputs` 含 `type:"image"` 的端口即套预览框，与大类目录无关；
  `ai/` 仍走原分支（image_gen/text_gen → AINode 自带预览，不重复套框），显式 `frontend.nodeType` 仍最高优先。
  更新 `backend/tests/batteryCategories.test.ts`（5 passed）与 `docs/architecture/{backend,frontend}.md`。

### Fixed
- **电池目录重组后前端读不出：`_shared` 相对 import 断裂。**
  将灰度/碰撞等电池挪到 `batteries/grayscale/`、`batteries/helper/collision/` 后，
  各电池仍 `import '../../_shared/asset2d.js'`，解析到不存在的分类级 `_shared`，
  loader 动态 import 失败、注册表为空。修复：共享模块上提到 `batteries/_shared/asset2d.ts`，
  全仓 15 个电池改为 `../../../_shared/asset2d.js`；同步 `ARCHITECTURE.md` 路径。

### Changed
- **`furniture_template` 由纯水平立面改为 2.5D 斜投影视角（能看到一部分顶面）。**
  原绘制只填正面矩形（`rect`）→ 纯立面。改为：绘制函数把各部件登记为正面矩形
  （`rect` 现仅入队 `Part`），渲染时 `renderParts` 先为每个部件补画向右上方退缩的
  顶面（更亮）与侧面（更暗）平行四边形（新增 `fillQuad`/`putPixel`，深度
  `DEPTH_X=0.05`/`DEPTH_Y=-0.06`），再统一画正面（`fillRect`），最后描边——既露出
  顶面又保留原可辨的正面剪影。顶/侧面用专用类别 `K_TOPFACE`/`K_SIDEFACE`，使
  顶/侧↔正面交界自动描出 2.5D 转折棱线；`flip`（right 朝向）改为逐像素镜像
  (`putPixel`)，深度方向随之镜像。`batteries/image/furniture/furniture_template/index.ts`，
  同步 `meta.json`/`README.md`（立面→2.5D 斜投影）。验证：临时 tsx 脚本渲染全部
  4×4 kind×orientation 为 PNG 逐一目检，桌/椅/衣柜/床均现清晰可见顶面（已删）。

### Added
- **新增 `house_footprint`（房屋底面）电池——与 `house_template` 严格对齐的底面黑白图。**
  输入同一份房顶二维数组字符串 + 「高度」，输出黑=底面(接触地面)、白=背景的图，可作掩码/对齐参考。
  关键在于 `ResizeMask` 的缩放/居中只依赖网格尺寸 `H×W`，而 `OffsetByHeight`/`DifferentiateFacades`
  不改尺寸、`ExpandMask` 把高度设为 `(height+origH)×W`；故底面只需复用 `house_template` 导出的
  `ParseMasks`/`ExpandMask`/`ResizeMask`（`batteries/image/house/house_template/index.ts`），走同样的
  `ExpandMask(roof,height)→ResizeMask(_,size)`，缩放/居中即逐像素一致，底面落在房屋图底部对应像素。
  新增 `batteries/image/house/house_footprint/{meta.json,index.ts,README.md,icon.svg}`。验证：临时脚本
  以 T 形 mask 渲染对比 `house_template` 几何，确认 footprint ⊆ 房屋轮廓且左/右/底边界完全一致（已删）。
- **`house_footprint` / `grid_json_to_size` 电池图标。**
  前者：青绿底 + JSON 花括号箭头指向白底黑 T 形底面剪影，与 `house_template` 同族；
  后者：靛蓝底 + 方格网格 + 宽高尺寸双箭头 + JSON 角标（`icon.svg`）。

### Changed
- **`house_template` 屋脊拓扑修正为真实直骨架，并强化平屋顶/门。** 上一版坡面用「1D 方向
  行程」算最近屋檐，T/L 形在交接处中轴断裂、成 Y 而非 T/L。改 `ComputeRoofFaces`→`ComputeRoof`
  （`batteries/image/house/house_template/index.ts`）：以所有屋檐为源做**多源 BFS（草火法）**得到
  真实 L1 距离 + 排水朝向，故中轴自然呈 **矩形=直脊 / L=L 脊 / T=T 脊 / 十字=十字脊**，四角
  斜脊以 45° 连到中轴端点、异形凹角自然出天沟。新增：① **平屋顶女儿墙/檐口收边**——`ComputeRoof`
  返回的 `dist` 取外缘一圈（厚度随屋顶尺寸自适应）着 `COLOR_PARAPET`(158)、内部屋面板(120)，
  双线收边强化平顶感；② **门半虚掩** `MakeDoorsAjar`——每扇门靠一侧留近黑门缝(`V_DOOR_OPEN`)，
  门缝与门扇经描边成线，纯示意。`MaskToHouseGray` 在 PlaceWindows 后插入 `MakeDoorsAjar`。本地
  矩形/L/T/十字（pitched）+ 矩形/正方形（flat）渲染验证：屋脊拓扑正确、平顶收边清晰、门半开可辨。
- **`house_template` 坡屋顶改用真实结构表达，弃用渐变（修正上一条 pitched=屋脊渐变的歧义）。**
  渐变屋顶让生图模型读不出结构、常识别错误。新增 `ComputeRoofFaces`
  （`batteries/image/house/house_template/index.ts`）：从屋顶轮廓做离散直骨架近似——每个
  屋顶格统计到四向屋檐的距离，归属到最近朝向的坡面(N/S/W/E)；四坡面各占一个像素类别
  (`K_ROOF_FACE`)，按朝向纯色平涂(`ROOF_FACE_*`)，坡面交界（屋脊/斜脊/天沟）由 `applyOutline`
  自动勾成线，呈现真实四坡/攒尖屋顶。**异形屋顶（L/T/十字）在凹角处 drain 朝向翻转自然形成
  天沟，无需特判**。`RenderGray` pitched 分支改走坡面着色（index.ts）。本地矩形/正方形/L/T/十字
  渲染验证：矩形=四坡、正方形=攒尖、异形交接处正确出天沟。

### Added
- **新增 `furniture_template`（家具模板）电池**——室内家具灰度图底图，与 `house_template`
  同角色（形状底图喂给 `image_gen`，配「严格遵守灰度图形状」提示词约束生图）。
  `batteries/image/furniture/furniture_template/{index.ts,meta.json,icon.svg,README.md}`。
  按「家具类型 + 朝向」**两个下拉端口**程序化绘制可识别的立面剪影：`kind`=table/chair/
  wardrobe/bed、`orientation`=down(正面)/up(背面)/left/right（`right`=`left` 水平镜像）。
  并非每种家具都区分所有朝向——椅子四向、床左右为侧影（下=床尾/上=床头）、衣柜正面有
  双门、桌子各向同形（meta.json:28-58）。渲染沿用 house 的「扁平灰度 + 外轮廓描边」：各
  部件以不同类别填充，`applyOutline`（index.ts）沿外缘与部件接缝画深色细线。纯绘制
  `DrawFurnitureGray` 以 Uppercase 导出供单测，入口唯一小写 `furnitureTemplate`。复用
  `_shared/asset2d.createImage` 双写（.forgeax/grayscale/ 归档 + 资产库 image 端口）。
  本地 4 类×4 向渲染验证：桌/椅/柜/床均一眼可辨。

### Changed
- **`house_template` 灰度图修饰，让其更像房屋、便于大模型识别。** 此前渲染只是「顶面深灰
  + 立面浅灰 + 小门」三档纯色色块，缺少窗户、屋顶语义与硬轮廓，大模型常识别错误。现在在
  渲染层加了三项修饰（`batteries/image/house/house_template/index.ts`）：
  ① **窗户** `PlaceWindows`（index.ts:303-380）——按立面连通块尺寸自动网格排布窗洞（标 8），
  避开门与边缘留白；② **屋顶类型** 新增输入端口 `roofType`（`meta.json` inputs，默认 `pitched`），
  `pitched`=坡屋顶（屋脊高光向两侧屋檐渐暗，`pitchedRoofGray` index.ts:418-425）、`flat`=纯色
  平屋顶；③ **外轮廓描边** `applyOutline`（index.ts:470-490）——沿建筑外缘、屋顶/立面交界、
  门窗框画深色细线(64)，强化建筑硬直线特征。`MaskToHouseGray` 增加 `roofType` 形参并插入
  `PlaceWindows` 步。输入契约（roof-only 2D array）不变。本地多形状（矩形/L/T/宽体）+ pitched/flat
  渲染验证：均清晰呈现多层窗户、门、屋顶与轮廓的建筑外观。

### Fixed
- **拖图片到已有 `image_source` 节点「原地换图」预览不刷新（非常慢 / 概率保持原图）修复。**
  `ImageSourceNode`（`frontend/src/workbench/ImageSourceNode.tsx`）此前用 ReactFlow
  的 `data.params.image` 渲染预览，而原地换图走 `updateNodeParam`——它只同步写
  `currentPipeline`，**不**回写 ReactFlow 节点的 `data`（只有 `agentUpdateParams` 经
  `_rfSetters` 才回写）；而 localParamEdit 热路径又会**抑制/合并**换图后的画布重建
  （`loadPipeline`），导致 `data.params.image` 长时间陈旧：预览要等去抖持久化往返
  + `graph:applied` 重建才更新（很慢），重建被合并掉时则一直显示旧图（保持原图）。
  改为直接订阅 store 的活值（`currentPipeline.nodes[id].params.image`）渲染预览，
  drop 落参后**同步**刷新。配套：`onDragOver` 把拖拽资产捕获进 `useRef`，`onDrop` 在
  `readDraggedAsset()` 为 `null` 时回退到该 ref，杜绝跨 iframe 读时序竞态造成的静默
  no-op；`alias` 改用 `silent` 写入、仅 `image` 触发执行，避免两次背靠背 execute 往返。
  新增回归测 `frontend/src/workbench/__tests__/ImageSourceNode.test.tsx`（活值渲染 +
  换参同步刷新）。`tsc --noEmit` 通过。
- **从 Asset Store 拖图片到画布/`image_source` 节点时「概率失败、节点保持原图」修复。**
  跨 iframe 的图片拖拽载荷通过 `localStorage`（`surfaces/library/draggedAssetBus.ts`）
  在 `dragstart` 写入、`dragend` 清除，落点的 `drop` 处理器（画布
  `WorkbenchHost.handleExternalDrop` 新建节点 / `ImageSourceNode.onDrop` 原地换图）
  在 drop 事件里**同步读取**该值。HTML 拖放模型虽规定 `drop` 先于 `dragend`，但跨
  assetstore↔canvas 的 iframe 边界该顺序在部分引擎（尤其 Studio .app 的 WKWebView）
  并不可靠，`dragend` 的同步清除可能恰好在 host 的 drop 读取**之前**抹掉载荷 → drop
  读到 `null`、静默 no-op，表现为「换图没生效、imageSource 保持原图」。改为
  `clearDraggedAssetDeferred()`（`draggedAssetBus.ts`）延迟 400ms 清除，使 drop 的同步
  读取始终先命中；下一次 `dragstart` 写入新载荷时会取消尚未触发的延迟清除，避免误清。
  落点：`frontend/src/surfaces/library/draggedAssetBus.ts`（新增 `clearDraggedAssetDeferred`
  + `writeDraggedAsset` 取消挂起的清除定时器）、`frontend/src/surfaces/GeneratedAssetStoreSurface.tsx`
  （卡片 `onDragEnd` 改用延迟清除）。`tsc --noEmit` 通过。

### Added
- **Image-analysis batteries: collision/anchor + pixels→mask.** New group
  `batteries/image/collision/`. `image_black_collision` binarizes a B/W image by
  a grayscale threshold (`_binarize`), traces the black region's outline (Moore
  boundary follow `_traceContours` + optional Douglas–Peucker `_douglasPeucker`)
  emitting both an image-sized binary `collision_grid` (`_outlineGrid`) and a
  vertex-ring JSON `collision`, plus a centroid `anchor` JSON (`_centroid`).
  `image_pixels_to_mask` turns a bitmap into a mask `grid` (`_pixelsToMask`):
  size = image w×h (per-pixel), most-frequent color → 0 (background), other
  colors get 1,2,3… by first-seen scan order. Both decode the input via the new
  `decodeInputImage` helper in `batteries/image/_shared/asset2d.ts:63`
  (delegates to `asset2d.decodeImage`). *Why:* generate 2D-asset collision
  shapes/anchors and color→mask grids from images. Verified with a tsx harness
  over the pure functions + battery entries (4×4 fixture, all asserts pass).
- **Saved Panel prompts (backend store + routes + shared op).** New
  `backend/src/prompts/{store,routes}.ts` (registered in `backend/src/main.ts`)
  expose `GET/POST/DELETE /api/v1/prompts`: a prompt is one JSON file per entry
  (built-in at `prompts/`, user under `<workspaceRoot>/prompts/`), with the
  server parsing the template's `[xxx]` placeholders into ordered, de-duplicated
  `vars` and an optional `tag` (sub-group, default `saved`). New shared
  `batteries/prompt/saved/prompt_template` op performs the `[xxx]` substitution
  (connected ports replace, unconnected stay verbatim) and outputs `prompt`;
  `frontend/src/api/HttpApiClient.ts` implements the prompt client methods. The
  kernel surfaces each saved prompt as a draggable battery under the **"Prompts"**
  big tag (see root CHANGELOG). *Why:* let users save a Panel's text as a
  reusable, parameterised prompt battery. Covered by `backend/tests/prompts.test.ts`.
- **User-template save route + scan root ("Save to templates").**
  `backend/src/routes/groupTemplates.ts` gained `POST
  /api/v1/group-templates/save-user`, which writes the posted group to the
  workspace `.forgeax` area at `<workspaceRoot>/user-content/templates/My
  templates/<smallTag>/<templateName>.json` (FORGEAX_PROJECT_ROOT-derived, read
  at request time for test isolation). The user-template root is appended to the
  template scan roots (`getKinds()`/`templateRoots()`), so `GET
  /api/v1/group-templates` lists built-in + user templates uniformly under the
  fixed **"My templates"** big-label. `frontend/src/api/HttpApiClient.ts`
  implements `saveUserTemplate`. *Why:* let users persist their own reusable
  group templates as project-shared user content.

### Fixed
- **Agent `generateImage` now resolves wired reference images even when the
  upstream was never executed.** `ai/routes.ts` walks the `image_gen` node's
  closure (`executeNode`) before `resolveNodeImageInputs`, so its pure upstream
  sources (`image_source`, `tree_merge`) execute and populate the file-backed
  output cache, while the `manualTrigger` `image_gen` node is skipped (no
  gateway re-fire). A human Run worked because the frontend store held the
  computed `nodeOutputs`; an AI caller has no store, so an `image_source`
  created via a create-batch (params set, never executed) had no cache file and
  the model got zero reference images. Test:
  `ai-routes.test.ts` "resolves the wired reference image even when the upstream
  was never executed".
- **AI applyBatch optimistic lock wired end-to-end.** `mutations.ts` forwards
  `opts.expectedPrevHash`; conflicts return HTTP 409. `tool-handlers.ts` transparently
  re-opens the active project and retries once on recoverable `mutation-denied-not-open`
  after a backend restart.
- **`generateImage` nodeId-only errors include actionable guidance.** `ai/routes.ts:49`
  tells callers to execute upstream nodes or pass prompt/images explicitly.
- **`image_terrain_extract` auto-retries with relaxed params on high-contrast textures.**
  `image_terrain_extract/index.ts` `terrainExtractWithFallback` tries three parameter
  tiers before failing.
- **`image_atlas_compose` meta documents alias or data: URL inputs.** `meta.json` terrain
  and template port descriptions match `parseImageRef` decode behaviour.

### Changed
- **generate-2d-asset skill documents `tree_merge` and `expectedPrevHash`.**
  `part-c-shaped-house.md`, `pipeline-schema.md`, `common-base.md`, `forgeax-plugin.json`.

### Added
- **Workbench CN 场景资产 skill 迁移为可编排电池与模板。** 新增 Four-Way 场景资产电池
  `fourway_route_classifier` / `fourway_prompt_builder` / `fourway_metadata_pack` /
  `seamless_edge_check`（落点 `batteries/image/fourway/*`），把 top-down/isometric
  资产按 `material_seamless` / `decal_sprite` / `modular_tileset` / `prop_sprite`
  分流，生成提示词、连续性报告和 runtime metadata；新增横版场景电池
  `sidescroller_prompt_builder` / `sidescroller_crop_letterbox` /
  `sidescroller_resize_tile` / `sidescroller_edge_blend` /
  `sidescroller_stitch_tiles` / `sidescroller_quality_check` /
  `sidescroller_metadata_pack`（落点 `batteries/image/sidescroller/*`），把
  2D side-scroller skill 的 16:9 背景、640×360 tile、1920×360 拼接、质量检查和
  metadata 约定沉淀为普通可复跑电池。新增模板
  `FourWayMaterialSeamless` / `SideScrollerBackgroundLayer`
  （`batteries/templates/*`），并补 `asset2d:templates.list/get` 与
  `asset2d:pipeline.instantiateTemplate`（`forgeax-plugin.json`、
  `backend/src/tool-handlers.ts`、`routes/groupTemplates.ts`、
  `lib/templateOps.ts`），让 AI 可先实例化高频模板再触发 `image_gen` 和下游
  `pipeline.execute`。同步更新 `generate-2d-asset` PART D/PART E 执行文档、
  `battery-catalog.md`、`ARCHITECTURE.md` 和 `docs/architecture/backend.md`。
  *为什么：* 两个共享 skill 原本只是文档规则，AI 每次都要临时解释并手搓节点；拆成
  路由 / prompt / 后处理 / 检查 / metadata 电池后，生成链路可复用、可验证、可由模板稳定落图。
- **Asset Store 新增「文件夹」视图（Folder），与 Grid / List 并列于标题栏视图下拉菜单。**
  选中文件夹视图时左侧文件夹菜单栏隐藏（该预览形式本身即是文件夹导航），主区域改为
  Windows 资源管理器风格的文件夹卡片网格——每张卡片是带页签的文件夹外观，盖内 peek
  最多 4 张该文件夹的样例缩略图，下方是文件夹名 + 资产计数。点击含子文件夹的卡片会**逐级
  下钻**（仍停留在文件夹视图，展示下一级文件夹）；点击无子文件夹的叶子文件夹才展示其图片
  （网格布局），此时左栏仍隐藏，改由顶部**面包屑导航栏**回退到任意上级（参照
  `wb-scene-generator` 的 `assetstore-crumbs`）。样式 1:1 参照 `wb-scene-generator` 的
  `AssetStoreSurface` `FolderCard`（folder tab/body/peek 配色与圆角一致），类名前缀本地化为
  `asset2d-store__folder-card*` / `asset2d-store__crumb*`。落点：
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx`（`ViewMode` 增 `'folder'`、
  `VIEW_OPTIONS` 增 Folder 项、`folderPath` 下钻路径状态 + `openFolderNode` /
  `goToFolderCrumb` 导航、`asset2d-store__body--folder` 单列布局下条件渲染
  `aside`/面包屑/文件夹卡片/图片网格、新增 `FolderCard` 组件按文件夹懒加载样例缩略图）、
  `GeneratedAssetStoreSurface.css`（`.asset2d-store__body--folder` /
  `.asset2d-store__folder-view` / `.asset2d-store__folder-card*` /
  `.asset2d-store__crumb*`）、
  `frontend/src/surfaces/icons.tsx`（新增 `Folder` 描边图标）。*为什么：* 用户希望以
  文件夹形式逐级浏览资产库，文件夹卡片本身已含左侧菜单的导航功能，故该视图下隐藏左栏并
  以面包屑回退。文件夹卡片对「仅含子文件夹、自身无图片」的目录（如 `presets`）会改为
  peek 其子文件夹内的样例缩略图（否则只会显示空文件夹图标）；并将外层容器由两行 grid 改为
  flex 纵向布局，避免插入面包屑后正文被挤到底部留出大片空白。进入文件夹时用
  `assetsFolder` 记录当前已加载图片所属目录，与 `folder` 不一致（刚切换、refetch 未回）时
  视为 stale 并隐藏旧缩略图，消除「先闪旧图再切新图」的过渡。

### Fixed
- **Agent 运行图生图时参考图被丢弃。** `/api/v1/ai/image` 的 "Run this node" 解析逻辑
  原为「`prompt` 与 `images` **都**为空才从画布解析」（`body.nodeId && !prompt &&
  images.length === 0`）；agent 调 `generation.generateImage` 时若顺手传了 `prompt`，
  该分支被整体跳过 → `images` 永远为空 → 接好线的灰度模版/参考图根本没进生图调用
  （成品与参考图无关）。改为 prompt / images **各自按需回填**：只要命名了 `nodeId`，
  调用方没给的那一项就从画布补齐，显式参数优先。落点
  `backend/src/ai/routes.ts:37`；回归测试 `backend/tests/ai-routes.test.ts`。

### Changed
- **`house_template` `height` 端口默认值 3→1。** 装饰性房屋常用较矮立面，新建节点时默认
  1 更贴合常见用法。落点：`batteries/image/house/house_template/meta.json:55`、
  `index.ts:376`。

### Added
- **`grid_json_to_size` 电池：把二维列表 JSON 字符串换算成对应灰度图的宽/高
  （每格 16px）。** 新落点
  `batteries/helper/data_transform/grid_json_to_size/{meta.json,index.ts}`——新
  `helper`（辅助）大标签 + `data_transform`（数据转换）小标签下的第一个电池。
  输入一个 `string` 端口 `json`（二维列表，如 `[[0,1],[1,0]]`），输出两个
  `number` 端口 `width = 列数×16` / `height = 行数×16`；解析失败 / 空串安全降级为
  `0/0`（`index.ts` `JSON.parse` try/catch + `Array.isArray` 守卫，列数取各行最大
  长度容忍非矩形）。烟测确认 `[[0,1,2],[3,4,5]]→48/32`、`[[1],[2],[3],[4]]→16/64`、
  空/非法→`0/0`，且 loader 干净注册（`getNodeOutput` 验证）。*为什么：* 下游按
  「网格→灰度图」的算子需要先据网格尺寸推像素画布尺寸，独立成一个纯数据转换电池便于复用。

### Fixed
- **AI/CLI "Run this node" image-gen now forwards *every* reference image when
  the `image` input is a multi-branch DataTree (two ImageSources merged via
  `tree_merge`) — previously zero refs reached the Studio gateway, so the model
  ignored both references.** `imageRefsFromValue` in
  `backend/src/ai/imageGeneration.ts` only ran `peelWireValue` (which collapses
  *single*-entry/single-item trees); a 2-image merge serialises as a 2-branch
  `DataTreeEntry[]`, so the entries (objects) all mapped to `''` and were
  filtered out → empty `inputImages`. It now flattens every branch's `items`
  into the ref list via `isDataTreeEntries`. Mirrors the kernel-side fix in
  `packages/node-runtime-react/.../AINode.tsx` (the human Run path), keeping
  "AI Run == human Run". `tsc --noEmit` passes. *Why:* `image` is a
  `tree`-access input on `image_gen`; merging multiple sources is the intended
  multi-reference workflow and must reach the gateway intact.

### Changed
- **`generate-2d-asset` skill：明确输入电池按端口类型固定选——字符串→`text_panel`、数值→`number_const`、
  布尔→`toggle`。** `notes/common-base.md` 通用防呆新增该三条铁律；`battery-catalog.md` 输入电池表
  补 `number_const`(value:number) / `toggle`(value:bool) 两行并标注"按类型喂值"。op id 以
  `packages/batteries-common/batteries/common/input/{textPanel,numberConst,toggle}/meta.json` 为准
  （`text_panel`/`number_const`/`toggle`，输出端口分别 `output`/`value`/`value`）。
  *为什么：* 用户要求给输入端口喂常量值时按类型选对电池，避免乱用。
- **`generate-2d-asset` skill · PART C（指定形状房屋）改写：默认像素图 + 默认单灰度底图 +
  强约束提示词（严守灰度图形状 + 纯色背景）+ 用 `grid_json_to_size` → `image_pixel_scale`
  按掩码目标尺寸缩放（`lock_aspect=false`）。** 改 `skills/generate-2d-asset/` 下
  `executions/part-c-shaped-house.md`（流程由"双参考图必接 `图1.png` 锚图、top-down"改为
  默认单灰度图直连 `image_gen.image`，仅当用户要把某张参考图风格严格迁移到灰度图上才追加锚图、
  双图 merge；新增 ① 据同一份掩码跑 `grid_json_to_size` 算目标宽高、④ PixelScale 接
  `grid_json_to_size.width/height` 且 `lock_aspect=false`；提示词两条硬约束=严守灰度图形状 +
  纯色背景）、`battery-catalog.md`（PART C 表新增 `grid_json_to_size` / `image_pixel_scale` 行、
  数据流改为默认单图分支 + 风格迁移双图分支）、`SKILL.md`（description + PART C 摘要同步）、
  `notes/common-base.md`（PART C 防呆改写：单图直连、两条硬约束、grid→PixelScale、去掉与新流程
  冲突的"正交正视/必接锚图"旧约束）。*为什么：* 用户要求装饰房默认出像素图、默认单灰度图（风格迁移
  才双图）、提示词务必严守灰度形状并出纯色背景、并用 `grid_json_to_size` 锁定 PixelScale 目标尺寸。
  `surfaces/GeneratedAssetStoreSurface.css`：栏目行内边距 `7px 9px`→`4px 9px`、列表 `gap` `6px`→`3px`；
  `__target select` 固定 `width:110px`（`box-sizing:border-box`），不再随选中项文本长度（如可变的
  `current (<folder>)`）撑宽/缩窄，统一为「All」时的下拉宽度。
  *为什么：* 用户反馈栏目过高、且下拉框宽度随标签切换跳动。纯 CSS 改动。


- **favorites 改回单层虚拟栏目，不再支持创建子分组；标题栏移除文件路径；父菜单展开三角移到名称右侧。**
  `surfaces/assetFolderTree.ts` 不再从后端 `__favorites__/<group>` 构建 favorites 子节点（恒为空），
  favorites 渲染为普通叶子；`GeneratedAssetStoreSurface.tsx` 中 favorites 右键不再弹任何菜单，
  标题栏去掉 `folder` 路径（仅在有选中时显示「N selected」），并把父/虚拟父行的展开三角从名称左侧移到名称右侧
  （`folder-label` 不再 flex 撑满、计数徽标 `margin-left:auto` 靠右）。
  *为什么：* 用户决定 favorites 只保留单文件夹、标题栏不再展示路径、三角统一放名称右侧。`tsc` 通过。

### Added
- **网格空白处右键改用内置菜单，仅含 `Paste`（激活/禁用两态）。**
  `surfaces/GeneratedAssetStoreSurface.tsx` 给网格容器加 `onContextMenu`（命中容器自身或空状态占位时
  `preventDefault` 阻止浏览器原生菜单），`ContextMenuState` 新增 `blank` 标记；空白菜单只渲染 Paste，
  剪贴板有内容时可点，否则禁用（新增 `asset2d-store__context-item--disabled` 样式）。
  *为什么：* 用户反馈空白处右键弹出的是浏览器原生菜单，期望与卡片一致的内置菜单并提供 Paste。`tsc` 通过。

- **资产右键菜单新增 `Cut`，Transport 子菜单新增 favorites 分组目标。**
  `surfaces/GeneratedAssetStoreSurface.tsx`：`Cut` 复用剪贴板机制（`clipboardMode`），
  粘贴时先复制到目标再删除原件（只读 preset 不显示 Cut）；Transport 子菜单除真实文件夹外，
  追加 favorites 虚拟分组（`__favorites__/<group>`），点击经新 `moveAssetsToFavoriteGroup`
  路由把资产收藏并归入该分组。`generatedAssetsApi.ts` 新增对应 API 与 `favoriteGroup` 类型字段。
  *为什么：* 用户反馈 Transport 看不到 favorites 新建的子分组、且缺少 Cut；补齐两项操作。`tsc` 通过。


- **资产库 `favorites` 虚拟栏目内不再重复显示收藏五角星角标。**
  `surfaces/GeneratedAssetStoreSurface.tsx` 的卡片角标渲染条件由 `asset.favorite`
  收紧为 `asset.favorite && folder !== FAVORITES_FILTER`——其余栏目里收藏过的
  资产仍展示黄色五角星，但进入 favorites 栏目后语境已表明「全是收藏」，去掉冗余角标。
  *为什么：* 与电池/模板收藏视图保持一致——真正的收藏列表内不再重复提示已收藏。`tsc` 通过。

### Added
- **Preview 元信息新增 `Location` 行——提示图片所在菜单，二级菜单用 `xx/xx` 表示。**
  `surfaces/ImagePreviewSurface.tsx` 在 Size/Blob 行下新增整行 `Location`，取 `selected.folder`
  （后端 folder 本就编码为 `top` 或 `top/child` 路径），空 folder 显示 `All Images`。
  *为什么：* 让用户一眼看出当前预览图属于哪个栏目/子栏目。`tsc` 通过。

### Changed
- **`All` 栏目现在也显示 `presets` 预设图片，预设仍保持只读（不可重命名/删除）。**
  后端 `backend/src/assets/generatedAssets.ts:277` 由「仅 `folder=presets` 才追加预设」改为
  「`presets` 列与无 folder 的 `All` 视图都追加」；前端 `assetFolderTree.ts:150` 的 `All`
  计数相应加上 `presetCount`。预设记录仍带 `readonly: true`，右键增删/重命名守卫不变。
  `backend/tests/generated-assets.test.ts` 新增 `indexItems()` 助手，针对仅校验文件索引的用例
  过滤掉只读预设。*为什么：* 满足「All 聚合全部资产」诉求，同时不破坏预设只读特性。
  17 个后端用例 + 4 个前端树用例通过。
- **右侧编辑器面板标题 `2D Scene Asset Generator` 改为 `Asset Generator`，且
  Preview 标题栏不再显示当前图片别名。** 编辑器标题在 `WorkbenchHost.tsx`
  `<Editor title>` 处改名；Preview 工具栏（`surfaces/ImagePreviewSurface.tsx`）
  删除 `.asset2d-preview__subtitle`（原显示 `selected.alias` / 占位文案），仅保留
  `Preview` 标题。图片别名仍在下方 `Alias` 元信息处可见。*为什么：* 标题与左侧
  导航命名统一为 Asset Generator；Preview 顶栏避免与图名重复、更简洁。`tsc` 通过。

### Fixed
- **点击 `presets` 列的预设图片时，右侧 Preview 不再空白。** `surfaces/ImagePreviewSurface.tsx`
  的跨 iframe 选图回调原来固定调用 `listGeneratedAssets()`（无 folder），而后端有意
  将预设排除在 "All" 之外、只在 `folder=presets` 时返回（`backend/src/assets/generatedAssets.ts:277`），
  导致预设别名永远 `match` 不到、`setSelected` 不触发。现按别名前缀判断：`preset:` 别名
  改用 `listGeneratedAssets('presets')` 拉取后再匹配。图片字节本就由 blob 路由经
  `readPresetAsset` 正常服务，无需后端改动。*为什么：* 修复预设预览空白。`tsc` 通过。
- **Templates 模式补齐 `template-categories` 数据源——修复内置模板电池 "text to image" 在左栏不显示。**
  上一条已把模板电池正确落到 `batteries/templates/2D/text to image/`，`GET /api/v1/group-templates`
  也确返回该电池（`category:"2D"`/`displayGroup:"templates/2D"`）。但本 app 的后端缺
  `GET /api/v1/group-templates/template-categories` 路由、前端 `HttpApiClient` 缺
  `listTemplateOnlyCategories()`（对比可工作的 `wb-scene-generator` 二者皆有）。缺失后
  `BatteryBar` 的 `templateCategories` 恒为空（`apiAdapter` 在 client 无此方法时回退 `[]`），
  Templates rail 的大标签便仅能依赖"电池自身 category"——与电池目录同一次 fetch 强耦合，
  目录拉取时序/缓存稍有偏差即整栏空白。现按 `wb-scene-generator` 对齐：`backend/src/routes/
  groupTemplates.ts` 新增扫描 `templateRoots` 子目录（含空占位）的 `template-categories` 路由；
  `frontend/src/api/HttpApiClient.ts` 新增对应 `listTemplateOnlyCategories()`。这样 rail 大标签
  由独立目录列表稳定供给（即便电池列表瞬时为空也显示分类占位），与真正的模板电池解耦。
  *为什么：* 本 app 此前从未实现该范式，致 Templates 栏依赖唯一数据源；补齐后与已验证可用的
  `wb-scene-generator` 完全一致，`curl /template-categories`→`["2D"]`、`curl /group-templates`
  含 `tpl_text_to_image`，前端硬刷新后即在 Templates 模式 2D 大标签下显示该模板电池。

### Added
- **AssetStore 左侧菜单升级为二级目录树 + 右键管理 + 子菜单拖拽排序；`user` 列更名 `staging` 并新增可建子菜单的 `user` 列。**
  前端树构建/持久化抽到 `frontend/src/surfaces/assetFolderTree.ts`（`buildFolderTree` 把后端扁平
  `folder`(`parent` / `parent/child`) 还原为父子树；`openMap`(展开态) 与 `orderMap`(子菜单顺序)
  持久化到 `localStorage`，含单测 `__tests__/assetFolderTree.test.ts` 4 项）。
  `GeneratedAssetStoreSurface.tsx`：父菜单点击仅切展开/收起（非小三角，`ChevronRight` 仅作指示），
  叶子/子菜单点击才选中；右键空白可"新建大菜单"，右键条目可"新建子菜单 / 删除菜单条目"（非空目录弹确认
  连同图片删除）；子菜单仅在同父内 HTML5 拖拽排序；`presets/favorites/all` 及固定列 `ai/grayscale/
  processed/staging` 不可建子菜单、不参与拖拽。Import 目标默认值 `user`→`staging`。
  后端 `backend/src/assets/generatedAssets.ts`：新增 `slugFolderPath`(逐段 slug 多级路径)、
  `scanFolderDirs`(扫描真实目录含空文件夹，使空菜单也出现在 `listGeneratedFolders`)、
  `createGeneratedFolder`/`deleteGeneratedFolder`(`node:fs` 目录 CRUD，单级嵌套校验、固定/虚拟列拒绝、
  删除递归连带索引清理) 及路由 `POST /api/v1/generated-assets/folders[/delete]`(`routes.ts`)；
  一次性幂等迁移 `migrateUserToStaging` 以 `generated/.user-staging-migrated` 哨兵文件兜底，迁移后
  `user` 释放为常规可建子菜单的列、绝不再被折叠进 `staging`。同时修正 `listGeneratedAssets` 仅在
  `presets` 虚拟列追加预设图，未筛选的 "All" 视图回归索引（与 UI 计数 All=ai+grayscale+processed+…一致）。
  *为什么：* 用户要求菜单支持二级目录、右键增删、子菜单内拖拽且状态持久化，前端树须严格对应后端
  `.forgeax` 文件夹结构（大菜单=标题父目录、子菜单=真实图片文件夹）。后端 17 项、前端 4 项测试全绿，
  backend/frontend `tsc --noEmit` 均通过。
- **「新建菜单/子菜单」改用应用内弹窗（仿 Save-as-Preset），并支持中文菜单名。**
  `GeneratedAssetStoreSurface.tsx` 右键菜单不再调用浏览器原生 `window.prompt`：新增 `createPrompt`
  状态与一个 lime 主题模态框（`.asset2d-store__dialog-*`，覆盖层点击/`Esc` 关闭、回车确认、自动聚焦
  输入框），结构与编辑器「保存为预设」一致但用本 app 强调色而非节点绿。后端 `slug()`(ASCII 文件名)
  保持不变，新增 `slugFolderSegment`(`generatedAssets.ts`)：文件夹/菜单名保留 Unicode 字母数字（含
  CJK），仅剥离标点/符号/路径分隔符，`slugFolderPath` 改用之。*为什么：* 用户反馈原生 prompt 风格突兀
  且中文菜单名（如「高反射」）被 ASCII slug 清空导致 `create folder failed: 400`；现中文菜单可正常创建，
  测试新增 `user/高反射` 用例，17 项全绿。
- **菜单弹窗样式与编辑器「Save as Preset」对齐（仅配色不同）。** `GeneratedAssetStoreSurface.css`
  的 `.asset2d-store__dialog-*` 结构/间距/圆角/阴影/模糊/按钮形态全部对齐 `.tp-save-*`：补齐此前缺失的
  `--danger`（红色调，与 `--confirm` 同形，修复删除按钮渲染成浏览器默认白底按钮）与 `__dialog-message`
  样式，关闭按钮 padding/字号、label `text-transform:uppercase`、弹窗底色对齐。仅强调色保持本 app 的
  lime（而非节点绿）。*为什么：* 用户反馈删除/新建弹窗与 Panel 保存弹窗"质感不同"，要求除配色外样式直接迁移。
- **父菜单选中即作为子树 ALL + 新建/删除弹窗英文化 + 左右两栏隐藏滚动条（保留滚动）。**
  ① `GeneratedAssetStoreSurface.tsx` 父菜单点击在切换展开的同时 `setFolder(node.top)` 选中自身，后端
  `listGeneratedAssets`(`generatedAssets.ts`) 的 folder 过滤由精确匹配改为「自身 OR `folder/...` 前缀」，
  使选中父菜单显示其下所有子菜单的图片（固定/叶子列无子级，等价精确匹配）。② 新建菜单/子菜单与删除确认
  弹窗文案全部改英文（New menu / New sub-menu / Menu name / Delete menu / Cancel / OK / Delete 等）。
  ③ `.asset2d-store__folders` 与 `.asset2d-store__grid` 加 `scrollbar-width:none`/`-ms-overflow-style:none`/
  `::-webkit-scrollbar{display:none}`，隐藏滚动条但保留滚轮/拖拽滚动。*为什么：* 用户要求父菜单充当该组
  ALL、增删界面统一英文、两栏不显示滚动条但可滚。后端新增「父菜单子树 ALL」用例，18 项全绿，tsc 通过。


  `backend/src/routes/groupTemplates.ts` 新增 `readPreviewImage(jsonFile)`：扫描该 template json 所在
  文件夹，挑首张受支持图片（优先 `icon.png`，否则按文件名排序取首张，确定性），编码为
  `data:<mime>;base64,...` 注入 `GET /api/v1/group-templates` 的 `iconPng`（仅 `templates` kind，
  `groups` 不读）。前端 `BatteryBar` 早已渲染 `battery.iconPng`（`.battery-row-thumb-img`
  `object-fit:cover` + 默认 `object-position:center`）——等比裁切铺满展示框、展示图片中段，无图回退
  "No preview"。故只补后端读图、无需改内核前端。`text to image` 模板因文件夹含
  `ai-...-mq85h8vo.jpg` 现自动显示其为预览（实测 `iconPng` 为 715KB data URL）。
  *为什么：* 用户要求每个 template 文件夹内若有图片即作前端预览图、等比铺满居中；本 app 后端此前
  只读 `icon.svg` 不读位图，Templates thumb 恒为 "No preview"。
- **AssetStore 右键菜单新增 Add to favorites + 图片右上角五角星 + 左侧 `favorites` 虚拟标签（跨文件夹、不复制）。**
  收藏只在记录上翻一个 `favorite` 布尔位——绝不复制图片，收藏后图片仍是原文件夹里的同一份。后端
  `backend/src/assets/generatedAssets.ts` 新增 `favorite?` 字段、`FAVORITES_FILTER='__favorites__'` 跨文件夹虚拟列
  （`listGeneratedAssets` 在 slug() 前特判该 token 返回所有收藏项；`listGeneratedFolders` 在有收藏时追加合成计数项）、
  `setGeneratedAssetFavorite`；`backend/src/assets/routes.ts` 新增 `POST /api/v1/generated-assets/:alias/favorite`；前端
  `generatedAssetsApi.ts` 新增 `setAssetFavorite`，`GeneratedAssetStoreSurface.tsx` 接入菜单项 + 五角星徽标 + 在 `presets`
  与 `All` 之间插入 `favorites` 虚拟标签（行为同普通标签、可滚轮进入），`GeneratedAssetStoreSurface.css` 加
  `.asset2d-store__fav-badge`。

### Changed
- **Transport 二级菜单（fly-out）按视口边缘自动左/右翻转，靠右时不再被裁切。** 默认向右展开（`left:100%`），打开时用
  父菜单实测 `getBoundingClientRect` 判断右侧是否有 ~150px 余量，不足则加 `--left` 修饰类改向左展开（`right:100%`）。落点：
  `GeneratedAssetStoreSurface.tsx`（`transportFlip` state + `onMouseEnter` 计算），`GeneratedAssetStoreSurface.css`
  （`.asset2d-store__context-submenu--left`）。
- **AssetStore 右键菜单做视口内 clamp，靠边时不再被相邻面板挡住/裁切。** 菜单 `z-index` 提到接近 int32 上限，且在打开时
  按估算尺寸 clamp、挂载后用实测 `getBoundingClientRect` 再修正位置，始终完整落在本 surface（iframe）视口内。落点：
  `GeneratedAssetStoreSurface.tsx`（`onCardContextMenu` 估算 clamp + 新增 `menuRef` 测量修正 effect），
  `GeneratedAssetStoreSurface.css`（`.asset2d-store__context-menu` / `__context-submenu` 的 `z-index`）。
- **Transport 移动后停留在原文件夹，不再自动跳转到目标文件夹。** 去掉 `onTransport` 里的 `setFolder(destFolder)`，
  reload 后被移动的卡片自然从当前视图消失（`GeneratedAssetStoreSurface.tsx`）。

### Added
- **AssetStore 顶栏新增「视图」下拉，支持 Grid / List 两种卡片布局（仿照
  wb-scene-generator 的 AssetStoreSurface 视图切换）。** 顶栏 Import Files 与全屏
  按钮之间加入图标式视图下拉（`asset2d-store__view*`），默认 Grid；切到 List 时网格
  容器加 `asset2d-store__grid--list` 修饰类，单列一行展示——44px 左侧缩略图 + 名称/详情
  右侧铺开，便于在大量资产中快速扫读。同时**整体缩小 Grid 卡片**：`asset2d-store__grid`
  `minmax(148px→120px)`、`gap 12→10px`，缩略图 `min-height 120→96px`，缓解原先每张图
  过大的问题。新增两枚描边图标 `LayoutGrid` / `List`（`surfaces/icons.tsx`，与
  scene-generator 同款）。落点：`frontend/src/surfaces/GeneratedAssetStoreSurface.tsx`
  （`ViewMode` / `VIEW_OPTIONS` / `viewMode` state + 顶栏下拉 + grid 修饰类）、
  `GeneratedAssetStoreSurface.css`（`--view-*` 下拉样式 + `--grid--list` 布局 + 缩小网格）、
  `frontend/src/surfaces/icons.tsx`。*为什么：* 用户希望资产库支持紧凑列表视图，且现有
  网格图片偏大、一屏看到的资产太少。

### Changed
- **左侧菜单 Help 区块改为按内容自适应高度、随左栏整体滚动，与 wb-scene-generator
  一致。** 原本 Help 与其它区块一样被 JS 写死的像素高度（`heights.help`，默认
  160px）框住、内容在该固定盒内单独滚动，导致帮助文字被挤成一小条且无法继续向下
  滑动；现 Help 区块（最后一个 section）不再裁剪：`SceneGeneratorControlsPanel.tsx`
  把该 section 的 `height` 改为 `minHeight`（保留拖拽手柄给上方 DataTypes 的语义、
  只作下限），并加 `editor-controls__section--help` 修饰类；`WorkbenchLeftPane.css`
  对该类设 `overflow:visible` 且其 `.editor-controls__section-content` 改
  `flex:0 0 auto; overflow:visible`，让帮助内容按自然高度铺开、由外层
  `.scene-left-pane`（已 `overflow-y:auto`）统一滚动。落点：
  `frontend/src/workbench/SceneGeneratorControlsPanel.tsx`、
  `frontend/src/workbench/WorkbenchLeftPane.css`。*为什么：* 对齐 scene-generator
  的帮助栏体验——帮助内容应完整展示并可随整栏滚动，而非困在一个矮固定盒里被裁切。

### Added
- **AssetStore 资产右键菜单新增 Transport / Copy / Paste，并新增后端「移动 / 跨文件夹复制」接口。** 旧右键菜单仅有
  `Rename`（单选）与 `Delete`。现新增：① `Transport ▸` 二级菜单——列出当前文件夹外的所有可写文件夹（永不含只读
  `presets`），点击把选中资产**物理移动**过去并跳转到目标文件夹；② `Copy`（单选）——只在前端 state 记录被复制资产的
  `alias`（不碰系统剪贴板，规避 iframe 沙盒对 `navigator.clipboard` 写图片的限制，给用户的体验是「记下了这张图」）；
  ③ `Paste`——把剪贴板里的资产在**后端**复制一份到当前文件夹（All/presets 视图下落到 `user`，与 Import-to 默认一致），
  前端无实际图片搬运、仅路径/引用信息流转。落点：后端 `backend/src/assets/generatedAssets.ts` 新增
  `moveGeneratedAssets`（read→write 新 relPath→remove 旧文件，按 `blobId` dedup 守卫）与 `copyGeneratedAssetToFolder`
  （按 alias 读源 bytes 经 `importGeneratedImage` 落入目标 folder，保留原图），`backend/src/assets/routes.ts` 新增
  `POST /api/v1/generated-assets/move`、`POST /api/v1/generated-assets/copy-to-folder`；前端
  `frontend/src/surfaces/generatedAssetsApi.ts` 新增 `moveGeneratedAssets`/`copyAssetToFolder`，
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` 接入菜单 + 处理函数，`GeneratedAssetStoreSurface.css` 加二级
  菜单样式。*为什么：* 用户要在文件夹间整理生成资产，且 copy/paste 走纯引用、避开沙盒。

### Changed
- **AssetStore 左侧标签栏支持鼠标滚轮切换，`presets` 标签置顶、视觉区分且只能点击进入。** 标签栏改为有序模型
  （`presets` 置顶 → `All` → 其余按名），`presets` 加 `--preset` 样式（sticky 顶部 + 冷色紫调填充，与普通用户文件夹
  区分）。滚轮规则：在 `presets` 时可向下滚出到其它标签；在其它标签时滚动**永不回到** `presets`（`presets` 仅点击进入，
  滚轮下界 clamp 到首个非 preset 标签）。同时 `Import to` 下拉在 All/presets 视图下不再显示 `current (x)`，直接以
  `user` 为目标。落点：`frontend/src/surfaces/GeneratedAssetStoreSurface.tsx`（`tabs`/`onTabsWheel`/`transportTargets`/
  `inWritableFolder` 派生 + `<aside onWheel>` 重写），`GeneratedAssetStoreSurface.css`（`.asset2d-store__folder--preset`）。
  *为什么：* 标签多时滚轮切换更顺手，且 `presets` 是只读源应固定、不被滚轮误入。


  `findFacadeRegions` 对所有相连立面做 4-邻 flood-fill 合成**一个包围盒**，T/十字形房屋的
  左/中/右翼立面彼此相连被并成一个 region，`doorCount=1` 时门恒落在该包围盒的 `leftCol`/
  `bottomRow`——即最左那面墙，其余墙永远没门。现改为识别**墙面前沿**（`findWallFronts`：逐格找
  「本格是立面、正下方不是立面」的底边格，按行内连续段聚合，每段是一面可放门的独立墙），`AddDoors`
  对前沿做 Fisher–Yates 洗牌后分配：门数 ≤ 墙数时随机抽**不重复**的墙、门数 > 墙数时每面墙至少
  一扇余下随机洒落；`addDoorToFront` 取代 `addDoorToRegion`，门只向上覆盖本墙脚的连续立面格
  （`isFacadeCell` 守卫，不越过墙顶进屋顶/空白），墙内横向位置仍按居中/角落/侧边随机。落点：
  `batteries/image/house/house_template/index.ts`（删 `findFacadeRegions`/`addDoorToRegion`，新增
  `WallFront`/`isFacadeCell`/`findWallFronts`/`addDoorToFront`，重写 `AddDoors`，更新头注释），
  `meta.json`（description/-en + doorCount 说明），`README.md`。*为什么：* 用户实测门只在左侧一面墙，
  预期三面墙都有出现门的可能。已用 T 形输入按 `doorCount=1`（多种子分别落在左/中/右）与 `doorCount=3`
  （三面墙各一扇）渲染 PNG 目视确认。

### Changed
- **`image_gen` 的 `image` 参考图端口从 `access:'item'` 改为 `access:'tree'`，并在节点内把整棵参考图树拍平成一个数组，实现「多图一次生图」。** 旧实现 `image` 为 item 端口、`imageGen()` 用 `stringValue(input.image)` 只取单张，dispatcher 又按 item 叶子 path fanout——经 Merge 合并的多张参考图会被拆成多次生成（每次只带一张），违背「两张图一起参考生成」的诉求。现 `image` 改为 tree 端口：dispatcher 把整棵原始树原样喂入、绝不 fanout（见 `packages/node-runtime/src/layer1/dispatcher.ts:408`、`callOnce` 行 215-217）；`imageGen()` 新增 `collectImageAliases()` 遍历 `tree.branches()` 收齐所有非空字符串 alias、拍平为一个数组，在【单次】`generateImage({ images })` 调用里一并发给 Gemini，与底层 `generateImageAsset` 的 `inputImages` 多图能力（`backend/src/ai/imageGeneration.ts:128-137`）对齐。`prompt`（item）端口的 fanout 不受影响（tree 端口不参与对齐）。无论上游 Merge 走 item 档还是结构 pack 档，所有参考图都进同一次调用。落点：`batteries/ai/providers/ImageGen/meta.json`、`batteries/ai/providers/ImageGen/index.ts`；测试 `backend/tests/imagegen-datatree.test.ts`（新增「多分支参考图树→单次调用、images 收齐」用例）。

### Added
- **Templates 模式现含内置模板电池 "text to image"（修正上一条 Added 的落点）。** 上一条把
  "text to image" 落成了 pipeline-import 模板（`apps/.../templates/*.json`，供顶栏 Open 对话框
  `GET /api/v1/pipeline/import`），但用户要的是工具栏 **Templates 模式** 左栏——该栏由
  `GET /api/v1/group-templates` 扫描的成组电池（`NodeGroup`）驱动，落点是
  `batteries/templates/<cat>/<name>/<name>.json`（见 `backend/src/routes/groupTemplates.ts`
  `appTemplateRoot`/`KINDS`），而该目录此前为空 → 故重启后仍显示 "No templates"。现新增内置成组
  电池 `batteries/templates/2D/text to image/text to image.json`：把 Default Asset Workspace 的
  文生图整链（`text_panel(prompt) → image_gen → image_remove_bg → image_pixel_fix →
  image_pixel_scale → image_output`，含 `image name` 文本面板与三个 `number_const`：
  lab_tolerance=13 / width=64 / height=64）打包为一个 `NodeGroup`（10 节点 9 边），暴露终端
  `image_output.alias` 为外部输出。它经 `listGroupTemplates → groupTemplateToBattery`
  （`displayGroup:"templates/2D"`）进入电池目录，`getBigLabel`→`templates` 使其出现在 Templates 模式
  rail。*为什么：* 用户的"插件内置 template"指的是 Templates 模式可拖拽的成组电池，而非 Open 对话框的
  图谱导入文件；上一条放错了系统，故按 Templates 模式的真实数据源补一个内置 group-template。
  （上一条的 pipeline-import 内置模板保留——它是 Open/导入对话框的独立有效能力，无冲突。）
- **（前序）新增 pipeline-import 内置图谱模板 "text to image"，模板列表/导入/新建工程模板支持「内置 + 用户」双源。**
  把 Default Asset Workspace 当前的电池链（`text_panel → image_gen → image_remove_bg →
  image_pixel_fix → image_pixel_scale → image_output`，含两个 `text_panel`（prompt / 图片名）
  与三个 `number_const` 参数）固化为随插件版本控制的内置模板
  `apps/wb-2d-scene-asset-generator/templates/text to image.json`（`kernel-graph-v1`，10 节点 9 边，
  去掉运行时 `hash`）。后端 `backend/src/routes/pipelineImport.ts`：新增 `BUILTIN_TEMPLATES_DIR`
  （app 根 `templates/`），`GET /api/v1/pipeline/templates` 现合并「内置（`source:'builtin'`）+
  用户（`<projectRoot>/templates/`，`source:'templates'`）」两源、同名文件用户胜出、按 name 排序；
  `resolveTemplatePath` 先查用户目录再回退内置目录，故 `POST /api/v1/pipeline/import` 的 `file.path`
  既能导入用户模板也能导入内置模板。`backend/src/routes/projects.ts` 的 `resolveTemplate`
  （新建工程 `fromTemplate` 级联）同样改为用户优先、回退内置。前端无需改动——`PipelineFileDialog`
  本就渲染 `t.source`，内置模板显示为 "kernel-graph-v1 - builtin"。*为什么：* 用户希望把默认工作区那条
  文生图电池链沉淀为开箱即用的插件内置模板，复用既有文本预设的「内置只读 + 用户可写」双源范式，
  内核保持领域无关（仅 app 后端改动）。`tsc --noEmit` 通过；`presets/store.test.ts` 全绿。

### Added
- **从 Asset Store 拖图片直接落到已有 `image_source` 节点上 → 替换该节点的图片，而非新建节点。**
  此前无论落点在哪，跨 iframe 图片拖拽都只走画布的 `onExternalDrop`（`WorkbenchHost.handleExternalDrop`）
  新建一个 `image_source` 节点。现给 `ImageSourceNode`（`frontend/src/workbench/ImageSourceNode.tsx`）
  外层 wrapper 加 `onDragOver`/`onDragLeave`/`onDrop`：当 `readDraggedAsset()`
  （`surfaces/library/draggedAssetBus.ts`）有值时 `stopPropagation` 拦截冒泡到画布，改用
  `usePipelineStore.getState().updateNodeParam(id, 'image'|'alias', …)` 就地写入图片
  （`image_source` 非 AI 电池，`updateNodeParam` 会顺带 `incrementalExecute` 刷新输出端口）；
  无拖拽资产时不拦截，事件照常冒泡到画布，保持空白处新建节点的原行为。配套 `ImageSourceNode.css`
  新增 `.asset2d-image-source-node.is-drag-over` 拖拽悬停高亮（虚线描边 + 加强 glow），让「替换」
  目标清晰可辨。*为什么：* 已有节点上换图不应再产生一个重复节点，符合「拖到电池里」的直觉。

### Changed
- **左侧 Workbench 导航的两行标签重命名并统一顺序，与右侧中央三块面板一一对应。**
  原面板开关行（`Asset Folders` / `Image Preview` / `Asset Graph`）与下方分组切换行
  （`Asset Graph` / `Asset Folders` / `Image Preview`）文案与右侧面板名（编辑器 `Editor`、
  `AssetStore` iframe、`Preview/Renderer` iframe）不一致且两行顺序互不一致。现两行均改为
  **`Asset Generator`（=编辑器 `LS_EDITOR`）/ `AssetStore`（=`LS_ASSETSTORE`）/ `Preview`
  （=`LS_PREVIEW`/`rendererInline`）** 的统一顺序（`frontend/src/workbench/WorkbenchLeftPane.tsx`
  面板开关 `EmbedToggle` 行与 `GroupTab` 行）。配套更新引用旧名的文案：空面板占位提示
  （`WorkbenchHost.tsx` `scene-workbench__empty`）、各控制面板帮助标题与交叉引用
  （`AssetFoldersControlsPanel.tsx` → AssetStore/资产库、`ImagePreviewControlsPanel.tsx`
  → Preview/预览、`SceneGeneratorControlsPanel.tsx` 的「Preview & assets / 预览与资产」段）。
  仅改文案与渲染顺序，`storageKey` 与分组 `value` 不变，开关行为与右侧映射保持原状。
  *为什么：* 让左侧标签与右侧面板名一一对应、顺序一致，消除命名歧义。`tsc` 无 lint 报错。

- **`image_gen` 的 `image` 参考图端口从 `access:'item'` 改为 `access:'tree'`，并在节点内把整棵参考图树拍平成一个数组，实现「多图一次生图」。** 旧实现 `image` 为 item 端口、`imageGen()` 用 `stringValue(input.image)` 只取单张，dispatcher 又按 item 叶子 path fanout——经 Merge 合并的多张参考图会被拆成多次生成（每次只带一张），违背「两张图一起参考生成」的诉求。现 `image` 改为 tree 端口：dispatcher 把整棵原始树原样喂入、绝不 fanout（见 `packages/node-runtime/src/layer1/dispatcher.ts:408`、`callOnce` 行 215-217）；`imageGen()` 新增 `collectImageAliases()` 遍历 `tree.branches()` 收齐所有非空字符串 alias、拍平为一个数组，在【单次】`generateImage({ images })` 调用里一并发给 Gemini，与底层 `generateImageAsset` 的 `inputImages` 多图能力（`backend/src/ai/imageGeneration.ts:128-137`）对齐。`prompt`（item）端口的 fanout 不受影响（tree 端口不参与对齐）。无论上游 Merge 走 item 档还是结构 pack 档，所有参考图都进同一次调用。落点：`batteries/ai/providers/ImageGen/meta.json`、`batteries/ai/providers/ImageGen/index.ts`；测试 `backend/tests/imagegen-datatree.test.ts`（新增「多分支参考图树→单次调用、images 收齐」用例）。

- **`house_template` 渲染从「立面 AO 渐变」改为「扁平纯色三档着色」，并让门的横向位置随机分布
  （居中/侧边/角落）。** 原渲染对立面做纵向 AO 渐变（顶/边更暗→底中更亮 `FACADE_TOP=150→
  FACADE_BOTTOM=205` + 边缘压暗 `FACADE_EDGE_DARKEN`）+ 分段压暗，立面像素明度连续变化、与近黑门
  对比弱，建筑「顶面/立面/门」三块界线糊在一起，灰度图作为大模型参考图时轮廓不清晰。现：顶面=深灰
  `COLOR_ROOF 120`、立面=浅灰**纯色平涂** `COLOR_FACADE 192`（多段仅按段次 `FACADE_SEGMENT_STEP 14`
  微压暗以区分相邻段）、门=深灰 `COLOR_DOOR 96`，三档明度拉开对比、边界清晰；`facadeColor` 简化为
  只吃 `segment`，`RenderGray` 立面分支删掉逐像素 AO 深度/边缘扫描改为平涂。门尺寸略放大
  （宽 `0.06–0.09`、高 `0.10–0.14`）确保在浅灰立面上可辨；`addDoorToRegion` 横向位置由原「60% 居中
  + 其余随机」改为按概率分布到**居中(0.4) / 角落贴左右边(0.3) / 侧边半区随机(0.3)**。落点：
  `batteries/image/house/house_template/index.ts`（颜色常量、`facadeColor`、`RenderGray`、
  `addDoorToRegion`、门尺寸常量、头注释），`meta.json`（description/-en + alg_tag），`README.md`。
  *为什么：* 用户要求灰度模版达到「顶面里门分明、易看出建筑模样」的效果以提升大模型识别准确率，并希望
  门位置有随机（不总在正中）。已用 3 个输入形状渲染 PNG 目视确认轮廓清晰、门可辨且位置各异。


  `house_template` 灰度底图作唯一参考图，成品视角/画风全靠提示词自由发挥而漂移；现明确：再接一张
  **风格/视角锚图**（新增 preset `presets-assets/图1.png`，top-down 像素风房屋示例），灰度模版锁形状/比例、
  锚图锁视角/画风，**两图须 merge 成一路再进 `image_gen.image`**——因后端 `resolveNodeImageInputs`
  对该端口**只读一条进边**（`backend/src/ai/imageGeneration.ts:97`），两张各连一条边只生效第一张。
  提示词骨架改为"结构比例严格照灰度图、视角画风严格照锚图、top-down 像素风黑描边"强约束并分别点名。
  落点：`skills/generate-2d-asset/executions/part-c-shaped-house.md`（概述 + 阶段一第 3 点 + ②③）、
  `battery-catalog.md`（PART C 链 + image_gen 行 merge 备注）、`SKILL.md`（PART C 要点提要 + description）。
  *为什么：* 用户反馈装饰房效果差，给出"图1 锚风格 + 图2 锁形状 + 多图 merge"的可用配方。

- **`image_pixel_scale` 改为「直达目标尺寸的最近邻缩放」，弃用 pixel-scale 整数倍方案。**
  原实现移植 `pixel-scale`：检测源图像素倍率→只能产出该 base 网格的**整数倍**尺寸。对真实
  AI 图（检测倍率=1，base=源尺寸）给目标宽 29、源 182 时，`round(29/182)` 退化为 ×1，于是
  原样输出、根本没缩放（用户实测 bug）。现 `_pixelScale` 直接按目标宽/高做最近邻重采样
  （`_nearestResample`，逐通道取单源像素、不插值/混色，保留硬边缘），任意目标尺寸都能命中；
  `_resolveTarget` 解算锁横纵比（目标宽优先/否则目标高推统一比例、另一轴等比；不锁定时各轴
  独立、缺轴回退源尺寸）。移除已无意义的 `max_color_diff` 输入与倍率检测机制；`meta.json`
  标题/描述/tags/alg_tag 同步从「无损/倍率」改为「最近邻缩放」。入口仍 `imagePixelScale`，
  纯算法导出 `_pixelScale` / `_nearestResample` / `_resolveTarget` 保留 `_` 前缀避开 loader
  入口正则。回归测试 `backend/tests/image-processing.test.ts` 的 `image_pixel_scale algorithm`
  块重写（182→29 等比、锁/不锁解算、最近邻不混色、非 4 对齐缓冲，17/17 通过）。落点：
  `batteries/image/processing/image_pixel_scale/{index.ts,meta.json}`。*为什么：* 用户要按目标
  像素宽/高真实缩放，整数倍方案对非整除目标会静默不缩放，不符预期。

- **`generate-2d-asset` PART C 明确 `height` 取值范围与问清要求。** 装饰性房屋高度一般 1–2
  （1 最常见），最多 3–4，极特殊才更高；阶段一第 2 点要求必须问清、别凭空给大值。落点：
  `skills/generate-2d-asset/executions/part-c-shaped-house.md`（C-阶段一第 2 点）、`battery-catalog.md`
  （HouseTemplate 行 `height` 备注）。*为什么：* 用户反馈避免默认给过大高度。

- **`generate-2d-asset` 技能后处理链改用 PixelFix + PixelScale，并将生图尺寸约束改为只定长宽比。**
  三点调整：(1) 像素风单资产/形状房屋成品在抠图后接 `image_pixel_fix`（完美像素修复，还原点对点
  真实像素网格），有尺寸需求再接 `image_pixel_scale`（整数倍最近邻无损缩放），**弃用 `image_resize`**；
  (2) PART C（形状房屋）后处理同样补上 PixelFix→PixelScale；(3) 生图阶段只在提示词里写长宽比
  （`image_gen` 无 width/height 端口），不再写硬像素尺寸——真实分辨率交给下游 PixelFix/PixelScale。
  落点：`skills/generate-2d-asset/executions/part-a-single-asset.md`（阶段一改问比例、第 4 步重写后处理链）、
  `executions/part-c-shaped-house.md`（阶段一第 4 点 + ④ 后处理）、`battery-catalog.md`（Resize 行换成
  PixelFix/PixelScale 两行 + 触发语义）、`pipeline-schema.md`（最小可跑图换成 nobg→pixfix→pixscale）、
  `SKILL.md`（PART A 要点提要 + description）。*为什么：* 用户要求像素图走完美像素修复 + 无损缩放、
  生图阶段只规定比例而非像素尺寸，使流程更贴合像素资产的真实分辨率需求。


- **Preview surface 的 meta 区由 4 行压缩为 3 行，并新增 Alias 行展示资产别名
  （即 Asset Store 左侧的 `ai-preset-…` 名称）。** 原 `<dl>` 把 Prompt / Source /
  Size / Blob 各占一行；现：(1) 新增 `Alias` 单独占满整行（`selected.alias`，带
  `title` 悬浮全名）；(2) Prompt + Source 同一行两列；(3) Size + Blob 同一行两列。
  落点：`frontend/src/surfaces/ImagePreviewSurface.tsx`（meta `<dl>` 改为三个
  `.asset2d-preview__meta-row` 包裹）、`ImagePreviewSurface.css`（原
  `.asset2d-preview__meta div` 规则改为 `.asset2d-preview__meta-row` 两列布局 +
  `--full` 整行修饰，字段 label 列宽 72→56px）。*为什么：* 用户要求把别名显示出来
  并把元信息压缩到三行，节省预览底部空间。

- **`generate-2d-asset` 技能重构为「入口 + 路由」结构，SKILL.md 只留路由与要点提要。**
  原单文件 SKILL.md 把 PART A/B/C 三套管线 + 公共底座/防呆全堆在一处；现拆分为：三条
  pipeline 各成一文件放 `skills/generate-2d-asset/executions/`（`part-a-single-asset.md`
  单资产、`part-b-tileset.md` 瓦片、`part-c-shaped-house.md` 指定形状房屋），公共底座 +
  三 PART 防呆清单移到 `skills/generate-2d-asset/notes/common-base.md`。SKILL.md 现仅含路由表、
  各 PART 要点提要、注意事项索引，并通过相对链接路由到 executions/ 与 notes/；execution 文件
  用 `../` 回链 SKILL 及 `battery-catalog.md`/`pipeline-schema.md`/`tile-pipeline.md`。
  入口仍是 `skills/generate-2d-asset/SKILL.md`（`forgeax-plugin.json:46` 不变）。
  *为什么：* 单文件 426 行过长、检索困难；按「SKILL 路由 + 各部分独立」拆分后格式更清晰，
  改某一条 pipeline 不再牵动整份文档。

### Added
- **新增 `image_pixel_scale`（像素图无损缩放 / PixelScale）电池——像素风专用的
  零质量损失缩放。** 算法移植自 npm 包 `pixel-scale`（`getPixelScale` +
  `scalePixels`）：(1) `detectPixelScale` 找出宽高公约数、从大到小检测每个
  `scale×scale` 块是否为纯色（`max_color_diff` 容差，对 JPEG 等有损来源可放宽），
  最大通过者即源图当前像素倍率（base 网格 = w/scale × h/scale）；(2) `pixelScale`
  由目标宽/高反推每轴整数倍率（四舍五入、>=1），`resampleScale` 用最近邻整数重采样，
  **不改任何颜色**。`lock_aspect=true` 时两轴共用同一倍率（目标宽优先，像素方块不变形），
  `false` 时两轴各取自己的整数倍率（可压扁/拉伸）。端口：输入 `image` / `width` /
  `height` / `lock_aspect`（+可选 `max_color_diff`），输出 `image` / `out_width` /
  `out_height` / `error`，I/O 复用 `_shared/asset2d.ts` 的 `processImage`。入口
  `imagePixelScale` **是唯一 `/^[a-z]/` 命名的导出**（纯算法导出 `_pixelScale` /
  `_resampleScale` / `_detectPixelScale` 一律加 `_` 前缀避开 loader 入口正则——TS→ESM
  转译会按字母序重排具名导出，声明序不可靠，沿用 `image_pixel_fix` 的 loader-entry 教训）。
  落点：`batteries/image/processing/image_pixel_scale/
  {index.ts,meta.json,icon.svg}`，回归测试 `backend/tests/image-processing.test.ts`
  新增 `image_pixel_scale algorithm` 块（倍率检测 / 2x 无损上采样 / 降回 scale 1 /
  非锁定双轴 / 非 4 对齐缓冲，15/15 通过）。`_detectPixelScale` 对 byteOffset 非 4 对齐
  的解码缓冲（JPEG 池缓冲）先拷入对齐缓冲再做 u32 视图，避免 `new Uint32Array` 抛
  「start offset should be a multiple of 4」。*为什么：* 像素图用普通缩放会糊边/混色，
  需要一个按整数倍率、零颜色损失的专用缩放，并支持按目标尺寸 + 锁横纵比驱动。

- **新增 `image_pixel_fix`（像素图修复 / PixelFix）电池——把 AI 生成的「伪像素图」
  还原成真正的点对点像素图。** 算法移植自 Pixel-Fixer（`process_pixel_art.py`）：
  (1) k-means 色彩量化合并一个色块内的几十种相近噪色（`k_colors` 可指定或 0=自动
  探测视觉主色，`autoDetectK`）；(2) 对量化图按行/列算梯度投影、找峰间距估计像素块
  步长（`computeProfiles` / `estimateStepSize`）；(3) 从 0 起按步长「网格行走」并在
  峰值附近吸附切割线、不足则均匀回退稳定化（`walk` / `snapUniformCuts` /
  `stabilizeAxis`）；(4) 每个检测格子内取众数调色板色重采样为一个输出像素
  （`resample`）。I/O 复用 `_shared/asset2d.ts` 的 `processImage` 委托后端解码/编码，
  电池只做纯像素算法，输出真实像素分辨率的小图。端口：输入 `image`（+可选
  `k_colors`），输出 `image` / `width` / `height` / `error`。纯算法入口 `_pixelFix`
  以 `_` 前缀避开 loader 入口正则 `/^[a-z]/`（沿用 `image_atlas_compose` 的
  loader-entry 教训，确保选 `imagePixelFix` 作 execute 入口）。落点：
  `batteries/image/processing/image_pixel_fix/{index.ts,meta.json,icon.svg}`。
  *为什么：* AI 出的像素图像素块大小不一、边缘模糊抗锯齿，需要一步把它规整成可用的
  点对点像素资产。`tsc -p batteries/tsconfig.json` 通过。

### Fixed
- **图像电池节点（`ImageBatteryNode`，画布上标 `image` 的预览框）的画布预览图加上
  `image-rendering: pixelated`。** `frontend/src/workbench/ImageBatteryNode.css`
  的 `.asset2d-image-preview__img` 此前没有 `image-rendering`，浏览器对放大的像素图
  做了双线性插值导致发糊。`ImageSourceNode` / `ImagePreviewNode` 早已是 `pixelated`，
  这里补齐保持一致。*为什么：* 像素资产应点对点显示，插值会破坏像素边缘。
- **`image_atlas_compose`（图集合成）的 loader-entry bug 真正落地修复——此前
  CHANGELOG 已记录该 fix，但源码里 helper 仍叫 `composeAtlas`，重命名从未应用，
  导致 bug 重启后依旧复现（用户实测 `template width undefined must be divisible
  by 4`，且 terrain 用 alias、template 用 data URL）。** 经验证 data URL 解码链
  （`readImageBytesFromRef` → `decodeImageBytes`）完全正常（独立解码该 64×80
  模版得到正确尺寸），根因仍是 battery loader 取「首个小写字母开头的导出函数」
  作 execute 入口（`/^[a-z]/`，ESM 命名空间按字母序枚举），`composeAtlas` 排在
  真正入口 `imageAtlasCompose` 之前被误选 → 整个 input 当 terrain、ctx 当
  template → `template.width` 为 undefined。本次把 helper 实际重命名为
  `_composeAtlas`（`_` 前缀落在正则外）、同步改 `imageAtlasCompose` 调用处与
  `backend/tests/image-processing.test.ts` 引用，并在导出处加注释钉死该约定。
  live `POST /api/v1/execute` 验证 compose 现 `status:completed`、产出与模版同
  分辨率(64×80)的 atlas、无 error；`image-processing.test.ts` 10/10 通过。

### Changed
- **`skills/generate-2d-asset` PART C 修复「AI 生的房屋不按底图形状」根因：把提示词骨架
  改成『视角对齐底图 + 强约束』，并补排查口诀。** 现象排查结论：底图**确实已作为参考图传入**
  生图网关（`image_gen.index.ts` 把 `image` 端口值作 `images:[image]`、后端
  `imageGeneration.ts` 解析为 base64 `inputImages` 发出），所以**不是"图没传"**；真正根因是
  ①**视角/投影不一致**——`house_template` 底图是一张**平面正交正视立面图**，而提示词此前允许
  「2.5D/正交侧视」，等距/透视成品的轮廓与平面底图根本无法一一对应，模型只能自由发挥；
  ②**提示词约束太软**（"遵循一下轮廓"而非强令)。修复落点 `skills/generate-2d-asset/SKILL.md`：
  C-阶段二 ② 的英文提示词骨架重写为强约束句式（`STRICT structural template / EXACTLY matches /
  Do NOT add/extend/rotate / white = empty / flat 2D front orthographic, no perspective, no
  isometric`），并新增"形状没跟"排查口诀（图传没传→视角对不对→约束够不够强，强调多半是视角不齐
  而非图没传）；C-阶段一第 3 问与方案话术、PART C 防呆、`battery-catalog.md` 同步加上「成品视角
  必须 flat 2D 正交正视、禁透视/等距」这条头号铁律。*为什么：* 图生图要"严格跟形状"，成品视角
  必须与平面底图一致且提示词强约束；视角不齐时再强的措辞也跟不住，这是此前 PART C 漏掉的关键。

  并给立面加环境光遮蔽(AO)渐变着色 + 新增 `doorCount`/`height` 端口。**（接上一条
  json→string 改动的迭代：上一版把二维数组当作「已表达屋顶/墙体/门的成品掩码」逐格
  上色，立面是单一平色；现按用户需求改为——输入只表达**房顶**的二维数组字符串
  `[[1,1,0],[1,1,1]]`，立面由程序沿屋顶形状按 `height` 向上投影自动生成，门在立面
  底部自动添加。）落点 `batteries/image/house/house_template/index.ts`：恢复
  `ExpandMask/OffsetByHeight/DifferentiateFacades/AddDoors` 投影管线（房顶=1、立面=2/
  多段 3,4…、门=9），`AddDoors` 改为按 `doorCount` 放置且优先大立面、门居中偏置；
  `RenderGray`/`facadeColor` 重写为**立面 AO 着色**——纵向（贴屋顶顶部最暗→底部最亮）
  + 横向（左右边缘更暗→中心更亮）+ 分段整体压暗（`FACADE_TOP/BOTTOM/EDGE_DARKEN/
  SEGMENT_STEP` 常量），使不同立面段彼此区分、不再是单一颜色。`meta.json`：`spec`
  端口语义改为「房顶掩码」，新增 `doorCount`(默认1) / `height`(默认3) 两个 number
  端口，参数恢复 `seed`。输出端口（`image[]` + `error`）不变。
  *为什么：* 上游只应给出房顶布局，立面与门是确定性几何，应由电池据形状自动推导；
  且立面需有 AO 明暗层次（参考环境光遮蔽图）而非死板平色。

 原电池接收
  `{entries:[{mask,height}]}` 形式的 JSON，再经五步（顶部补高 → 高度投影立面 →
  区分多段 → 缩放并随机加门 → 渲染）从二值脚印 + 高度推导出立面与门。现改为接收一个
  二维数组字符串 `[[...],[...]]`（也兼容三维 `[[[...]]]` 批量），**输入即最终结构**，
  逐格按约定填充值映射为灰度，不再做任何几何推导：`0`=背景(255)、`1`=屋顶(127)、
  `2`=墙体(191)、`3`=门(60)；掩码等比缩放居中到 `imageSize²`（非方形不拉伸）。
  落点：`batteries/image/house/house_template/index.ts`（重写 `RenderGray` /
  `MaskToHouseGray` 为按值映射 + 居中缩放、新增 `ParseMasks` / `VALUE_*` 常量，删除
  `Expand/Offset/Differentiate/AddDoors` 等推导步骤）、`meta.json`（`spec` 端口
  `json → string`，删除已无用的 `addDoors` / `seed` 参数）、`README.md`。输出端口
  （`image[]` + `error`）不变。*为什么：* 改由上游直接给出已表达屋顶/墙体/门的二维
  掩码，电池只负责「二维列表 → 灰度图」的纯转译，去掉与上游重复且不可控的随机推导。


- **拖拽 presets 栏目（插件内置预设）图片到画布时，`image_source` 节点无法预览
  （破图）；而 `.forgeax` 生成图正常。** 拖拽时 `encodeDraggedAssetRef`
  （`frontend/src/surfaces/library/draggedAssetBus.ts`）把资产编码成
  `{alias,blobId}`，`ImageSourceNode.imageRefToSrc` 优先用 `blobId` 走
  `/api/v1/library/blob/:id` → `readGeneratedAssetByBlobId`。但该函数只查
  file-backed 的 `_asset2d-index.json`，而预设记录是 `listPresetAssets()`
  运行时派生、从不写入索引（`backend/src/assets/generatedAssets.ts:225`），故预设
  blobId 命中不到 → 404 → 破图（生成图 blobId 在索引里所以正常）。修复：
  `presetAssets.ts` 新增 `readPresetAssetByBlobId(blobId)`（按 blobId 扫描派生的
  预设列表再读字节），`readGeneratedAssetByBlobId` 在索引未命中时回退到它。
  *为什么：* 预设资产同样需可被 blobId 解析，与按 alias 解析
  （`readGeneratedAsset` 已支持 `preset:`）对齐。

- **前端启动报错 `Failed to resolve import "zustand"`（kernel 源码 alias 模式下无法解析）。**
  `vite.config.ts` 把 `@forgeax/node-runtime-react` 别名到 kernel 源码（`uiStore.ts`
  直接 `import 'zustand'`，且 zustand 是其 peerDependency），但本 app 的
  `frontend/package.json` 未声明 `zustand`，pnpm 因此没把它装到可解析位置（对照
  `wb-scene-generator` 已显式声明）。补 `zustand: ^4.5.0` 到 `dependencies` 后
  `pnpm install`，软链到 app 的 `node_modules`，Vite 恢复解析。

### Added
- **Asset Store 新增只读「presets」栏目（插件内置预设图片，不可删除）。** 新增
  `backend/src/assets/presetAssets.ts`：扫描插件目录 `presets-assets/` 下的图片
  （`.png/.jpg/.jpeg/.webp/.gif`），派生成 `preset:<file>` 别名、`readonly:true`、
  虚拟 folder `presets` 的 `GeneratedAssetRecord`，blob 直接从该目录读取，永不写入
  per-project 的 `generated/_asset2d-index.json`。`generatedAssets.ts` 的
  `listGeneratedAssets`/`listGeneratedFolders`/`readGeneratedAsset` 注入这些记录，
  `deleteGeneratedAsset`(单删) 对 `preset:` 别名返回 null、`deleteGeneratedAssets`
  (批删) 把 `preset:` 过滤出删除集；`GeneratedAssetRecord` 增 `readonly?` 字段。
  前端 `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx`：右键菜单对 readonly
  项不显示 Rename/Delete、目标全只读则不弹菜单，Delete/Backspace 跳过 readonly 项，
  双击标题不改名；`Import to: current` 停在 `presets` 栏时回退到 `user`，避免把用户
  图导入只读栏。`generatedAssetsApi.ts` 的 `GeneratedAssetRecord` 透传 `readonly`。
  *Why*：用户需要一批随插件分发、所有项目共享、不可被误删的内置预设资产，复用
  text-preset 的「内置只读」范式，纯派生不污染用户索引。
- **`skills/generate-2d-asset` 拆成两个 PART，新增 tile 生成核心流程文档。**
  `SKILL.md` 现明确分 **PART A · 单个资产生成**（原有的 prompt→ImageGen→RemoveBG/Resize→
  preview/output 链）与 **PART B · Tile 生成核心流程**（生大面积目标纹理图 →
  `image_terrain_extract` → 可选 `make_seamless_moisan` → `image_atlas_compose`（配 4×N
  mask 模版）→ 重命名），并新增「公共底座」节收拢两者通用的 op 写法/触发语义/入库命名。
  新增 `skills/generate-2d-asset/tile-pipeline.md`（与画布图一致的数据流图、最小可跑
  applyBatch ops、运行顺序、模版约束），`battery-catalog.md` 补「Tile 链常用电池」表
  （`image_terrain_extract` / `make_seamless_moisan` / `image_atlas_compose` 端口与参数）。
  *Why*：tile 与单个资产是两条心智不同的流程（核心在 Extract→Seamless→AtlasCompose 而非
  抠图/缩放），合写一节易让 AI 把 tile 当孤立精灵处理；端口名/触发顺序对齐运行时元数据
  （`batteries/image/tiles/*/meta.json` + `scripts/smoke-tileset-pipeline.mjs` 的连线），避免编 op id。
- **新增 `scripts/smoke-tileset-pipeline.mjs`（`pnpm smoke:tileset`）——
  在真实 REST API（隔离临时 project root + ephemeral 端口）上端到端验证
  「地形纹理 → 自适应铺贴图集」左半段管线跑通。** 脚本程序化合成两张测试
  PNG（噪声地形 + 4×4 cardinal-16 alpha-mask 模版）→ `POST /api/v1/generated-assets/import`
  入库拿到真实 alias → `POST /api/v1/batch` 用 `createNode`/`connect` 连出图
  `image_source(terrain) → image_terrain_extract → image_atlas_compose`、
  `image_source(template) → image_atlas_compose.template`、
  `image_atlas_compose → image_output` → `POST /api/v1/execute` 跑全图，断言
  `image_terrain_extract` 产出干净纹理、`image_atlas_compose` 产出与模版同分辨率
  的图集（无 error）、`image_output` 回写成功（`ok:true` + 非空 alias）。这是
  首个把该图像管线在后端串起来跑的回归用例，也正是它暴露了下面的电池入口 bug。

### Fixed
- **`image_atlas_compose`（图集合成）电池此前根本无法在节点图里执行——
  battery loader 误把内部 helper `composeAtlas` 当成了 op 的 execute 入口。**
  loader 约定取模块「首个导出的小写字母开头函数」为 execute（正则 `/^[a-z]/`，
  见 `packages/node-runtime/src/layer1/loader/battery-loader.ts`），而 ESM 命名
  空间键是**按字母序**排列的：`composeAtlas`（一个被单测引用、因此导出的纯像素
  helper）按字母序排在真正的入口 `imageAtlasCompose` 之前，于是被选中。结果执行
  时 `composeAtlas(args, ctx)` 把整个 input 对象当成第一个参数 `terrain`、把 ctx
  当成 `template`，`template.width` 为 `undefined` → 抛
  `template width undefined must be divisible by 4`，节点永远失败（该电池此前从未
  在图中端到端跑过，故 bug 长期潜伏）。修复：把 helper 重命名为 `_composeAtlas`
  （`_` 前缀落在 loader 正则 `/^[a-z]/` 之外，不再是 execute 候选；单测
  `backend/tests/image-processing.test.ts` 同步改引用），使唯一的小写字母开头导出
  `imageAtlasCompose` 被正确选为入口。两文件加注释钉死该约定，避免回归。
- **Agent 改图不再需要刷新网页才同步——`HttpApiClient` 的 `/ws` 套接字此前
  断开后永不重连，导致后端 HMR 重启 / 空闲超时 / 网络 blip 一旦断链就静默死亡。**
  数据流本身正确（agent `asset2d:pipeline.applyBatch` → `POST /api/v1/batch` →
  kernel `applyBatch` emit `graph:applied` → 后端 `/ws` fan-out → 前端 `subscribe`
  刷新画布），但前端只在首次 `subscribe()` 时 `ensureSocket()` 建一次连接：旧的
  `sock.onclose` 仅把 `this.ws = null`、无任何重连，也无 `onerror` 兜底。连接一旦
  断开，agent 后续改图发出的 `graph:applied` 这个浏览器再也收不到，必须手动刷新
  页面重新 mount `<Editor>` → 重新 `subscribe` 才能看到最新图。现移植
  `wb-3d-lowpoly` 同款修复（见其 CHANGELOG「Runtime WS had no reconnect」）：
  `HttpApiClient`（`frontend/src/api/HttpApiClient.ts`）新增 `disposed` /
  `wsReconnectAttempts` / `wsReconnectTimer`，`onopen` 重置退避计数并重新订阅，
  新增 `onerror` 主动关闭，`onclose` 改为带 capped-backoff（上限 5s、仅当未
  dispose 且仍有 listener）的自动重连 + 重新 subscribe，`dispose()` 置
  `disposed` 并清理 timer。连接现在在后端重启/blip 后自愈，graph/execution/asset
  三通道实时同步恢复。
- **`image_output`（图像输出）的 `name` / `tags` / `overwrite` 终于真正生效——
  此前声明了端口/参数却被电池胶水层整段丢弃，导致用户起的名字（如「圣诞树测试」）
  永远落不到资产上。** `meta.json` 早已声明 `name`（显示名输入端口）、`tags`
  （标签输入端口）与 `overwrite`（覆盖参数），但实现链路 **电池 index →
  `batteries/image/_shared/asset2d.ts:copyImage` → 后端 `runtime.ts` 的 `copyImage`
  服务 → `generatedAssets.ts:copyGeneratedImage` → `importGeneratedImage`** 全程
  只透传 `operation/suffix/folder`，把 `name`/`tags`/`overwrite` 全部吃掉，所以
  alias 永远是宿主按「源 alias + operation」自动生成、`name` 形同虚设（旁边的
  `createImage` 路径带 name，唯独 `copyImage` 路径漏传）。现在四层全部补上透传：
  - `batteries/image/_shared/asset2d.ts:copyImage` 从 `input.name`(string,去空白)
    / `input.tags`(list,过滤非字符串/空串) / `input.overwrite`(boolean) 读出并透传；
  - `backend/src/runtime.ts` 的 `asset2d.copyImage` 闭包签名加 `name/tags/overwrite`；
  - `backend/src/assets/generatedAssets.ts` 的 `CopyGeneratedImageRequest` /
    `ImportGeneratedImageRequest` 加 `name?/tags?/overwrite?`，`importGeneratedImage`
    将显示名写入记录的 **`name` 字段**（中文进不了 slug 化的 alias，只能进显示名，
    与卡片重命名 `renameGeneratedAsset` 同一字段，并复用 `uniqueDisplayName` 自动
    `(N)` 去重），并实现 `overwrite`：当存在同显示名记录且 `overwrite=true` 时，
    **就地复用其 alias/relPath 覆盖底层文件与 blob**（不新增条目），`overwrite=false`
    则照常新建且自动后缀化显示名；同时修掉 `copyGeneratedImage` 里
    `width: ... ? 0 : 0` 的死代码。
  *为什么：* 跑文生图生圣诞树时，「圣诞树测试」这个落库名一直落不上，根因即此
  契约/实现脱节的胶水 bug。注意 alias 仍是英文自动串（slug 会清掉中文），中文名
  正确地落在用户可见的显示名字段（卡片标题/检索/可 rename）。
  测试：`backend/tests/image-output-naming.test.ts`（电池层 name/tags/overwrite
  透传、空名略过、非字符串 tags 过滤、无图 ok=false）+ `backend/tests/
  generated-assets.test.ts` 新增 copyGeneratedImage 写显示名/标签、overwrite 就地
  覆盖、overwrite=false 追加并自动 `(2)` 三例。同步在 `skills/generate-2d-asset`
  （`SKILL.md` 第 4 步入库 + 防呆须知、`pipeline-schema.md` 入库命名与运行顺序）
  补上 `image_output` 命名规范：`name` 落显示名字段（支持中文、可 param 直填或连
  `name` 端口）、`overwrite` 默认就地覆盖同显示名、`alias` 由后端自动生成、入库后用
  `asset2d:assets.get` 核对 `name`。

### Added
- **Asset Store 卡片支持重命名（持久化到后端）。** 右击单张卡片菜单新增
  `Rename`，或双击卡片标题即可内联编辑；Enter 提交、Esc 取消、失焦自动提交。
  *为什么：* 生成物/导入图的默认标题是机读 `alias`（如 `ai-2-node-….png`），
  用户需要给资产起人类可读的名字（如「树林2」「墙」）。重命名改的是新引入的
  **显示名 `name`** 字段、持久化进文件型索引 `generated/_asset2d-index.json`，
  **不动 `alias`/`blobId`/`relPath`/底层文件**——因此缩略图 URL、拖拽标识、去重
  全部稳定不破坏。卡片标题渲染规则：有 `name` 显示 `name`，否则回退 `alias`。
  重名时后端自动追加 ` (2)`/` (3)`… 后缀保证唯一。
  后端 `backend/src/assets/generatedAssets.ts` 新增 `renameGeneratedAsset(rt,
  alias, name)`（`GeneratedAssetRecord` 加可选 `name`），路由
  `backend/src/assets/routes.ts` 新增 `PATCH /api/v1/generated-assets/:alias`
  接受 `{ name }`；前端 `frontend/src/surfaces/generatedAssetsApi.ts` 新增
  `renameGeneratedAsset` + `assetDisplayName` 帮助函数，
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` 加内联重命名 UI 与右键
  `Rename` 项。测试见 `backend/tests/generated-assets.test.ts`（持久化/唯一性
  自动加(N)/空名与未知 alias 拒绝）。


  网格卡片现在可多选：单击=选中并预览、Ctrl/Cmd 单击=切换、Shift 单击=按视觉顺序
  连选；选中后右击弹出菜单可一次性删除整组（菜单显示 `Delete N items`），也支持
  键盘 Delete/Backspace 删除选中、Esc 清空选择；切换文件夹会清空选择。*为什么：*
  上一版只允许逐张删除、且仅限用户上传的图；用户需要清理流水线产出的 ai/processed
  废图，并希望一次清理多张。删除限制已去除（生成物也可删），并新增批量通道。
  后端 `backend/src/assets/generatedAssets.ts` 新增
  `deleteGeneratedAssets(rt, aliases[])`（基于单次索引快照计算，仅当没有**存活**
  别名共用同一 `relPath` 时才删底层文件，正确处理去重），
  `backend/src/assets/routes.ts` 新增 `POST /api/v1/generated-assets/delete`
  （`{ aliases }` → `{ deleted }`，命中即清 `selectedPreviewAlias`），
  `frontend/src/surfaces/generatedAssetsApi.ts` 新增 `deleteGeneratedAssets`，
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` 加入 `selected` 选择集 +
  `anchorRef` 连选锚点 + Ctrl/Shift 点击逻辑 + 选中态卡片样式 + 标题栏选中计数，
  右键菜单改为对「右击卡片或整组选择」删除；
  `GeneratedAssetStoreSurface.css` 加 `.asset2d-store__card--selected` 等样式。
  测试：`backend/tests/generated-assets.test.ts` 新增「跨 source 批量删除」「未知
  alias 不误删」两例（共 6 例通过）。

### Added
- **左侧 Workbench 菜单在 PROJECTS 下方补上「三个分组按钮」（Asset Graph /
  Asset Folders / Image Preview），照搬 `wb-scene-generator` 的下半区分组切换
  范式。** 此前美术插件左栏 PROJECTS 拖拽条下方直接渲染唯一的控制面板
  （`SceneGeneratorControlsPanel`），缺少场景插件那一行下划线分组 tab。现在加上
  三按钮分组切换：`Asset Graph` 仍显示既有的 节点信息/操作历史/数据类型/帮助
  面板（`SceneGeneratorControlsPanel`），`Asset Folders` /`Image Preview` 各对应
  本插件的两个 surface（`?pane=assetstore` / `?pane=preview`），先落地占位控制
  面板（`AssetFoldersControlsPanel.tsx` / `ImagePreviewControlsPanel.tsx`），后续
  按需填充实际控制项。*为什么：* 美术插件本就有三个界面（Asset Graph / Asset
  Folders / Image Preview），三者后续都要加控制，对齐场景插件的分组切换交互后
  扩展点统一。落点：`frontend/src/workbench/WorkbenchLeftPane.tsx`（新增 `group`
  状态 + `GroupTab` + `ControlGroup` 类型，分组渲染下半区）。

### Fixed
- **左栏控制面板的「分组拖拽缩放」交互完全照搬场景插件，修掉鼠标与栏目分离、
  Help 滚不到底两个问题；NODE INFO 补回「选中(Selected)」统计；Asset Folders /
  Image Preview 两个分组补上各自的 Help 菜单。** 此前美术插件的
  `SceneGeneratorControlsPanel` 用的是旧版**内联**拖拽逻辑（每个标题直接
  `prev[key] + dy`，没有拖拽起始锁面板高度、也没有溢出补偿），拖动 Help 标题时
  面板会被压缩、handle 跟不上指针（鼠标与栏目分离），内容也滚不到底。现在改用
  与场景插件**同一套**共享逻辑：新增 `frontend/src/workbench/controlSections.tsx`
  （`SectionTitle` / `DragTitle` / `CollapseTriangle`，`DragTitle` 带
  `setPointerCapture` + `onDragStart` 回调）与
  `frontend/src/workbench/sectionDragResize.ts`（`applySectionDragDelta` 向上压缩
  补偿 + `usePanelDragMinHeight` 在 drag 起始锁定 `scrollHeight` 为 `min-height`，
  整段拖拽期间面板不再回缩）。`SceneGeneratorControlsPanel.tsx` 整体重写对齐场景版：
  NODE INFO 统计补回 `Selected/选中` 一项（`stats.selectedCount`）、选中电池用
  `SelectedBatteryDiagram` + `useLayoutEffect` 自适应卡片宽度与值框 `--ni-value-w`、
  端口名 `breakableName` 在 camelCase 处插零宽断点、值拆成 `kind/value` 两行
  （`ni-peer__kind`/`ni-peer__node`）、Help 改为结构化多组（`help-group`/`help-title`
  + ol/ul）。`AssetFoldersControlsPanel.tsx` / `ImagePreviewControlsPanel.tsx` 由
  单段占位文案改为带同款 section chrome（`DragTitle` 可折叠 + 可拖拽缩放 +
  localStorage 记忆高度/折叠态）的结构化 Help 菜单。CSS 同步场景插件的 node-info
  收尾样式：`.ni-name` 改为可换行（`flex:1` + `overflow-wrap`）、`.ni-peers` 改用
  `--ni-value-w` 定宽值框、新增 `.ni-wire--ghost` 与 `.ni-peer__kind`，移除旧的
  `.ni-peer__port`。*为什么：* 用户指出三处没有完全复刻——NODE INFO 少 Selected、
  另两个分组没 Help、拖动 Help 鼠标分离且滚不到底——要求把场景插件已妥善解决的
  实现全部照搬过来。落点：`frontend/src/workbench/{controlSections.tsx,
  sectionDragResize.ts,SceneGeneratorControlsPanel.tsx,AssetFoldersControlsPanel.tsx,
  ImagePreviewControlsPanel.tsx,WorkbenchLeftPane.css}`。

### Changed
- **电池下方挂着的图像预览面板（`.asset2d-image-preview`）改用电池同款的强调色
  发光外框，不再是淡灰细边。** 此前预览面板只有一道 `--color-border` 灰边 + 微暗
  背景，挂在电池框下方时几乎融进画布、辨识度很低（见用户反馈：「太不明显」）。现在
  它借用电池的强调色（`--node-rgb`，默认取画布 accent 黄绿）画 1.5px 亮边 +
  内描边 + 发光阴影（`inset/0 0 14px` glow，呼应 `BatteryNode.css` 的 box-shadow
  配方），顶边保留细分隔线 + `margin-top:-1px` 与电池本体无缝衔接，看起来像电池向下
  延伸出来的抽屉而非独立浮窗；缩略图边框也改为强调色淡描边以协调。*为什么：* 让弹出
  的预览像被电池外框包住，明显归属于该电池节点。落点：
  `frontend/src/workbench/ImageBatteryNode.css`（`.asset2d-image-preview` /
  `.asset2d-image-preview__img`）。
  AssetStore / Preview 两个 iframe 窗口初始**默认一人一半**（`1fr / 1fr`），
  此前 AssetStore 固定 seed 成 250px：去掉 `BATTERY_BAR_WIDTH_DEFAULT` seed，
  `assetStoreWidth` 初始为 `null`，两窗都内联时 grid 回退 `minmax(0,1fr)`，拖动
  列分隔条后才钉成像素宽（`frontend/src/workbench/WorkbenchHost.tsx` 的
  `gridTemplateColumns`）。2) 左侧 AssetStore 单个卡片的详细信息行
  （`<p>`）**限制为单行 + 省略号**，避免不同长度 prompt 撑高卡片导致网格参差
  （`frontend/src/surfaces/GeneratedAssetStoreSurface.css`）。3) 右侧 Preview：
  图片**放大占满预览区**（stage 改 `1fr auto` 两行栅格，img `max-height:100%`），
  并**禁用浏览器插值**（`image-rendering: pixelated/crisp-edges`，像素画放大不糊）；
  meta 三/四条信息块**靠下**（`align-self:end`）并新增 **Size 行**（从 `<img>`
  `onLoad` 读 `naturalWidth × naturalHeight`，切换资产时清零）
  （`frontend/src/surfaces/ImagePreviewSurface.tsx` + `.css`）。*为什么：* 默认
  对半分更易同时浏览素材与预览；卡片等高更整齐；像素美术放大需关插值且应占满
  可视区，尺寸是审素材的关键信息。
- **修正 Preview 小图未占满 + AssetStore 卡片图同样关插值。** 之前 Preview 的
  img 用 `max-width/height:100%`，对 26×33 这类小像素图只限上限、不上采样，留出
  大片空白；改为 `width/height:100% + object-fit:contain`，小图也放大到容器边界
  （保持比例）。同时给 AssetStore 卡片 img 补 `image-rendering: pixelated/crisp-edges`，
  此前缩略图被浏览器双线性插值糊掉（`frontend/src/surfaces/ImagePreviewSurface.css`、
  `frontend/src/surfaces/GeneratedAssetStoreSurface.css`）。
  （`Asset Workbench Navigation`）由 `Righteous` + `scaleY(1.14)` 改为与场景插件
  一致的 `Inter` + 宽松行高（accent-green，避免裁切 g/y descender）；同时把
  panel-tabs（缩字号容纳三标签不换行）、section-content 隐藏滚动条 +
  `overflow-x:hidden`、可拖拽 section 标题 hover 的盒模型预留、NODE INFO 统计
  改为自适应网格、Help/数据类型/历史的可读字号等细节，从场景插件
  `WorkbenchLeftPane.css` 照搬过来，使两个插件左栏菜单的交互、拖拽与排版一致。
  *为什么：* 用户要求美术插件左栏菜单的交互、拖拽逻辑、标题字体完全照搬场景
  插件。落点：`frontend/src/workbench/WorkbenchLeftPane.css`。
 在 Asset Store 网格里右击一张
  **用户上传**（`source: 'user-upload'`）的卡片会弹出上下文菜单，点击 *Delete*
  即从资产索引移除该条目并删除其底层文件。*为什么：* 用户导入图片后此前没有
  任何途径在 UI 里清理误传/废弃的素材，只能手动改磁盘。仅对用户上传的素材开放
  （生成/processed 素材是流水线产物，保持只读）。后端
  `backend/src/assets/generatedAssets.ts` 新增 `deleteGeneratedAsset(rt, alias)`
  （按 alias 删索引条目；仅当没有其它 alias 共用同一 `relPath` 时才
  `rt.assets.remove` 删文件，避免去重场景下误删存活别名的图），
  `backend/src/assets/routes.ts` 新增 `DELETE /api/v1/generated-assets/:alias`
  （命中即返回 `{ deleted }`，并清掉 `selectedPreviewAlias`），
  `frontend/src/surfaces/generatedAssetsApi.ts` 新增 `deleteGeneratedAsset` 客户端，
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` 给卡片加 `onContextMenu`
  + 固定定位的上下文菜单（外部点击 / 滚动 / Esc 关闭），
  `GeneratedAssetStoreSurface.css` 加 `.asset2d-store__context-menu` 等样式。
  测试：`backend/tests/generated-assets.test.ts` 新增删除 + 去重保留两例。


### Fixed
- **点击 Asset Store 图片后约 1–2s 又跳回原图（本次新增功能引入的回归）。**
  *为什么：* `selectedPreviewBus` 订阅回调里误把用户点击的 alias 写进了
  `lastSeenLatestAlias` ref。该 ref 的语义是「后台 `/preview/latest` 轮询的基线」，
  被覆盖后下一次 2s 轮询会把真正的最新生成资产判为「新资产」并 `setSelected`
  覆盖用户的点击。修复：`surfaces/ImagePreviewSurface.tsx` 的点击回调不再触碰
  `lastSeenLatestAlias`，只 `setSelected`，让轮询基线与用户选择互不干扰。

### Added
- **Asset Store 充当 Image Preview 的图片选择器（跨 iframe）。** 点击 Asset Store
  网格里的任意图片，Image Preview 即切换显示该图。*为什么：* Preview 自带的左侧
  缩略图竖列与 Asset Store 网格职责重复；让 Asset Store 直接驱动 Preview 后，预览
  区只负责「大图 + 元数据」，选择交给资产库。新增
  `frontend/src/surfaces/library/selectedPreviewBus.ts:1`（与 `draggedAssetBus.ts`
  同款 localStorage 通道；store 在 `GeneratedAssetStoreSurface.tsx` card 的
  `onClick` 写入选中 alias，preview 通过 `storage` 事件订阅并 `setSelected`），
  `surfaces/GeneratedAssetStoreSurface.tsx:193` 给 `<article>` 加 `onClick`（保留
  既有 `draggable`→画布），`surfaces/ImagePreviewSurface.tsx:35` 订阅 bus。

### Removed
- **删除 Image Preview 左侧缩略图竖列（`asset2d-preview__rail`）。** *为什么：*
  与 Asset Store 网格功能重叠，且现在改由 Asset Store 点击驱动预览（见上）。改动：
  `surfaces/ImagePreviewSurface.tsx` 移除 `assets` state 与 `<aside>` rail（`__body`
  改为单列），`surfaces/ImagePreviewSurface.css` 删去 `__rail`/`__thumb*` 规则、
  `__body` 由 `112px 1fr` 改为 `1fr`。

### Removed
- **彻底移除旧 3D/voxel renderer 子系统及其整条死链路（前后端 + 数据 + 脚本）。**
  *为什么：* 资产生成 app 现在前端只剩四块——底部 editor、上方两个预览区
  （Asset Folders / Image Preview）、左侧 workbench；旧的「assetstore + 4 模式
  renderer」范式已被「文件型 generated-asset 索引 + 图像预览」完全取代，残留的
  旧代码只会反复扰乱 debug 视线。本次按「前后端两层一起清」做了一次性彻底删除：
  - **前端：** 删 `frontend/src/renderer/` 整目录（store/bridge/framework/host/
    modes free3d·iso·top·topBillboard/server）、`surfaces/RendererSurface.tsx`、
    `surfaces/AssetStoreSurface.tsx`、`surfaces/library/` 下除 `draggedAssetBus.ts`
    外的全部 bus/API/view-model（`selectedLayerBus`/`editToolbarBus`/`paintAssetBus`/
    `rulesApi`/`assetStoreStore`/`pagination`/`layerInspector` 等）、
    `workbench/PreviewControlsPanel.tsx`、`workbench/PreviewLayerInspector.tsx`，
    并把 `WorkbenchLeftPane` 剔除 assetstore/preview group 与全部旧 bus 订阅。
    `protocol.ts` 裁掉只服务旧 renderer 的 `editor-selection`/`preview-change`/
    `renderer-command` 三个消息类型，`WorkbenchHost` 同步删去对应的两处 dead-end
    postMessage 发送 + onLoad 重播。
  - **后端：** 删 `backend/src/library/`（SQLite 资产库 db/service/routes）、
    `backend/src/agent/`（截图 + renderer 命令路由）、`backend/src/baked/`、
    `backend/src/routes/assets.ts`，并从 `main.ts` 注销对应注册。
  - **AI 工具：** 从 `forgeax-plugin.json` 与 `tool-handlers.ts` 删去 7 个
    `screenshot.*` / `renderer.*` 工具声明与映射。
  - **数据：** 删除已成孤儿的 `materials/asset-store/`（13MB `library.db` + `blobs/`）、
    `materials/export_2026-06-04/`、`materials/legacy-asset-overlays.json`——删掉
    `library/` 后已无任何运行时代码读取它们（`/api/v1/library/blob/:blobId` 改由
    文件型 `readGeneratedAssetByBlobId` 提供）。
  - **脚本：** 删 `scripts/{preview,north-star-loop,preview-house-template,
    smoke-house-template,smoke-assets,import-exported-assets,legacy-asset-overlays}.mjs`
    及其 npm scripts（`preview`/`north-star`/`smoke:assets`/`import:assets`）；
    `smoke-projects.mjs` 移除假 renderer + screenshot capture 断言。
  - **依赖：** 前端移除 `three`/`zustand`/`@napi-rs/canvas`/`@types/three`，后端
    移除 `better-sqlite3`/`@types/better-sqlite3`（删 renderer/library 后均无引用）。
  - **测试：** 删 `backend/tests/{baked,screenshot,library,import-exported-assets}.test.ts`
    （对应源码已删），`tool-handlers.test.ts` 去掉 `renderer.info` 断言。
  - 校验：`backend` 34 tests + `frontend` 19 tests 全过，前后端 `tsc --noEmit` 净。

### Changed
- **文档回写到清理后的真实结构（`ARCHITECTURE.md`/`README.md`/`AGENTS.md`/
  `docs/architecture/{backend,frontend,extension-and-contracts}.md`）。** 移除
  renderer/asset-store/SQLite 描述，改述为「文件型 generated-asset 索引 +
  AI 图像网关 + 文本 presets」三块后端 + 两个生成资产 surface + 图像画布节点。


- **新增电池「房屋模板」(`house_template`，`batteries/image/house/`)：JSON→房屋灰度图。**
  提取自 `pipelines/decoration_house_generation` 管线 `block_layout_tool/utils`
  的五步算法（顶部补高 expand → 高度投影立面 offset → 区分多段立面
  differentiate → 缩放到正方形并加门 addDoors → 渲染灰度 render），用纯
  TypeScript 重写为一个电池（`index.ts` 五步纯函数 + `houseTemplate` 入口）。
  输入一个 `spec`（json，兼容 `{entries}`/`{building_sequence}`/包裹形式），每个
  entry 产出一张灰度图（1=深灰顶面127、≥2=浅灰立面渐变166→191、0=白底），参数
  `imageSize/addDoors/seed`。输出 `image`（list）+ `error`。**双写**：每张灰度图
  既归档到仓库顶层 `.forgeax/grayscale/`（专属栏目，可用 `FORGEAX_GRAYSCALE_ROOT`
  覆盖根目录），又导入资产库作为 `image` 端口引用（画布可预览、下游可消费）。
  *why*：把管线里「二维列表→房屋灰度图」的能力沉淀成可复用电池，且按用户要求
  既归档到独立栏目又随电池标准输出。
- **后端 `asset2d` 新增 `createImage` 服务 + `_shared/asset2d.ts` 暴露
  `createImage` 帮助函数。** 原 `asset2d` 只支持 `processImage`（必须有源图），
  无「从零创建图像」能力。新增 `createGeneratedImage` / `resolveGrayscaleRoot`
  (`backend/src/assets/generatedAssets.ts`)：把电池合成的 RGBA 像素编码为 PNG
  后双写（顶层 `.forgeax/grayscale/` 归档 + `importGeneratedImage` 进资产库），
  在 `backend/src/runtime.ts` 的 `asset2d` 服务里挂载为 `createImage(pixels,
  width, height, opts)`。栏目根目录解析优先读 `FORGEAX_GRAYSCALE_ROOT`，否则
  从 `repoRoot` 向上找含 `.forgeax/` 的祖先目录（避免脆弱的相对深度，兼容
  web-dev/desktop-dev/desktop-prod 三形态）；栏目写失败仅返回 `error` 提示而不
  影响 `image` 输出。*why*：支撑 `house_template` 这类「数据合成图像」电池，并满足
  灰度图独立归档诉求。
- **文本预设栏（Presets）+ 后端双源持久化。** 大标签栏新增「预设/Presets」一列
  （🔖，钉在「收藏」之后），展示已保存的 Panel 文本预设；每个条目可拖到画布生成预填
  文字的 `text_panel` 节点（拖拽载荷沿用旧的 `application/battery` +
  `application/preset-text`，由 `useCanvasDrop` 消费）。预设来自**双源合并**：
  插件内置目录 `apps/wb-2d-scene-asset-generator/presets/`（随插件分发、只读）+
  用户工作区 `<FORGEAX_PROJECT_ROOT>/text-presets/`（运行时 =
  `.forgeax/workbench/wb-2d-scene-asset-generator/text-presets/`，**每条一个
  `<id>.json` 文件**，遵守运行时隔离铁律）。后端新增
  `backend/src/presets/{store,routes}.ts`：`GET /api/v1/presets`（合并，用户优先、
  最新在前）、`POST /api/v1/presets`（写用户源）、`DELETE /api/v1/presets/:id`
  （删用户源，内置不可删 + path-traversal 防护），在 `backend/src/main.ts` 注册；
  `HttpApiClient` 实现对应可选方法。*why*：让常用提示词/文本像电池一样沉淀、复用、
  团队内随插件分发。
- **Panel 保存按钮改为「输标题→存后端」弹框。** `text_panel` 右上角书签按钮原先
  直接把文本塞进 localStorage；现点击弹出小输入框填写预设标题，回车/保存写到后端
  （`kernel: TextPanelNode.tsx` + `TextPanelNode.css`）。*why*：预设需要可读标题，
  且持久化到后端而非浏览器本地。

### Changed
- **两个生成资产 surface（`ImagePreviewSurface`、`GeneratedAssetStoreSurface`）的
  外壳/控件统一到 scene-generator 的设计语言。** 此前它们用一套自成一格的视觉
  （硬编码蓝色 `#0f172a`/`#38bdf8`、文字版 `Focus`/`Exit Focus` 按钮、带 eyebrow
  的 `<header>`），与三个 scene-generator surface 的统一标题栏（渐变标题栏 +
  lime→米白 wordmark + 26px 图标按钮 + 设计令牌）不一致。现改为：标题栏走与
  `.renderer-toolbar`/`.assetstore-titlebar` 相同的配方（`--titlebar-height` 32px、
  `--color-bg-titlebar` 渐变、hairline 边框），全屏按钮换成 `Maximize2`/`Minimize2`
  图标钮，缩略图轨/卡片网格/文件夹列表全部改用内核设计令牌（`--color-accent` 系列、
  `--radius-*`、`--color-border`）。**why**：让 asset 插件的前端与主流（scene-gen）
  在样式、行为、交互上完全一致；asset 领域独有的功能（图像预览、文件夹分组、
  Import 控件、拖拽到画布）保留不变，只统一外壳。
- **新增 `frontend/src/surfaces/icons.tsx`**（surface-local inline SVG glyph 组件，
  与 scene-generator 的 `surfaces/library/icons.tsx` 锁步、零新依赖），供两个 surface
  的图标按钮使用；每个 app 各持一份拷贝而非跨 app import，保持架构边界清晰。
- **文本预设从浏览器 localStorage 迁移到后端存储。** 内核 `uiStore.textPresets`
  现在优先经 `EditorApiAdapter`（→ `ApiClient.listTextPresets/createTextPreset/
  deleteTextPreset`，均为可选方法）读写后端；客户端未实现这些方法时**自动回退**到
  原 localStorage 行为，保证其它 app 不受影响。`TextPreset` 类型新增 `title`/
  `builtin` 字段（旧 localStorage 条目读取时自动 backfill）。

### Removed
- **左侧栏旧「预设文本面板」折叠区。** 该面板（`LeftSidebar.tsx` 的 `textpresets`
  section + `TextPresetsPanel`）已被大标签栏「Presets」列取代并移除。

### Fixed
- **Generated Image Preview 手动选图后约 1s 又被切走。** 起因：
  `surfaces/ImagePreviewSurface.tsx` 的 2s 轮询无条件 `setSelected(latest)`，
  把用户点击的缩略图覆盖回最新图。改为事件驱动：后台探测仅在 `latest.alias`
  真正变化（出现新图）时切换一次并刷新缩略图列表，初次挂载只记基线、不抢占；
  手动点击照常切换。现在手动选择会稳定保持。

> 内核侧改动（`packages/node-runtime-react`）：`api/ApiClient.ts` 新增 `TextPresetDto`
> 与三个可选预设方法、`editor/transport/apiAdapter.ts` 透传、`editor/stores/uiStore.ts`
> 改为双模式（后端/localStorage）、`editor/components/sidebar/BatteryBar.tsx` +
> `batteryGrouping.ts` 新增 `__presets__` 合成大标签与 `PresetsRailPanel`、
> `editor/Editor.tsx` 启动时 `loadTextPresets()`。详见上方条目引用的文件。


### Added
- **AI 可「远程点运行」某个 image_gen 节点：`generation.generateImage` 只传 `nodeId`
  即可按画布连线生图。** 此前该 tool（→ `POST /api/v1/ai/image`）要求调用方自带
  `prompt`/`images`，与画布脱节。现在 `backend/src/ai/routes.ts` 在「只给 `nodeId`、
  未显式给 `prompt`/`images`」时，调用新增的
  `resolveNodeImageInputs(rt, nodeId)`（`backend/src/ai/imageGeneration.ts`）——从
  `listEdges`/`getNodeOutput` 解析该节点 `prompt`/`image` 端口已连的上游值（无连线则回退到
  节点自身 `params.prompt`），与编辑器「运行」按钮的 `getPromptValue`/`getInputImage`
  逻辑一致（同款 `peelWireValue`）。*why*：让 AI 调 tool 等价于「点该电池的运行按钮」，
  人/AI 走同一接口、同一套输入解析。

### Changed
- **AI 触发生图后，结果像人点运行一样持久化 + 实时回到画布。** 此前 AI 路径只
  `writeNodeOutput`（写输出缓存），不写人工路径会写的 `_gen_image` 持久化 param，导致刷新
  丢预览、画布节点不点亮。现在 `backend/src/ai/routes.ts` 在生图后**先**经 `applyBatch`
  `updateNode` 写 `_gen_image`/`_gen_error`（拿到新 graph hash），**再**
  `writeNodeOutput('image')`（用最新 hash 标记缓存）；`graph:applied` + `exec:node:output`
  事件让在线编辑器实时刷新该节点预览。*why*：实现「人点运行 == AI 点运行」，同一套数据流、
  同一套 UI。
- **`generate-2d-asset` skill 教 agent 用「只传 nodeId」的运行方式。**
  `skills/generate-2d-asset/SKILL.md` 阶段二第 3 步改为推荐 `args: { nodeId }`（后端按画布
  解析），并新增「AI 点运行 = 人点运行」防呆条目。*why*：之前文档要求 AI 自带 prompt/images，
  与画布连线脱节、agent 易漏用该 tool。

### Removed
- **从本工作台注册表移除误串入的 `compose-scene-pipeline` skill。** 该 skill 实属
  `wb-scene-generator`（场景生成器），在本 app 初建（`add image scene asset app`）时被
  连同模板拷入 `skills/compose-scene-pipeline/`，并在「绑定 Mira」一改中被误当作"漏注册"
  补进了 `forgeax-plugin.json` 的 `provides.skills` 及 agent-mira 的 `defaultSkills`，与
  专属的 `generate-2d-asset` 职责重叠/混淆。现从 `provides.skills` 和 agent-mira
  `defaultSkills` 解绑，UI 不再展示该条；磁盘文件 `skills/compose-scene-pipeline/` 暂保留
  （初建带入、非本次新增，留待后续清理）。本工作台现仅暴露 `author-guide` 与
  `generate-2d-asset` 两个 skill。

### Fixed
- **导入较大图片失败（413 `FST_ERR_CTP_BODY_TOO_LARGE`）。** Fastify 实例
  （`backend/src/main.ts:19` `Fastify({ logger: false })`）未设全局 `bodyLimit`，
  沿用默认 1 MiB；导入图片的 base64 JSON body 很容易超过该限制，导致「某些图片」
  （原图 ≳ 750KB）在解析前被拒。给 `POST /api/v1/generated-assets/import`
  （`backend/src/assets/routes.ts:65`）补 `{ bodyLimit: 20 * 1024 * 1024 }`，与
  `agent/routes.ts` 截图路由的 20MB 上限一致。*why*：用户导入大图时报 413、
  前端 import 失败。

- **Generated Asset Folders 资产网格卡片被压成一条线 + 左侧栏目列表过宽。**
  `frontend/src/surfaces/GeneratedAssetStoreSurface.css`：给 `.asset2d-store__grid`
  加 `grid-auto-rows: max-content`，把 `.asset2d-store__card` 改为 flex column，
  并给 `.asset2d-store__card img` 用 `aspect-ratio: 1 / 1` + `min-height: 120px`
  兜底，修复行高坍缩导致缩略图退化成横线的问题；同时把 `.asset2d-store__body`
  左栏宽度从 `220px` 收窄到 `150px`、folder 内边距/字号略减，给右侧网格让出空间。
  *why*：导入功能上线后实测网格卡片在窄列下高度坍缩、左栏占位过宽影响布局。

### Added
- **Generated Asset Folders 界面新增「Import Files」按钮 — 用户可从本机导入图片到资产库。**
  `frontend/src/surfaces/GeneratedAssetStoreSurface.tsx` header 新增导入控件：一个隐藏的
  `<input type="file" accept="image/*" multiple>`（支持一次批量多选）+ 「Import to」目标栏目
  选择器（`user` / `current (当前选中栏目)` / `new folder…` 新建栏目名）。选图后经
  `readFileAsDataUrl` 转 base64，逐张 POST 到既有的 `/api/v1/generated-assets/import`
  （`folder` 取目标栏目、`source: 'user-upload'`、`tags: ['user-upload']`），完成后自动切到
  目标栏目并刷新。*why*：用户此前只能拖入 AI 生成/processed 的素材，无法把自己电脑上的图片
  纳入管线；后端 `importGeneratedImage`（`backend/src/assets/generatedAssets.ts:107`）已支持
  任意 `folder` 且 `listGeneratedFolders` 会自动统计出现过的 folder，因此导入 `user` 栏目
  后左侧列表会自动出现 `user` 项并带计数，无需硬编码栏目，后端零改动。
  配套 `frontend/src/surfaces/generatedAssetsApi.ts` 新增 `importUserAsset()` /
  `readFileAsDataUrl()` 客户端函数，`GeneratedAssetStoreSurface.css` 新增
  `.asset2d-store__actions/__target/__new-folder` 与按钮 disabled 态样式。

- **新增 `generate-2d-asset` skill — 教 AI 用图生图/文生图管线生成 2D 资产。** 新建
  `skills/generate-2d-asset/{SKILL.md,battery-catalog.md,pipeline-schema.md}`，并在
  `forgeax-plugin.json` 的 `provides.skills` 注册（trigger `/generate-2d-asset`）。
  内容分两阶段：先问清需求（生成什么 / 文生图还是图生图 / 尺寸 / 是否抠图 / 是否批量），
  再搭 `text_panel → image_gen ← image_source` 主链并按需接 `image_remove_bg` /
  `image_resize` / `image_preview` / `image_output`。明确 `image_gen` 是 `manualTrigger`：
  由 AI 调一次 `asset2d:generation.generateImage`（带 `nodeId`）触发，**每个 image_gen
  节点只点一次运行**（结果经 `writeNodeOutput` 写入输出缓存，下游 `pipeline.execute` 不会
  重触发生图，避免重复消耗网关额度）。op id / 端口以 `batteries.list` / `batteries.get`
  为准。配套在 agent-mira（Mira · 织绘师）的 `defaultSkills` 引用此 skill。
- **绑定 `Mira · 织绘师` agent（`@forgeax-plugin/agent-mira`）为本工作台的
  `preferredAgent`，并注册 `compose-scene-pipeline` skill。** `forgeax-plugin.json`
  的 `provides.workbench` 新增 `preferredAgent`，使进入本工作台时 agent picker 默认
  选中 Mira；`provides.skills` 补注册原已存在但未登记的 `compose-scene-pipeline`
  （`./skills/compose-scene-pipeline/SKILL.md`），让 Mira 的 `defaultSkills` 能解析到它。
  仿照 `wb-3d-lowpoly` ↔ `agent-lowpoly`（Poly）的工作台/agent 配对模式，给 2D 资产
  生成提供专职 agent。见 `forgeax-plugin.json` provides.workbench / provides.skills。

### Changed
- **RemoveBG (`image_remove_bg`) 的 `lab_tolerance` 默认值 50 → 9。** `meta.json`
  的 `default` 与 `index.ts` 的回退默认值同步改为 9，使默认抠图更保守（仅去除与
  背景色高度相似的像素），减少误删前景。见
  `batteries/image/processing/image_remove_bg/{meta.json,index.ts}`。

### Fixed
- **`serve-dist` 启动时强制重建内核 dist，避免 RemoveBG 等电池「预览有图、端口
  no result」。** 编译态后端走 `@forgeax/node-runtime` 的 `dist/`（无 `source`
  条件）；内核 dist 不入 git，本地若未 `pnpm --filter @forgeax/node-runtime build`
  会沿用旧的 dispatcher（把 `error:''` 成功哨兵当失败），staging 已写入抠图但
  OutputCache/`nodeOutputs` 为空。`scripts/serve-dist.mjs` 现在在拉起 backend 前
  始终 rebuild 内核。HMR 开发（`pnpm dev` + `--conditions=source`）不受影响；若仍
  看到旧状态，重启 backend 并对 BG 节点再跑一次下游执行即可。

### Changed

- **`dec_semantic_partition` 改造为独立可用的「装饰房屋·语义分区灰度图」电池
  （`batteries/pipelines/dec_house/dec_semantic_partition/`，v2.0.0）。** 旧形态
  消费整段装饰房屋管线的 `entries`(json) 且输出也是 `entries`(json)——灰度图被埋在
  json 字段 `semantic_partition_image` 里，节点上**没有 `image` 端口**，在编辑器里既
  无法预览也无法连线，等于不可用。改造后：输入「单张掩码 `mask`(json，可选，0/1
  二维数组)」+ 参数 `height`/`target_size`/`seed`；输出真正的 `image` 端口（灰度网格
  图 PNG data URL）外加 `mask_out`/`error`。不连掩码时回退到内置默认建筑掩码，拖进画布
  即可出图；`seed>0` 时用确定性 LCG 替换 `Math.random` 使加门可复现
  （`index.ts:rng/makeSeededRng/decSemanticPartition`）。*Why:* 用户反馈这组电池连一个
  `image` 端口都没有、无法使用；保留并修复唯一真正产出灰度图的电池，删除其余依赖管线上下游
  的电池。零依赖（自带 `_shared/png.ts` 编码器），无需任何宿主服务。

### Removed

- **PCG 管线只保留滤镜上色管线模板，删除文生图 / 图生图两条模板及其专属电池。**
  移除模板 `batteries/templates/pipelines/{pcg_text_to_image,pcg_image_to_image}/`
  以及仅被这两条模板使用的电池
  `batteries/pipelines/pcg/{pcg_text_to_image,pcg_image_to_image}/`。保留
  `pcg_filter_image` 模板及其依赖的 8 个电池（`pcg_parse_input`、
  `pcg_parse_asset_list`、`pcg_match_assets`、`pcg_filter_image`、
  `pcg_judge_remove_holes`、`pcg_process_image`、`pcg_generate_run_csv`、
  `pcg_update_total_csv`）——这些是滤镜上色管线完整跑通所必需的，未删以免模板断链。
  *Why:* 按用户要求 PCG 仅保留滤镜管线这一条 template。

- **裁剪 UI 物品生成管线，`ui_items` 下仅保留 `ui_load_prompt`（提示词，含参考图模板）。**
  移除 `batteries/pipelines/ui_items/{ui_parse_input,ui_retrieve_similar,ui_image_gen,
  ui_format_image}/` 以及管线模板
  `batteries/templates/pipelines/ui_items/ui_items.json`。被删电池端口全是
  `json`/`number`/`string`、无 `image` 端口，且依赖上下游条目结构或宿主注入的
  `asset2d.generateImage`/像素服务（`ui_image_gen`/`ui_format_image`），脱离整条管线
  无法单独使用。保留的 `ui_load_prompt` 同时覆盖「提示词」与「含参考图(url)模板」两块
  能力。*Why:* 按用户要求 ui_items 只保留参考图与提示词；经核对这两块能力都集中在
  `ui_load_prompt` 一个电池里。

- **删除装饰房屋生成管线中无法独立使用的 6 个电池及其管线模板。** 移除
  `batteries/pipelines/dec_house/{dec_parse_input,dec_merge_grid,dec_load_prompt,
  dec_gen_image,dec_remove_bg,dec_crop_grid}/` 以及模板
  `batteries/templates/pipelines/dec_house/dec_house.json`。这些电池端口全是
  `json`/`number`/`string`，无 `image` 端口，且每个都依赖上下游条目结构或宿主注入的
  `asset2d` 生图/像素服务，脱离整条管线无法单独运行。*Why:* 用户要求清空这组无法使用的
  电池，仅保留核心的产出灰度图电池（见上 Changed）。



- **Drag an image from the All Images panel onto the canvas to create an
  `image_source` node (cross-iframe drag handoff).** New output-only battery
  `batteries/image/basic/image_source/` (no inputs, one `image` output; the
  image reference lives in `params.image`) plus a canvas renderer
  `frontend/src/workbench/ImageSourceNode.tsx` (styled like `ImagePreviewNode`
  but with only an output handle), registered in `frontend/src/panels/scenePanels.ts`.
  The All Images grid (`GeneratedAssetStoreSurface`) sits in the `?pane=assetstore`
  iframe while the canvas is the host `<Editor>`, and native HTML5 `dataTransfer`
  does not cross the iframe boundary — so the dragged asset (`{alias, blobId}`)
  is handed off through a localStorage bus
  (`frontend/src/surfaces/library/draggedAssetBus.ts`, the channel-C pattern of
  `selectedLayerBus.ts`): the assetstore writes it on `dragstart` / clears on
  `dragend`, and `WorkbenchHost`'s `onExternalDrop` reads it synchronously on
  drop, looks up the `image_source` battery, and places a node with the encoded
  ref as a preset param. *Why:* lets users seed an image pipeline directly from
  already-generated assets without re-uploading.
  - **Kernel:** `useCanvasDrop` gained a generic `onExternalDrop` hook (called
    for drops with no `application/battery` payload) and `placeBattery` now
    accepts `presetParams`; both are threaded through `<Editor>`/`<Canvas>`
    props. Generic and domain-agnostic — see root `CHANGELOG.md`.

- **5 pipeline graph templates in the Templates tab
  (`batteries/templates/pipelines/{ui_items,dec_house,pcg_text_to_image,
  pcg_image_to_image,pcg_filter_image}/`).** Each pipeline is serialized as a
  `NodeGroup` JSON (nodes + edges + auto-derived `exposedInputs`/`exposedOutputs`
  for every unconnected port), so the backend `group-templates` scan tags them
  `displayGroup=templates/pipelines` and the editor lists them under the
  **Templates** tab (drag-to-canvas instantiates a collapsed group, ungroup to
  expand the full wired pipeline). *Why:* the earlier `pipeline/export` JSONs only
  fed the "open pipeline" path, not the Templates tab the user expected.

- **Real image-processing implementations for 7 image batteries (were copy-only
  stubs).** Ported the algorithms from the shared `ai_grasshopper` battery
  library into self-contained TS, wired through a new host `asset2d` image
  pipeline instead of the old dynamic `backend/.../png_codec.js` imports:
  - `processing/image_remove_bg` (Lab flood-fill + morphology + unsharp),
    `processing/image_resize` (nearest / area / smart unsharp),
    `tiles/make_seamless_moisan` (FFT periodic+smooth), `tiles/image_seamless_poisson`
    (cosine-taper band seam fix), `tiles/image_terrain_extract` (K-means + Image
    Quilting min-cut), `tiles/image_atlas_compose` (4×N Wang/autotile atlas) and
    `cliffs/cliff_atlas_extract` (cliff plateau/facade synthesis).
  - Single-image batteries call `image/_shared/asset2d.ts` `processImage`; the two
    multi-input batteries (atlas / cliff) use a new `processImages(inputNames, …)`
    helper backed by an added `asset2d.processImages` service in `backend/src/
    runtime.ts` (decodes N refs, runs the transform, encodes+persists one output).
  - The codec gained JPEG decode: `backend/src/utils/png_codec.ts` now exposes
    `decodeJpegImage` + a `decodeImageBytes` dispatcher (PNG signature / JPEG SOI /
    mime hint) via the new `jpeg-js` dependency; `runtime.ts` decodes through it so
    the AI image gateway's JPEG outputs no longer fail with "not a PNG".
  - Pure transforms exported for tests; `backend/tests/image-processing.test.ts`
    covers codec roundtrip + JPEG, RemoveBG, Resize, Moisan, terrain, Poisson and
    atlas (10 tests, all green). *Why:* RemoveBG/Resize (and the other tile/cliff
    batteries) emitted an unmodified copy, so downstream nodes received no real
    result; JPEG inputs additionally aborted decoding outright.


  `pipelines/` big-tag (`batteries/pipelines/{ui_items,dec_house,pcg}/`).** The
  Python flows in `pipelines/{UI_items_generation,decoration_house_generation,
  pcg_generation}` are reimplemented as 22 self-contained TS batteries, one
  small-tag folder per pipeline, loading cleanly (`createBatteryLoader.scan()`
  reports 0 errors for `pipelines/*`; strict typecheck clean):
  - **`ui_items/` (5):** `ui_parse_input` → `ui_retrieve_similar` →
    `ui_load_prompt` → `ui_image_gen` → `ui_format_image`.
  - **`dec_house/` (7):** `dec_parse_input` → `dec_semantic_partition` →
    `dec_merge_grid` → `dec_load_prompt` → `dec_gen_image` → `dec_remove_bg` →
    `dec_crop_grid`.
  - **`pcg/` (10):** `pcg_parse_input`, `pcg_parse_asset_list`,
    `pcg_match_assets`, `pcg_judge_remove_holes`, `pcg_filter_image`,
    `pcg_text_to_image`, `pcg_image_to_image`, `pcg_process_image`,
    `pcg_generate_run_csv`, `pcg_update_total_csv`.
  - Pure data/orchestration logic (parsing, matching, prompt templating, mask
    geometry, CSV manifests) is reimplemented directly in TS; heavy
    pixel/AI work (image generation, background removal, pixelate/resize) is
    delegated to the host-injected `asset2d` service via the shared
    `image/_shared/asset2d.ts` (`generateImage`/`copyImage`), mirroring the
    existing `ImageGen`/`image_remove_bg`/`image_resize` batteries. Two
    zero-dependency helpers were added for ops with no backend service:
    `pipelines/_shared/png.ts` (mask render + grid compose/crop on PNG data
    URLs) and `pipelines/_shared/csv.ts` (asset-manifest parse/write).
    Infra-only steps (`bootstrap_agent`/`router_agent`) and the text-LLM
    `judge_remove_holes` were intentionally skipped/replaced (the latter by a
    keyword heuristic) since no equivalent service is exposed. *Why:* surface
    the three asset-generation pipelines as reusable, individually-wireable
    canvas nodes instead of opaque Python flows.

### Fixed

- **`image_gen` (and every Run-button AI battery) is now triggered EXCLUSIVELY by
  its Run button — an upstream change no longer fires the AI API.** Previously
  any upstream edit (e.g. editing a connected text panel) called
  `updateNodeParam` → `incrementalExecute`, whose backend walk executed *every*
  node in the downstream closure, including the AI generator — silently bypassing
  the Run button and hitting the paid API. Fix introduces a kernel-level
  **`manualTrigger`** op semantic and wires it end-to-end:
  - **Kernel — op model:** `OpSpec.manualTrigger` + `BatteryMeta.manualTrigger`
    (`packages/.../node-runtime/src/layer1/types/op-spec.ts`,
    `layer1/loader/types.ts`); `meta-parser.ts` resolves it (explicit
    `meta.manualTrigger`, else `frontend.nodeType === 'ai_battery'`). Surfaced to
    the editor via `OpSummary.manualTrigger` (`layer2/queries.ts`), the frontend
    `Battery` type, and `transport/mappers.ts`.
  - **Kernel — walker:** `executeNode`'s walk now treats a `manualTrigger` node
    as a *data boundary*: it is NEVER executed by the walk; its outputs are
    hydrated from the persisted output cache so genuine downstream consumers still
    receive the last Run-button value. Emits `exec:node:skipped`
    (`layer2/execute-node.ts`, `layer2/subscriptions.ts`). The same skip is
    applied to inner group nodes (`layer1/executor.ts`).
  - **Kernel — out-of-band write:** new `writeNodeOutput(runtime, nodeId, portId,
    value)` (`layer2/write-output.ts`) persists a Run-button result into the same
    output cache the walker reads (wrapping scalars in the dispatcher wire form,
    tagging the current `graph.hash`) and emits `exec:node:output` so subscribed
    clients refresh.
  - **App — AI routes:** `/api/v1/ai/image` and `/api/v1/ai/text`
    (`backend/src/ai/routes.ts`) now call `writeNodeOutput` after a successful
    generation (ports `image` / `result`) when a `nodeId` is supplied, so the
    skipped op's downstream hydrates from cache without re-firing the op.
  - **App — batteries:** `image_gen` and `text_gen` `meta.json` set
    `"manualTrigger": true`.
  *Why:* the Run button is the sole intended trigger for AI API calls; the pipeline
  walker must not re-fire it on unrelated upstream edits. Covered by
  `packages/.../node-runtime/src/__tests__/execute-node.test.ts`
  (manual-trigger skip + cache hydration + `writeNodeOutput`) and
  `backend/tests/ai-routes.test.ts` (Run result persisted to cache).

- **A single Run click now calls the AI API exactly once (no duplicate calls).**
  `AINode.handleRun` (`packages/.../node-runtime-react/.../canvas/AINode.tsx`)
  used to write its persist-only result fields (`_gen_image` / `_gen_result` /
  `_gen_error`) via non-silent `updateNodeParam`, each of which kicked off an
  `incrementalExecute` whose walk re-ran the AI node — a second API hit per click
  (and a double downstream pass). Those writes are now `silent`, followed by a
  single explicit `incrementalExecute(id)`; combined with the kernel
  `manualTrigger` skip, the AI op fires once (via the Run button's own fetch) and
  the downstream refreshes once from the freshly cached output. The text branch
  also now forwards `nodeId` so its result is cached symmetrically.


  `ai/` battery now renders as a plain BatteryNode**
  (`backend/src/routes/batteryCategories.ts`). The scanner previously routed
  *all* `ai/` big-tag batteries to `nodeType: 'ai_battery'`, so transform ops
  like `name_list_gen`, `prompt_dealer`, and `grid_value_to_mask` wrongly showed
  a manual Run button + resident preview (and `prompt_dealer` lost its dynamic
  ports, which AINode doesn't render). Now only the two API-calling providers
  are whitelisted to `ai_battery`; the rest are pinned to `battery` so they get
  normal battery behavior. *Why:* the Run button exists solely to gate AI API
  calls — non-API batteries should execute through the standard pipeline like
  any other op. Covered by `backend/tests/batteryCategories.test.ts`.


  a plain `BatteryNode` (title + ports, no preview) because the kernel's built-in
  `image_preview` renderer is not wired into this app's editor. Added an app-local
  `frontend/src/workbench/ImagePreviewNode.tsx` (+ `.css`) — it wraps the kernel
  `BatteryNode` and appends a preview panel that reads the **upstream** image
  straight from the incoming edge (`{ blobId }` → `/api/v1/library/blob/:id`, or a
  `data:` URL), with a "连接图像端口" empty state — and registered it under the
  `image_preview` node type in `frontend/src/panels/scenePanels.ts`
  (`domainNodeTypes`), which overrides the default `image/*` → `asset2d_image_battery`
  routing. Tests: `frontend/src/workbench/__tests__/ImagePreviewNode.test.tsx`
  (preview-from-edge + empty state) and an added assertion in
  `panels/__tests__/scenePanels.test.ts`. *Why:* the preview battery was visually
  inert in the canvas, defeating its purpose.

### Added

- **`image_preview` 图像预览电池 (`batteries/image/basic/image_preview/`).** A
  pass-through inspector node for the asset workbench: connect any `image`-typed
  output (ImageGen / RemoveBG / Resize …) into its `image` input to preview the
  picture inline on the canvas, and feed the identical image out of its `image`
  output without breaking the wire. Backend `index.ts` only passes the alias /
  data URL through; the visual is the kernel's standalone `ImagePreviewNode`,
  selected via an explicit `frontend.nodeType: "image_preview"` in `meta.json`
  so it overrides this app's default `image/*` → `asset2d_image_battery` routing
  (`backend/src/routes/batteryCategories.ts`). Unlike `ImageBatteryNode` (which
  previews a battery's own *output* ports after execution), this reads the
  *upstream* value straight from the edge, so it shows the image even as a probe
  and renders a "连接图像端口" empty state when unwired. `projectTypes:["asset2d"]`
  scopes it to this app's palette (Basic group). *Why:* the 2D asset pipeline had
  no dedicated, non-destructive way to eyeball an image mid-chain.
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

- **"Node Info" panel above History in the 2D Scene Asset Generator controls.** A new top
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
  `apps/wb-2d-scene-asset-generator/frontend/src/workbench/SceneGeneratorControlsPanel.tsx`
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

- **`ImgPreview` (`image_preview`) node now renders the preview pane inside the
  battery shell instead of as a detached box below it
  (`frontend/src/workbench/ImagePreviewNode.css`).** The outer wrapper
  (`.asset2d-image-preview-node`) now owns the battery border / radius / glow
  (mirroring kernel `.battery-node`, incl. hover and `:has(.battery-node.selected)`
  selected glow), the inner `<BatteryNode>` renders transparently (header + ports
  only, no own frame), and `.ip-preview` fills the bottom of the same shell
  separated by a hairline. *Why:* the previous layout stacked a fully-framed
  `BatteryNode` over a separately-bordered preview box, so the preview looked like
  it hung outside the battery; the user wants it wrapped into the battery itself.
- **Preview left tab now uses the 2D Scene Asset Generator controls-panel layout.**
  Edit tools, Selected layer, and Help render as collapsible, resizable sections
  with their own persisted layout state. *Why:* Preview and 2D Scene Asset Generator share
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
  (History / Data Types / Help) from the standalone 2d-scene-asset-generator dev commit,
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
  - New AI tool **`asset2d:projects.close`** (release the exclusive lock) +
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
  legacy relay interactions inherited by 2d-scene-asset-generator: double-click a wire to
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
- **Empty BatteryBar at `:9565`**: caused by `opSpecToBattery` crashing on ops that
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
    domain-agnostic (the 2d-scene-asset-generator host already serves `getNodeOutput` via
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
