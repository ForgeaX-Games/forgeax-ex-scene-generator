import { memo, useCallback } from 'react'
import { useUIStore } from '../../stores/index.js'
import type { Battery } from '../../types.js'
import { getDragGhostCanvas } from './batteryBarDragGhost.js'
import { writeBatteryDragPayload } from './batteryDragPayload.js'
import {
  cancelBatteryPointerDrag,
  shouldUseBatteryPointerDrag,
  startBatteryPointerDrag,
} from './batteryPointerDrag.js'
import { PresetXIcon } from './batteryBarIcons.js'

// ── 文本预设面板（嵌在大标签栏「预设」列下） ──────────────────────────────────
// 展示已保存的文本预设（内置 + 用户，来自后端双源），支持拖拽到画布生成预填文字
// 的 text_panel 节点；用户预设可删除，内置预设只读。拖拽载荷沿用旧实现
// （application/battery + application/preset-text），由 useCanvasDrop 消费。
export interface PresetsRailPanelProps {
  batteries: Battery[]
  langMode: string
}

export const PresetsRailPanel = memo(function PresetsRailPanel({ batteries, langMode }: PresetsRailPanelProps) {
  const textPresets = useUIStore((s) => s.textPresets)
  const removeTextPreset = useUIStore((s) => s.removeTextPreset)
  const en = langMode === 'en'
  const usePointerDrag = shouldUseBatteryPointerDrag()

  // 拖拽开始：stopPropagation 阻止冒泡到父级 draggable 容器（避免其取消拖拽）。
  const handleDragStart = useCallback((e: React.DragEvent<HTMLDivElement>, text: string) => {
    e.stopPropagation()
    if (usePointerDrag) {
      e.preventDefault()
      return
    }
    cancelBatteryPointerDrag()
    const textPanelBattery = batteries.find((b) => b.id === 'text_panel')
    if (!textPanelBattery) {
      console.warn('[PresetsRailPanel] text_panel battery not found in registry')
      return
    }
    e.dataTransfer.effectAllowed = 'copy'
    writeBatteryDragPayload(e.dataTransfer, { battery: textPanelBattery, presetText: text })
    const ghost = getDragGhostCanvas()
    if (ghost) e.dataTransfer.setDragImage(ghost, 14, 14)
  }, [batteries, usePointerDrag])

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>, text: string) => {
    const textPanelBattery = batteries.find((b) => b.id === 'text_panel')
    if (textPanelBattery) startBatteryPointerDrag(e, textPanelBattery, text)
  }, [batteries])

  if (textPresets.length === 0) {
    return (
      <div className="bb-presets-empty">
        {en
          ? 'No presets. Click the bookmark on a text panel to save one.'
          : '暂无预设。在文本面板右上角点击书签按钮保存。'}
      </div>
    )
  }

  return (
    <div className="bb-presets-panel">
      {textPresets.map((preset) => (
        <div
          key={preset.id}
          className={`bb-preset-item${preset.builtin ? ' bb-preset-item--builtin' : ''}`}
          draggable={!usePointerDrag}
          onPointerDown={(e) => handlePointerDown(e, preset.text)}
          onDragStart={(e) => handleDragStart(e, preset.text)}
          title={preset.text}
        >
          <div className="bb-preset-body">
            {preset.title && (
              <div className="bb-preset-title">
                {preset.builtin && (
                  <span className="bb-preset-badge" aria-hidden>
                    {en ? 'Built-in' : '内置'}
                  </span>
                )}
                <span className="bb-preset-title-text">{preset.title}</span>
              </div>
            )}
            <div className="bb-preset-text">{preset.text}</div>
          </div>
          {!preset.builtin && (
            <button
              type="button"
              className="bb-preset-delete"
              onClick={(e) => { e.stopPropagation(); removeTextPreset(preset.id) }}
              title={en ? 'Delete preset' : '删除此预设'}
            >
              <PresetXIcon size={12} />
            </button>
          )}
        </div>
      ))}
    </div>
  )
})
