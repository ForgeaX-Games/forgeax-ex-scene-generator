# Changelog — kernel (`packages/*`) + monorepo

All notable changes to the node-editor **kernel** (`packages/{node-runtime,
node-runtime-react,scene-authoring,project-generator,editor-host,batteries-common,i18n,node-runtime-cli}`) and the
monorepo as a whole.

Format: [Keep a Changelog](https://keepachangelog.com/) · semver. Dates are
calendar dates in the project timezone.

> **Maintenance contract (see [`AGENTS.md`](./AGENTS.md)).** Every commit that
> touches kernel source MUST add a bullet under `## Unreleased`, grouped by
> Added / Changed / Fixed / Removed / Deferred, citing the relevant `file:line`
> and test. History below is **append-only** — never rewrite past entries;
> corrections append a new entry stating the reason. App-level changes go in the
> per-app changelogs (`apps/*/CHANGELOG.md`), not here.
>
> Pre-monorepo `@forgeax/node-runtime-react` history lives in
> [`packages/node-runtime-react/CHANGELOG.md`](./packages/node-runtime-react/CHANGELOG.md);
> from 2026-06-02 onward, kernel-wide entries are recorded here.

---

## Unreleased

### Fixed

- Published Scene authoring resolves resources from the module root and includes acceptance coverage and reference sources, so Sino receives callable contracts and all six reference topics work outside the source checkout. See `apps/wb-scene-generator/backend/src/resources.ts:1` and consumer regression `scripts/probe-scene-authoring.mjs:3`. Generator SDK/sandbox entries are included and backend bundles use production mode, avoiding development file watchers in the installed package.
- Canonical execution summaries resolve omitted final output references before counting meshes; large mesh scenes must not appear empty. See `apps/wb-scene-generator/backend/src/captured-outputs.ts:4` and `apps/wb-scene-generator/backend/tests/captured-outputs.test.ts:4`.
- Release 0.2.5 keeps Windows installer paths within the supported budget: generated 2D preview names are stable and source-only `*.generated.json` parity oracles are excluded from the runtime package. Release tooling also reads canonical manifests, invokes npm through its CLI entry, and identifies battery `index.ts` files by basename so Windows builds compile the same 622 entries as Linux. Gates: `scripts/{build,check}-standalone-releases.mjs` and the IDE product-wide path preflight. This replaces the symptom-by-symptom 0.2.4 fix with a whole-package invariant.

- Release 0.2.3 includes module agent personas so declared specialists can be materialized. Copy: `scripts/build-standalone-releases.mjs:53`; regression gate: `scripts/check-standalone-releases.mjs:47` checks both generated files and the npm pack inventory. This closes a separate missing-file defect after the 0.2.2 duplicate-tool fix.

- Release 0.2.2 rejects duplicate tool IDs before publishing so the Studio host can register the package and Sino. Gate: `scripts/check-standalone-releases.mjs:35`; regression: `scripts/release-tools.test.mjs:9`.

### Added
- **Converged the release into `@forgeax-extension/scene-generator`.** `scripts/build-standalone-releases.mjs` now emits one package with `composition`, `3d-model`, and `2d-assets` first-level modules; the publish workflow performs one tag-validated `npm publish`. *为什么：* the product is one Scene Generator, so npm identity and lifecycle must not split into three packages.
- **Project Generator ABI: static `defineGenerator`, overlay registry, and sandboxed `OpSpec`.** `@forgeax/scene-authoring` parses Contract from AST (host never executes source). New `@forgeax/project-generator` bundles `.generator.ts` + helpers, runs each call in a fresh child process, and stamps `implementationRevision`. `@forgeax/node-runtime` `OverlayOpRegistry` merges a read-only platform base with a mutable local layer; cache freshness compares `opRevision`. Tests: `packages/scene-authoring/src/language/generator-parser.test.ts`, `packages/node-runtime/src/__tests__/overlay-registry.test.ts`, `packages/project-generator/src/__tests__/{compile,sandbox}.test.ts`. *为什么：* 项目局部算法必须与平台 Battery 同 ABI，但作用域、沙箱和生命周期不同，且源码变化必须让缓存失效。
- **Scene Script compiler builtins `repeat` / `choose`, spatial port protocol, and `bool`/`boolean` alias.** `repeat.count` is a static 1..16 (`SCENE_REPEAT_MAX_COUNT`); `choose` lowers to ordinary `scene_choose`. `portCompatibilityIssue` enforces declared `runtimeType` and treats `bool`/`boolean` as the same ordinary type. Tests: `packages/scene-authoring/src/scene-authoring.test.ts`, `packages/scene-authoring/src/diagnostics/diagnostics.test.ts`. *为什么：* 循环和选择属于语言，不是高阶执行器；空间口要按协议匹配，不能靠全局禁 Any。
- **`ExecutionResult.failures`.** Bounded `{ nodeId, message }` on the kernel execute result. Tests: `packages/node-runtime/src/__tests__/execute-node.test.ts`. *为什么：* 宿主和 Agent 需要修理单，而不是去解析 stack 或 `execFailures` 字符串。
- **Documented the two-identity packaging contract (pnpm `apps/*` vs published `@forgeax-extension/*`).** Root [`docs/development-and-release.md`](./docs/development-and-release.md) is the SSOT. Studio `prepare.ts` bun-installs the three slug roots, so `apps/*/package.json` is a registry-only shell; `backend`/`frontend` keep `workspace:*`. Cold start uses `scripts/ensure-workspace-packages.mjs` from `serve-dist.mjs` / `dev.mjs` / `build-standalone-releases.mjs`. Lock: `scripts/standalone-plugin-dependencies.test.mjs`. CI: `.github/workflows/release-gate.yml`. *为什么：* foreign `bun install` of `workspace:*` at the slug root failed; `file:` also failed; Studio/marketplace cannot change except pin.
- **Added the unified Scene Script diagnostic contract and executable structured Fix seam.** `packages/scene-authoring/src/{types,diagnostics,commands}.ts` preserves legacy `code/phase/severity/message/source` fields while adding graph location, bounded expected/actual evidence, fixes, transaction state, retryability, and escalation with one explicit policy table for all phases. `ReplaceReference` fixes execute through canonical authoring commands. Tests: `packages/scene-authoring/src/{diagnostics,scene-authoring}.test.ts`. *为什么：* failures must guide source repair without exposing Runtime payloads or requiring agents to investigate internal APIs.
- **Added `@forgeax/scene-authoring` and a canonical-authoring interception seam in `@forgeax/editor-host`.** The new package provides the restricted Scene Script AST/parser/printer, versioned function contracts, deterministic Authoring Entity compiler, recursive module composition, source maps, structured diagnostics, scoped commands, and sealed-group capability checks. `ProjectPipelineRouteDeps.handleApplyBatch` lets a domain translate an existing visual editor batch into its canonical authoring transaction before the legacy runtime write occurs. Tests: `packages/scene-authoring/src/scene-authoring.test.ts`; build: `packages/editor-host/src/backend/projectPipelineRoutes.ts`. *为什么：* preserve the shared node editor while allowing AI-oriented apps to move their source of truth above opaque runtime graph mutations.

- **Split kernel write-path and editor god files without changing public APIs.** `packages/node-runtime/src/layer2/apply-batch.ts` is now the OCC/save/emit orchestrator; types/ops/group-ops/classify/validate live beside it. `node-runtime-react` extracted `BatteryBar` row/presets/icons and `pipelineStore` fan-out/persist/execution/live-sync/group-view modules; `usePipelineStore` remains a single zustand `create`. Tests: `pnpm --filter @forgeax/node-runtime test`, `pnpm --filter @forgeax/node-runtime-react test`. *为什么：* 1400–2700 line files mixed mutation, UI, and live-sync in one compilation unit.
- **Split Scene Agent HTTP and remaining authoring god files without changing public APIs.** `packages/scene-authoring/src/commands/apply-project-ops.ts` holds extract/move/inline helpers; `compile/{compiler-helpers,module-compiler,project-compiler}.ts` split module vs project compile (`compiler.ts` re-exports). Scene Agent routes live in `apps/wb-scene-generator/backend/src/routes/scene-agent/*`. Tests: `pnpm --filter @forgeax/scene-authoring test`. *为什么：* leftover 700-line files after the first authoring reorg still mixed helpers with facades.
- **Aligned stale maps to the seven-package kernel.** `guidance/{GUIDANCE,packages_framework,apps-overview,state-machine,wb-2d-*}.md` now list `scene-authoring`, 45 common ops, and `POST /api/v1/projects/:projectId/batch` via `registerProjectPipelineRoutes`. *为什么：* guidance still said 六包 / 32 ops / unscoped `/api/v1/batch` after the authoring-stack reorg. `packages/scene-authoring/src/` is now `language/` `model/` `contracts/` `compile/` `commands/` `diagnostics/` `migrate/` `workflow/`; `compiledOpsToKernelGraph` lives in `compile/projector.ts`; `commands.ts` is split into module/project/fix modules. Tests: `pnpm --filter @forgeax/scene-authoring test` (43). *为什么：* the language stack was a flat 18-file dump and could not host a projector or grow without more god files.
- **Declared `@forgeax/scene-authoring` on `@forgeax/batteries-common`.** `packages/batteries-common/package.json` now lists the workspace dependency used by 45 `scene.contract.ts` files. *为什么：* contracts already imported the package via hoist; isolated publish would break.
- **Scene Script `Mesh` port type.** `ScenePortTypeName` and `portContractForType` include `Mesh` (`type: 'mesh'`). *为什么：* heightfield terrain is a first-class graph value, not a renderer-only extrusion.
- **`PortContract.control`.** Optional flag on a Scene Script port so a scene-level panel (Valley) can collect demo knobs without opening the full inspector. Tests: app Valley drawer smoke. *为什么：* seed / roadWidth / buildingHeight are Control, not ordinary battery params.

### Changed
- **`incrementalExecute` now returns the execute result.** Callers can see `status: 'error'` and roll back a param write. Tests: `packages/node-runtime-react/src/editor/__tests__/pipelineStore.test.ts`. *为什么：* a viewport SetParam that blows up the graph must be able to restore the previous value.

### Fixed
- **Dropped batteries did not auto-execute on canonical Scene Script projects.** `placeBattery` already called `incrementalExecute`, but the authoring adapter compiles a new entity id on persist, so the walk targeted the canvas-minted id (`executeNode: target node not found`) and never hydrated outputs. Incremental execute now retries against the single new kernel node (or the full graph). Tests: `packages/node-runtime-react/src/editor/__tests__/{pipelineExecution.remap,pipelineStore}.test.ts`. *为什么：* dropping a grid battery must run the existing hot-update path, not wait for a manual Run.
- **`ProjectPanel` no longer throws `[editor] no transport configured` on first mount.** `packages/node-runtime-react/src/editor/components/chrome/ProjectPanel.tsx` `refreshLocks` now uses `peekEditorTransport()` and no-ops when the parent left pane has not yet called `configureEditorTransport` (child effects run first). Same pattern as `BatteryBar.tsx`. *为什么：* HMR / plugin remount raced the boot effect and spammed the console even when `/ops` was healthy.
- **Studio `bun install` of the three workbench slug roots no longer hits `workspace:*`.** App-root `package.json` files are registry-only shells; kernel consumption stays on `apps/*/{backend,frontend}` via `workspace:*`. `serve-dist.mjs` / `dev.mjs` / `build-standalone-releases.mjs` call `ensureWorkspacePackages` (walk up to `pnpm-workspace.yaml`, then `pnpm --filter './packages/**' run --if-present build`). Tests: `scripts/{standalone-plugin-dependencies,ensure-workspace-packages,cold-start-health}.test.mjs`. *为什么：* `prepare.ts` bun-installs marketplace symlinks into `apps/*` and cannot be changed this round (other repos: pin only).

- **电池栏拖入画布不再卡死（重复 onDrop + 巨型拖拽载荷 + 节点 id 碰撞 + Edge 拖拽幽灵图快照）。**
  `Canvas.tsx` 外层 `.canvas` 与内层 `<ReactFlow>` 均注册了 `onDrop`，同一原生 drop 事件会触发两次 `placeBattery`：两次 `node-${Date.now()}` 在同一毫秒内碰撞 → ReactFlow 节点表出现重复 id → 主线程卡死、刷新后仍异常。
  `useCanvasDrop.ts` 以 `timeStamp+clientX+clientY` 去重；新节点 id 改用 `mintCanvasNodeId()`（与 copy/paste、ctrl-drag 一致的随机后缀）。
  `BatteryBar.tsx` 对 catalog 内电池改传 `application/battery-id`（落盘时从 store 查完整 Battery），避免 Templates 行把 multi-MB `iconPng` base64 塞进 `dataTransfer` 再在 drop 时 `JSON.parse` 阻塞主线程。
  以上修完后用户反馈 Edge 上拖拽仍卡死（Chrome 不卡）——定位到第四个独立成因：Templates 行内联 `<img src={battery.iconPng}>`（`BatteryBar.tsx:416`），原生 HTML5 DnD 默认会同步栅格化被拖拽的 DOM 节点作为拖拽幽灵图，Edge 对大体积内联图片走同步慢路径（Chrome 走合成层缓存，不受影响）——鼠标停在「拖拽中」形状、整页点不动，正是 OS 级 drag 会话卡在幽灵图生成上。
  `BatteryBar.tsx:60-83`（`getDragGhostCanvas`）新增一个预渲染的 28×28 占位 canvas，两处 `handleDragStart`（`:1253` 电池行、`:184` 文本预设行）都在 `dragstart` 里 `e.dataTransfer.setDragImage(ghost, 14, 14)`，用固定小图接管幽灵图，绕开对巨图的隐式快照，与 iconPng 大小无关。
  `relayCreate.smoke.test.tsx` 仍通过；`pnpm --filter @forgeax/node-runtime-react build` 通过。
  *为什么：* 三插件共用内核编辑器，拖电池卡死是共享 drop 路径的回归，非单 app 问题。

- **`ProjectRegistry.openProject()`（AI 调用者）现在会同时把该项目设为「查看中」项目，不再只加锁。**
  `packages/node-runtime/src/layer2/project-registry.ts:627`（`ProjectRegistry.openProject`）。
  *为什么：* 每个 app 只有一个共享渲染面（`?pane=urdf` 之类的实时查看器/无头渲染器），其截图/GLB 导出路由都以
  `getViewingProjectId()`（「查看中」项目）为准，从不看任何 agent 的独占锁。此前 `projects.open` 刻意不改查看中项目，
  但也没有任何 AI 可调用的工具能设置查看中项目（`viewProject`/`/view` 只挂在人类 UI 上）——于是 agent 一旦
  `projects.open` 一个不是当前查看中的项目（新建项目后的常规流程），其自身的 `screenshot.capture`/`export-glb`
  就会永久 409「project X is not the viewing project」，且无法自行恢复，正是用户报告的「调用截图等工具时对话
  异常中断/出现路径错误」。人类的显式 `viewProject`/非 AI 调用者的 `open` 行为不变（见新增测试
  `apps/wb-3d-lowpoly/backend/tests/agent-project-scoping.test.ts`、`packages/node-runtime/src/__tests__/project-registry.test.ts`
  既有用例仍全部通过）。

- **Panel（TextPanel）节点重新支持双击进入编辑输入文字。** `Canvas.tsx` 画布空白处双击搜索弹窗用的原生 `dblclick` 监听挂在 `.react-flow__pane` 上，而节点是该 pane 的后代，节点上的双击会冒泡到此监听并被 `e.stopPropagation()` 截断，导致 React 委托的节点 `onDoubleClick` 永不触发（panel 无法进入编辑）。监听里加 `e.target.closest('.react-flow__node')` 守卫：命中节点时直接 return、不拦截，仅空白背景才弹搜索框。*为什么：* `200c201` 引入原生 pane 双击监听时未排除节点，破坏了 Panel 的双击输入。
- **组内视图里删除/新增节点、增删内部连线、移动或改参数，现在会立即（去抖）持久化，不再「刷新后全部重现」。**
  此前组内编辑只写进内存 ref + 标脏（`useCanvasGroupView.ts` 的 `syncInnerNodesDelete`/`syncInnerNodeAdd`/`syncInnerEdgeAdd`/`syncInnerEdgeRemove`/`syncInnerNodePosition`/`syncInnerNodeParam` 仅设 `isDirtyRef`），
  只有**退出组视图**（`exitGroupView` 的 `flushInnerEdits`+`persistSession`）才落盘。于是在组内「删干净」后直接刷新网页、未先退出，未落盘的删除全部丢失、节点重现（用户报告「没有持久化到 json」）。
  新增 `scheduleInnerPersist`（`flushInnerEdits` 把 ref 写回 store group + `schedulePersistSession('group-inner-edit')`），接到上述六个结构性内编辑回调上，使组内编辑与根画布编辑一样去抖落盘、可跨刷新存活；退出时仍做最终 flush（幂等）。`syncInnerNodePosition` 仅在拖拽停止（`onNodeDragStop`）触发，无逐帧抖动。`tsc --noEmit` 通过（`node-runtime-react`）。
  *为什么：* 组内编辑与根画布编辑应有一致的持久化语义，不能依赖「必须先退出组」才保存（根画布删除本就经 `useCanvasDelete` 直接 `persistSession` 落盘，已验证正常）。
- **组内视图下输入端口取值现会查 group 自身的 edges（之前只查根 `currentPipeline.edges`，导致组内节点取不到上游内部节点的输出）。** `nodeTooltip.tsx` `resolveInputPortValue`：进入某组内视图时，先用 `groupViewStack` 末项定位当前 group，把 `group.edges` 拼到 `currentPipeline.edges` 前面再追溯上游；上游内部节点的真实输出由 `probeGroupInnerOutputs` 已 hydrate 到其真实 id 下，故能解析。*为什么：* 组内的连线存在 `group.edges` 而非根 edges，叶子可视化节点（`scene_structure`/`mask_structure` 等）因此在组内视图无法解析输入、只显示占位提示。

### Changed
- **Further split kernel god files without changing public APIs.** `pipelineStore.ts` is the zustand facade; groups / agent ops / canvas extras live in `pipelineGroups.ts` `pipelineAgentOps.ts` `pipelineCanvasExtras.ts`. Persist retries bind `get` instead of importing `usePipelineStore`. `output-cache-format.ts` holds shard/DataTree helpers; `project-registry.types.ts` holds registry types; `groupViewLayout.ts` holds group-view geometry (re-exported from `useCanvasGroupView`). BatteryBar catalog matching lives in `batteryGrouping.ts`. Tests: `pnpm --filter @forgeax/node-runtime test`, `pnpm --filter @forgeax/node-runtime-react test`. *为什么：* Ported hunks landed in already-split facades and the remaining 1k-line files mixed format/types/layout with the orchestrators.
- **CLI / live-sync comments name the project-scoped batch path.** `node-runtime-cli` `postBatch` errors report the path actually used (`/api/v1/projects/:id/batch` or legacy `/api/v1/batch`); `pipelineHistoryBridge.ts` documents the project-scoped route. *为什么：* unscoped `/api/v1/batch` is no longer the write entry.
- **电池栏左下角「开发/模板」切换图标改为环形双箭头（循环）形状。** `BatteryBar.tsx` `ModeToggleRailIcon`：由上下双箭头（swap）改为两段半圆弧 + 左上/右下箭头的环形循环图标。*为什么：* 用户要求该图标改为更直观的循环刷新形状。
- **Templates 行：拉宽电池栏时缩略图不再放大，名称 / 版本 / 作者 / 时间戳整体等比放大（先保证全部文字显示、再放大、绝不截断）。**
  `BatteryBar.css`：`.battery-row-thumb` 固定 `flex:0 0 164px; width:164px`（默认栏宽下的尺寸，拉宽/收窄电池栏均不变，宽度变化只作用于文字）；
  改 CSS 容器查询为 JS 测量驱动：用 canvas 逐行测量名称、版本+作者行、日期的单行自然宽度。
  **列表层**（`BatteryBar`）对全列模板（`visibleBatteries`）求出**全局最宽文字行** `templateMaxLineW` 下发给每个 `BatteryRow`，
  使全列所有行共用同一约束、同一缩放系数 `--tpl-scale`（行间大小一致）：只要最宽行还放不进一行就整体保持换行不放大（不截断），
  全部能单行容纳后才统一加 `.is-oneline`（`nowrap`）并整体等比放大，高度封顶约缩略图高（`imageH / TPL_BASE_BLOCK_H`）。
  名称 / `-ver` / `-author` / `-date` 字号均改为 `calc(基准 * var(--tpl-scale,1))`，相对大小一致、同步放大。
  *为什么：* 用户希望拉宽时所有文字同步等比放大、且优先保证文字完整显示后再放大（旧实现仅放大标题且会省略号截断）。

### Added
- **「保存到模板」对话框新增「作者」输入框（写入模板 JSON 的 `author`，配合 Templates 行展示）。**
  `GroupTemplateSaveDialog.tsx` 新增 `authorInput` 态与输入框（可选），保存时把 `author` 合并进 `savedGroup`；
  编辑器 `NodeGroup`（`editor/types.ts`）新增可选 `version?`/`author?`/`createdAt?` 以承载模板元数据。
  后端 save-user 的 `stampTemplateMeta` 会保留该 `author` 并补 `createdAt`，故无需改 API 签名。
  *为什么：* 用户保存模板时需要直接录入作者名，而非只能事后手改 JSON。

### Added
- **Templates 模式电池行除名称外，新增显示「版本号 · 作者 · 制作时间戳」（持久化在模板 JSON 中，读取到前端展示）。**
  契约扩展：`GroupTemplateBattery`（`api/ApiClient.ts`）与编辑器 `Battery`（`editor/types.ts`）新增可选 `author?: string` / `createdAt?: number`（`version` 已有）；
  `groupTemplateToBattery`（`editor/transport/apiAdapter.ts`）透传二者。
  前端 `BatteryRow`（`editor/components/sidebar/BatteryBar.tsx`，仅 templateMode）在名称下方渲染 `vX.Y.Z` + `作者 …` 行与一行时间戳（新增 `formatTemplateDate`），样式见 `BatteryBar.css`（`.battery-row-template-info/-ver/-author/-date`）。
  数据来源由 app 后端 `/api/v1/group-templates` 提供（见各 app CHANGELOG：从模板 JSON 读 `version`/`author`/`createdAt`，缺省时 `version=1.0.0`、`createdAt` 回退文件 mtime；保存时落盘 stamp）。
  *为什么：* 用户需要在模板列表上一眼看到模板的版本、作者与制作时间，而非仅名称。

### Fixed
- **template/group 折叠面与内部视图壳的输入端口现在能显示内部映射端口的默认数据（此前未连线恒显示「暂无数据」）。**
  普通电池输入端口 hover 时未连线会回退显示 meta `default`（`BatteryNode.tsx:440`），但 group 走另一套：折叠面用 `resolveInputPortValue(groupId, portName)`（只查根图连线 / group shadow 节点 params，后者无逐端口默认值），内部壳只读 `nodeOutputs[shellId]`（仅在有真实上游缓存时由 `hydrateGroupBoundaryAliases` 写入），两者未连线时恒为 `undefined`。
  新增共享解析 `resolveGroupExposedInputValue(group, port)`（`groupViewUtils.ts`）：顺 `ExposedPort.sourceNodeId`/`sourcePortName` 找组内源节点——源是嵌套 `__group__` 则递归进子组对应暴露输入；否则源节点 `params[sourcePortName]` 有值当 `value`，无则查电池目录 `inputs[name].default` 当 `default`（muted）。
  折叠面（`GroupNode.tsx` 输入端口 `onMouseEnter`）与内部壳（`GroupBoundaryNode.tsx` `showPortValueTooltip`）在原值为空时回退该解析，按 `value:`/`default:` 显示，与普通电池一致。`tsc --noEmit` 通过。
  *为什么：* 组合电池的暴露输入应像普通电池一样在未连线时展示内部端口的默认值，便于用户判断「不连会取什么」。

### Added
- **电池栏大标签 rail 底部新增 Develop ⇄ Templates 切换按钮（在收起与五角星之间）。**
  `BatteryBar.tsx` `.bb-rail-group--collection` 内、收起按钮之下、收藏星标之上插入一个图标按钮，
  点击调用与 Toolbar 切换相同的 `setBatteryFilterMode` store 动作（二者状态同步）；
  处于 templates 模式时按钮点亮强调色（`BatteryBar.css` `.bb-rail-button--mode`）。
  *为什么：* 让用户无需离开电池 rail 即可切换 develop / templates 模式。

### Changed
- **Templates 模式预览图改为完整显示（`contain`）+ 黑色填充剩余区域。** `BatteryBar.css`
  `.battery-row-thumb-img` 由 `object-fit: cover`（裁切）改为 `contain`（整图可见、不裁切），
  `.battery-row-thumb` 背景由 `rgba(251,191,36,0.06)` 改为 `#000` 填充留白。
  *为什么：* 模板预览图（如不同宽高比的截图）此前被预览框裁掉边缘，用户需要看到完整模板缩略图。
- **电池栏大标签拖拽顺序持久化到浏览器（develop / templates 各存各的）。** 此前顺序仅
  存在 apiAdapter 内存 `orderCache`（刷新即丢），且 develop 与 templates 共用同一
  `batteryOrder.bigLabels`。现按模式分桶写入 `localStorage`（`batteryBarStorage.ts:readBigLabelOrder/writeBigLabelOrder`，key `battery-bar-big-label-order` = `{ develop, templates }`），
  `BatteryBar.tsx` 渲染（`bigLabels` useMemo）与拖拽落点（`handleTabDrop`）改用按当前
  `batteryFilterMode` 读取/回写的本地态；切换模式时重载对应桶。
  *为什么：* 用户调好的左侧大标签顺序需跨刷新保留，且两种模式标签集不同必须互不污染。
- **Templates 模式电池栏支持小标签手风琴（与 Develop 模式统一）。** 此前 Templates
  模式无条件把某大标签下的全部模板平铺、丢弃小标签（`BatteryBar.tsx` 旧分支假设
  「子目录名＝卡片名」）。现按目录结构区分：`templates/{大标签}/{小标签}/{模板}/file.json`
  的模板进小标签手风琴（与 Develop 共用新抽出的 `renderSmallSection`，UX 一致）；扁平
  `templates/{大标签}/{模板}/file.json`（子目录名即卡片名、无独立小标签层）仍直接平铺，
  避免「每个模板一个同名小标签」的冗余。新增 `batteryGrouping.ts:getTemplateSmallLabel`
  （仅当大标签与模板文件夹之间确有一层小标签目录时返回该小标签，否则 null）。
  测试 `batteryGrouping.test.ts`（嵌套返回小标签 / 扁平返回 null / 无 sourcePath 返回 null）。
  *为什么：* 用户把 scene 模板按 `interests/decoration/LakeRegions` 等结构归类，需要
  Templates 模式像 Develop 一样按小标签分组。
- **merge: integrate `origin/main` into `dev`。** 合入 scene 侧 keypoint_graph/keypoint_layout、PointSampleBuilding 手动放楼、voxel_slice 自动 z、共享沙箱热更新、image_atlas_compose 模版端口可选等；2d skill 冲突保留 dev 模板电池版文档。 `BatteryBar.css` 把 `.bb-big-content-title` 的分割线伪元素从 `::after` 改为 `::before`（`flex:1` 撑满），名称从「左侧名称 + 右侧横线」变为「左侧横线 + 右侧名称」。

### Added
- **`batteries-common` 新增逻辑非电池 `not`（取反）。** 输入 `value`（`type:bool`）取反输出 `result:bool`（true↔false）；非布尔输入按真值判断（空串/"false"/"0"/0 为 false）后取反（`logic/not/index.ts:not`）；支持 DataTree 批处理。
- **`batteries-common` 新增通用判断电池 `equals`（相等判断）。** 2 个输入端口 `condition`、`rule`（`type:any`，`access:item`），两边转字符串后比较，相等输出 `result:bool=true` 否则 `false`（`logic/equals/index.ts:equals`）；支持 DataTree 按 lacing 逐对批处理。新增 `common/logic/` 分类。
- **`batteries-common` 新增通用流程电池 `port_router`（端口路由 / Switch）。** 2 个固定输入端口 `rules`（规则串，形如 `[{A:2},{C:3}]`，键→动态端口下标）、`params`（生效键集合串，形如 `(A,C)`）+ 一组 `port_*` 动态输入端口（`port_router/meta.json` 的 `dynamicInputs.prefix="port_"`），按规则书写顺序取第一个命中参数集合的键，将其下标对应的 `port_<n>` 输入原样透传到 `any` 输出端口 `value`；无命中或该端口未连接则不输出（`port_router/index.ts:portRouter`）。所有端口 `access:tree`（无 fanout，函数单次调用、整树透传），`rules/params` 未连线时由 meta 默认值以原始字符串注入、连线时为 DataTree，统一用 `getScalar` 取标量。路由选择逻辑已用独立脚本验证（规则顺序优先、命中/未命中/多键场景）。

### Fixed
- **组内视图：增加电池、修改组内节点参数（如文本面板内容）会漏到组外、不保存进组合电池、组也不变 `unsaved*`。**
  - **根因：** 组内编辑采用「ref 暂存 + 退出回写」（`useCanvasGroupView.ts`：`innerNodesRef` 等，退出时 `flushInnerEdits`→`updateGroup` 标脏）。连线增删/删除/移动已接入 `syncInner*`，但**增节点**（`useCanvasDrop.placeBattery` 直接 `store.addNode` 写根 `currentPipeline.nodes`）与**改参数**（节点组件直接 `store.updateNodeParam`，只在根 nodes 里 find/map）两条路径绕过了 ref，落到根图。
  - **改参数：** 在 `pipelineStore.ts` 新增可注册的 group-view inner param-edit sink（`setGroupInnerSink`）；`useCanvasGroupView` 在组内视图激活时注册 `syncInnerNodeParam`（退出清除），`updateNodeParam` 据此把内部节点参数编辑路由进组的 live ref 并标脏（对非本组 id 返回 false 回落根路径，无需改动各节点组件）。
  - **增电池：** 经 `Canvas.tsx` 的 ref 桥把 `syncInnerNodeAdd` 传给 `useCanvasDrop`；`placeBattery` 组内时改用 `onInnerNodeAdd` 取代根 `store.addNode`，并跳过根层 history 记录与 `incrementalExecute`（退出 flush 会重算内部子图）。仅路由 `placeBattery`（拖拽/双击搜索），不影响 paste/ctrl-drag 等其它根 `addNode` 调用方。
  - 退出时 `updateGroup` 如实回写组的 nodes（含新电池与新参数）→ 组合电池正确保存且转 `unsaved*`，不再漏到组外。`pnpm typecheck` 通过；190 项内核单测全过（`transport.test.ts` 1 项失败为既有、与本改动无关）。
- **复制/Ctrl+拖拽 template/group 节点：① 复制后样式退化为普通 group；② 内部 `image_gen` 仍保留母体缓存。**
  - **样式：** 复制路径（`useCtrlDragGhost.ts` 单组与包围框两处、`useCanvasCopyPaste.ts` 粘贴）原先把新 shadow 节点的 params 写死成 `{ groupId }` 且不向 `buildGroupNodeData` 传 `isTemplate`，丢掉了 `__groupIsTemplate` 等溯源。现用 `readGroupProvenance(源 params)` 读出溯源（含 `isTemplate`），经 `writeGroupProvenance` 合并进新 params 并传给 `buildGroupNodeData(..., isTemplate)`，复制出的 template 保持 template 样式/锁定 UI。
  - **缓存：** `remapGroupIds`（`groupViewUtils.ts`）拷贝内部节点 params 时用新增的 `stripGenCacheParams`（`groupStatus.ts`）剥掉 `_gen_image`/`_gen_result`/`_gen_error`，复制体不再带母体上次生成结果（一处改动覆盖 Ctrl+拖拽/粘贴/库实例化全部复制路径；磁盘模板无缓存故为 no-op）。剥除不影响内容哈希（哈希本就 `stripProvenance` 掉 `_gen_*`），保存状态保持一致。

### Changed
- **电池栏（BatteryBar）：两视图越界滚动连通 + 大标签名称叠在分割线上。**
  - **越界滚动跨视图（无缝）：** 电池视图滚到底后继续向下滚动、或收藏视图滚到顶后继续向上滚动，累加越界量到阈值即切到相邻视图并定位到对边（`switchOverscrollView` + 滚动恢复 effect 的 `forcedScrollEdgeRef`）。两视图仍各自独立滚动，只是用越界滚动连通。改用**非 passive 的原生 wheel 监听**：跨界时 `preventDefault` 并用 rAF 手动驱动 `scrollTop`（`ensureFlushLoop`/`transitionUntilRef`），绕开浏览器在边界处的 wheel latching，使同一手势越界后无需移动鼠标即可无缝续滚。
  - **大标签标题：** 每个非空大标签分组在分割线处显示名称（`renderBigSectionTitle`），分割线上下间距略加宽；默认白色（原灰色），带品牌色的大标签沿用其 rail 配色；空分类沿用细线分隔不显示标题（`BatteryBar.css` `.bb-big-content-title`）。
- **组合电池内部视图改为「运行时如实落账 + 只读回读」，彻底废弃「进组每次重跑子图」的探针做法（含组嵌套）。** 端口现在如实反映数据流转：数据到达端口/电池跑完出结果就显示，没跑就为空，不再用重算的「虚假值」。
  - **Kernel — 运行时落账内部端口：** `execute-node.ts`（`runWalk` 的 `__group__` 分支）给 `executeGroupSubgraph` 传 `onInnerResult`，把**每一层**内部节点的真实输出写进与顶层节点同一个输出缓存（`runtime.outputs.write`，内部节点 id 全局唯一）。组原先以黑盒执行、内部中间值算完即丢；现真实运行即记录，嵌套各层各自按其 id 落账。`image_gen` 等 `manualTrigger` 内部节点由 `executeGroupSubgraph` 从其缓存 `_gen_*` 水合（`layer1/executor.ts:414`），落账的是其上次缓存结果，**不会被重跑触发**。
  - **Kernel — 探针改只读回读：** `probeGroupInner`（`layer2/queries.ts`）由「重跑子图」改为直接读 `runtime.outputs` 里落账的真实值（按 `group.nodes` 逐节点 `listPorts`+`read`）；未跑过的端口如实留空。彻底去掉重执行 → 无冷缓存跑空、无 `manualTrigger` 重触发风险。新增 `OutputCache.listPorts(nodeId)`（`layer1/storage/output-cache.ts`）枚举某节点已缓存的端口。
  - **前端 — 壳/外部上下文端口别名：** 新增 dependency-free 的 `groupBoundaryIds.ts`（边界/上下文 id 方案，供 `useCanvasGroupView` 与 store 共享，避免环依赖）；`pipelineStore.ts` `probeGroupInnerOutputs` 回填内部输出后调用 `hydrateGroupBoundaryAliases`，把已在 store 中的真实值（外部输入在真实上游节点、暴露输出在组 shadow 节点）别名到内部视图的壳（`__boundary_*`）与外部上下文（`__group_context_*`）合成 id 上，使壳端口、外部输入/文本面板端口也如实显示（含嵌套：容器取父组）。
  - **前端 — 壳端口显示数据 + 下游 external output 回读：** `GroupBoundaryNode.tsx` 给壳（GROUP INPUT/OUTPUT）每个端口加 hover 值 tooltip（读 `nodeOutputs[壳id][portName]`，由上面的别名落值），壳不再是空白。`nodeTooltip.tsx` `resolveInputPortValue` 与 `ImagePreviewNode.tsx` 改用 `getRealNodeIdFromContext` 按**真实节点 id** 追踪容器图连线——外部输出节点（如 ImgPreview）在组内视图渲染为合成上下文 id，原先按合成 id 找不到连线 → 不显示；现按真实 id 解析，组内与组外显示一致。
  覆盖：`group-nesting.test.ts`「probeGroupInner returns each inner node's real output (incl. nested)」——先整图运行再探针，验证直接内部节点 `k=20` 与嵌套 `g_inner` 暴露输出 `m=10` 均如实回读（174 项内核单测全过）。

### Added
- **组合电池可把内部「带运行按钮电池」（`image_gen`/`text_gen` 等 `manualTrigger`）的运行按钮映射到外部，点击外部按钮即运行内部电池；人点与 agent 调用走同一套流程。**
  这是「映射」而非独立运行：外部按钮只是按内部节点 id 触发该内部电池的运行。
  - **Kernel — 节点定位/输入解析（group 感知）：** 新增 `findNodeWithGroup`（`layer2/queries.ts`，按全局唯一 id 在顶层或 `groups[*].nodes` 中定位节点并返回 `groupId`）与
    `resolveGroupInnerNodeInputs`（跨组边界解析内部节点的 `prompt`/`image`/… 输入：跑组子图算出纯上游 + 路由内部连线 + 暴露输入，未连端口由调用方回退内部节点 `params`）。
    重构 `probeGroupInner` 复用新抽出的 `resolveGroupShadow`/`buildGroupExternalInputs`。
  - **Kernel — 边界水合：** `executeGroupSubgraph`（`layer1/executor.ts`）对 `manualTrigger` 内部节点不再输出空，而是按 `_gen_<port>` 约定（`_gen_image`/`_gen_result`/`_gen_error`）从其
    持久化的运行结果水合输出，使内部运行结果经组的暴露输出流向下游——与顶层 manualTrigger 边界一致。
  - **Kernel — `updateNode` group 感知：** `applyBatch` 的 `updateNode`（`layer2/apply-batch.ts`）在顶层找不到时回退到 `groups[*].nodes` 内查找，使运行结果可写回内部节点。
  - **前端：** `GroupNode.tsx`/`GroupNode.css` 折叠组节点扫描内部 `manualTrigger` 电池并为每个渲染一枚映射运行按钮（per-node），点击发 `{ nodeId: 内部节点id }` 到
    `getAINodeEndpoints()`（新导出于 `AINode.tsx`）对应的同一 AI 端点，成功后 `incrementalExecute(groupId)` 刷新下游。`groupStatus.ts` 的内容哈希排除 `_gen_*` 易变运行结果，
    避免「运行内部电池」误把已保存组标记为 `unsaved*`（与端口类型修复同一陷阱）。
  覆盖：`packages/node-runtime/src/__tests__/group-manual-run.test.ts`（定位/跨边界解析/group 感知写回/水合流向下游/未运行为空，5 项）。配套 app 改动见
  `apps/wb-2d-scene-asset-generator/CHANGELOG.md`。

### Fixed
- **组合电池：外部映射运行按钮出图后暴露 `image` 输出不再为空；内部视图运行后实时刷新内部线/端口/AI 预览。**
  - `GroupNode.tsx`（`runInnerNode`）：外部运行内部 `manualTrigger` 电池后改为 `incrementalExecute(groupId, false, { persist: false })`。后端 `/api/v1/ai/image` 已
    经 `applyBatch` 把内部节点的 `_gen_image` 持久化；原先默认的整图持久化会用**尚未经 `graph:applied` 同步的前端旧图**做 diff，把刚写入的 `_gen_*`
    回滚成空 → 组重跑时 `manualTrigger` 内部节点从空 `_gen_image` 水合 → 暴露 `image` 输出为空。跳过这次持久化即修复（前端随后由 `graph:applied` 回拉）。
  - `pipelineStore.ts`（`exec:completed` 订阅）：运行完成且当前停在某组内部视图时，对该组追加一次只读 `probeGroupInnerOutputs`。`refreshConnectedOutputs`
    只覆盖根图、跳过组内节点，故内部线/端口/内部 AI 节点的 `nodeOutputs[innerId]` 原先运行后不会刷新。`probeGroupInner` 只读、不落盘、不 emit 事件，
    且内部 `manualTrigger` 节点只 hydrate 不重发 → 不触发 AI API、不自循环。
  - `pipelineStore.ts`（`probeGroupInnerOutputs`）：新增按 `groupId` 的在途请求合并（`_groupProbeInFlight`），bursty 的 `exec:completed` 不会叠加重复的
    `probeGroupInner` GET。
  这三处依赖 app 侧新增的 `GET /api/v1/groups/:id/probe`（见 `apps/wb-2d-scene-asset-generator/CHANGELOG.md`）。
- **组合电池上枚举端口的下拉选择器不再与端口文字重叠；提示词电池拖入画布后宽度不再瞬间回退变窄。**
  组合电池：`estimateGroupNodeWidth`（`canvasConstants.ts`）原先只为端口标签文字 + 固定 chrome 预留宽度，未计入枚举端口右侧的内联下拉
  选择器（`PortOptionsPicker` ~14px），导致 `1fr` 标签列被压窄、`white-space:nowrap` 的标签溢出并压到下拉箭头上。现 `estimateGroupNodeWidth`
  接收 `batteries`，按渲染时的回填逻辑（`GroupNode.tsx`：端口自带 `options` 或内部电池源端口带 `options`）识别带选择器的输入端口并加上
  `GROUP_PORT_PICKER_WIDTH`(22px)；同步给 `.group-node__port-label` 加 `overflow:hidden;text-overflow:ellipsis`（`GroupNode.css`）兜底，
  文字再也不会盖到选择器上。各 group 节点构建点统一传入 `batteries`（`useCanvasGraphSync.ts` `buildCanvasNodes`、`useCanvasGroup.ts`、
  `useCanvasGroupView.ts`、`useCanvasDrop.ts`）。
  提示词电池：提示词节点持久化时挂在共享 `prompt_template` 背板 op 上，目录电池是通用的（名称短、无变量端口），其真实标题/端口在节点 params
  （`_promptName`/`_promptVars`）里由 PromptNode 渲染。`buildCanvasNodes`（`useCanvasGraphSync.ts`）原先对 `prompt` 类型也用
  `estimateBatteryNodeWidth(通用电池)` 估宽 → 落盘回流（`graph:applied → loadPipeline`）后宽度坍缩到最小值，标题溢出。新增
  `estimatePromptNodeWidth(params)`（`canvasConstants.ts`，从 `_promptName` + `_promptVars` 估宽，与拖入时 `useCanvasDrop.ts` 的估宽一致），
  `buildCanvasNodes` 对 `prompt` 节点改用它，回流后宽度与拖入时保持一致。`tsc --noEmit` 通过。

- **保存后再拖出的组合电池，端口类型不再回退、状态不再误判 `unsaved*`。** 根因：`createGroup`
  的 exposed-port 契约不带 `portType`，`applyCreateGroup` 一律用 `resolveBoundaryPort` 从内部
  电池 OpSpec 重新派生，覆盖了用户设置的边界类型。改为契约可携带 `portType` 且被尊重，缺省时
  仍回退派生：`apply-batch.ts` `ExposedPortContract.portType` + 两处 `c.portType ?? tier.portType`；
  `diff-pipeline.ts` `buildCreateGroupContract` 带上 `portType`；`import-graph.ts` 两处重建契约
  同步携带；前端 `mappers.ts` import 契约同步携带。测试：`group-ops.test.ts`「honours an explicit
  contract portType override」。

### Added
- **组合电池「壳」端口支持右击设置端口类型。** `GroupBoundaryNode.tsx`（新增 `PortTypeMenu`
  浮层 + `openTypeMenu`/`pickPortType`）：进入组内视图后右击 IN/OUT 壳上的端口，从核心+领域
  类型清单中选择类型；`updateGroupPort(..., { portType })` 写入并自动持久化到会话图，端口色随之
  更新，外层折叠面同步标记 `unsaved*`（`computeGroupContentHash` 已含 `portType`），点「保存到
  电池库」即写回组电池 JSON。为此放开 `pipelineStore.ts:399` `updateGroupPort` patch 类型以接受
  `portType`。模板组（`editable=false`）不暴露该入口。

### Changed
- **「Prompts」大标签文案改为全大写 `PROMPTS`。** `batteryGrouping.ts:60` `formatBigLabel`，
  与 `SPECIAL` / `GROUPS` / `AI` 等大标签风格统一。

### Added
- **新增透传（恒等）电池 `passthrough`。** `packages/batteries-common/batteries/common/datatree/passthrough/`
  （`index.ts:7` 直接 `return { value: input.value }`，`meta.json` 输入/输出均为 `any`+`access:tree`）。
  *为什么：* 提供占位/连线整理/保持图结构对齐用的恒等算子，整棵 DataTree 原样透传。
- **`PromptDto.iconSvg` + 提示词电池图标透传。** `ApiClient.ts:127` 给 `PromptDto` 增 `iconSvg?`，
  `transport/apiAdapter.ts` 的 `promptToBattery` 在存在时带出 `iconSvg`，使提示词电池可按「预设/用户」
  显示不同图标（图标资产与后端读取在 `wb-2d-scene-asset-generator` app 侧，见其 `CHANGELOG.md`）。*为什么：*
  让 app 决定提示词图标，内核只做透传。

### Fixed
- **dev→main 合并：搜索分支内 `batteryFilterMode === 'templates'` 死分支触发 TS2367。**
  该块已处于 `batteryFilterMode !== 'templates'` 守卫下，小标签文案直接走
  `formatSmallLabel`（`BatteryBar.tsx:1321-1324`）。
- **电池栏模板预览图被浏览器插值模糊（小尺寸像素素材放大时变糊）。** 给
  `.battery-row-thumb-img` 加 `image-rendering: pixelated`（+ `crisp-edges` 兜底），
  关闭放大插值，保持像素锐利（`BatteryBar.css`）。
- **电池栏右键菜单贴近视口下/右边缘时被裁掉。** 菜单原以 `position:fixed` 直接落在
  鼠标点击坐标（`BatteryBar.tsx` 的 `setContextMenu({x:e.clientX,y:e.clientY})`），靠近
  视口底部时会被状态栏 / 视口底边遮挡。新增 `contextMenuRef` + `useLayoutEffect` 在 paint
  前实测菜单宽高，超出右 / 下边缘（留 8px 边距）时回钳 `left/top`，必要时上翻、左移。
  *为什么：* 让右键菜单始终完整显示在视口内，不被裁切。验证：靠近电池栏底部右击电池条目，
  菜单完整可见。

### Added
- **电池栏右键菜单支持删除「用户提示词 / 用户模板」（预设只读，不可删）。** 提示词与模板均为
  双源（插件内置 + `.forgeax` 用户内容）。在 `Battery` 上新增 `builtin?` 来源标记（`types.ts`）：
  预设=`true`、用户内容=`false`、普通 op=`undefined`；`apiAdapter.ts` 的 `promptToBattery` /
  `groupTemplateToBattery` 透传该字段，`ApiClient.ts` 的 `GroupTemplateBattery` 与新增的可选
  `deleteUserTemplate(groupId)` 同步。`BatteryBar.tsx` 用 `getDeletableKind()` 仅对「`prompt:*` 且
  非内置」与「模板电池且 `builtin===false`」展示「🗑 删除」项（落点 `battery-context-menu-item--danger`
  in `BatteryBar.css`）；删除经 `uiStore` 新增的 `removePrompt` / `removeUserTemplate` 调用既有
  `deletePrompt` 与新增的 `deleteUserTemplate`，成功后 `loadBatteries()` 刷新目录。*为什么：* 用户能清理
  自己保存的提示词 / 模板，同时从来源标记上根除误删预设的可能。验证：`pnpm -r build` 全绿；
  app 后端 `group-templates.test.ts` 新增 3 项（用户模板 `builtin:false`、按 id 删除、删除缺失/预设 404）。

### Changed
- **电池栏重新「浮在画布之上」（撤回上一条的 flex 回流方案），并把组内视图导航栏右移到电池栏右侧避免遮挡。**
  上一条改回 flex 流后，收起 / 展开电池栏会让画布容器变宽、ReactFlow 内容（节点）随之在屏幕上平移——
  用户要求节点**不移动**。故恢复 `.battery-bar--vertical` 的 `position:absolute` 浮动（+ `.main-layout`
  `position:relative`）：画布恒占满整行、开闭不回流，节点位置纹丝不动。为解决浮动遮挡 breadcrumb 的老问题，
  改为：`BatteryBar.tsx` 用 `ResizeObserver` 把本栏实测宽度发布到根级 CSS 变量 `--bb-current-width`，
  `GroupBreadcrumb.css` 用 `left: calc(var(--bb-current-width) + 12px)`、`max-width` 同步扣除、`z-index:26`
  压过电池栏（25），令导航栏始终紧贴电池栏右侧、随其宽度实时跟随、不被遮挡。落点：
  `BatteryBar.tsx`（`asideRef` + 发布宽度的 `useLayoutEffect`）、`BatteryBar.css`、`EditorLayout.css`、
  `GroupBreadcrumb.css`。*为什么：* 收起 / 展开时节点不能移动（浮动方案天然满足），导航栏遮挡用宽度偏移解决。
- **电池栏撤回「浮在画布之上」，恢复为 `.main-layout` flex 流里的左列；改用回流让收起时
  工作区向左扩张。** 浮动（`position:absolute`）会盖住组内视图导航栏（breadcrumb «Root
  Pipeline › … › Back»），令其被电池栏遮挡。改回 in-flow 后导航栏始终显示在电池栏右侧、不被遮挡；
  收起右侧列表时本栏 `width:auto` 变窄，右侧工作区（`flex:1`）自然向左扩张填满，等价于
  「工作区不动、向左扩张」。撤销 `.battery-bar--vertical` 的 `position/top/left/bottom/z-index`
  与悬浮阴影（恢复 `box-shadow:none`）、撤销 `.main-layout` 的 `position:relative`
  （`BatteryBar.css`、`EditorLayout.css`）。收起 / 展开切换（rail 三角按钮 + `isCollapsed`）
  功能保留不变。*为什么：* 浮动遮挡了组内视图导航栏；用户要的「收起不左移」用 flex 回流即可达成。

### Added
- **电池栏可收起 / 展开右侧电池列表（保留左侧大标签栏），且整栏改为「浮在画布之上」
  不再挤压右侧工作区。** rail 底部收藏五角星之上新增一个小三角按钮
  （`bb-rail-button--collapse`，`CollapseRailIcon` chevron，收起=指向左、展开=指向右），
  点击只收起 / 展开右侧 `.bb-scroller`（电池列表），左侧大标签栏（rail，含分类按钮 +
  五角星 + 该三角）始终保留；收起态下点 rail 上任一大标签会自动展开并跳到该组。
  配套把 `.battery-bar--vertical` 由 flex 流改为 `position:absolute`（`.main-layout`
  设 `position:relative` 作定位基准），所以电池栏的宽度 / 开闭都不再回流右侧画布——
  画布恒定占满整行，电池栏悬浮覆盖其左侧。落点：
  `packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`
  （`isCollapsed` 会话态 + rail 三角按钮 + `.bb-scroller` 收起态条件渲染 +
  `handleRailBigLabelClick` 收起态点击大标签自动展开）、`BatteryBar.css`
  （浮动定位 / `--collapsed` / `.bb-rail-button--collapse`）、`EditorLayout.css`
  （`.main-layout` 定位基准）。*为什么：* 用户希望随手收起电池列表腾出画布空间但保留
  大标签栏入口，且电池栏本质是悬浮层，不应影响右侧工作区。`tsc --noEmit` 通过；
  sidebar/editor smoke 12/12 通过。

- **Panel right-click menu + "Save as Prompt" → draggable prompt batteries.**
  Panel nodes (`editor/components/canvas/TextPanelNode.tsx`) now open a
  right-click menu with **Save as Preset** (universal) and **Save as Prompt**
  (gated on `EditorApiAdapter.supportsPrompts`, i.e. only apps that back the
  prompt routes). Save-as-Prompt takes a name + optional 小标签/sub-tag and calls
  the new `uiStore.addPrompt`, which persists via optional
  `ApiClient.{listPrompts,createPrompt,deletePrompt}` + `PromptDto`
  (`api/ApiClient.ts`) and `EditorApiAdapter` passthroughs, then refreshes the
  catalog. Saved prompts surface under a new **"Prompts"** big tag
  (`sidebar/batteryGrouping.ts formatBigLabel`), sub-grouped by the user's tag.
  Each `[xxx]` placeholder becomes a `str` input port; the single output is
  `prompt`. New `PromptNode` renderer (`editor/components/canvas/PromptNode.tsx`,
  registered in `canvasConstants.ts`) draws ports from the node's own params
  (so reloaded nodes keep their ports) and right-clicks to a read-only detail
  panel. `Battery` gains `paletteHidden` (hides the shared backing op from the
  palette) + `dropParams` (`editor/types.ts`); `useCanvasDrop` routes a dropped
  prompt battery to the shared backing op with template/vars baked into params.
  The "Prompts" rail tag is styled like the GROUPS brand tag in cyan
  (`sidebar/BatteryBar.css .tab-prompt`) and pinned directly below GROUPS
  (`sidebar/BatteryBar.tsx` bigLabels ordering).
- **Group nodes can be saved as USER templates ("Save to templates").** New
  optional `ApiClient.saveUserTemplate({ group, smallTag, templateName })`
  (`packages/node-runtime-react/src/api/ApiClient.ts`) + `EditorApiAdapter`
  passthrough with a `supportsUserTemplates` guard
  (`editor/transport/apiAdapter.ts`). New `GroupTemplateSaveDialog`
  (`editor/components/canvas/GroupTemplateSaveDialog.tsx`, reuses
  `GroupSaveDialog.css`) takes a 小标签/small-tag + template name; the saved
  group is written to the app's `.forgeax` workspace under the fixed
  **"My templates"** big-label and surfaces in Templates mode beside the
  built-in templates (the catalog merges both sources). `GroupNode` opens it
  from the right-click menu (gated on `supportsUserTemplates`) and refreshes the
  catalog via `loadBatteries` on save. *Why:* let users persist their own
  reusable group templates as user content, separate from the shipped built-ins.
- **Group node's four header actions mirrored into its right-click menu (with
  text labels).** `GroupNode.handleContextMenu`
  (`editor/components/canvas/GroupNode.tsx`) now appends Save to library / Save
  to templates / Restore hidden ports (only when ports are hidden) / Enter group
  view / Ungroup, sharing event-less core handlers with the header buttons
  (template-class groups omit the locked actions). *Why:* the header icons were
  the only entry point; the menu makes the same actions discoverable by name.
