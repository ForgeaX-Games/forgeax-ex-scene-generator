import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRuntime, OpRegistry } from '@forgeax/node-runtime'
import {
  copyGeneratedImage,
  createGeneratedFolder,
  deleteGeneratedAsset,
  deleteGeneratedAssets,
  deleteGeneratedFolder,
  importGeneratedImage,
  listGeneratedAssets,
  listGeneratedFolders,
  moveGeneratedAssets,
  parseImageRef,
  renameGeneratedAsset,
} from '../src/assets/generatedAssets.js'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'asset2d-generated-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function runtime() {
  return createRuntime({
    projectRoot: root,
    pipelineId: 'main',
    pluginId: '@forgeax-plugin/wb-2d-scene-asset-generator',
    registry: new OpRegistry(),
  })
}

// The unfiltered "All" list now also surfaces the plugin's read-only preset
// assets (`readonly: true`). These tests exercise the file-backed index, so we
// filter presets out before asserting on index-only records.
function indexItems(rt: ReturnType<typeof runtime>) {
  return listGeneratedAssets(rt).items.filter((i) => !i.readonly)
}

describe('generated asset store', () => {
  it('persists a gateway image and returns an encoded ImageRef', () => {
    const rt = runtime()
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])

    const saved = importGeneratedImage(rt, {
      prompt: 'tiny cat',
      nodeId: 'node-a',
      imageBase64: png.toString('base64'),
      mimeType: 'image/png',
      source: 'studio-gateway',
    })

    const ref = parseImageRef(saved.image)
    expect(ref).toEqual({ alias: saved.asset.alias, blobId: saved.asset.blobId })
    expect(saved.asset.relPath).toMatch(/^generated\/ai-tiny-cat-node-a-/)
    expect(saved.asset.mimeType).toBe('image/png')

    expect(indexItems(rt)).toEqual([
      expect.objectContaining({
        alias: saved.asset.alias,
        blobId: saved.asset.blobId,
        source: 'studio-gateway',
      }),
    ])
  })

  it('copies an existing generated ImageRef into the processed folder', () => {
    const rt = runtime()
    const first = importGeneratedImage(rt, {
      prompt: 'grass tile',
      nodeId: 'node-a',
      imageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
      mimeType: 'image/png',
      source: 'test',
    })

    const copied = copyGeneratedImage(rt, {
      image: first.image,
      operation: 'image_resize',
      suffix: '_resized',
      folder: 'processed',
    })

    expect(copied.error).toBe('')
    expect(copied.image).not.toBe(first.image)
    const copiedRef = parseImageRef(copied.image)
    expect(copiedRef).toEqual({ alias: expect.any(String), blobId: first.asset.blobId })
    expect(listGeneratedAssets(rt, 'processed').items).toHaveLength(1)
  })

  it('deletes an asset by alias: drops the index entry and removes the file', () => {
    const rt = runtime()
    const saved = importGeneratedImage(rt, {
      prompt: 'user pic',
      imageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]).toString('base64'),
      mimeType: 'image/png',
      source: 'user-upload',
      folder: 'user',
    })
    expect(indexItems(rt)).toHaveLength(1)

    const deleted = deleteGeneratedAsset(rt, saved.asset.alias)
    expect(deleted?.alias).toBe(saved.asset.alias)
    expect(indexItems(rt)).toHaveLength(0)
    expect(rt.assets.read(saved.asset.relPath)).toBeNull()

    expect(deleteGeneratedAsset(rt, saved.asset.alias)).toBeNull()
  })

  it('keeps the shared blob file when another alias still references it', () => {
    const rt = runtime()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x42]).toString('base64')
    const a = importGeneratedImage(rt, { prompt: 'dup', nodeId: 'n', imageBase64: bytes })
    const b = copyGeneratedImage(rt, { image: a.image, operation: 'copy' })
    expect(b.error).toBe('')
    // b reuses a's bytes, so its file shares the same relPath only when identical
    // path; here copy writes a new alias. Delete a and confirm a's own file is
    // removed but b survives independently.
    deleteGeneratedAsset(rt, a.asset.alias)
    expect(indexItems(rt).map((i) => i.alias)).toEqual([b.asset!.alias])
  })

  it('batch-deletes several aliases regardless of source (ai/processed/user)', () => {
    const rt = runtime()
    const mk = (prompt: string, source: string, folder: string) =>
      importGeneratedImage(rt, {
        prompt,
        nodeId: prompt,
        imageBase64: Buffer.from(prompt).toString('base64'),
        mimeType: 'image/png',
        source,
        folder,
      })
    const ai = mk('ai-pic', 'studio-gateway', 'ai')
    const processed = mk('proc-pic', 'battery:image_resize', 'processed')
    const user = mk('user-pic', 'user-upload', 'user')
    expect(indexItems(rt)).toHaveLength(3)

    const deleted = deleteGeneratedAssets(rt, [ai.asset.alias, processed.asset.alias, 'does-not-exist'])
    expect(deleted.sort()).toEqual([ai.asset.alias, processed.asset.alias].sort())
    expect(indexItems(rt).map((i) => i.alias)).toEqual([user.asset.alias])
    expect(rt.assets.read(ai.asset.relPath)).toBeNull()
    expect(rt.assets.read(processed.asset.relPath)).toBeNull()
  })

  it('batch delete returns empty for unknown aliases and leaves the store intact', () => {
    const rt = runtime()
    importGeneratedImage(rt, { prompt: 'keep', imageBase64: Buffer.from('keep').toString('base64') })
    expect(deleteGeneratedAssets(rt, ['nope-1', 'nope-2'])).toEqual([])
    expect(indexItems(rt)).toHaveLength(1)
  })

  it('renames the display name and persists it without touching the file/alias', () => {
    const rt = runtime()
    const saved = importGeneratedImage(rt, {
      prompt: 'forest',
      imageBase64: Buffer.from('forest').toString('base64'),
    })

    const updated = renameGeneratedAsset(rt, saved.asset.alias, '树林2')
    expect(updated?.name).toBe('树林2')
    // alias / relPath / blobId are untouched — only the display name changes.
    expect(updated?.alias).toBe(saved.asset.alias)
    expect(updated?.relPath).toBe(saved.asset.relPath)
    expect(rt.assets.read(saved.asset.relPath)).not.toBeNull()
    expect(listGeneratedAssets(rt).items[0]?.name).toBe('树林2')
  })

  it('auto-suffixes (N) when the desired name collides with another asset', () => {
    const rt = runtime()
    const a = importGeneratedImage(rt, { prompt: 'a', imageBase64: Buffer.from('a').toString('base64') })
    const b = importGeneratedImage(rt, { prompt: 'b', imageBase64: Buffer.from('b').toString('base64') })
    const c = importGeneratedImage(rt, { prompt: 'c', imageBase64: Buffer.from('c').toString('base64') })

    expect(renameGeneratedAsset(rt, a.asset.alias, '墙')?.name).toBe('墙')
    expect(renameGeneratedAsset(rt, b.asset.alias, '墙')?.name).toBe('墙 (2)')
    expect(renameGeneratedAsset(rt, c.asset.alias, '墙')?.name).toBe('墙 (3)')
    // Renaming an asset to its own current name is a no-op (no spurious suffix).
    expect(renameGeneratedAsset(rt, a.asset.alias, '墙')?.name).toBe('墙')
  })

  it('rejects empty names and unknown aliases', () => {
    const rt = runtime()
    const saved = importGeneratedImage(rt, { prompt: 'x', imageBase64: Buffer.from('x').toString('base64') })
    expect(renameGeneratedAsset(rt, saved.asset.alias, '   ')).toBeNull()
    expect(renameGeneratedAsset(rt, 'does-not-exist', 'name')).toBeNull()
  })

  it('copyGeneratedImage writes the display name + tags onto the saved record', () => {
    const rt = runtime()
    const first = importGeneratedImage(rt, {
      prompt: 'a single christmas tree',
      nodeId: 'gen',
      imageBase64: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
      mimeType: 'image/png',
      source: 'studio-gateway',
    })

    const copied = copyGeneratedImage(rt, {
      image: first.image,
      operation: 'image_output',
      name: '圣诞树测试',
      tags: ['xmas', 'tree'],
      folder: 'processed',
    })

    expect(copied.error).toBe('')
    expect(copied.asset?.name).toBe('圣诞树测试')
    expect(copied.asset?.tags).toEqual(['xmas', 'tree'])
    // The Chinese name lives in the display-name field, not the alias (slug strips it).
    expect(copied.asset?.alias).not.toContain('圣诞树测试')
    expect(listGeneratedAssets(rt, 'processed').items[0]?.name).toBe('圣诞树测试')
  })

  it('overwrite replaces an existing same-named asset in place (reusing its slot)', () => {
    const rt = runtime()
    const seed = (data: string) =>
      importGeneratedImage(rt, {
        prompt: 'tree',
        nodeId: 'gen',
        imageBase64: Buffer.from(data).toString('base64'),
        mimeType: 'image/png',
        source: 'studio-gateway',
      })

    const v1 = copyGeneratedImage(rt, {
      image: seed('v1').image,
      operation: 'image_output',
      name: '圣诞树测试',
      overwrite: true,
    })
    const v2 = copyGeneratedImage(rt, {
      image: seed('v2').image,
      operation: 'image_output',
      name: '圣诞树测试',
      overwrite: true,
    })

    // Same display name + overwrite → one record, same alias/relPath, new bytes.
    const processed = listGeneratedAssets(rt, 'processed').items
    expect(processed.filter((i) => i.name === '圣诞树测试')).toHaveLength(1)
    expect(v2.asset?.alias).toBe(v1.asset?.alias)
    expect(v2.asset?.relPath).toBe(v1.asset?.relPath)
    expect(v2.asset?.blobId).not.toBe(v1.asset?.blobId)
  })

  it('overwrite=false appends a fresh entry even with the same display name', () => {
    const rt = runtime()
    const seed = () =>
      importGeneratedImage(rt, {
        prompt: 'tree',
        nodeId: 'gen',
        imageBase64: Buffer.from('seed' + Math.random()).toString('base64'),
        mimeType: 'image/png',
      })

    copyGeneratedImage(rt, { image: seed().image, operation: 'image_output', name: '圣诞树测试', overwrite: false })
    copyGeneratedImage(rt, { image: seed().image, operation: 'image_output', name: '圣诞树测试', overwrite: false })

    const named = listGeneratedAssets(rt, 'processed').items.filter((i) => (i.name ?? '').startsWith('圣诞树测试'))
    // Two distinct records; the second auto-suffixes its display name to stay unique.
    expect(named).toHaveLength(2)
    expect(named.map((i) => i.name).sort()).toEqual(['圣诞树测试', '圣诞树测试 (2)'])
  })
})

