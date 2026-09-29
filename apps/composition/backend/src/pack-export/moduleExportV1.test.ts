import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { exportSceneModulePack } from './moduleExport.js'
import { rebuildScenePack } from './rebuild.js'
import { deriveAssetGuid } from './identity.js'
import { inspectModuleImports } from '@forgeax/scene-authoring'

const packageId = '01900000-0000-7000-8000-000000000202'
// Opt-in integration with an external v1 consumer. The plugin never depends on its SDK.
const consumer = process.env.SCENE_PACK_V1_CONSUMER_ROOT

describe('v1 standalone publication', () => {
  it('rejects unsupported target options before loading a source or writing output', async () => {
    const options = { sourceDir: '/absent', entryFile: 'main.scene.ts', destination: '/absent', packageId }
    await expect(exportSceneModulePack({ ...options, schemaVersion: '3.0.0' as never })).rejects.toThrow(/schemaVersion/)
    await expect(exportSceneModulePack({ ...options, schemaVersion: '1.0.0', parameters: [{ name: 'width', type: 'f32', default: 2 }] })).rejects.toThrow(/fixed args/)
  })

  it.runIf(consumer)('loads and builds with the pinned v1 worker, including after a detached rebuild', async () => {
    const root = mkdtempSync(join(tmpdir(), 'native-v1-pack-')), source = join(root, 'source'), out = join(root, 'artifact')
    mkdirSync(source)
    try {
      writeFileSync(join(source, 'main.scene.ts'), `import { sceneNode } from '@forgeax/scene';
export function room({width=2}={}) { return sceneNode({name:'Room',geometry:{kind:'mesh',positions:[0,0,0,width,0,0,0,2,0],indices:[0,1,2],material:{id:'wall',surface:{baseColor:[1,1,1,1],baseColorTexture:{width:1,height:1,rgba8:'/////w==',colorSpace:'srgb'}}}}}) }
`)
      const result = await exportSceneModulePack({ sourceDir: source, entryFile: 'main.scene.ts', exportName: 'room', args: [{ width: 3 }], destination: out, packageId, sourceKey: 'scene/stable-room', schemaVersion: '1.0.0', includeDefaultLighting: false })
      expect(result.schemaVersion).toBe('1.0.0')
      expect(result.sceneGuid).toBe(deriveAssetGuid(packageId, 'scene/stable-room'))
      const receipt = JSON.parse(readFileSync(join(out, 'scene-entry.json'), 'utf8'))
      expect(receipt.packSchemaVersion).toBe('1.0.0')
      for (const file of receipt.files.filter((f: string) => f.endsWith('.ts'))) {
        for (const { specifier } of inspectModuleImports(readFileSync(join(out, file), 'utf8')).imports) {
          expect(specifier.startsWith('.') || specifier.startsWith('@forgeax/engine-'), `${file} -> ${specifier}`).toBe(true)
        }
      }
      symlinkSync(join(consumer!, 'node_modules'), join(out, 'node_modules'), 'dir')
      writeFileSync(join(out, 'package.json'), '{"type":"module"}')
      const probe = `import {loadScriptablePack} from '@forgeax/engine-pack/source-node';
import {AssetGuid} from '@forgeax/engine-pack/guid';
const loaded=await loadScriptablePack(${JSON.stringify(join(out, result.packFile))});
if(!loaded.ok)throw new Error(JSON.stringify(loaded.error));
const meta={schemaVersion:loaded.value.schemaVersion,packageId:AssetGuid.format(loaded.value.packageId),assets:Object.fromEntries(Object.entries(loaded.value.assets).map(([key,a])=>[key,{...a,guid:AssetGuid.format(a.guid)}]))};
const built=await loaded.value.build({readByGuid:async()=>{throw new Error('Unexpected external read')}});
if(!built.ok)throw new Error(JSON.stringify(built.error));
console.log(JSON.stringify({ok:true,metadata:meta,keys:Object.keys(built.value).sort(),scene:built.value['scene/stable-room'],kinds:Object.values(built.value).map(a=>a.kind).sort()}));`
      const native = () => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', probe], {
        cwd: out, encoding: 'utf8', timeout: 15000, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
      }))
      const first = native()
      expect(first.ok).toBe(true)
      expect(first.metadata.schemaVersion).toBe('1.0.0')
      expect(first.metadata.packageId).toBe(packageId)
      expect(first.metadata.assets['scene/stable-room'].guid).toBe(result.sceneGuid)
      expect(Object.keys(first.metadata.assets).sort()).toEqual(first.keys)
      expect(first.kinds).toEqual(['material', 'mesh', 'sampler', 'scene', 'texture'])
      expect(first.scene.entities).toHaveLength(2)
      rmSync(source, { recursive: true })
      writeFileSync(join(out, 'scene/main.scene.ts'), readFileSync(join(out, 'scene/main.scene.ts'), 'utf8').replace('0,2,0', '0,4,0'))
      await rebuildScenePack(out)
      expect(readFileSync(join(out, result.packFile), 'utf8')).toContain("schemaVersion: '1.0.0'")
      const second = native()
      expect(second.keys).toEqual(first.keys)
      expect(second.metadata).toEqual(first.metadata)
      console.info('V1_NATIVE_VERIFIED:', JSON.stringify({ keys: first.keys, sceneGuid: result.sceneGuid, detachedRebuild: true }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
