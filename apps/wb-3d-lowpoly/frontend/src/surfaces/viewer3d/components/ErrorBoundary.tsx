// 💡 Viewer 顶层错误边界：避免任意子组件抛错（典型为 useThreeScene 内 WebGL 创建失败）
//    把 React 整棵树 unmount 成黑屏。捕获后渲染醒目的错误浮层，并把堆栈写入 console
//    供 browserLogger 落盘，方便后续排查"窗口空白"型 Bug。
import { Component, type ReactNode } from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

interface ErrorBoundaryProps {
  children: ReactNode
}

export class ViewerErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    console.error('[viewer] uncaught render error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: '#070b08',
            color: '#f3f7ee',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '32px',
            fontFamily:
              "'PingFang SC', 'Microsoft YaHei', 'Inter', system-ui, sans-serif",
            gap: '16px',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '20px', fontWeight: 600, color: '#f04e52' }}>
            URDF Viewer crashed during render
          </div>
          <div style={{ fontSize: '14px', color: '#9aa894', maxWidth: '720px' }}>
            {this.state.error?.message ?? 'unknown error'}
          </div>
          <pre
            style={{
              fontSize: '12px',
              color: '#667260',
              maxWidth: '720px',
              maxHeight: '40vh',
              overflow: 'auto',
              textAlign: 'left',
              padding: '12px',
              background: '#101912',
              borderRadius: '8px',
              border: '1px solid #263326',
            }}
          >
            {this.state.error?.stack ?? ''}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              padding: '8px 18px',
              fontSize: '13px',
              borderRadius: '6px',
              cursor: 'pointer',
              background: '#d4ff48',
              color: '#070b08',
              border: 'none',
              fontWeight: 600,
            }}
          >
            Reload viewer
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
