/** Shared lowpoly-side contract for the direct-to-Editor GLB workflow. */
export const EDITOR_ASSET_IMPORT_CAPABILITY = 'editor.asset.import' as const;
export const EDITOR_ASSET_IMPORT_CAPABILITY_VERSION = 1 as const;
export const DEFAULT_ENGINE_ASSET_DIRECTORY = 'assets/3d' as const;

function pathSegments(raw: string, fallback: string): string[] {
  const trimmed = raw.trim();
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(trimmed)) {
    throw new Error('engine asset directory must be project-relative, not an absolute path');
  }
  const normalized = trimmed.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  const value = normalized || fallback;
  const segments = value.split('/').filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('engine asset directory must be a project-relative path without . or .. segments');
  }
  return segments;
}

/** Normalize a game-relative destination directory; absolute OS paths are not accepted. */
export function normalizeEngineAssetDirectory(raw: unknown): string {
  if (raw !== undefined && typeof raw !== 'string') throw new Error('directory must be a string');
  return pathSegments(typeof raw === 'string' ? raw : '', DEFAULT_ENGINE_ASSET_DIRECTORY).join('/');
}

/** Keep filenames deterministic and compatible with the existing GLB exporter. */
export function normalizeGlbFilename(raw: unknown): string {
  const value = typeof raw === 'string' && raw.trim() ? raw.trim() : 'lowpoly-model';
  const filename = value
    .split(/[\\/]/u).at(-1)!
    .replace(/\.glb$/iu, '')
    .replace(/[^a-zA-Z0-9._-]/gu, '_')
    .replace(/_+/gu, '_')
    .replace(/^[._]+|[._]+$/gu, '');
  return `${filename || 'lowpoly-model'}.glb`;
}

export function buildEngineGlbPath(directory: unknown, name: unknown): { directory: string; sourceName: string; destPath: string } {
  const normalizedDirectory = normalizeEngineAssetDirectory(directory);
  const sourceName = normalizeGlbFilename(name);
  return {
    directory: normalizedDirectory,
    sourceName,
    destPath: `${normalizedDirectory}/${sourceName}`,
  };
}
