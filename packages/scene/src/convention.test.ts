import { describe, expect, it } from 'vitest'
import { diagnoseSceneConventions, sceneSourceKind } from './convention.js'

describe('material modules', () => {
  it('is its own source kind', () => {
    expect(sceneSourceKind('scene/rock.material.ts')).toBe('material')
    expect(sceneSourceKind('scene/main.scene.ts')).toBe('scene')
    expect(sceneSourceKind('scene/erode.generator.ts')).toBe('generator')
  })

  it('leaves package dependency resolution to the TypeScript build', () => {
    const diagnostics = diagnoseSceneConventions({
      entryFile: 'main.scene.ts',
      files: {
        'main.scene.ts': "import { rock } from './rock.material.ts'\n",
        'rock.material.ts': "import chroma from 'chroma-js'\n",
      },
    })
    expect(diagnostics.map((diagnostic) => diagnostic.code)).not.toContain('SCENE_IMPORT_EXTERNAL')
  })

  it('refuses a material that imports back up into a scene', () => {
    const diagnostics = diagnoseSceneConventions({
      entryFile: 'main.scene.ts',
      files: {
        'main.scene.ts': "import { rock } from './rock.material.ts'\n",
        'rock.material.ts': "import { thing } from './other.scene.ts'\n",
        'other.scene.ts': '',
      },
    })
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain('SCENE_IMPORT_DAG')
  })

  it('accepts the shape a material is supposed to have', () => {
    const diagnostics = diagnoseSceneConventions({
      entryFile: 'main.scene.ts',
      files: {
        'main.scene.ts': "import { rock } from './rock.material.ts'\nimport { sceneOutput } from '@forgeax/scene'\n",
        'rock.material.ts': "import { defineMaterial } from '@forgeax/scene'\nimport { tune } from './tune.generator-lib.ts'\n",
        'tune.generator-lib.ts': '',
      },
    })
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
  })
})
