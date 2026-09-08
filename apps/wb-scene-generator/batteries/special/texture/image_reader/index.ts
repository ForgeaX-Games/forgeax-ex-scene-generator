/**
 * ImageReader 电池执行函数
 *
 * 行为：将用户在节点上选择并上传到资产库的 ImageRef（node.params.imageRef，
 *       已编码为 JSON 字符串：`{"alias":...,"blobId":...}`）原样输出到 image 端口。
 *
 * 运行约定：函数名小写字母开头，入参/出参均为 Record<string, unknown>
 */
export function imageReader(input: Record<string, unknown>): Record<string, unknown> {
  const ref = typeof input.imageRef === 'string' && input.imageRef.trim()
    ? input.imageRef.trim()
    : ''

  if (!ref) {
    return { error: 'No image selected. Double-click the node to choose an image.' }
  }

  return { image: ref }
}