- **Group-view editable port "shell".** The group inner view now renders the
  group's edited exposed ports as input/output **shell** boundary nodes between
  the external context nodes and the inner nodes; each external wire reaches the
  shell, which bridges on to the real inner port via a mapping segment
  (`useCanvasGroupView.ts` `buildInnerNodes`/`buildInnerEdges`,
  `BOUNDARY_MAP_PREFIX`). The shell is editable like the collapsed group face —
  rename / reorder / hide, plus **true-delete** and **+新建端口**
  (`GroupBoundaryNode.tsx`). Shell↔inner connect/disconnect re-wires the port
  mapping live (`Canvas.tsx` group-view `onConnect`/edge-removal routing).
- **Exposed-port store actions** `addGroupExposedPort` / `removeGroupExposedPort`
  / `bindGroupExposedPort` / `unbindGroupExposedPort` (`pipelineStore.ts`). They
  mutate the group's `exposedInputs/Outputs` (kernel-persisted overlay) and drop
  orphaned external edges; the outer instance auto-derives `unsaved*` via the
  content hash. Tests: `pipelineStore.test.ts` (group-view shell editing),
  `groupsystem.smoke.test.tsx` (shells filtered from inner subgraph asserts).

### Fixed
- **Group-view shell `+新建端口` (and true-delete / rebind) now persist instead
  of flashing and vanishing.** The persist diff for an existing group only ever
  emitted an overlay patch, and `applyUpdateGroup` ignored unknown portNames
  ("port set owned by createGroup/ungroup"), so a shell-added port lived only in
  the editor until the next WS/reconcile re-pull wiped it. `updateGroup` gains an
  `exposedWiring` payload that REPLACES `exposed{Inputs,Outputs}` wholesale
  (wiring authority + overlay inline), mirroring how `nodes`/`edges` replace the
  inner sub-graph; `diff-pipeline` emits it only when the port set/wiring
  actually changed (overlay-only edits stay on the light patch)
  (`apply-batch.ts` `applyUpdateGroup`/`isLayoutOnlyBatch`, `diff-pipeline.ts`
  `diffExposedPortWiring`; test `group-ops.test.ts`).