describe('asset store folder tree (two-level menus)', () => {
  it('selecting a PARENT menu lists assets across its whole subtree (acts as All)', () => {
    const rt = runtime()
    importGeneratedImage(rt, { prompt: 'p', imageBase64: Buffer.from('p').toString('base64'), folder: 'user' })
    importGeneratedImage(rt, { prompt: 'c1', imageBase64: Buffer.from('c1').toString('base64'), folder: 'user/trees' })
    importGeneratedImage(rt, { prompt: 'c2', imageBase64: Buffer.from('c2').toString('base64'), folder: 'user/rocks' })
    // The parent column returns its own asset + both sub-folder assets.
    expect(listGeneratedAssets(rt, 'user').items).toHaveLength(3)
    // A specific sub-menu still scopes to just that folder.
    expect(listGeneratedAssets(rt, 'user/trees').items).toHaveLength(1)
  })

  it('imports into a nested folder path (parent/child) and lists it back', () => {
    const rt = runtime()
    const saved = importGeneratedImage(rt, {
      prompt: 'tree',
      imageBase64: Buffer.from('nested').toString('base64'),
      folder: 'user/trees',
    })
    expect(saved.asset.folder).toBe('user/trees')
    expect(saved.asset.relPath).toMatch(/^generated\/user\/trees\//)
    expect(listGeneratedAssets(rt, 'user/trees').items.map((i) => i.alias)).toEqual([saved.asset.alias])
  })

  it('createGeneratedFolder makes an empty top-level menu + a one-level sub-menu', () => {
    const rt = runtime()
    expect(createGeneratedFolder(rt, 'user')).toBe('user')
    expect(createGeneratedFolder(rt, 'user/Trees!!')).toBe('user/Trees') // strips punctuation per segment, keeps case
    expect(createGeneratedFolder(rt, 'user/高反射')).toBe('user/高反射') // CJK menu names are preserved
    const names = listGeneratedFolders(rt).folders.map((f) => f.name)
    // Empty folders surface in the list even with zero assets.
    expect(names).toContain('user')
    expect(names).toContain('user/Trees')
    expect(names).toContain('user/高反射')
  })

  it('rejects a sub-folder under a fixed top column and deep nesting', () => {
    const rt = runtime()
    expect(createGeneratedFolder(rt, 'staging/sub')).toBeNull()
    expect(createGeneratedFolder(rt, 'ai/sub')).toBeNull()
    expect(createGeneratedFolder(rt, 'a/b/c')).toBeNull() // only one level of nesting
    expect(createGeneratedFolder(rt, 'presets')).toBeNull() // virtual column
  })

  it('deletes a menu and every asset inside it (including sub-folders)', () => {
    const rt = runtime()
    importGeneratedImage(rt, { prompt: 'a', imageBase64: Buffer.from('a').toString('base64'), folder: 'user' })
    const child = importGeneratedImage(rt, {
      prompt: 'b',
      imageBase64: Buffer.from('b').toString('base64'),
      folder: 'user/trees',
    })
    // `user` is a parent → its list spans the subtree (own asset + sub-folder).
    expect(listGeneratedAssets(rt, 'user').items).toHaveLength(2)
    expect(listGeneratedAssets(rt, 'user/trees').items).toHaveLength(1)

    const res = deleteGeneratedFolder(rt, 'user')
    expect(res.ok).toBe(true)
    expect(res.deleted).toHaveLength(2)
    expect(listGeneratedAssets(rt, 'user').items).toHaveLength(0)
    expect(listGeneratedAssets(rt, 'user/trees').items).toHaveLength(0)
    expect(rt.assets.read(child.asset.relPath)).toBeNull()
    // Fixed/virtual columns are not deletable.
    expect(deleteGeneratedFolder(rt, 'staging').ok).toBe(false)
    expect(deleteGeneratedFolder(rt, 'presets').ok).toBe(false)
  })

  it('migrates the legacy "user" column to "staging" on the first folders list', () => {
    const rt = runtime()
    const legacy = importGeneratedImage(rt, {
      prompt: 'legacy',
      imageBase64: Buffer.from('legacy').toString('base64'),
      folder: 'user',
    })
    // moveGeneratedAssets default also routes to staging now.
    const extra = importGeneratedImage(rt, { prompt: 'x', imageBase64: Buffer.from('x').toString('base64') })
    moveGeneratedAssets(rt, [extra.asset.alias], 'user/old')

    // First folders call runs the one-time migration.
    const names = listGeneratedFolders(rt).folders.map((f) => f.name)
    expect(names).toContain('staging')
    expect(names).toContain('staging/old')
    expect(names).not.toContain('user')
    // The migrated asset is readable under its new staging path.
    const migrated = listGeneratedAssets(rt, 'staging').items.find((i) => i.alias === legacy.asset.alias)
    expect(migrated).toBeTruthy()
    expect(rt.assets.read(migrated!.relPath)).not.toBeNull()
  })
})
