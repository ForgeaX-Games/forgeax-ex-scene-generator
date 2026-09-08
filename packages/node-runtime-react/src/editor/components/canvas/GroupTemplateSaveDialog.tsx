// Save-group-as-USER-template dialog: enter a small tag (sub-folder) + template
// name, then save the collapsed group as user content under the fixed
// "My templates" big-label. Reuses GroupSaveDialog's `.gsd-*` styling so the
// panel matches the regular group-save dialog.
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { NodeGroup } from '../../types.js'
import { usePipelineStore, useUIStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import { collectNestedDependencies } from './groupViewUtils.js'
import { isTemplateBattery, getTemplateSubfolder } from '../sidebar/batteryGrouping.js'
import './GroupSaveDialog.css'

/** Fixed big-label that all user templates live under (matches the backend). */
export const USER_TEMPLATE_BIG_LABEL = 'My templates'

interface GroupTemplateSaveDialogProps {
  group: NodeGroup
  onClose: () => void
  /** Save-success callback; receives the small tag + template name. */
  onSaved?: (smallTag: string, templateName: string) => void
}

export function GroupTemplateSaveDialog({ group, onClose, onSaved }: GroupTemplateSaveDialogProps) {
  const en = useUIStore((s) => s.langMode) === 'en'
  const batteries = usePipelineStore((s) => s.batteries)

  const [smallTagInput, setSmallTagInput] = useState('')
  const [templateName, setTemplateName] = useState(group.name || (en ? 'My Template' : '我的模板'))
  const [authorInput, setAuthorInput] = useState(group.author ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const tagInputRef = useRef<HTMLInputElement>(null)

  // Existing user-template small tags (sub-folders under "My templates"), so the
  // user can reuse one instead of typing it again.
  const existingTags = useMemo(() => {
    const tags = new Set<string>()
    for (const b of batteries) {
      if (!isTemplateBattery(b)) continue
      if (b.category !== USER_TEMPLATE_BIG_LABEL) continue
      tags.add(getTemplateSubfolder(b))
    }
    return [...tags].sort()
  }, [batteries])

  useEffect(() => {
    setTimeout(() => tagInputRef.current?.focus(), 50)
  }, [])

  const handleSave = useCallback(async () => {
    const tag = smallTagInput.trim()
    const name = templateName.trim()
    const author = authorInput.trim()
    if (!tag) { setError(en ? 'Small tag is required' : '请填写小标签'); return }
    if (!name) { setError(en ? 'Template name is required' : '请填写模板名称'); return }

    setSaving(true)
    setError('')
    try {
      // Collect nested dependencies so the saved template is self-contained.
      const { currentPipeline } = usePipelineStore.getState()
      const lookup = (gid: string) => (currentPipeline?.groups ?? []).find((g) => g.id === gid)
      const nested = collectNestedDependencies(group, lookup)
      const groupToSave: NodeGroup =
        nested.length > 0 ? { ...group, _nestedGroups: nested } : group
      const savedGroup = {
        ...groupToSave,
        name,
        nameEn: name,
        ...(author ? { author } : {}),
      }

      await getEditorTransport().api.saveUserTemplate({
        group: savedGroup,
        smallTag: tag,
        templateName: name,
      })
      // Refresh the catalog so the new template appears in the Templates palette.
      await usePipelineStore.getState().loadBatteries()
      onSaved?.(tag, name)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [smallTagInput, templateName, authorInput, group, onSaved, onClose, en])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !saving) void handleSave()
  }, [onClose, handleSave, saving])

  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return createPortal(
    <div className="gsd-overlay" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className="gsd-modal">
        <div className="gsd-header">
          <span className="gsd-title">{en ? 'Save to Templates' : '保存到模板'}</span>
          <button className="gsd-close" onClick={onClose}>✕</button>
        </div>

        <div className="gsd-body">
          <div className="gsd-field">
            <label className="gsd-label">
              {en ? `Small tag (under "${USER_TEMPLATE_BIG_LABEL}")` : `小标签（归于「${USER_TEMPLATE_BIG_LABEL}」下）`}
            </label>
            <input
              ref={tagInputRef}
              className="gsd-input"
              value={smallTagInput}
              onChange={(e) => setSmallTagInput(e.target.value)}
              placeholder={en ? 'Enter a small tag or pick below…' : '输入小标签或从下方选择…'}
              list="gtsd-tags-list"
              onKeyDown={handleKeyDown}
            />
            <datalist id="gtsd-tags-list">
              {existingTags.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
            {existingTags.length > 0 && (
              <div className="gsd-chips">
                {existingTags.map((tag) => (
                  <button
                    key={tag}
                    className={`gsd-chip${smallTagInput === tag ? ' gsd-chip--active' : ''}`}
                    onClick={() => setSmallTagInput(tag)}
                    type="button"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Template name' : '模板名称'}</label>
            <input
              className="gsd-input"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={en ? 'Enter template name…' : '输入模板名称…'}
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Author' : '作者'}</label>
            <input
              className="gsd-input"
              value={authorInput}
              onChange={(e) => setAuthorInput(e.target.value)}
              placeholder={en ? 'Enter author name (optional)…' : '输入作者名称（可选）…'}
              onKeyDown={handleKeyDown}
            />
          </div>

          {error && <div className="gsd-error">{error}</div>}
        </div>

        <div className="gsd-footer">
          <button className="gsd-btn gsd-btn--cancel" onClick={onClose} disabled={saving}>{en ? 'Cancel' : '取消'}</button>
          <button className="gsd-btn gsd-btn--save" onClick={handleSave} disabled={saving}>
            {saving ? (en ? 'Saving…' : '保存中…') : (en ? 'Save' : '保存')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
