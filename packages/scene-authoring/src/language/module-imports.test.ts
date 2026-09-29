import {describe,it,expect} from 'vitest'
import {inspectModuleImports} from './module-imports.js'

describe('runtime imports with inline type specifiers', () => {
  it('retains a default value beside type-only named imports', () => {
    const [item] = inspectModuleImports("import build, { type Options } from './part.scene.ts'").imports
    expect(item?.typeOnly).toBe(false)
    expect(item?.names).toEqual(['default'])
  })
  it('preserves default and named runtime bindings together', () => {
    const [item] = inspectModuleImports("import build, { helper, type Options } from './part.scene.ts'").imports
    expect(item?.typeOnly).toBe(false)
    expect(item?.names).toEqual(['default', 'helper'])
  })
  it('continues to exclude actual type-only imports and reexports', () => {
    for (const source of ["import type Build from './part.ts'", "import { type Options } from './part.ts'", "export { type Options } from './part.ts'"])
      expect(inspectModuleImports(source).imports[0]?.typeOnly).toBe(true)
  })
  it('keeps bare imports and namespace imports as runtime dependencies', () => {
    for (const source of ["import './part.ts'", "import * as part from './part.ts'"])
      expect(inspectModuleImports(source).imports[0]?.typeOnly).toBe(false)
  })
})
