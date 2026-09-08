/**
 * Ambient types for the vendored frontend modelVariants module
 * (`vendor/dist/renderer-resolve/.../modelVariants.js`).
 */
declare module '*/vendor/dist/renderer-resolve/renderer/modes/mesh3d/modelVariants.js' {
  export const DECORATIVE_PACK_PREFIXES: readonly string[]
  export function hashString(s: string): number
  export function packFamilyStem(packName: string): string
  export function listNumberedVariants(stem: string, catalog: readonly string[]): string[]
  export function pickModelVariant(
    requested: string,
    instanceKey: string,
    catalog: readonly string[],
  ): string
}
