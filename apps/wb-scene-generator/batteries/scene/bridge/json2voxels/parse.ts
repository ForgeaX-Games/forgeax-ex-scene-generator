/** Shared JSON → voxel cell parsing for json2voxels / voxels2scene. */

export interface ParsedVoxelCell {
  x: number;
  y: number;
  z: number;
  token: string;
}

export interface ParsedVoxelNode {
  name: string;
  cells: ParsedVoxelCell[];
}

export interface ParsedVoxelDocument {
  root?: string;
  schema?: string;
  nodes?: ParsedVoxelNode[];
  voxels: ParsedVoxelCell[];
  tokens: string[];
}

export function tryParseJSON(str: string): unknown {
  let current: unknown = str;
  for (let i = 0; i < 3; i += 1) {
    if (typeof current !== 'string') break;
    try {
      current = JSON.parse(current);
    } catch {
      break;
    }
  }
  return current === str ? null : current;
}

function finiteInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

export function parseVoxelCell(raw: unknown, defaultToken: string): ParsedVoxelCell | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const x = finiteInt(rec.x);
  const y = finiteInt(rec.y);
  const z = finiteInt(rec.z ?? 0);
  if (x === null || y === null || z === null) return null;
  const token = typeof rec.token === 'string' && rec.token.trim()
    ? rec.token.trim()
    : defaultToken;
  return { x, y, z, token };
}

function flattenCells(raw: unknown[], defaultToken: string): ParsedVoxelCell[] {
  const out: ParsedVoxelCell[] = [];
  for (const item of raw) {
    const cell = parseVoxelCell(item, defaultToken);
    if (cell) out.push(cell);
  }
  return out;
}

function cellsToLists(cells: ParsedVoxelCell[]): { voxels: ParsedVoxelCell[]; tokens: string[] } {
  return {
    voxels: cells,
    tokens: cells.map((c) => c.token),
  };
}

/**
 * Normalize a node name into a safe scene path suffix.
 * Allows nested segments ("district/building") to build hierarchical trees:
 * trims each segment, drops empty ones, collapses repeated slashes.
 * Returns '' when nothing valid remains.
 */
export function normalizeNodePath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

function parseNodeEntry(raw: unknown, defaultToken: string): ParsedVoxelNode | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const name = normalizeNodePath(rec.name);
  if (!name) return null;
  const rawCells = Array.isArray(rec.cells) ? rec.cells : Array.isArray(rec.voxels) ? rec.voxels : [];
  const cells = flattenCells(rawCells, defaultToken);
  if (cells.length === 0) return null;
  return { name, cells };
}

/** Parse JSON value into flat voxels and optional hierarchical nodes. */
export function parseVoxelDocument(parsed: unknown, defaultToken = 'cell'): ParsedVoxelDocument | { error: string } {
  if (parsed === null || parsed === undefined) {
    return { error: 'JSON is empty' };
  }

  if (Array.isArray(parsed)) {
    const cells = flattenCells(parsed, defaultToken);
    if (cells.length === 0) return { error: 'array contains no valid voxel cells' };
    const { voxels, tokens } = cellsToLists(cells);
    return { voxels, tokens };
  }

  if (typeof parsed !== 'object') {
    return { error: 'JSON root must be an array or object' };
  }

  const obj = parsed as Record<string, unknown>;
  const root = typeof obj.root === 'string' ? obj.root.trim() : undefined;
  const schema = typeof obj.schema === 'string' ? obj.schema.trim() : undefined;
  const defaultTok = typeof obj.token === 'string' && obj.token.trim() ? obj.token.trim() : defaultToken;

  if (Array.isArray(obj.nodes)) {
    const nodes: ParsedVoxelNode[] = [];
    for (const entry of obj.nodes) {
      const node = parseNodeEntry(entry, defaultTok);
      if (node) nodes.push(node);
    }
    if (nodes.length === 0) return { error: 'nodes[] contains no valid entries' };
    const voxels = nodes.flatMap((n) => n.cells);
    return {
      ...(root ? { root } : {}),
      ...(schema ? { schema } : {}),
      nodes,
      voxels,
      tokens: voxels.map((c) => c.token),
    };
  }

  const listRaw = obj.voxels ?? obj.cells;
  if (Array.isArray(listRaw)) {
    const cells = flattenCells(listRaw, defaultTok);
    if (cells.length === 0) return { error: 'voxels/cells contains no valid entries' };
    const { voxels, tokens } = cellsToLists(cells);
    return {
      ...(root ? { root } : {}),
      ...(schema ? { schema } : {}),
      voxels,
      tokens,
    };
  }

  return { error: 'expected top-level array, { voxels: [...] }, or { nodes: [...] }' };
}

export function computeBounds(cells: readonly ParsedVoxelCell[]): { width: number; height: number } {
  let maxX = 0;
  let maxY = 0;
  for (const c of cells) {
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { width: maxX + 1, height: maxY + 1 };
}
