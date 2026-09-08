import { useCallback, useMemo, useState } from 'react'
import { bakedApi } from '../renderer/bridge/bakedApi.js'
import { refreshBakedLayers } from '../renderer/bridge/useBakedLayers.js'
import { ATTRIBUTE_TEMPLATES } from '../surfaces/library/attributeTemplates.js'
import { useAssetStoreStore } from '../surfaces/library/assetStoreStore.js'
import { libraryApi } from '../surfaces/library/libraryApi.js'
import { aliasItemName } from '../surfaces/library/paintAssetBus.js'
import {
  buildLayerInspectorViewModel,
  mergeTemplateAttributes,
  parseAttrInput,
  type SelectedLayerSnapshot,
} from '../surfaces/library/layerInspector.js'
import { RESERVED_BAKED_ATTRIBUTE_KEYS } from '../surfaces/library/reservedAttributes.js'

function displayField<T>(value: T | 'mixed'): string {
  return value === 'mixed' ? 'mixed' : String(value ?? '—')
}

interface Props {
  layers: SelectedLayerSnapshot[]
}

export function PreviewLayerInspector({ layers }: Props): JSX.Element {
  const vm = useMemo(() => buildLayerInspectorViewModel(layers), [layers])
  const assets = useAssetStoreStore((s) => s.assets)
  const bakedPaths = useMemo(
    () => layers.filter((l) => l.kind === 'baked').map((l) => l.nodePath),
    [layers],
  )
  const [templateId, setTemplateId] = useState(ATTRIBUTE_TEMPLATES[0]?.id ?? '')
  const [status, setStatus] = useState<string | null>(null)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')

  const applyPatch = useCallback(async (attributes: Record<string, unknown>, overwrite?: boolean) => {
    if (bakedPaths.length === 0) return
    setStatus(null)
    try {
      await bakedApi.patchAttributes(bakedPaths, attributes, { overwrite })
      await refreshBakedLayers({ mode: 'full' })
      setStatus('Saved')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }, [bakedPaths])

  const onApplyTemplate = useCallback(async () => {
    const tpl = ATTRIBUTE_TEMPLATES.find((t) => t.id === templateId)
    if (!tpl || bakedPaths.length === 0) return
    setStatus(null)
    try {
      let applied = 0
      for (const path of bakedPaths) {
        const layer = layers.find((l) => l.nodePath === path && l.kind === 'baked')
        if (!layer) continue
        const merged = mergeTemplateAttributes(layer.attributes, tpl.attributes, false)
        const diff: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(merged)) {
          if (!Object.prototype.hasOwnProperty.call(layer.attributes, k)) diff[k] = v
        }
        if (Object.keys(diff).length > 0) {
          await bakedApi.patchAttributes([path], diff)
          applied++
        }
      }
      if (applied === 0) {
        setStatus('No new fields to apply')
        return
      }
      await refreshBakedLayers({ mode: 'full' })
      setStatus('Template applied')
    } catch (e) {
      setStatus((e as Error).message)
    }
  }, [templateId, bakedPaths, layers])

  const onAddCustom = useCallback(async () => {
    const key = newKey.trim()
    if (!key || RESERVED_BAKED_ATTRIBUTE_KEYS.has(key)) {
      setStatus('Invalid or reserved key')
      return
    }
    try {
      const value = parseAttrInput(newValue)
      await applyPatch({ [key]: value })
      setNewKey('')
      setNewValue('')
    } catch (e) {
      setStatus(`Invalid value: ${(e as Error).message}`)
    }
  }, [newKey, newValue, applyPatch])

  if (layers.length === 0) {
    return (
      <div className="scene-left-pane__layer-inspector scene-left-pane__layer-inspector--empty">
        <p className="scene-left-pane__hint">Select a layer in the Preview panel to inspect it here.</p>
      </div>
    )
  }

  const title = vm.selectionCount === 1 && vm.nodeName !== 'mixed'
    ? String(vm.nodeName)
    : `${vm.selectionCount} layers`
  const assetName = vm.assetName !== 'mixed' ? String(vm.assetName ?? '') : ''
  const snapshotAlias = layers.length === 1 ? layers[0].assetAlias : undefined
  const matchedAsset = assetName
    ? assets.find((a) => aliasItemName(a.alias) === assetName || a.alias === assetName)
    : undefined
  const assetAlias = snapshotAlias ?? matchedAsset?.alias

  return (
    <div className="scene-left-pane__layer-inspector">
      <div className="scene-left-pane__inspector-hero">
        <AssetPreview
          assetName={assetName}
          assetAlias={assetAlias}
          assetListLoaded={assets.length > 0}
          mixed={vm.assetName === 'mixed'}
        />
        <div className="scene-left-pane__inspector-title">
          <div className="scene-left-pane__rule-head">
            <h2>{title}</h2>
            <span className={`scene-left-pane__rule-schema${vm.allBaked ? '' : ' is-output'}`}>
              {vm.bakedCount > 0 && vm.outputCount > 0
                ? `${vm.bakedCount} editable · ${vm.outputCount} output`
                : vm.allBaked ? 'editable' : 'output'}
            </span>
          </div>
          {vm.selectionCount > 1 && (
            <code className="scene-left-pane__rule-alias">{vm.commonPath}</code>
          )}
          {vm.selectionCount === 1 && vm.nodePath !== 'mixed' && (
            <code className="scene-left-pane__rule-alias">{String(vm.nodePath)}</code>
          )}
        </div>
      </div>

      <div className="scene-left-pane__inspector-card">
        <h3 className="scene-left-pane__inspector-sub">Scene node</h3>
        <dl className="scene-left-pane__rule-meta">
          {vm.selectionCount > 1 && (
            <div><dt>Selection</dt><dd>{vm.selectionCount} layers</dd></div>
          )}
          <div><dt>Schema</dt><dd>{displayField(vm.schema)}</dd></div>
          <div><dt>Value</dt><dd>{displayField(vm.value)}</dd></div>
          <div><dt>Asset</dt><dd>{displayField(vm.assetName)}</dd></div>
          <div><dt>Type</dt><dd>{displayField(vm.assetType)}</dd></div>
        </dl>
      </div>

      <div className="scene-left-pane__inspector-card">
        <h3 className="scene-left-pane__inspector-sub">Voxels</h3>
        <dl className="scene-left-pane__rule-meta scene-left-pane__metric-grid">
          <div><dt>Cells</dt><dd>{displayField(vm.voxelStats.cellCount)}</dd></div>
          <div><dt>X</dt><dd>{displayField(vm.voxelStats.xRange)}</dd></div>
          <div><dt>Y</dt><dd>{displayField(vm.voxelStats.yRange)}</dd></div>
          <div><dt>Z</dt><dd>{displayField(vm.voxelStats.zRange)}</dd></div>
          <div><dt>Tokens</dt><dd>{displayField(vm.voxelStats.tokenCount)}</dd></div>
        </dl>
      </div>

      {vm.reservedAttrs.length > 0 && (
        <div className="scene-left-pane__inspector-card">
          <h3 className="scene-left-pane__inspector-sub">Reserved attributes</h3>
          <dl className="scene-left-pane__rule-meta scene-left-pane__attr-list">
            {vm.reservedAttrs.map((row) => (
              <div key={row.key}><dt>{row.key}</dt><dd>{displayField(row.value)}</dd></div>
            ))}
          </dl>
        </div>
      )}

      <div className="scene-left-pane__inspector-card">
        <h3 className="scene-left-pane__inspector-sub">Custom attributes</h3>
        {!vm.canEditCustom && (
          <p className="scene-left-pane__hint">Output layers are read-only. Bake to edit custom attributes.</p>
        )}
        {vm.canEditCustom && vm.outputCount > 0 && (
          <p className="scene-left-pane__hint">
            Applies to {vm.bakedCount} editable layer{vm.bakedCount === 1 ? '' : 's'}; {vm.outputCount} output layer{vm.outputCount === 1 ? '' : 's'} skipped.
          </p>
        )}
        {vm.customAttrs.length === 0 ? (
          <p className="scene-left-pane__hint">No custom attributes yet.</p>
        ) : (
          <dl className="scene-left-pane__rule-meta scene-left-pane__attr-list">
            {vm.customAttrs.map((row) => (
              <CustomAttrRow
                key={row.key}
                row={row}
                disabled={!row.editable || bakedPaths.length === 0}
                onSave={(value) => applyPatch({ [row.key]: value })}
              />
            ))}
          </dl>
        )}

        {vm.canEditCustom && (
          <div className="scene-left-pane__attr-add">
            <input
              type="text"
              placeholder="key"
              value={newKey}
              onChange={(e) => setNewKey(e.currentTarget.value)}
              aria-label="New attribute key"
            />
            <input
              type="text"
              placeholder="value"
              value={newValue}
              onChange={(e) => setNewValue(e.currentTarget.value)}
              aria-label="New attribute value"
            />
            <button type="button" className="editor-controls__btn" onClick={() => void onAddCustom()}>
              Add
            </button>
          </div>
        )}
      </div>

      {vm.canEditCustom && bakedPaths.length > 0 && (
        <div className="scene-left-pane__inspector-card scene-left-pane__template-apply">
          <h3 className="scene-left-pane__inspector-sub">Apply template</h3>
          <select value={templateId} onChange={(e) => setTemplateId(e.currentTarget.value)} aria-label="Attribute template">
            {ATTRIBUTE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <p className="scene-left-pane__hint">
            {ATTRIBUTE_TEMPLATES.find((t) => t.id === templateId)?.description}
          </p>
          <button type="button" className="editor-controls__btn" onClick={() => void onApplyTemplate()}>
            Apply to selection
          </button>
        </div>
      )}

      {status && <p className="scene-left-pane__inspector-status">{status}</p>}
    </div>
  )
}

function AssetPreview({
  assetName,
  assetAlias,
  assetListLoaded,
  mixed,
}: {
  assetName: string
  assetAlias?: string
  assetListLoaded: boolean
  mixed: boolean
}): JSX.Element {
  if (mixed) {
    return (
      <div className="scene-left-pane__asset-preview is-empty">
        <span className="scene-left-pane__asset-preview-label">Mixed assets</span>
      </div>
    )
  }
  if (!assetName) {
    return (
      <div className="scene-left-pane__asset-preview is-empty">
        <span className="scene-left-pane__asset-preview-label">No bound asset</span>
      </div>
    )
  }
  if (!assetAlias) {
    if (!assetListLoaded) {
      return (
        <div className="scene-left-pane__asset-preview is-empty">
          <span className="scene-left-pane__asset-preview-label">Bound asset</span>
          <strong>{assetName}</strong>
        </div>
      )
    }
    return (
      <div className="scene-left-pane__asset-preview is-missing">
        <span className="scene-left-pane__asset-preview-label">Asset not found in library</span>
        <strong>{assetName}</strong>
      </div>
    )
  }
  return (
    <div className="scene-left-pane__asset-preview">
      <img src={libraryApi.serveUrl(assetAlias)} alt={assetName} />
      <span className="scene-left-pane__asset-preview-label">Matched asset</span>
    </div>
  )
}

function CustomAttrRow({
  row,
  disabled,
  onSave,
}: {
  row: { key: string; value: string | 'mixed'; editable: boolean }
  disabled: boolean
  onSave: (value: unknown) => Promise<void>
}): JSX.Element {
  const [draft, setDraft] = useState(row.value === 'mixed' ? '' : row.value)
  if (!row.editable || row.value === 'mixed') {
    return (
      <div><dt>{row.key}</dt><dd>{row.value === 'mixed' ? 'mixed' : row.value}</dd></div>
    )
  }
  return (
    <div className="scene-left-pane__attr-row">
      <dt>{row.key}</dt>
      <dd>
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={() => {
            if (disabled || draft === row.value) return
            try {
              void onSave(parseAttrInput(draft))
            } catch { /* invalid JSON etc. */ }
          }}
        />
      </dd>
    </div>
  )
}
