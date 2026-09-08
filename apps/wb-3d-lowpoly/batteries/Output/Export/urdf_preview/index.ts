/**
 * urdf_preview —— URDF XML 字符串预览电池。
 *
 * 行为：
 *   - 接收 urdf 字符串输入（通常来自 g_to_urdf 的 urdf 输出端口）
 *   - 原样透传到 urdf 输出端口（用于级联其他文本/导出节点）
 *   - 副作用：通过 NODE_OUTPUT WS 广播，让 URDF Viewer iframe / 独立窗口（9558）
 *     接收并自动展开预览（识别由 batteryId='urdf_preview' 完成；详见
 *     editor/src/App.tsx 与 viewer/src/services/wsService.ts）
 *
 * 注意：这个电池本身只做 passthrough，不做编译或校验。无效 URDF 由
 *      Viewer 端解析时报错并展示。
 */

export function urdfPreview(input: Record<string, unknown>): Record<string, unknown> {
  const urdf = typeof input.urdf === 'string' ? input.urdf : '';
  return { urdf };
}

export default urdfPreview;
