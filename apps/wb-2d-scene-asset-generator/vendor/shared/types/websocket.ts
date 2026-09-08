/**
 * 跨层级共享的 WebSocket 通信契约。
 *
 * 包含三部分：
 *   1. WSChannel  — 后端三个 WS 通道枚举
 *   2. WSMessage  — 标准报文外壳
 *   3. WS_EVENTS  — 所有事件名常量（消除 magic string）
 */

/** 后端 WebSocket 通道：在 main.ts 中分别挂载到 /ws/render /ws/editor /ws/log */
export type WSChannel = 'render' | 'editor' | 'log';

/** 任何推流报文都包装为统一外壳 */
export interface WSMessage {
  event: WSEventName | string;
  pipelineId?: string;
  timestamp?: number;
  payload?: Record<string, unknown>;
}

/**
 * 所有 WS 事件名的单一定义源。
 * 新增事件请加到此对象，使用 WS_EVENTS.xxx 替代 magic string。
 */
export const WS_EVENTS = {
  // ── 节点与管线执行 ─────────────────────────────────────────────
  /** 节点计算结果（核心数据流；多项目下 pipelineId 即 projectId） */
  NODE_OUTPUT: 'node:output',
  /** 单个节点执行状态变化（目前未消费） */
  NODE_STATUS: 'node:status',
  /** 节点动态输出端口结构变化 */
  NODE_PORTS_UPDATED: 'node:ports_updated',
  /** 整条管线执行状态变化（running/completed/error） */
  PIPELINE_STATUS: 'pipeline:status',
  /** 切换项目时立即广播，前端清缓存 */
  PIPELINE_OUTPUTS_CLEARED: 'pipeline:outputs_cleared',

  // ── 多项目 ──────────────────────────────────────────────────
  /** 多项目激活变更 */
  PROJECT_ACTIVATED: 'project:activated',
  /** 会话图结构变更（兼容遗留） */
  SESSION_UPDATED: 'session:updated',

  // ── 电池热更新 ──────────────────────────────────────────────
  /** 电池目录变化（增/删/改/重命名） */
  BATTERIES_UPDATED: 'batteries:updated',

  // ── 资产库 ─────────────────────────────────────────────────
  /** 资产库变更（payload: action, alias, projectId, zone） */
  LIBRARY_UPDATED: 'library:updated',
  /** AI Agent 请求把资产导入编辑器画布 */
  EDITOR_IMPORT_ASSET: 'editor:import_asset',

  // ── AI Agent → 编辑器 ─────────────────────────────────────
  /** AI Agent 画布操作指令（addNode / removeNodes / addEdge / updateParams 等） */
  CANVAS_OP: 'canvas:op',

  // ── 渲染器控制（AI Agent → 渲染器） ────────────────────────
  RENDERER_SET_VIEW_MODE: 'renderer:set_view_mode',
  RENDERER_SELECT_LAYER: 'renderer:select_layer',
  /** AI Agent 请求打开渲染器窗口 */
  RENDERER_OPEN: 'renderer:open',

  // ── URDF Viewer 控制 ─────────────────────────────────────
  /** urdf_preview 电池 / AI Agent 请求打开内嵌 URDF Viewer 面板 */
  VIEWER_OPEN: 'viewer:open',

  // ── 编辑器 ↔ 渲染器双向同步 ────────────────────────────────
  /** 选中状态双向同步 */
  EDITOR_SELECTION: 'editor:selection',
  /** 节点预览开关变化（前端→后端→广播） */
  PREVIEW_CHANGE: 'preview:change',
  /** 一键开启所有子图层 */
  EDITOR_SUBLAYER_OPENALL: 'editor:sublayer:openall',
  /** 编辑器语言切换通知（影响渲染器中文本/标签显示） */
  EDITOR_LANG_MODE: 'editor:lang_mode',
  /** 渲染器图层可见性变化 */
  RENDERER_LAYER_TOGGLE: 'renderer:layer:toggle',
  /** 渲染器子图层可见性变化 */
  RENDERER_SUBLAYER_TOGGLE: 'renderer:sublayer:toggle',

  // ── 截图（AI Agent ↔ 渲染器） ──────────────────────────────
  /** 截图请求 */
  SCREENSHOT_REQUEST: 'screenshot:request',
  /** 渲染器回传截图 base64 */
  SCREENSHOT_STORE: 'screenshot:store',

  // ── 日志与错误 ─────────────────────────────────────────────
  LOG_MESSAGE: 'log:message',
  ERROR_NODE: 'error:node',
  ERROR_PIPELINE: 'error:pipeline',

  // ── 通用控制 ──────────────────────────────────────────────
  PING: 'ping',
  PONG: 'pong',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  /** 订阅 / 退订成功响应 */
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
} as const;

/** 所有合法事件名的联合类型，由 WS_EVENTS 自动派生 */
export type WSEventName = typeof WS_EVENTS[keyof typeof WS_EVENTS];