- **Group-view port shell UX polish.** Forced `pointer-events` back on the
  non-selectable/non-draggable shell so `+`/delete/hide buttons and
  drag-to-reorder fire again (ReactFlow had set `pointer-events:none`); unified
  shell typography with normal batteries; removed the redundant left port dot;
  auto-sized shell width (`GroupBoundaryNode.{tsx,css}`).
- **Nested group exposed ports show the real inner port name again (not raw
  `in_1`/`out_0`).** `getGroupPortDisplayLabel` now descends into a nested child
  group when a parent exposed port's `sourceNodeId` is the child group's shadow
  node (id === child group id), resolving the child's readable label
  (`editor/components/canvas/groupViewUtils.ts` `resolveNestedSourceLabel`).
  *Why:* the human `portLabel` is presentation-only and dropped on persistence,
  so after a reload a parent port's `sourcePortName` is the child's opaque stable
  id; the previous fallback then displayed that raw id. Test:
  `nestedGroupPortLabel.test.ts`.
- **Save-to-library no longer overwrites a same-named group battery.** The save
  dialog's first-save path now dedupes the battery name against existing group
  batteries in the chosen category, appending ` (n)` on collision
  (`editor/components/canvas/GroupSaveDialog.tsx` `dedupeBatteryName` +
  `handleSave`). *Why:* keeping the default `Group Node` name when the category
  already had one silently overwrote the older battery. In-place overwrite of an
  already-sourced group (via `GroupNode`) is unaffected.
