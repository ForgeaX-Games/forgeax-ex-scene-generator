import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { scanBatteryCategories } from './batteryCategories.js'

describe('scanBatteryCategories', () => {
  it('includes iconSvg when an op directory has icon.svg', async () => {
    const root = await mkdtemp(join(tmpdir(), `scene-battery-icons-${process.pid}-`))
    const batteryDir = join(root, 'common', 'input', 'toggle')
    await mkdir(batteryDir, { recursive: true })
    await writeFile(join(batteryDir, 'meta.json'), JSON.stringify({ id: 'toggle', name: 'Toggle' }), 'utf8')
    await writeFile(join(batteryDir, 'icon.svg'), '<svg viewBox="0 0 24 24"><path d="M1 1"/></svg>\n', 'utf8')

    const categories = await scanBatteryCategories([root])

    expect(categories.get('toggle')?.iconSvg).toContain('<svg')
  })
})
