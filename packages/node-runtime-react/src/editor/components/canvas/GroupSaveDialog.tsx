// Save-group-as-battery dialog: enter a category (folder) and battery name, then
// save the collapsed group as a reusable battery. Ported from the legacy editor
// (components/canvas/GroupSaveDialog.tsx).
//
import { useState, useCallback, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { NodeGroup } from '../../types.js'
import { usePipelineStore } from '../../stores/index.js'
import { useUIStore } from '../../stores/index.js'
import { getEditorTransport } from '../../transport/index.js'
import { collectNestedDependencies } from './groupViewUtils.js'
import { computeGroupContentHash, writeGroupProvenance, readGroupProvenance } from './groupStatus.js'
import './GroupSaveDialog.css'

interface GroupSaveDialogProps {
  group: NodeGroup
  onClose: () => void
  /** Save-success callback; receives the saved category + battery name. */
  onSaved?: (categoryName: string, batteryName: string) => void
}

/**
 * Persist a group to the battery library AND stamp provenance back onto the
 * group's `__group__` shadow node so its save status becomes `saved`. Shared by
 * the save dialog (first save / save-as) and the GroupNode overwrite path
 * (re-saving an already-sourced group without a dialog).
 *
 * Writing to `groups/<cat>/<name>/<name>.json` is idempotent on the backend, so
 * calling this again with the same category + name overwrites in place.
 */
export async function saveGroupToLibrary(
  group: NodeGroup,
  categoryName: string,
  batteryName: string,
  en: boolean,
  /**
   * The STABLE library battery id to write back to. Passed on an overwrite
   * (re-saving a group that was dragged out / previously saved) so the disk
   * file and the catalog row keep their original id instead of churning to the
   * volatile remapped instance id. Omitted on a first save → the instance id
   * becomes the library id.
   */
  sourceGroupId?: string,
): Promise<void> {
  const { renameGroup, updateNode, batteries, setBatteries, currentPipeline } = usePipelineStore.getState()
  renameGroup(group.id, batteryName)

  // The library entry has a stable identity independent of the canvas instance:
  // on overwrite we reuse the original library id, on first save we adopt the
  // instance id as the new library id.
  const libraryId = sourceGroupId ?? group.id

  // Collect nested dependencies so the saved group is self-contained on reload.
  const lookup = (gid: string) => (currentPipeline?.groups ?? []).find((g) => g.id === gid)
  const nested = collectNestedDependencies(group, lookup)
  const groupToSave: NodeGroup = nested.length > 0 ? { ...group, _nestedGroups: nested } : group
  // Write the file under the STABLE library id so re-listing always yields the
  // same battery id (inner node/edge ids stay as-is — they are remapped fresh on
  // the next drag-out anyway).
  const savedGroup = { ...groupToSave, id: libraryId, name: batteryName, nameEn: batteryName }

  await getEditorTransport().api.saveGroupTemplate({
    group: savedGroup,
    categoryName,
    batteryName,
  })

  // Stamp provenance onto the shadow node: source location + stable library id
  // (for later overwrite) + the content hash at save time (so the status reads
  // `saved` until the user edits the group again). Read the LIVE group
  // (renameGroup just mutated name).
  const liveGroup = (usePipelineStore.getState().currentPipeline?.groups ?? []).find((g) => g.id === group.id) ?? group
  const newHash = computeGroupContentHash(liveGroup)
  const shadow = usePipelineStore.getState().currentPipeline?.nodes.find((n) => n.id === group.id)
  if (shadow) {
    updateNode(group.id, {
      params: writeGroupProvenance(shadow.params, {
        sourceCategory: categoryName,
        sourceBatteryName: batteryName,
        sourceGroupId: libraryId,
        savedContentHash: newHash,
      }),
    })
  }

  // Multi-instance consistency: `saved` means "matches the CURRENT library
  // content". This save just rewrote the library file, so re-baseline every
  // OTHER on-canvas instance that points to the same library entry to the new
  // content hash. A sibling whose live content no longer matches the new library
  // version then renders `unsaved*` (diverged from library); one that happens to
  // match stays `saved`. Without this an untouched sibling would keep a stale
  // `saved` badge while differing from what's actually in the library.
  const pipelineNow = usePipelineStore.getState().currentPipeline
  for (const sib of pipelineNow?.nodes ?? []) {
    if (sib.id === group.id) continue
    const sibProv = readGroupProvenance(sib.params)
    if (!sibProv.sourceGroupId || sibProv.sourceGroupId !== libraryId) continue
    if (sibProv.savedContentHash === newHash) continue
    updateNode(sib.id, {
      params: writeGroupProvenance(sib.params, { savedContentHash: newHash }),
    })
  }

  // Optimistic update: inject the saved group into the battery catalog so it
  // appears in the BatteryBar immediately. Match the existing row by the stable
  // library id OR by (category + name) so an overwrite REPLACES the original
  // entry instead of appending a duplicate keyed on the remapped instance id.
  const existingIdx = batteries.findIndex(
    (b) => b.id === libraryId || (b.type === 'group' && b.category === categoryName && b.name === batteryName),
  )
  const groupBattery = {
    id: libraryId,
    name: batteryName,
    nameEn: batteryName,
    type: 'group' as const,
    category: categoryName,
    displayGroup: `groups/${categoryName}`,
    description: en ? `Group battery: ${batteryName}` : `成组电池：${batteryName}`,
    version: '1.0.0',
    inputs: [],
    outputs: [],
    params: [],
  }
  if (existingIdx >= 0) {
    const updated = [...batteries]
    updated[existingIdx] = groupBattery
    setBatteries(updated)
  } else {
    setBatteries([...batteries, groupBattery])
  }

  usePipelineStore.getState().schedulePersistSession('group-save-provenance')
}

/**
 * Return a battery name that does not collide with an existing group battery in
 * `categoryName`. If `desired` is free it is returned as-is; otherwise the first
 * available `desired (n)` (n = 1, 2, …) is returned so the older battery is
 * never overwritten.
 */
function dedupeBatteryName(categoryName: string, desired: string): string {
  const existing = new Set(
    usePipelineStore
      .getState()
      .batteries.filter((b) => b.type === 'group' && b.category === categoryName)
      .map((b) => b.name),
  )
  if (!existing.has(desired)) return desired
  let n = 1
  while (existing.has(`${desired} (${n})`)) n++
  return `${desired} (${n})`
}

export function GroupSaveDialog({ group, onClose, onSaved }: GroupSaveDialogProps) {
  const en = useUIStore((s) => s.langMode) === 'en'

  const [categories, setCategories] = useState<string[]>([])
  const [categoryInput, setCategoryInput] = useState('')
  const [batteryName, setBatteryName] = useState(group.name || (en ? 'Group Node' : '组合节点'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const categoryInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void getEditorTransport().api.listTemplateCategories()
      .then((cats) => setCategories([...cats].sort()))
      .catch(() => {
        const cats = Array.from(
          new Set(
            usePipelineStore
              .getState()
              .batteries.filter((b) => b.type === 'group' && b.category)
              .map((b) => b.category as string),
          ),
        ).sort()
        setCategories(cats)
      })
    setTimeout(() => categoryInputRef.current?.focus(), 50)
  }, [])

  const handleSave = useCallback(async () => {
    const cat = categoryInput.trim()
    const name = batteryName.trim()
    if (!cat) { setError(en ? 'Category name is required' : '请填写标签名'); return }
    if (!name) { setError(en ? 'Battery name is required' : '请填写电池名'); return }

    setSaving(true)
    setError('')
    try {
      // First save / save-as via this dialog never overwrites: if a group
      // battery with this name already exists in the chosen category, append a
      // ` (n)` suffix so the older battery is preserved. (In-place overwrite of
      // an already-sourced group goes through GroupNode, not this dialog.)
      const uniqueName = dedupeBatteryName(cat, name)
      await saveGroupToLibrary(group, cat, uniqueName, en)
      onSaved?.(cat, uniqueName)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }, [categoryInput, batteryName, group, onSaved, onClose, en])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'Enter' && !saving) void handleSave()
  }, [onClose, handleSave, saving])

  // Only close when the mousedown truly lands on the overlay itself. Otherwise,
  // dragging to select text inside an input and releasing outside the modal makes
  // the browser dispatch the click to the nearest common ancestor (the overlay),
  // which would mis-close the dialog mid-edit.
  const handleOverlayMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }, [onClose])

  return createPortal(
    <div className="gsd-overlay" onMouseDown={handleOverlayMouseDown} onKeyDown={handleKeyDown}>
      <div className="gsd-modal">
        <div className="gsd-header">
          <span className="gsd-title">{en ? 'Save Group Battery' : '保存成组电池'}</span>
          <button className="gsd-close" onClick={onClose}>✕</button>
        </div>

        <div className="gsd-body">
          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Category (folder name)' : '标签名（分类文件夹）'}</label>
            <input
              ref={categoryInputRef}
              className="gsd-input"
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              placeholder={en ? 'Enter new category or select below…' : '输入新分类或从下方选择…'}
              list="gsd-categories-list"
              onKeyDown={handleKeyDown}
            />
            <datalist id="gsd-categories-list">
              {categories.map((cat) => (
                <option key={cat} value={cat} />
              ))}
            </datalist>
            {categories.length > 0 && (
              <div className="gsd-chips">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`gsd-chip${categoryInput === cat ? ' gsd-chip--active' : ''}`}
                    onClick={() => setCategoryInput(cat)}
                    type="button"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="gsd-field">
            <label className="gsd-label">{en ? 'Battery name' : '电池名'}</label>
            <input
              className="gsd-input"
              value={batteryName}
              onChange={(e) => setBatteryName(e.target.value)}
              placeholder={en ? 'Enter battery name…' : '输入电池名称…'}
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
