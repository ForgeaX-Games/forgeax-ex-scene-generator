/**
 * BakerError —— baker 服务专用错误类型。
 *
 * 拆出来不和别的 Error 混在一起的好处：
 *   - baker.service 可以 instanceof 判断是"参数问题（用户应当能修）"还是
 *     "OCCT/WASM 内部异常（用户基本只能换参数避开）"。
 *   - HTTP / WebSocket 层把 BakerError 翻译成业务级提示，把别的 Error 翻译成
 *     "服务器内部错误"。
 */
export class BakerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BakerError';
  }
}