- **Vite dev alias for `@forgeax/node-runtime/derive-group-ports`.** All three app
  `frontend/vite.config.ts` now map the subpath to kernel source (same pattern as
  `diff-pipeline`) so `useCanvasGroup` resolves after merge without a full dist build.
- **execute-node group branch tolerates missing `node.params`.** `execute-node.ts:189` uses
  `node.params?.groupId` so group shadow nodes without a params bag no longer throw during walk.
- **applyBatch save concurrent-write throws are caught as rejected status.** `apply-batch.ts`
  try/catch around `GraphStore.save` converts disk-level concurrent-write into
  `{ status: 'rejected' }` instead of bubbling as HTTP 500.

### Changed
- **Project lock denial carries machine-readable `code`.** `project-registry.ts`
  `checkMutationAccess` returns `mutation-denied-not-open` (recoverable after backend restart)
  vs `mutation-denied-locked-by-other` (genuine conflict). Test:
  `project-registry.test.ts`.

### Fixed
- **Browser bundle no longer pulls Node-only kernel via diffPipelineToOps.**
  `mappers.ts` imports `@forgeax/node-runtime/diff-pipeline`; `GROUP_OP_ID` moved
  to browser-safe `group-constants.ts`; Vite aliases added for dev. Fixes
  `node:fs` externalized errors after Module E.
- **Vite suppresses expected dynamic battery import warning.**
  `battery-loader.ts` uses `/* @vite-ignore */` on runtime `import(pathToFileURL…)`.

### Added
- **CLI `--server-url` / `FORGEAX_SERVER_URL` routes mutations through the running
  backend.** `node-runtime-cli/src/http-client.ts` POSTs to `/api/v1/batch` and
  `/api/v1/execute`; `--offline` forces in-process kernel writes. Live editor WS
  clients receive `graph:applied` when CLI mutates via HTTP
  (`http-client.test.ts`, `pipeline-commands.test.ts`).
- **Kernel watches graph.json for external writes and emits `graph:applied`.**
  `graph-external-sync.ts` suppresses self-write echo from `applyBatch` via
  `markGraphSelfWrite`; direct CLI/disk edits refresh live WS clients
  (`graph-external-sync.test.ts`).
- **Monorepo hygiene now rejects ELF core dumps in the working tree.** Root
  `scripts/hygiene-check.mjs` scans for `core.<pid>` files (excluding
  `node_modules`) in addition to the existing forbidden-term grep; all three
  apps delegate `pnpm hygiene` to this script. *Why:* a multi-GB crash dump had
  been sitting under `apps/wb-scene-generator/frontend/` despite `.gitignore`.

### Removed
- **Unused backend `ops/index.ts` placeholders (3 apps).** Batteries register via
  file scan; nothing imported `OPS = []`.
- **Redundant `.gitkeep` files** in populated battery/test directories.
- **Unused `@forgeax/i18n` frontend workspace deps** (zero runtime imports; package
  retained for future wiring).
- **Dropped unused `@deprecated Battery*` type aliases from the kernel public
  surface.** The nine backwards-compat aliases at the foot of
  `packages/node-runtime/src/layer1/types/op-spec.ts` had zero importers
  anywhere in the monorepo (editor `Battery` lives in `node-runtime-react`).
  *Why:* dead public API surface; callers already use `Op*` names.

### Changed
- **Pipeline diff→ops logic moved into the kernel (`layer2/diff-pipeline.ts`).**
  Group/ungroup/boundary algebra is now single-sourced in `@forgeax/node-runtime`;
  `node-runtime-react/mappers.ts` maps UI `Pipeline` → `DesiredPipelineInput` and
  delegates. All 34 transport regression tests pass unchanged.
- **Ephemeral applyBatch uses a faster clone/save path without changing SSOT
  semantics.** `apply-batch.ts` clones via `structuredClone` (JSON fallback);
  ephemeral batches write compact (non-pretty) `graph.json` via
  `graph-store.ts` `{ compact: true }`. History skip + `graph:applied` behavior
  unchanged (`apply-batch-ephemeral.test.ts`).

### Fixed
- **Battery hot-reload now picks up `index.ts` execute edits without touching
  `meta.json`.** `battery-loader.ts` tracks `index.ts`/`index.js` mtime alongside
  `meta.json`, and re-import uses `?t=<mtime>` cache-busting when the entry file
  changed. Regression: `battery-loader.test.ts`.
- **wb-scene-generator HttpApiClient reconnects WebSocket after drop.** Matches
  3d/2d backoff (500ms→5s cap) so renderer/assetstore live-sync survives backend
  restarts without a full page reload.
  `apps/wb-scene-generator/frontend/src/api/HttpApiClient.ts`.

### Fixed
- **电池栏底部「收藏星标 / 预设书签」图标在 rail 收起↔展开时不再左右跳动。** 原
  `.bb-rail-button--icon` 收起态为 `justify-content:center; padding-left:0`（图标在
  26px 按钮内居中），展开态切到 `flex-start; padding-left:5px`，导致切换瞬间图标水平
  平移（develop 与 templates 模式均如此）。现两态统一为 `flex-start; padding-left:5px`
  （与文字 rail 按钮一致），图标水平位置恒定。落点：
  `packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.css`
  （`.bb-rail-button--icon`）。*为什么：* 收起/展开本质只是 rail 变宽，图标自身不应位移。
- **AI image-gen now actually sends *every* reference image when its `image`
  input is a multi-branch DataTree (e.g. two ImageSources merged via
  `tree_merge`) — previously the model received zero reference images, so the
  result ignored both refs.** `imageRefsFromValue`
  (`packages/node-runtime-react/src/editor/components/canvas/AINode.tsx`, the
  Run-button path) only ran `peelWireValue`, which collapses *single*-entry/
  single-item wire trees; a 2-image merge serialises as a 2-branch
  `DataTreeEntry[]` (`[{path:[0],items:[ref]},{path:[1],items:[ref]}]`), which
  peel leaves untouched, after which the entries (objects, not strings) all
  mapped to `''` and were filtered out → empty `images[]`. It now detects the
  wire shape (`isDataTreeEntries`, re-exported from `editor/utils/datatreeShape`)
  and flattens every branch's `items` into the ref list, so single- and
  multi-image inputs both forward correctly. `tsc --noEmit` passes. *Why:*
  "image" is a `tree`-access input on `image_gen`; merging multiple sources is
  the intended multi-reference workflow and must reach the gateway intact.

### Changed
- **BatteryBar 大标签 rail 悬浮展开改为「覆盖」右侧电池栏，而非挤压它。** 原先
  `.bb-big-rail` 是 `.bb-body` flex 流中的项，展开时 `flex-basis/width` 32→98px
  会压缩同级 `.bb-scroller`，导致右侧电池/模板内容回流变形。现：`.bb-body`
  设 `position:relative`，`.bb-big-rail--expanded` 改为 `position:absolute`
  （`top/left/bottom:0`、`z-index:30`、不透明深色底 + 投影）叠放在右侧之上；
  并在展开时渲染一个 `.bb-big-rail-spacer`（32px）占住原槽位，使 `.bb-scroller`
  宽度恒定、不回流。鼠标移开恢复原样。落点：
  `packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`
  （展开态条件渲染 spacer + nav）、`BatteryBar.css`（`.bb-body`/`.bb-big-rail`
  /`--expanded`/`.bb-big-rail-spacer`）。*为什么：* 三个 generator 共用此 rail，
  统一为「窄栏临时覆盖、不改右侧内容布局」的悬浮行为。Templates 模式展开态额外
  补不透明琥珀底（`.mode-templates .bb-big-rail--expanded`），否则模式色调的半透明
  背景会让右侧模板内容透出（行为/样式与 develop 一致，仅配色区分）。`tsc` 通过。

### Fixed
- **Template preview no longer shrinks when its right-click menu opens.** The
  enlarged thumbnail state was hover-only (`.battery-row--template:hover
  .battery-row-thumb` → `scale(1.08)` + amber border), so opening the context
  menu (pointer leaves the row) snapped the preview back to its resting size.
  `BatteryRow` now takes an `isContextActive` prop (true when `contextMenu`
  targets that battery) that adds `.battery-row--context-active`, and the CSS
  rule was widened to keep the enlarged state for both hover and context-active
  (`packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`,
  `BatteryBar.css`). *Why:* the preview should stay zoomed while the user reads
  the menu, not flicker smaller.
- **Templates mode now shows the Favorites rail button — favourited templates
  were unreachable.** `rawBigLabels` (`packages/node-runtime-react/src/editor/
  components/sidebar/BatteryBar.tsx`) returned the templates branch *early* with
  only the template category tags, omitting the pinned `__favorites__` synthetic
  big-label that the Develop branch adds — so in Templates mode the bottom-left
  rail had no ⭐ button and there was no surface to view favourited templates.
  The templates branch now prepends `FAVORITES_BIG` (presets stay Develop-only —
  they are text presets, unrelated to templates), so `collectionLabels` is
  non-empty and the Favorites button + its template-format section render in
  Templates mode. *Why:* without the rail entry the per-mode favourites split
  (previous fix) had no Templates-side surface at all.
