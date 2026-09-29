/** Client batchId prefix for slider/inspector param writes. Preview param-drag lane. */
export const LOCAL_PARAM_EDIT_BATCH_PREFIX = 'editor-param-'

export function isLocalParamEditBatch(batchId: string | undefined | null): boolean {
  return typeof batchId === 'string' && batchId.startsWith(LOCAL_PARAM_EDIT_BATCH_PREFIX)
}
