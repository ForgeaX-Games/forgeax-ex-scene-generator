// 💡 三维视口容器：把 useViewer3DScene 注入的 THREE 渲染目标承载到 DOM；负责空态/错误/加载浮层
import { forwardRef } from 'react'
import { Box } from 'lucide-react'
import { useViewerI18n } from '../../i18n/strings'
import './ViewerCanvas.css'

interface ViewerCanvasProps {
  error: string | null
  loading: boolean
  hasModel: boolean
}

const ViewerCanvas = forwardRef<HTMLDivElement, ViewerCanvasProps>(function ViewerCanvas(
  { error, loading, hasModel },
  ref,
) {
  const t = useViewerI18n()
  return (
    <>
      <div ref={ref} className="viewer-canvas-host" />
      {!hasModel && !error && (
        <div className="viewer-canvas-empty">
          <Box size={48} strokeWidth={1.2} />
          <div className="viewer-canvas-empty-title">{t.canvas.emptyTitle}</div>
          <div className="viewer-canvas-empty-sub">
            {t.canvas.emptySubPrefix}
            <b>{t.canvas.emptySubMid1}</b>
            {t.canvas.emptySubSuffix}
          </div>
        </div>
      )}
      {error && (
        <div className="viewer-canvas-error" title={error}>{error}</div>
      )}
      {loading && (
        <div className="viewer-canvas-loading">{t.canvas.loadingMesh}</div>
      )}
    </>
  )
})

export default ViewerCanvas
