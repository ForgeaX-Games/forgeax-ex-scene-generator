/**
 * ImagePreview 电池执行函数
 *
 * 行为：透传上游 image（图像资产 alias 或 base64 data URL）到输出端口，
 *      不做任何实际计算 —— 真正的「预览」由前端自定义节点 ImagePreviewNode 渲染。
 *      串联到任意输出 image 的节点（image_reader / asset_export / AI 生图等）后，
 *      可在画布上直观看到该图像，且不打断下游连线。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function imagePreview(input: Record<string, unknown>): Record<string, unknown> {
  const image = typeof input.image === 'string' && input.image.trim()
    ? input.image.trim()
    : null

  if (!image) {
    return { error: 'No upstream image connected. Connect an image-typed output to this node.' }
  }

  return { image }
}