- **Favourites are now split by catalog mode — template favourites no longer
  leak into Develop's favourites (and vice versa).** `getBatteriesForBig(
  __favorites__)` (`packages/node-runtime-react/src/editor/components/sidebar/
  BatteryBar.tsx`) resurrects favourites not in the current `visibleBatteries`
  via `parseFavoriteBatteryJson(f.batteryJson)`, but `visibleBatteries` is
  mode-filtered (Develop excludes templates; Templates is templates-only) — so a
  favourited **template** still surfaced under **Develop**'s Favorites section
  (and a favourited normal battery under Templates). Added a
  `(batteryFilterMode === 'templates') === isTemplateBattery(b)` filter so each
  mode's Favorites only lists items of that kind; template favourites render in
  the Templates Favorites section in the same large-preview format as templates
  (`renderBatteryRow` already passes `templateMode` by mode). *Why:* favourited
  templates belong under the Templates favourites rail, not mixed into the
  battery (Develop) favourites.

### Added
- **Favorited batteries/templates now show a yellow star marker in the catalog.**
  `BatteryRow` (`packages/node-runtime-react/src/editor/components/sidebar/
  BatteryBar.tsx`) gained an `isFavorite` prop: a solid amber five-point star
  (`FavoriteStarIcon`) renders inline to the **right of the battery name**
  (non-right-aligned — name shrinks to content, star sits next to it, dev-note
  meta pushed to the row end via `margin-right:auto`) for list rows, and pinned
  to the **top-right of the template preview thumbnail** in Templates mode
  (`.battery-row-fav-star` / `--thumb` in `BatteryBar.css`; `.battery-row-thumb`
  made `position:relative`, `.battery-row-name` `flex:1 → 0 1 auto`).
  `favoriteIds` (a `Set` derived from `favoriteBatteries`) drives the flag.
  The marker is suppressed **inside the Favorites view itself** (the
  `__favorites__` big-label section + its `+`-expand overlay pass
  `inFavoritesView`), since the context already implies "favorited". *Why:* a
  glanceable, theme-consistent cue that a battery/template is already saved.

### Changed
- **Favourites is the single shared surface for batteries *and* templates — no
  architectural move needed.** The favourites feature already lives entirely in
  the kernel (`node-runtime-react`, domain-agnostic `favoriteBatteries` store +
  pinned `__favorites__` rail) and the Templates mode reuses the same vertical
  accordion, so favourited templates already appear under the same Favorites
  rail (filtered from `visibleBatteries`, which is templates-only in Templates
  mode). Confirmed correctly placed in `packages/*`; left as-is.

### Removed
- **Battery right-click menu's "★ Add Star" / "☆ Remove Star" items removed.**
  Dropped both `battery-context-menu-item` entries and their now-unused handlers
  (`handleContextMenuAddStar` / `handleContextMenuRemoveStar`) + the
  `adjustBatteryStars` selector from `BatteryBar.tsx`. The menu now offers only
  Add/Remove from Favorites + Dev Notes. (The separate dev star-*count* badge —
  `batteryStars` — is untouched.) *Why:* the star-count action is obsolete;
  favourites is the canonical "save" gesture.
- **Templates 模式预览图加可见边框 + 悬浮放大。**
  `editor/components/sidebar/BatteryBar.css` 的 `.battery-row-thumb` 边框由
  `1px rgba(251,191,36,0.18)` 加粗为 `1.5px rgba(251,191,36,0.45)` 并加暗描边
  `box-shadow`；新增 `.battery-row--template:hover .battery-row-thumb`：边框转亮金
  `0.85` + 金色外发光，并对**整个预览框**（连边框带图）`transform: scale(1.08)`
  放大（`transform-origin:center`、`200ms` 过渡）。*为什么：* 用户要求模板预览图有
  边框、悬浮时有放大反馈，且放大对象是边框整框而非图片在框内裁切放大；纯样式、跨 app 一致。
- **History panel now always shows English labels.** Both history views
  (`editor/components/sidebar/LeftSidebar.tsx`,
  `editor/components/toolbar/EditorSettingsPanels.tsx`) switched from
  `en ? (labelEn ?? label) : label` to `labelEn ?? label`, and AI/CLI
  committed batches now derive an English `labelEn` via new
  `batchSummaryEn(entry)` (`editor/stores/historyLabels.ts`) instead of
  copying a possibly-Chinese `entry.label` (updated in
  `historyEntryV1ToView` and `editor/stores/pipelineHistoryBridge.ts`).
  Covered by `editor/__tests__/historyStoreHydrate.test.ts`.

### Added
- **Exposed-port presentation overlay is now a first-class persistent kernel
  field — hide / reorder / rename of group ports lives in the live graph (and
  group-template JSON), readable/writable by the editor, AI and CLI.** The
  kernel `ExposedPort` (`packages/node-runtime/src/layer1/types/graph.ts:88`)
  gained four optional fields `hidden?` / `order?` / `customLabel?` /
  `customLabelEn?` — all optional so pre-existing `graph.json` / template JSON
  remain valid (absent reads as visible / source-order / built-in label). They
  describe *presentation* only and never affect the wiring authority
  (`portType` / `access` / `sourceNodeId` / `sourcePortName`), which stays owned
  by `createGroup` derivation. The `updateGroup` op
  (`packages/node-runtime/src/layer2/apply-batch.ts:75`) gained an optional
  `exposedPorts: { inputs?, outputs? }` patch of `ExposedPortPatch` records;
  `applyUpdateGroup` (`apply-batch.ts:489`) applies them in place by `portName`
  (incremental — unspecified fields preserved, unknown portNames ignored, wiring
  untouched). Because the patch changes what the renderer shows, a batch
  carrying `exposedPorts` is excluded from the layout-only fast-path so it still
  emits `graph:applied` (`apply-batch.ts:158`). Frontend: `updateGroupPort` /
  `moveGroupPort` (`editor/stores/pipelineStore.ts:597,632`) → debounced
  `persistSession` → `updatePipeline` now fetches the live group set and
  `diffPipelineToOps` (`editor/transport/mappers.ts`) diffs the overlay against
  it, emitting a minimal `updateGroup(exposedPorts)` op only when something
  changed (no-op otherwise). `kernel↔editor` group mappers
  (`mappers.ts:128,158`) round-trip the fields. Tests: kernel
  `group-ops.test.ts` (+2 cases: patch hidden/order/label persists + re-read;
  incremental preserve / unknown-port ignore) and react `transport.test.ts`
  (+3: emit on change, skip when unchanged, `updatePipeline→getGroup`
  round-trip). This makes the kernel live graph + template JSON the single
  source of truth for exposure/hide/order/label; the Plan-B
  `mergeExposedPortOverlay` carry-forward (`pipelineStore.helpers.ts`) still
  bridges the transient window before the kernel writes back, and is compatible
  because it is "incoming kernel value wins".
- **Pluggable text-preset transport on `ApiClient` — saved Panel texts can be
  backed by a server store instead of localStorage.** New `TextPresetDto` plus
  three optional methods on `ApiClient`
  (`packages/node-runtime-react/src/api/ApiClient.ts`):
  `listTextPresets` / `createTextPreset` / `deleteTextPreset`, surfaced through
  `EditorApiAdapter` (`editor/transport/apiAdapter.ts`,
  `supportsTextPresets` guard) so the editor can persist presets over any
  transport. `uiStore` (`editor/stores/uiStore.ts`) now reads/writes presets via
  the adapter when available and **falls back to the previous localStorage
  behaviour** when the client omits these methods (additive, non-breaking for
  other apps). `Editor.tsx` calls `loadTextPresets()` at boot.
- **`__presets__` synthetic big-tag rail in the BatteryBar.** New pinned rail
  entry (after `__favorites__`) rendering a `PresetsRailPanel` of saved presets
  that drag onto the canvas as a pre-filled `text_panel` (reusing the
  `application/battery` + `application/preset-text` payload). Label/icon mappings
  added in `editor/components/sidebar/batteryGrouping.ts`; panel + rail wiring in
  `editor/components/sidebar/BatteryBar.tsx`. The old left-sidebar
  `TextPresetsPanel` (`LeftSidebar.tsx`) is removed.

### Fixed
- **Dragging a number slider that drives a `createGrid` (or any battery) no longer
  lags the grid preview.** Real-runtime profiling against the running app
  (`apps/wb-scene-generator`, backend :9557) corrected the earlier root-cause
  guess: the backend `createGrid`/`rect_grid` execute is ~**0.7–2 ms** even at a
  200-wide grid and its output JSON is only a few KB, so neither kernel compute
  nor data transfer was the bottleneck. The dominant cost was the **frontend
  preview-repaint fan-out**, and the two earlier mitigations (below) were
  necessary but *not sufficient* on their own.
  (0) **PRIMARY — preview repaint churned on every connected port, changed or
  not.** After each `exec:completed`, `refreshConnectedOutputs`
  (`packages/node-runtime-react/src/editor/stores/pipelineStore.ts`) re-`GET`s
  **every** connected/visible output port (82 ports in the user's real graph,
  ~30 ms/pass), and `setNodeOutput` replaced the **whole** shared `nodeOutputs`
  object reference on *every* write — even when the value was identical. Every
  preview that subscribes to that map (`GridPanelNode` read the entire map and
  re-ran `extractGrids` + the `drawGrid` `useEffect` each render) therefore
  repainted its canvas once **per port per tick** (≈3× per drag tick for a
  2-slider + grid graph, more on larger graphs), including for the unchanged
  slider-value ports. Fix: (a) `setNodeOutput` now **skips the state write when
  the value is unchanged** (`Object.is` for primitives, a cheap JSON structural
  compare for grid arrays — `pipelineStore.ts` `outputValuesEqual` + `setNodeOutput`),
  so unchanged/unrelated port refreshes no longer churn the reference; (b)
  `GridPanelNode` now subscribes **only to its own** `nodeOutputs[id]` slice and
  memoizes `extractGrids` on the raw value reference, so it re-renders + redraws
  **only when its grid actually changes** — exactly once per genuinely-changed
  tick (`editor/components/canvas/GridPanelNode.tsx`; test:
  `editor/__tests__/gridPanelPreview.test.tsx` proves 10 drag ticks → 10 repaints,
  not 30, and that an unrelated/unchanged port refresh costs 0 re-renders).
  (1) **Self-echo full reload (kept).** Every non-silent `updateNodeParam`
  (`pipelineStore.ts:729`) persists
  through `incrementalExecute` → `updatePipeline` → `applyBatch`, which announces
  `graph:applied`; the live-sync handler then ran a *full* `loadPipeline()`
  snapshot refetch (rebuilding every node) **plus** `refreshConnectedOutputs()` on
  every committed batch — even for the editor's own write whose result it already
  held locally. During a drag (≈10 commits/s under the 100 ms exec throttle) this
  rebuilt the whole ReactFlow tree ~10×/s. Fix: tag each local param-edit persist
  with a client-generated `batchId`, recorded synchronously *before* the write, and
  have the `graph:applied` handler skip the reload + duplicate output refresh for
  those ids (`pipelineStore.ts` local-param-edit batch ring + tag + suppression). The
  grid preview still updates live because the trailing `exec:completed` refreshes
  the connected outputs once the new values are computed. A remote actor's batch is
  unaffected and still drives a full reload (test:
  `editor/__tests__/pipelineStore.test.ts` "local param edit does NOT trigger a
  full loadPipeline reload"). Threaded an optional `batchId` through
  `EditorApiAdapter.updatePipeline` / `applyOps`
  (`editor/transport/apiAdapter.ts:185,197`, additive; kernel
  `ApplyBatchOptions.batchId` already existed at
  `packages/node-runtime/src/layer2/apply-batch.ts`).
  (2) **Per-pointermove store write (kept).** The slider wrote the store on *every*
  pointermove (~60/s), each rebuilding `currentPipeline` and queuing an exec.
  `NumberSliderNode` now updates the **local** value every frame (smooth, zero
  kernel churn) but throttles the store write (leading + trailing, 80 ms) and
  always flushes the **final released value once on pointerup**, so the persisted
  kernel SSOT lands exactly on the value the user released at
  (`editor/components/canvas/NumberSliderNode.tsx:74` drag handler; test:
  `editor/__tests__/numberSliderDrag.test.tsx`).
- **Dropping a saved group template onto the canvas no longer returns a bare 500
  on its first execute (and the custom group name no longer appears to "revert").**
  Root cause was a drop-then-execute *race*, not the exposed-port overlay:
  `useCanvasDrop.placeBattery`
  (`packages/node-runtime-react/src/editor/components/canvas/useCanvasDrop.ts:114`)
  fired `persistSession()` (which commits the `createGroup` op that materialises
  the group's shadow node in the kernel) and `incrementalExecute(rootId, …,
  { persist:false })` in the *same tick*; because `persist:false` skips the
  persist queue, the execute reached the backend with the group node id **before**
  the createGroup batch had committed. The kernel had no such node, so
  `buildExecutionClosure` (`packages/node-runtime/src/layer2/resolve-inputs.ts:80`)
  threw `executeNode: target node not found: …`, which — with the app's Fastify
  `logger:false` (`apps/wb-scene-generator/backend/src/main.ts:19`) and no error
  handler — surfaced as an opaque 500 (`backend/src/routes/execute.ts:13` returns
  `handle.done` directly, so a rejected promise = 500). The custom name "reverted"
  was the same root cause: the broken drop chain left the canvas in the pre-commit
  state. A clean `createGroup` (even one seeded with `hidden:true` ports) executes
  fine and round-trips the name — confirmed by repro — so the earlier
  front-end-only hidden-edge filter (#008 fix) was *not* the culprit and the
  kernel graph holds no dangling redir edge on the drop path (redir edges are a
  canvas-only concept built in `useCanvasGroup.ts`, never persisted). Fix lands in
  two layers:
  - **Kernel (the bare-500 source seam):** `executeNode`
    (`packages/node-runtime/src/layer2/execute-node.ts:227`) no longer *throws* for
    a missing graph / unknown / cyclic target. The execution model already
    represents failures as `ExecutionResult { status:'error' }` (every per-node
    failure in `runWalk` does), so a request that can't even build a closure now
    resolves the SAME way (mints an `executionId`, emits `exec:started` +
    `exec:error`, resolves `handle.done` with `status:'error'` and a structured
    `error.message`). This eliminates the bare 500 at the seam for *every* host of
    the kernel, not just this app — the robust 兜底.
  - **Frontend (the real correctness fix):** the drop path now chains the execute
    off the persist promise — `persistSession().then(() =>
    incrementalExecute(rootId, false, { persist:false }))` (`useCanvasDrop.ts:114`)
    — so the createGroup commit always lands before the group node is executed, and
    the run returns `completed` with the group's outputs.
  Tests: `packages/node-runtime/src/__tests__/execute-node.test.ts` (unknown /
  cyclic target now assert a structured error result + `exec:error` event instead
  of a reject); `apps/wb-scene-generator/backend/tests/bridge.test.ts` (execute of
  an unknown nodeId returns 200 + `status:'error'`, not 500).
- **Dragging any node no longer spams ReactFlow error #008 ("Couldn't create
  edge for target handle id …") for a group's redirected (`*_redir`) edges that
  point at a hidden exposed-port handle.** Root cause: a `__group__` node only
  renders Handles for its NON-hidden exposed ports (`GroupNode` →
  `getVisibleGroupPorts`, `editor/components/canvas/GroupNode.tsx:125,136`), but
  the kernel graph keeps the wiring — a redirected edge created at group time
  still targets the exposed port's handle (`useCanvasGroup.ts:350` sets the redir
  target to `exposed.portName`, e.g. `in__pyq3__value`). Once that port is hidden
  (via the client overlay / a dropped saved-group template that carries
  `hidden:true` — neither path enforces the UI's disconnect-first guard in
  `pipelineStore.ts:602`), `buildCanvasEdges`
  (`editor/components/canvas/useCanvasGraphSync.ts:267`) kept emitting the wire to
  the now-unrendered handle, so ReactFlow logged #008 on every render — and
  **re-logged it on every committed batch's rebuild, including the persist
  round-trip of an unrelated node drag** (`updateNode`→`persistSession`→
  `graph:applied`→`loadPipeline`→`pipelineRevision++`→rebuild). The handle id vs.
  edge-target naming was never mismatched (both are the exposed `portName`); the
  bug was purely the unfiltered wire to a hidden handle. Fix: `buildCanvasEdges`
  now builds a hidden-handle key set from each `__group__` node's group
  (`exposedInputs`/`exposedOutputs` with `hidden`) and drops any edge whose
  source/target endpoint references one (`useCanvasGraphSync.ts:271-296`). The
  wiring stays in the kernel graph (restoring the port repaints the wire); we
  just never paint to a handle that is intentionally not rendered. Because the
  dangling edge is now never emitted, the existing `reconcileCanvasEdges`
  identity-preserving rebuild keeps the edge array stable across a pure-move
  re-pull, so no edge churn / re-render and no #008 re-log on drag. Tests:
  `editor/__tests__/canvasGraphSync.hiddenPortEdges.test.ts` (+3: hidden-handle
  edge dropped while visible kept; pure-move rebuild keeps edge-array identity &
  stays #008-free; restoring a port repaints the wire).
- **Dragging a saved group template back onto the canvas now keeps the user's
  hidden/reordered/renamed exposed ports and the custom group name, instead of
  reverting to the from-scratch derivation ("hidden slots reappear" + "name
  resets to Group Node").** Root cause: re-instantiation routes through
  `diffPipelineToOps` → `createGroup` (`editor/transport/mappers.ts:452`), and
  `applyCreateGroup` (`packages/node-runtime/src/layer2/apply-batch.ts:350`)
  *re-derives* the exposed-port set from the live topology — dropping the
  template's presentation overlay (`hidden`/`order`/`customLabel*`) entirely.
  The Plan-B `mergeExposedPortOverlay` carry-forward could not rescue it either,
  because `remapGroupIds` rewrites each port's `sourceNodeId` to a fresh id but
  leaves the `portName` referencing the *pre-remap* id, so the overlay key no
  longer matched the kernel's derived `in|out:<sourceNodeId>:<sourcePortName>`.
  Fix: the `createGroup` op (`apply-batch.ts:75`) gained an optional
  `exposedPorts: { inputs?, outputs? }` seed (same `ExposedPortPatch` shape as
  `updateGroup`); `applyCreateGroup` (`apply-batch.ts:506`) layers it onto the
  freshly-derived ports by `portName` after derivation via
  `patchExposedPortOverlay` (wiring authority `portType`/`access`/`source*` stays
  derived; unknown portNames ignored). The frontend builds + **re-keys** that
  seed at emit time from the template's `source*` via `buildCreateGroupOverlay` /
  `derivedExposedPortName` (`mappers.ts:236,247`), so it lands on the post-remap
  derived names. The custom name already flowed as `createGroup.name`
  (`mappers.ts:342` `node.name || group.name` → `apply-batch.ts:494`); the
  round-trip test now pins it. Tests: kernel `group-ops.test.ts` (+2:
  `createGroup` seeds overlay incl. name; unknown overlay portName is a no-op)
  and react `transport.test.ts` (+1: drop round-trip re-keys overlay and
  preserves `hidden`/`customLabel`/`order` + custom name through
  `diffPipelineToOps` → mock kernel → `getGroup`).
- **A renamed group (e.g. saving it as a template named `ttt`) no longer
  reverts to "Group Node" when dragged back onto the canvas.** Correction to the
  entry above: that fix pinned the custom name only through the
  *manually-constructed* `diffPipelineToOps` → `createGroup` test, which did not
  exercise the real save/rename path, so it passed while the live editor still
  showed "Group Node". Real root cause: `GroupSaveDialog`
  (`editor/components/canvas/GroupSaveDialog.tsx:59`) renames via
  `renameGroup(groupId, name)`, which updated **only** `currentPipeline.groups[].name`
  and left the `__group__` shadow node's mirror `name` stale (its default, e.g.
  "Group Node"). The persist diff then took `name: node.name || group.name`
  (`editor/transport/mappers.ts:342`), so the **stale shadow name masked the
  renamed group name**: for an existing group `nameChanged` was false and no
  `updateGroup(name)` op was emitted, leaving the *live kernel* group named
  "Group Node". A later drag-out resolves `loadGroup` → `getGroup` (live graph,
  preferred over the template file in `apiAdapter.ts:312`), so the canvas showed
  the live group's stale name even though the template JSON on disk correctly
  held `ttt`. Fix (frontend only): (1) make the **NodeGroup the name SSOT** in the
  diff — `name: group.name || node.name` (`mappers.ts:342`); (2) `renameGroup`
  (`editor/stores/pipelineStore.ts:565`) now updates the shadow node's mirror
  `name` alongside `group.name` so display, persist, undo/redo and drag-out all
  agree. No kernel/contract change. Tests: react `transport.test.ts` (+1:
  renamed group with a stale shadow name now emits `updateGroup({name})` and the
  live group reads back the custom name through the mock kernel) and
  `pipelineStore.test.ts` (+1: `renameGroup` syncs both the group name and the
  shadow node mirror).

### Changed
- **BatteryBar rail 的「收藏 / 预设」图标由 emoji 改为 lucide-free 描边 SVG
  pictogram，与编辑器图标风格统一。** 原先两个合成大标签
  （`__favorites__` / `__presets__`）在 rail 上用彩色 emoji `⭐` / `🔖` 当图标
  （`batteryGrouping.ts` `formatBigLabelRailText` 返回 emoji），与其余文字标签
  风格割裂、且违反「产品控件不混用彩色 emoji」的图标规范。现：
  (1) `BatteryBar.tsx` 新增 `FavoritesRailIcon`（星形轮廓）/ `PresetsRailIcon`
  （书签轮廓）两个 `currentColor` 描边 SVG 组件，`renderRailButton` 对收藏 / 预设
  渲染 `.bb-rail-icon` shell 中的 SVG（加 `bb-rail-button--icon` 修饰类），其余
  标签仍走原 `.bb-rail-button-short` 文本槽；(2) `batteryGrouping.ts`
  `formatBigLabelRailText` 对收藏 / 预设改返回空字符串，emoji 文本分支不再参与
  渲染；(3) `BatteryBar.css` 新增 `.bb-rail-icon`（18px 盒 / 15px svg /
  `currentColor` 继承按钮语义色）与 `.bb-rail-button--icon`（收起态居中、展开态
  左对齐）。图标配色继续由既有 `.bb-rail-button--favorites`（琥珀）/
  `--presets`（蓝）color 驱动，hover / active / drag 状态完全沿用原按钮样式。
  落点：`packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`、
  `BatteryBar.css`、`batteryGrouping.ts`。*为什么：* 统一 rail 图标语言，去除与
  dark-green/lime 主题割裂的彩色 emoji（图标风格规范）。`tsc --noEmit` 通过。
  按钮分组钉到底部对齐。** 原先收藏（`__favorites__`）/ 预设（`__presets__`）
  与普通电池大标签同列于一个 `.bb-scroller` 中、可相互连续滚动；现按需求拆为：
  (1) rail 按视图分两组渲染——`.bb-rail-group--batteries`（电池大标签，占满剩余
  空间）在上，`.bb-rail-group--collection`（收藏 + 预设）`margin-top:auto` 钉到
  底部并以分隔线区隔；(2) 右侧滚动容器按 `railView`（`'batteries' | 'collection'`，
  由 `focusedBigLabel` 落在哪组派生）只渲染对应视图的 section，两视图各自独立连续
  滚动、互不滚过；(3) 滚动位置持久化 key 拼入 `railView` 维度，切换视图各自恢复。
  落点：`packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`
  （新增 `isCollectionLabel` / `railView` / `collectionLabels` / `batteryLabels` /
  `activeViewLabels`，抽出 `renderRailButton` / `renderBigSection` 复用，`scrollKey`
  并入视图维度，`handleRailBigLabelClick` 滚动改双 rAF 以容忍换视图重挂载）、
  `BatteryBar.css`（新增 `.bb-rail-group` / `--batteries` / `--collection` 布局，
  `.bb-scroller--batteries` / `--collection` 视图标记）。*为什么：* 收藏 / 预设属
  「集合」语义，应与电池目录在布局与滚动上彻底分离，避免一栏内两类内容相互滚过。
- **Panel 节点「保存为预设」对话框改为居中模糊弹窗，并对齐主题。** 原对话框
  `position:absolute` 锚在节点标题栏右下，被节点容器的 `overflow:hidden`
  裁剪（且配色为蓝色，不符当前主题）。现改用 `createPortal(..., document.body)`
  渲染为**全屏 overlay + `backdrop-filter: blur` + 居中 modal**，交互范式与
  成组电池保存弹窗（`GroupSaveDialog`）一致；样式新建 `.tp-save-*` 类、采用
  Panel 节点的绿色主题（`--node-color #7cc47c` / rgb 124,196,124），含 header/
  关闭按钮/footer 取消·保存按钮、输入框 focus 高亮、点击遮罩关闭、Esc/Enter
  键盘操作。落点：`packages/node-runtime-react/src/editor/components/canvas/
  TextPanelNode.tsx`（`createPortal` 导入 + 弹窗移出 header）、`TextPanelNode.css`
  （删除 `.text-panel-save-dialog*`，新增 `.tp-save-*`）。*为什么：* 弹窗被节点裁剪
  无法完整显示且蓝色配色割裂，参照组合电池保存的居中模糊范式统一交互与配色。
  (`packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`)
  now tags built-in (`preset.builtin`) entries with
  `bb-preset-item--builtin` and renders an inline "内置 / Built-in" badge next
  to the title. CSS
  (`packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.css`,
  `.bb-preset-item--builtin` / `.bb-preset-badge`) gives built-ins an amber
  left bar + tint so they read apart from user-saved presets, and
  `.bb-preset-text` switches from `-webkit-line-clamp: 3` to a single-line
  `white-space: nowrap` ellipsis so every entry shows at most one detail line.
- **`TextPreset` shape gains `title` + `builtin`.**
  (`editor/stores/uiStore.ts`) — legacy localStorage entries are backfilled on
  read; `addTextPreset(text, title?)` and `removeTextPreset` respect the
  read-only `builtin` flag. The `text_panel` save button
  (`editor/components/canvas/TextPanelNode.tsx`) now opens a title-input popover
  before saving.
- **Manual-trigger ops are skipped by the incremental-execute walk and instead
  hydrate from the persisted output cache, plus `writeNodeOutput` to feed their
  output out-of-band.** New optional
  `OpSpec.manualTrigger` (`packages/node-runtime/src/layer1/types/op-spec.ts`)
  and `BatteryMeta.manualTrigger`
  (`packages/node-runtime/src/layer1/loader/types.ts`), resolved by
  `meta-parser.ts`'s `resolveManualTrigger` (explicit `meta.manualTrigger`, else
  `frontend.nodeType === 'ai_battery'`). When set, `executeNode`'s walk treats
  the node as a *data boundary*: it skips `execute()` entirely and hydrates the
  node's outputs from the persisted output cache, emitting `exec:node:skipped`
  (`packages/node-runtime/src/layer2/execute-node.ts`,
  `layer2/subscriptions.ts`); inner group nodes get the same skip
  (`layer1/executor.ts`). New `writeNodeOutput(runtime, nodeId, portId, value)`
  (`packages/node-runtime/src/layer2/write-output.ts`) lets a host persist a
  value into that cache out-of-band (wraps scalars in the dispatcher wire form,
  tags the current `graph.hash`, emits `exec:node:output`). Surfaced to the
  editor via `OpSummary.manualTrigger` (`layer2/queries.ts`), the
  `node-runtime-react` `Battery` type, and `transport/mappers.ts`. Covered by
  `packages/node-runtime/src/__tests__/execute-node.test.ts` (skip + cache
  hydration + `writeNodeOutput` wire form / event / hash). *Why:* "Run button"
  ops (AI generators that hit a paid API) must fire only on the explicit user
  action, never as a side effect of an unrelated upstream change rippling through
  the incremental-execute walk.
- **`useCanvasDrop` gained a generic `onExternalDrop` extension hook + preset
  params, for app/domain drops that carry no `application/battery` payload.**
  When a drop has no `application/battery` data, `onDrop` now defers to the
  optional `onExternalDrop(flowPosition, event, placeBattery)` consumer instead
  of bailing out, and `placeBattery` accepts an `options.presetParams` record
  merged into the new node's params. The prop is threaded `<Editor>` →
  `<Canvas>` → `useCanvasDrop`, and the `ExternalDropHandler` type is re-exported
  from the editor barrel. The kernel stays domain-agnostic: the dragged payload
  lives entirely in an app-side channel (e.g. a localStorage bus across an iframe
  boundary). See `packages/node-runtime-react/src/editor/components/canvas/
  useCanvasDrop.ts` (`ExternalDropHandler`, `PlaceBatteryFn`), `Canvas.tsx`,
  `Editor.tsx`, and the canvas `index.ts` export. *Why:* an embedded asset panel
  in a sibling iframe (e.g. wb-2d's All Images) cannot pass native `dataTransfer`
  to the host canvas, so apps need a seam to handle such drops without the kernel
  knowing the domain payload.
- **Editor sync bridge now mirrors whole-canvas tallies + the selected node's
  wiring, for side-pane "Node Info" surfaces.** The `EditorMirrorSnapshot` the
  center `<Editor>` broadcasts gained `stats` (battery/edge/group/annotation/
  frame counts, batteries excluding `__group__` shadows) and `selectedNode`
  (the selected node's visible input/output ports, each resolved to its
  connected peers — upstream for inputs, downstream for outputs; group shadows
  resolve their exposed ports, plain nodes their catalog battery + dynamic
  output ports). Computed host-side so a side pane in a different iframe (with an
  empty pipeline store) can redraw the node's connections without its own store.
  New exported types `CanvasStatsView` / `SelectedNodeView` / `SelectedPortView`
  / `SelectedPortPeerView`. See `packages/node-runtime-react/src/editor/sync/
  editorBridge.ts` (`buildCanvasStats`, `buildSelectedNodeView`) and the updated
  `editorBridge.test.ts` fixture.
- **Canvas stats mirror now reports the live selection count.** `CanvasStatsView`
  gained `selectedCount` (from `pipelineStore.selectedNodeIds.length`), so a
  side-pane "Node Info" can show how many nodes are marquee/click-selected, not
  just whether one node is focused. See `buildCanvasStats` in
  `packages/node-runtime-react/src/editor/sync/editorBridge.ts` and the updated
  `editorBridge.test.ts` fixture.
- **Architecture maps + changelog discipline.** Added root `ARCHITECTURE.md`
  (monorepo + kernel map), this `CHANGELOG.md`, and `AGENTS.md` (the
  read-before-write / write-back-changelog contract). Per-app maps rewritten for
  the monorepo reality.

### Fixed
- **Group exposed-port hide/reorder/rename no longer reverts after a live-sync
  re-pull.** The group `'−'` (hide-port) button, port drag-reorder, and
  double-click rename write a CLIENT-ONLY presentation overlay
  (`hidden`/`order`/`customLabel`/`customLabelEn`) onto the editor `ExposedPort`
  (`editor/types.ts:150`), set via `updateGroupPort`/`moveGroupPort`
  (`editor/stores/pipelineStore.ts:597,632`). The kernel `ExposedPort`
  (`packages/node-runtime/src/layer1/types/graph.ts:76`) models only the wiring
  and re-derives exposed ports at `createGroup` time
  (`packages/node-runtime/src/layer2/apply-batch.ts:351`); the `updateGroup` op
  carries only name/position (`apply-batch.ts:475`,
  `editor/transport/mappers.ts:380`). So any later graph op that diffs to a
  kernel batch fired a `graph:applied` → `loadPipeline` re-pull
  (`pipelineStore.ts:1016,820`) that returned groups WITHOUT the overlay,
  silently un-hiding ports the user just hid (and dropping reorder/rename). Fix:
  `loadPipeline` now carries the prior exposed-port overlay forward across the
  re-pull, keyed by groupId + portName, mirroring the existing `previewEnabled`
  client-only carry-forward — see `mergeExposedPortOverlay`
  (`editor/stores/pipelineStore.helpers.ts`) wired into `loadPipeline`
  (`editor/stores/pipelineStore.ts:820`). The overlay's durable cross-session
  home is unchanged: the saved group-template JSON preserves these fields
  verbatim (`editor/transport/mappers.ts:166`, app save route writes the whole
  `NodeGroup`), and drop-out re-instantiation reuses the stored array rather than
  re-deriving (`editor/components/canvas/groupViewUtils.ts:161`,
  `useCanvasDrop.ts:74`). New unit test
  `editor/__tests__/exposedPortOverlay.test.ts` (6 cases: hide/order/label
  carry-forward, incoming-wins, match-by-name, new-group passthrough).


### Changed
- **`AINode` preview now mirrors out-of-band generation results, so an AI/CLI
  running the node remotely is equivalent to a human clicking Run.** Previously
  `AINode`'s preview used only local state (seeded from
  `params._gen_image`/`_gen_result`) and did not subscribe to later changes; when
  an AI tool / CLI ran generation remotely against the same `nodeId`, the node on
  the canvas never lit up and the preview was lost after a refresh. A new
  `useEffect` now subscribes to this node's output-port cache
  (`nodeOutputs[id].image`/`.result`, synced via the `node:output` event) and
  `data.params._gen_image`/`_gen_result` (updated after a graph re-fetch),
  syncing whichever is non-empty into the preview; an `isRunning` guard ensures a
  locally in-progress run is not overwritten
  (`packages/node-runtime-react/src/editor/components/canvas/AINode.tsx`).
  *Why:* "human Run == AI Run" — same interface, same data flow, same UI; after
  an AI generates remotely the canvas preview lights up live and survives a refresh.
- **New-project wizard tolerates an empty name.** Submitting the wizard with an
  empty name no longer errors; it falls back to the supplied
  `defaultProjectName` ("My scene") and de-duplicates against existing project
  names as "My scene (2)", "(3)", … (case-insensitive). See `uniqueProjectName`
  and `NewProjectWizard.submit` in
  `packages/node-runtime-react/src/editor/components/chrome/projectViews.tsx`.
  *Why:* a blank name should produce a valid, unique project, not a hard stop.
- **Battery bar default width 250 → 293px.** `BATTERY_BAR_WIDTH_DEFAULT` in
  `packages/node-runtime-react/src/editor/components/sidebar/batteryBarStorage.ts`
  bumped to 293px to better fit the default battery-row content. *Why:* the prior
  250px clipped longer labels; the value is the reset/seed default (not persisted).
- **Editor mirror's `selectedNode` now carries English labels + live port
  values for side-pane Node Info surfaces.** `SelectedNodeView` gained
  `batteryNameEn` (`battery.nameEn`/`group.nameEn`, else id-derived) and
  `SelectedPortView` gained `labelEn` (group exposed ports) plus `valueText`
  (the port's current value, formatted host-side via the editor's domain
  formatters — inputs resolved upstream/default, outputs from the computed
  cache, with inputs falling back to the catalog `default` so unconnected,
  unedited ports still report their effective value). `useEditorBroadcastHost(
  key, formatters)` and `<Editor>` thread `domainValueFormatters` through so
  values format identically to canvas tooltips. See
  `packages/node-runtime-react/src/editor/sync/editorBridge.ts` and `Editor.tsx`.
- **Legacy `ai_grasshopper-implicit-list` migration audit (`wb-scene` + `asset3d`).**
  Ported remaining `origin/wb-scene` scene30 GTA / Vice City batteries through
  `3747d58b` into `apps/wb-scene-generator`. Audited shared editor fixes from the
  same range against `packages/node-runtime-react` (already equivalent; no delta
  commit). Audited `origin/asset3d` strict geometry / baker chain against
  `apps/wb-3d-lowpoly` (`6fa0a167`–`7bccdc20` already reconciled; geometry DSL
  tests 39/39).
- **`pnpm typecheck` is now self-bootstrapping (no more spurious failures on a
  fresh checkout).** Cross-package types resolve from built artifacts: the kernel
  packages' `dist/*.d.ts` (their `exports.types` → `dist`, not `src`) and
  `apps/wb-3d-lowpoly/backend/vendor/dist/shared/types/*.d.ts` (the geometry DSL,
  hard-imported at `apps/wb-3d-lowpoly/backend/src/services/baker/shared-types.ts:19`).
  `tsc --noEmit` does not emit those, and only `build` had a `prebuild` — so on a
  machine that had only run `pnpm install` (no `pnpm -r build`), `pnpm typecheck`
  failed with `Cannot find module '@forgeax/node-runtime'` /
  `'@forgeax/editor-host/backend'` plus cascading `implicitly has 'any' type`
  errors, all landing in the wb-3d-lowpoly backend (the only app that vendors the
  DSL). Added a root `pretypecheck` (`pnpm --filter './packages/**' run
  --if-present build && pnpm build:vendor`) that builds the kernel dist + each
  backend's vendor before `tsc` runs. `tsc -b` is incremental, so re-runs on an
  already-built tree are cheap. Not caused by the `"source"` HMR condition: the
  backend uses `moduleResolution: "Bundler"`, which reads the `types` condition
  (→ dist), never `source` (no `customConditions` set). See root `package.json`.
- **Kernel now hot-reloads in dev (no more `pnpm -r build` to see changes).**
  The kernel packages are consumed by the two plugin apps via their `dist/`
  (package `exports` → dist), so both the Vite frontend and the `tsx` backend
  transformed *built* output — editing kernel source required a full rebuild +
  restart. Added a `"source"` export condition (→ `src/*.ts`, listed first) to
  `node-runtime` (`.`, `./layer1`, `./layer2`) and `editor-host` (`./backend`).
  The backend dev launcher now runs `tsx --watch` with `--conditions=source`, so
  kernel edits hot-restart the backend from source. The frontend uses a Vite
  `resolve.alias` for the same effect (see the per-app changelogs). Production
  paths (`serve-dist` / `.app` / studio) pass no such condition and never load
  the dev vite config, so they keep consuming `dist` unchanged. See
  `packages/node-runtime/package.json` and `packages/editor-host/package.json`.
- **Hover tooltip redesigned to the design-system theme + shows the battery
  icon.** The shared battery/port tooltip (`TooltipPortal` / `.node-tooltip*`,
  used on canvas battery hover, battery-bar option hover, and port value probes)
  was painted with a hardcoded blue-purple gradient (`#1f1f38→#191926`) and a
  purple-tinted tag colour — off the near-black + moss-green + lime theme, and
  broken under the light theme. Re-skinned entirely with design-system tokens
  (`--color-bg-elevated` / `--color-border-strong` / `--radius-md` /
  `--shadow-lg` / `--font-family`, probe values mapped to `--color-info` /
  `--color-warning`), so it matches both themes. Added a 28px icon chip
  (`battery.iconSvg`) to the header and restacked the layout (icon · title+version
  row · category tag · clamped 2-line description · divided probe value section).
  New optional `icon` field on `TooltipState`; both battery call sites pass
  `battery.iconSvg`. The icon is rendered large (44px) on a transparent ground
  (no chip), the description is shown in full (no line clamp), and `TooltipPortal`
  now measures itself in a `useLayoutEffect` and clamps left/top to the (iframe)
  viewport — a hover near the bottom/right edge flips in instead of overflowing
  and clipping its content. The selected-node **节点信息 / Node Info** panel
  (`PropertiesPanel` `NodeInfoTab`) gained the same large battery icon header
  (resolved from the catalog by `batteryId`). See
  `packages/node-runtime-react/src/editor/components/canvas/nodeTooltip.tsx`,
  `BatteryNode.css` (`.node-tooltip*`), the `showDelayed` calls in
  `BatteryNode.tsx` + `sidebar/BatteryBar.tsx`, and `sidebar/PropertiesPanel.tsx`
  + `Sidebar.css` (`.node-info-header` / `.node-info-icon`).
- **Kernel is now in-repo `workspace:*` packages, not an `external/` submodule.**
  The former `forgeax-wb-node-core` submodule (consumed via `link:`→dist by each
  standalone plugin) was absorbed into this monorepo as `packages/*`. Apps
  reference the kernel by `workspace:*` (source, not built dist); one
  `pnpm -r build` rebuilds everything. There is no pin to bump, no
  `kernel:setup/build`, no cross-repo dist sync.

### Fixed
### Fixed
- **删除一条输入边（或删点 / 删组）现在会失效受影响节点及其下游的输出缓存——
  修复「删边后该节点输出不变」。** `applyBatch` 之前只改图结构，从不触碰
  `runtime.outputs`；叠加 `manualTrigger` 电池（AI ImageGen/TextGen）在执行时被
  walker 跳过 `execute`、直接从 `outputs/` 缓存 hydrate 旧值
  （`packages/node-runtime/src/layer2/execute-node.ts:135`），导致删除输入边后该电池
  仍显示与已删除上游对应的过期结果。现 `applyBatch` 在成功写盘后、广播 `graph:applied`
  之前，对 `connect`/`disconnect`/`deleteNode`/`deleteGroup`/`ungroup` 收集受影响的
  target 种子节点（`disconnect` 用删前快照 `current` 解析 `edgeId → target`），基于最终
  `next.edges` 跑下游 BFS 传递闭包（复用 `getDownstreamNodeIds`），逐个调用
  `runtime.outputs.invalidate(id)`（`packages/node-runtime/src/layer2/apply-batch.ts:566`
  `collectInvalidationSeeds`、`apply-batch.ts:691` 失效落点）。仅在批次成功且确有结构变更时
  执行；校验不过 / dryRun 不动缓存。*Why:* `outputs/` 是「可丢弃的执行缓存」，删边改变了节点
  的输入拓扑，旧缓存即为脏；不失效会让 manualTrigger 电池绕过「输入消失→输出失效」语义。
  新增 `packages/node-runtime/src/__tests__/apply-batch-invalidate.test.ts`（6 例：disconnect
  失效 target、下游闭包级联失效、删边后普通 op 回退 default、manualTrigger 删边清缓存、删点
  失效存活下游、无关子树不受影响）。
- **Dragging a node no longer janks the canvas on large/framed graphs (the
  "moving a node feels very laggy" report).** Two per-drag-frame hot paths were
  defeating the layout-only fast path even though the kernel already exempts a
  pure move from `graph:applied`
  (`packages/node-runtime/src/layer2/apply-batch.ts:124` `isLayoutOnlyBatch`,
  confirmed clean: `diffPipelineToOps` emits a `position`-only `updateNode`,
  `transport/mappers.ts:282`):
  - The frame-tracking effect in
    `packages/node-runtime-react/src/editor/components/canvas/useCanvasFrames.ts:261`
    is keyed on `nodes`, which gets a fresh array reference on every mousemove
    (`Canvas.onNodesChange` → `setNodes`,
    `editor/components/canvas/Canvas.tsx:245`). It ran a full `nds.map` plus a
    per-frame O(nodes×frames) `computeFrameGeometry` on EVERY drag frame, even
    when the graph had no frames. Now it bails early when no `frame` node is
    present (`useCanvasFrames.ts:261`, new `hasFrameNode` guard), so a plain
    move pays zero frame-tracking cost.
  - The domain-port renderer wrapper
    (`editor/components/canvas/canvasConstants.ts:137` `injectDomainPortTypes`)
    returned a bare functional component, so the already-`memo`'d
    `BatteryNode`/`GroupNode` re-rendered on every ReactFlow node-store update
    (including each drag frame). The wrapper is now wrapped in `memo`; since
    `domainPortTypes` is a stable prop, untouched nodes skip re-render during a
    drag.
- **Session persist no longer crashes (`Cannot convert undefined or null to
  object`) when a node has missing params — the whole save aborted.** The diff
  helper `paramsEqual` (`packages/node-runtime-react/src/editor/transport/
  mappers.ts:210`) called `Object.keys(existing.params)` on a node whose
  `params` was null/undefined (legacy graph / relay/panel node created without a
  params bag), throwing inside `diffPipelineToOps` → `EditorApiAdapter.
  updatePipeline` and surfacing as the repeating `[Session] persist failed`
  console error (`pipelineStore.ts:771`); every edit silently failed to save.
  `paramsEqual` now coerces null/undefined to an empty bag on both sides, and
  the kernel's `createNode` (`packages/node-runtime/src/layer2/apply-batch.ts:162`)
  defaults `params` to `{}` so a malformed op can't persist undefined params in
  the first place. *Why:* a missing params bag is equivalent to no params and
  must never abort the persist pipeline.
- **Editor sync bridge stops flooding the console with
  `InvalidStateError: ... Channel is closed`.** `publishState` / `sendCommand`
  on a closed `BroadcastChannel` (iframe teardown / HMR dispose) threw and
  spammed the console (`editorBridge.ts:163`). The bridge now tracks a `closed`
  flag set by `close()` and makes post-teardown publishes silent no-ops. See
  `packages/node-runtime-react/src/editor/sync/editorBridge.ts`.
- **A required DataTree input that resolves to an empty tree now throws a clear
  error instead of leaving the node a silent, result-less no-op when it carries an
  upstream value (the "我给了输入但输出端口一直 no result、又没有任何报错" bug).**
  The DataTree dispatcher aligns the branch paths of every `item`/`list` input;
  when one aligned port resolves to an empty tree (zero branches) `alignBranches`
  returns no tuples, so the op function was never called and
  `executeWithDataTreeDispatch` returned `{}` — the node produced NO outputs AND
  NO `error`, leaving every output port stuck on "no result" with nothing to
  diagnose. This bit two-input batteries hardest (e.g. `image_atlas_compose`'s
  `terrain` + `template`): an incremental `executeNode(target)` run hydrates
  boundary upstream inputs from the persisted output cache, so if one upstream
  had never executed / its cache was empty, that input arrived as an empty tree
  and the whole node became a silent no-op. The dispatcher now distinguishes two
  zero-tuple cases: if EVERY aligned input is empty the node is simply unwired
  and stays a silent no-op (the editor recomputes mid-edit), but if SOME aligned
  input has data while a REQUIRED one is empty it throws a clear
  `"<op>: required input "<port>" has no value (upstream produced nothing) — run
  the upstream node or the full pipeline first"`, which surfaces on the canvas as
  an `exec:error` instead of a dead, result-less node. See
  `packages/node-runtime/src/layer1/dispatcher.ts` (`executeWithDataTreeDispatch`
  zero-tuple branch) and the new regression tests in
  `packages/node-runtime/src/__tests__/dispatch-missing-input.test.ts`
  (runs with both inputs / throws on one empty required input / stays a no-op
  when all empty).
- **AI image-battery node preview no longer crops the generated image from the
  bottom; it now fits the whole image inside the fixed preview area.** The image
  used `width:100%; max-width:220px` with no height constraint, so a near-square
  / tall image overflowed the `150px` preview box and got clipped (the visible
  Christmas-tree sprite lost its base). `.ai-node__preview-img` now constrains
  both axes (`max-width/max-height:100%`, `width/height:auto`, `object-fit:
  contain`) and `.ai-node__image-grid` centers it (`height:100%` flex center);
  the preview area was also bumped `150px → 180px` for a roomier fit
  (`packages/node-runtime-react/src/editor/components/canvas/AINode.css`).
- **Image/IO batteries that return `error: ''` on success no longer have their
  outputs discarded (the "battery ran but its `image` port shows no result"
  bug).** The dispatcher aborted a cell whenever the op's return carried an
  `error` key that was not `undefined`, so the empty-string success sentinel
  returned by every `processImage`/`processImages` battery (e.g.
  `image_remove_bg`, `image_resize`) was misread as a failure — the node threw,
  all outputs (including `image`) were dropped, yet the image side-effect had
  already been written to staging, producing a visible preview with an empty
  output port. The dispatcher now treats only a NON-EMPTY `error` as a failure
  (`packages/node-runtime/src/layer1/dispatcher.ts`), and the executor unwraps
  the (now DataTree-wrapped) `error` output port to a scalar before deciding
  whether the node errored, so an empty string is a clean success and the
  `error` port still publishes `''`
  (`packages/node-runtime/src/layer1/executor.ts`). Regression tests:
  `op returning error:"" ... still publishes its outputs` and `op returning a
  non-empty error aborts the node` in
  `packages/node-runtime/src/__tests__/execute-node.test.ts`.
- **Selected inner-group node now resolves its connections + values from the
  active container, plus external-boundary peers, in side-pane Node Info.**
  Peer/value resolution read the root pipeline's edges/nodes only, but a
  selected inner node's connections live in the active group's own
  `nodes`/`edges`. `buildSelectedNodeView` now resolves the active container
  from `groupViewStack` (deepest first, incl. nested snapshots) when the group
  actually owns the selected node, resolves input values against that
  container's edges + `nodeOutputs`, and additionally surfaces external-boundary
  peers/values: an inner port that is an exposed group input/output reports the
  outside node it links to (and its fed value) by following the parent-side edge
  into/out of the group's `__group__` node. See `buildSelectedNodeView` in
  `packages/node-runtime-react/src/editor/sync/editorBridge.ts`.
- **Group node ports now show clean names (and their values) in side-pane Node
  Info.** The group branch of `buildSelectedNodeView` emitted the raw exposed
  `portName` / `portLabel` (e.g. `in__node-…__width`), so Node Info rendered
  garbled labels. It now derives the label via the same
  `getGroupPortDisplayLabel(ep, en)` the canvas uses (stripping generated
  `in__…__`/`out__…__` prefixes, honouring custom labels), for both `label`
  and `labelEn`. Port values/peers already keyed off the exposed `portName`
  (matching the edges), so they resolve once the label is correct. See
  `buildSelectedNodeView` in
  `packages/node-runtime-react/src/editor/sync/editorBridge.ts`.
- **Group (composite) nodes now resolve their exposed ports + wiring in
  side-pane Node Info.** A selected group RF node carries `GroupNodeData`
  (`groupId` / `exposedInputs` / `exposedOutputs`), not a catalog
  `data.battery`/`data.params`, so `onSelectionChange` mirrored it with an
  empty `batteryId` and no `groupId` — `buildSelectedNodeView` then missed the
  `__group__` branch and reported "no inputs / no outputs". `onSelectionChange`
  now maps `type === 'group'` selections to `batteryId: '__group__'` +
  `params.groupId`, so the group's exposed ports, values and connections render.
  See `onSelectionChange` in
  `packages/node-runtime-react/src/editor/components/canvas/Canvas.tsx`.
- **History "Copy node" / "Paste node" English labels no longer show the
  Chinese battery name.** The Ctrl-drag duplicate and Ctrl+V paste built their
  `labelEn` from `battery.name` (zh) instead of `battery.nameEn`, so the
  English history list still rendered Chinese names. Both now use `nameEn`
  with an id-derived fallback (`formatIdAsLabel`). See `useCtrlDragGhost.ts`
  (`ctrlCopyLabelEn`) and `useCanvasCopyPaste.ts` (`firstEntryNameEn`) under
  `packages/node-runtime-react/src/editor/components/canvas/`.
- **Data-probe type badge now uses domain port colours (e.g. scene → orange),
  matching the port handle.** The probe edge (`ProbeEdge`) colours its type badge
  via `getPortTypeColor(type, domainPortTypes)` and already accepts a
  `domainPortTypes` prop, but `Canvas` passed ReactFlow the *static* `edgeTypes`
  map (no injection) instead of `createCanvasEdgeTypes(domainPortTypes)` — which
  exists for exactly this. So a domain type like `scene` (not in the built-in
  colour table) fell back to `DEFAULT_PORT_COLOR` (#6b7280 grey) on the probe
  while its port handle showed the registered orange (#fb923c). `Canvas` now
  memoises `createCanvasEdgeTypes(domainPortTypes)` and passes it, mirroring
  `activeNodeTypes`. See
  `packages/node-runtime-react/src/editor/components/canvas/Canvas.tsx`
  (`activeEdgeTypes`).
- **Canvas fits the view when a graph is wholesale-replaced (Open/import/project
  switch), so the result is visible immediately.** The canvas kept its previous
  viewport across `loadPipeline`, so a graph laid out far from the origin (or off
  the current pan/zoom) — e.g. just imported via the left-pane Open — reconciled
  in live but appeared as an empty canvas until the user fit-view'd manually
  (ReactFlow only renders nodes inside the viewport). `useCanvasGraphSync` now
  tracks the previous node-id set and, when a rebuild swaps in a near-disjoint
  set (overlap 0 — i.e. an open/import/project-switch, NOT an incremental local
  or agent edit which keeps most ids), calls `reactFlowInstance.fitView()` once.
  See `packages/node-runtime-react/src/editor/components/canvas/useCanvasGraphSync.ts`
  (`prevNodeIdsRef`, `wholesaleReplace`).
- **Graph import survives an orphan `__group__` shadow (malformed/partial save)
  instead of aborting.** A saved graph can contain a `__group__` shadow node
  whose `NodeGroup` definition is missing from `groups` (e.g. a group that was
  ungrouped/deleted but left a dangling shadow + boundary edges). `flattenGroups`
  only remapped boundary edges for groups it *could* reconstruct; an edge into an
  orphan shadow kept pointing at it, and since the shadow is skipped (recreated
  only via `createGroup`), the emitted `connect` referenced a non-existent node →
  the whole import failed with `connect.target.nodeId <group> does not exist`.
  Now any boundary edge whose group endpoint can't be resolved to an inner port
  (orphan group, or a never-exposed port) is dropped (graceful degradation), so
  the rest of the graph imports. See `packages/node-runtime/src/layer2/import-graph.ts`
  (`flattenGroups` `allShadowIds` + `resolvable`) and the new `import-graph.test.ts`
  case ("drops an orphan __group__ shadow ... keeps the rest").
- **Graph import no longer rejects the `__relay__` wire sentinel.**
  `importPipelineGraph` validates every node's `opId` against the live op
  registry, but exempted only the `__group__` sentinel — so a graph carrying
  reroute **relay** nodes (`opId: '__relay__'`, created via `applyBatch` and
  handled directly by the executor as a wire pass-through, never registered as an
  op) round-tripped *out* of the editor but failed to import *back in* with
  `unknown opId '__relay__'` (HTTP 422). The relay sentinel is now exempt from the
  registry check alongside the group sentinel, so Save→Open of any graph with
  reroute points works. See `packages/node-runtime/src/layer2/import-graph.ts`
  (`RELAY_OP_ID`, validation loop) and the new `import-graph.test.ts` case
  ("accepts the __relay__ wire sentinel").
- **Small-label collapse now works.** `BatteryBar` rendered every small section
  with a chevron that looked collapsible, but `isOpen` was hardcoded `true` at
  both render sites and the open/closed state value was discarded
  (`const [, setOpenSmallLabels]`) — clicking the header toggled localStorage but
  never the view. Reworked the persisted set to mean **collapsed** labels
  (default = expanded, matching prior behaviour): added `isSmallOpen()`, fixed
  `toggleSmallOpen` to drive it, and computed `isOpen` from state at both sites.
  Storage helper renamed for honesty (`readOpenSmallMap`/`writeOpenSmallMap` →
  `readCollapsedSmallMap`/`writeCollapsedSmallMap`, key
  `battery-bar-open-small-labels` → `battery-bar-collapsed-small-labels`; old key
  abandoned since its semantics were inconsistent). See
  `packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx` and
  `batteryBarStorage.ts`.
- **Drag-battery-to-canvas no longer fails under WebKit.** The canvas cancelled
  only `dragover`, not `dragenter`; WebKit (Studio/.app WKWebView) then showed the
  no-drop cursor on entry until a later `dragover` corrected it — releasing during
  that transient window dropped nothing, so battery creation silently failed.
  Added an `onDragEnter` handler (mirrors `onDragOver`: `preventDefault` +
  `dropEffect='copy'`) wired on both the canvas wrapper and the `ReactFlow` pane.
  See `packages/node-runtime-react/src/editor/components/canvas/useCanvasDrop.ts`
  (`onDragEnter`) and `Canvas.tsx`.
- **Favourite batteries now have a visible home.** The favourites feature was
  fully wired (mark via right-click → store → localStorage `favorite-batteries`)
  but its only display surface, `FavoritesPanel`, lived inside `LeftSidebar`,
  which `<Editor>` never mounts (`Editor.tsx` renders only Toolbar + BatteryBar +
  Canvas) and no app instantiates — so favourited batteries were unreachable.
  Added a synthetic **收藏 / Favorites** entry pinned to the bottom of the
  vertical big-label rail in `BatteryBar`, plus a matching content section that
  lists the favourites (parsed from `FavoriteBattery.batteryJson`, reusing the
  existing `BatteryRow` + drag-to-canvas + scroll-jump machinery; no new store,
  no kernel logic change). Develop-mode only. See
  `packages/node-runtime-react/src/editor/components/sidebar/BatteryBar.tsx`
  (`FAVORITES_BIG`, `favoriteRows`, `railLabels`, rail button + content section)
  and `BatteryBar.css` (`.bb-rail-button--favorites` pinned via `margin-top:auto`,
  `.bb-small-section--favorites`).

### Removed
- **Dead `external/` migration debris.** Removed the "kernel submodule SSOT
  guard" from `apps/*/scripts/hygiene-check.mjs` (it asserted a now-nonexistent
  `external/forgeax-wb-node-core` and was failing `pnpm hygiene` in both apps);
  repointed `apps/wb-scene-generator/scripts/acceptance-loop.mjs` CLI bin to the
  workspace `packages/node-runtime-cli/dist/bin.js`. (`.gitmodules` and the
  `.cursor/rules/kernel-cascade.mdc` cascade rules removed — see app changelogs.)

---

## `wb-scene-generator` project-switch latency + scene-tree storage — batch handoff (2026-07-14 → 2026-07-15)

> Consolidated write-back for a multi-day investigation that landed as a sequence
> of small commits without a CHANGELOG entry at the time (contract violation on
> the earlier commits — corrected here, append-only, rather than editing
> history). Full narrative + empirical measurements for every item below live in
> `aw-support/docs/DEVLOG.md` (all `2026-07-14`/`2026-07-15` entries) and
> `aw-support/docs/performance/{wb-scene-generator-project-switch,wb-scene-generator-scene-tree-storage}.md`.
> Root cause: opening/switching a `wb-scene-generator` project felt slow/blank
> because of (a) redundant full-graph recomputation, (b) O(N) duplicate storage
> of near-identical `scene` DataTrees, and (c) synchronous full-`JSON.stringify`
> calls used only to *measure* whether a port was too large to send.

### Added
- **`OutputCache` content-addressed blob store (dedup by sha256, not by
  reference) + recursive Merkle-DAG subtree addressing.**
  `packages/node-runtime/src/layer1/storage/blob-ref-contract.ts` (new —
  `OUTPUT_CACHE_BLOB_REF_KEY`/`isOutputCacheBlobRef`/`makeOutputCacheBlobRef`,
  no fs/crypto deps, shared by kernel + frontend);
  `packages/node-runtime/src/layer1/storage/output-cache-blob-store.ts` (new —
  `OutputCacheBlobStore.put/get/has/byteSize/stats/gc`, gzip-on-disk,
  content-idempotent). `output-cache.ts`: `dedupeTopLevel`'s
  `externalizeIfLarge()` externalizes any top-level field ≥16KB
  (`BLOB_MIN_BYTES`) to a blob ref; `isSceneNodeLike()` + `externalizeValue()`
  additionally recurse *into* `SceneNodeSnapshot.children` post-order (a
  Merkle DAG — each subtree hashes independently, unchanged subtrees reuse
  their prior hash across writes) instead of hashing a scene tree as one
  opaque blob, so incrementally-grown tree snapshots (e.g. an `add_child`
  merge chain) share their unchanged prefixes on disk. `resolveSharedRefs`/
  `resolveBlobRef`/new `resolveNestedBlobRefs` resolve nested blob refs
  recursively with call-scoped `blobMemo` memoization (blob refs may now
  point to values that themselves contain blob refs — any future code
  touching blob content directly must go through these recursive-aware
  entry points, not assume a blob is a leaf). Tests:
  `packages/node-runtime/src/__tests__/storage.test.ts` (+8: cross-write/
  cross-port content dedup, envelope round-trip, `gcBlobs` liveness, chained
  `add_child`-style growth, nested-blob GC reachability, envelope recursive
  hydrate), `packages/node-runtime/src/layer1/storage/__tests__/output-cache-blob-store.test.ts`
  (new, 8 cases).
- **HTTP "wire envelope" (`{ value, blobs }`) so deduped ports can inline
  instead of being rejected as `tooLarge`.**
  `packages/editor-host/src/backend/projectPipelineRoutes.ts`:
  `tryEnvelopeResponse()` cheaply pre-checks via `envelopeByteSize()`, then
  confirms via real `readWithBlobRefs()` + stringify within the response cap;
  wired into both the single-port GET and batch POST `tooLarge` branches
  (batch route additionally shrinks the cap by remaining batch budget), and
  — per P0-11 (2026-07-15) — tried at a low 1MB threshold
  (`ENVELOPE_TRY_THRESHOLD_BYTES`) rather than only right before the 128MB
  rejection edge, since most real dedup wins live well under 128MB and were
  never reaching the envelope path at all.
  `packages/node-runtime-react/src/api/sceneEnvelope.ts` (new, in `api/` so
  both the root and `editor` entry points can share it) — `hydrateBlobRefs`,
  no-op when `blobs` absent. Exported from `api/index.ts`, `src/index.ts`,
  `src/editor/index.ts`. `ApiClient.ts`/`apiAdapter.ts` batch-fetch return
  types gained `blobs?: Record<string, unknown>`; `pipelineStore.ts`'s
  `fanOutConnectedOutputsBatch` hydrates before `setNodeOutput`.
  `apps/wb-scene-generator/frontend/src/api/HttpApiClient.ts` passes `blobs`
  through. Tests: `packages/node-runtime-react/src/api/__tests__/sceneEnvelope.test.ts`
  (new, 5 cases); `pipelineStore.test.ts` (+1, batch-with-blobs hydrate).
- **Write-time size-estimate caching — `portByteSize()`/`envelopeByteSize()`
  are now O(1) reads instead of an O(chunk-count) synchronous directory scan.**
  `output-cache.ts`: `write()` computes and stores
  `estimatedExpandedBytes`/`estimatedEnvelopeBytes` in the port's metadata
  JSON right after sharding; both size-query methods now call
  `cachedOrScannedByteSize()` (new) which prefers the cached field and only
  falls back to the original full scan (`scanEnvelopeByteSize()`, renamed
  from the previous inline logic) when the field is absent (old projects,
  backward compatible). `types.ts`: `OutputCacheV1` gained the two optional
  fields. Empirically measured on real 60×60 data: scan time
  110ms/36ms → 0ms/0ms per call; on a real 200×200 clone (17,830 chunks):
  three consecutive calls all 0ms (previously would have been the one case
  that gets *worse*, not better, as a scene grows — this eliminates that).
  See `aw-support/docs/DEVLOG.md` "2026-07-15 — 场景树内容寻址递归化…" for the
  full before/after table (honest caveat there too: the recursive dedup
  itself had mixed/negative results on disk size and 200×200 envelope size
  for this app's real `add_child` merge-chain data shape — the *caching* is
  the unconditional win, not the dedup granularity).
- **`gcBlobs()` rewritten as BFS over transitive blob reachability**, fixing a
  latent data-loss bug: once blob refs can nest (previous bullet), the old
  scan-chunk-top-level-fields-only GC would delete a blob that was only
  reachable *through* another still-live blob. `output-cache.ts`: `gcBlobs()`
  now loads each newly-discovered live hash's content and scans it for
  nested blob refs, repeating to a fixed point. Verified on a real 200×200
  clone: 301/301 blobs correctly judged live (0 false deletes).
- **`TooLargeOutputSummary` sentinel** — a small `{ __forgeaxTooLargeSummary,
  nodeId, portId, ... }` object stored in `nodeOutputs` in place of a
  rejected `tooLarge` port's real value, so probes/tooltips/preview
  pass-through can recognize and render "(too large, N chunks, ~X MB)"
  instead of `undefined` or a stale value.
  `packages/node-runtime-react/src/editor/utils/tooLargeOutputSummary.ts`
  (new) + `__tests__/tooLargeOutputSummary.test.ts` (new). Consumed by
  `ProbeEdge.tsx` (skips `formatDataTreeSummary` for a summary sentinel),
  `nodeTooltip.tsx`'s `formatPortValue`/`formatPortValueExtra` (now
  zh/en-aware via `useUIStore`'s `langMode`, since the summary text needs a
  language), and `WorkbenchHost.tsx`'s `stripTooLargeSummaries` before
  posting preview data into the renderer iframe (a summary sentinel is
  meaningless to the renderer and would otherwise be forwarded as if it were
  real scene data). `pipelineStore.helpers.ts` gained
  `resolveOutputPortType()` to look up a port's declared type for the
  tooltip/probe formatters.
- **Project-switch loading-progress panel** (host + renderer-iframe phases
  merged into one non-blocking checklist overlay), so a slow switch/open no
  longer looks like a silent hang.
  `apps/wb-scene-generator/frontend/src/renderer/bridge/loadingSignals.ts`
  (new, in-iframe progress event bus, `postMessage('workbench:loading-status')`
  to the host), `workbench/LoadingStatusPanel.{tsx,css}` (new),
  `workbench/protocol.ts` (`LoadingStatusMessage`), `WorkbenchHost.tsx`
  (`useLingeringStep`, merges host-observed switch/outputs/execute phases with
  renderer-reported preview/baked/alias phases), `useNodePreviews.ts`/
  `useBakedLayers.ts`/`useAliasMetas.ts` (`beginLoadingTask`/`endLoadingTask`
  at each hook's full-fetch entry point).

### Changed
- **`autoExecuteOnOpen()` no longer defaults to a full-graph recompute the
  moment any visible output port is `undefined`.** That happened on nearly
  every project open (front-end `nodeOutputs` is cleared on every switch
  regardless of disk-cache validity), accounting for 70-80% of two measured
  open cycles. `pipelineStore.ts`: now (1) batch-backfills from disk-cached
  values first (read-only, no compute) to absorb front-end-only staleness,
  then (2) only for ports still missing, computes the deduped set of root
  nodes via `getDownstreamIds` and runs `callPipelineExecute({ startNodeId })`
  per root (kernel's partial-closure execution auto-pulls cold upstream
  ancestors), falling back to a full `executePipeline()` only once the root
  count nears the graph size. Verified via headless Playwright: 74 missing
  ports → 2 root-node partial recomputes, not a 185-node full graph run.
  New `autoexec-backfill` sync-trace point (`refreshTrace.ts`: `RefreshReason`
  gained `'autoexec-backfill'`). Tests: `pipelineStore.test.ts` (+2: single
  missing node only executes that node; disk-cache-valid resolves via
  backfill with zero `execute` calls).
- **Sharded-port batch/single-port routes try the dedup envelope at a much
  lower bar (1MB) instead of only right before the 128MB rejection edge**
  (P0-11) — see `ENVELOPE_TRY_THRESHOLD_BYTES` above. Verified against a
  running dev server: one real port's response dropped from ~69MB to
  ~31.6MB.
- **Batch output route enforces a cumulative response budget, not just a
  per-port one.** `projectPipelineRoutes.ts`: new
  `MAX_BATCH_RESPONSE_BYTES` (128MB); short-circuits when either a single
  port exceeds the cap *or* the running total would. `[output-batch-trace]`
  gained a `deferred` counter.
- **`portByteSize()`/`shardedDataByteSize()` no longer under-report by up to
  3× for deduped or voxel-coded ports.** Two independent, additive
  under-estimates existed: (a) a `SharedRef` pointer is a few hundred bytes
  on disk but expands to the full referenced value on read — the old scan
  summed *disk* bytes; (b) voxel cells are stored in a packed
  `{__voxelCells:1,t,d}` encoding smaller than the `{x,y,z,token}[]` shape
  `read()` actually returns. `voxel-cells-codec.ts` gained
  `expandedPayloadByteLength()`/`expandedVoxelCellsByteLength()` (computes
  the true expanded JSON byte count without allocating the expanded
  objects); `output-cache.ts`'s `shardedDataByteSize()` rewritten to resolve
  `SharedRef`s via a hash-memo and use the codec function for voxel fields.
  Verified against real data: one port's estimate corrected from 94.4MB to
  289.5MB (true 289.55MB, <0.01% error). Tests:
  `packages/node-runtime/src/__tests__/storage.test.ts` (+2, precision
  assertions against true expanded byte counts).
- **Renderer iframe soft-resets on project switch instead of a full
  destroy-and-remount.** `WorkbenchHost.tsx` now only posts
  `workbench:project-changed`; `RendererSurface.tsx` handles it via
  `useRenderStore.getState().reset()`. The previous hard remount
  (`rendererReloadKey` bump) tore down and reconnected 3 WebSockets +
  op-catalog/node-meta caches on every switch, which was a meaningful chunk
  of the perceived "stuck" delay for work `reset()` already covered.
  `rendererReloadKey`/the iframe `key` prop are left wired as a manual
  escape hatch; nothing bumps it automatically anymore.
- **Renderer-side alias/baked-layer subscriptions share one WebSocket instead
  of opening their own.** `HttpApiClient.ts` gained `subscribeRaw`/
  `rawListeners` for broadcasts with no `RuntimeEvent` envelope (e.g.
  `baked:changed`); `useAliasMetas.ts`/`useBakedLayers.ts` now take a shared
  `client: HttpApiClient` instead of each opening `new WebSocket(...)`.
  `useAliasMetas.ts` also gained a 300ms-debounced
  `scheduleAliasMetasRefresh()` collapsing 3-4 previously-independent
  refresh triggers (mount, `project:viewing`/`project:activated`,
  host `workbench:project-changed`, `library:changed`) into one fetch per
  switch. Tests: `useAliasMetas.test.tsx` (new, 5 cases), `useBakedLayers.test.tsx`
  (updated to drive a real `HttpApiClient` + `FakeWebSocket`).
- **Output-cache read paths get an in-process cache keyed on file
  mtime+size** (mirrors `GraphStore`'s existing pattern), invalidated on
  `write`/`invalidate`/`pruneOrphans`/`pruneByRetention`; batch output route
  yields the event loop (`setImmediate`) every 8 ports instead of running
  the whole batch synchronously.

### Fixed
- **Opening a project for the first time could run the full graph twice.**
  Two independent, mutually-unaware triggers both called
  `refreshConnectedOutputs(...).then(autoExecuteOnOpen)` on first
  open — `WorkbenchHost`'s `bootstrap()`→`switchProject()` cascade, and
  `Editor.tsx`'s own mount effect. The slower-finishing one's
  `resetPipelineUiForProjectSwitch()` cleared the outputs the faster one had
  just computed, so its own "still missing" check fired a second full
  185-node execute. `Editor.tsx`'s mount effect now checks
  `viewingProjectId !== null` (project store exists → owns the cascade) and
  no-ops instead of racing it.
- **A `tooLarge` port was re-queried on literally every refresh, forever**,
  because "already cached" was checked via `nodeOutputs[nodeId][port] !==
  undefined` — but a `tooLarge` port is never given a value, so that check
  was permanently false regardless of whether the underlying `executedHash`
  had changed. `pipelineStore.ts` added `_knownTooLargeByPort`
  (nodeId→portId→`executedHash`) as a parallel "confirmed too large, don't
  re-ask unless the hash changes" table. Tests: `pipelineStore.test.ts`
  (+1: repeated refreshes hold the fetch count at 1 until the hash changes).
- **A sharded port's full value was `JSON.stringify`'d just to measure its
  byte size before discarding it as `tooLarge`**, synchronously blocking the
  event loop for up to several seconds per request (measured 1.6-7.5s on
  real vegetation-group ports) and stalling *unrelated* concurrent requests.
  `output-cache.ts` added `portByteSize()` (pure `statSync`/`readdirSync`
  disk-size sum, no read/parse/reassembly); both routes in
  `projectPipelineRoutes.ts` now short-circuit on this cheap check before
  ever calling `getNodeOutput()`/`stringify`, with a real-serialize fallback
  check retained near the size boundary.
- **Switching into a project with a cold output cache silently left the
  preview blank** — `refreshConnectedOutputs('project-switch')` only reads
  already-cached server outputs, never computes; the "cold cache → auto-run
  once" logic (`autoExecuteOnOpen()`) was wired only to the editor's initial
  mount, never to the switch path. `projectStore.ts`'s
  `refreshOutputsAfterProjectSwitch` now chains `autoExecuteOnOpen()` after
  the refresh (no-op when warm), skipped when the *target* project already
  has an agent executing it (`targetIsExecuting`, to avoid racing that run's
  own live-sync).
- **`OutputCache` no longer multiplies disk usage by the branch count when
  the same object is legitimately shared by reference across ports/chunks**
  (e.g. `scene_focus_path`'s `{ tree, focus }` output, 125 branches sharing
  one `tree` object) — this predates and is a strict subset of the blob-store
  work above (reference-identity dedup within one `write()` call, no
  hashing). `output-cache.ts`: `dedupeTopLevel`/`writeChunk` replace a
  same-reference repeat with a `SharedRef` pointer; `readDataChunks`'s
  `resolveSharedRefs` restores it. Tests: `storage.test.ts` (+2: 125-branch
  shared-tree round-trip stays under 2MB on disk vs. ~125MB; two
  content-equal-but-distinct objects are *not* collapsed).

### Deferred
- Recursive content-hash dedup showed **limited or negative** disk/wire
  benefit on this app's real `add_child` merge-chain data (60×60: blob count
  24→295, disk 766.8KB→1522KB; 200×200: envelope 142.9MB→465.57MB, larger
  than before) — position-dependent path/version churn defeats subtree
  reuse, and fine-grained splitting loses whole-payload gzip efficiency. Not
  pursued further this round; see `wb-scene-generator-scene-tree-storage.md`
  §8 for the full data and the alternative directions considered (viewport
  tile-ization, content-addressing independent of position/version).
- `/execute`'s full-graph HTTP response can still hit V8's `Invalid string
  length` at 200×200 scale (pre-existing, independent of this batch of
  work) — needs a response-level byte budget (return execution status only,
  values fetched separately) rather than a per-port one. Not implemented.
- **Note on shared-file contamination:** at commit time, several files this
  entry touches were *also* carrying unrelated in-flight changes from a
  different, concurrently-edited feature (multi-game project scoping —
  `activeGameSlug`/`showAllProjects`/`projectSwitchRole`/`gameSlug` on
  `ProjectMeta`/`listProjects`/`createProject`/`updateProject`):
  `packages/node-runtime-react/src/editor/stores/projectStore.ts`,
  `packages/node-runtime/src/layer2/project-registry.ts`,
  `packages/node-runtime-react/src/api/ApiClient.ts`,
  `packages/node-runtime-react/src/editor/transport/apiAdapter.ts`,
  `apps/wb-scene-generator/frontend/src/api/HttpApiClient.ts`. Those
  fields/branches are **not** part of this entry and are not described
  above; whoever owns that feature still owes it its own CHANGELOG entry. In
  `projectStore.ts`/`project-registry.ts` the interleaving is at the
  statement level within shared functions (`switchProject`, `viewProject`),
  not separable into independent hunks; in the other three it happens to sit
  in separate hunks but was left as one commit rather than hand-split, since
  splitting risked misrepresenting either feature's actual tested state.
  This commit necessarily includes both features' current on-disk state.
