import type { Arg, Geometry, Statement } from './types.js';
import { formatStatements } from './serialize.js';

export function collectReachableStatementIds(
  rootId: string,
  geometry: Geometry,
): readonly string[] {
  const byId = new Map(geometry.statements.map(s => [s.id, s]));
  const seen = new Set<string>();

  const visit = (id: string): void => {
    if (seen.has(id)) return;
    const stmt = byId.get(id);
    if (!stmt) return;
    seen.add(id);
    for (const arg of Object.values(stmt.args)) collectRefsFromArg(arg, visit);
  };

  visit(rootId);
  return geometry.statements.filter(s => seen.has(s.id)).map(s => s.id);
}

export function collectReachableStatements(
  rootId: string,
  geometry: Geometry,
): readonly Statement[] {
  const ids = new Set(collectReachableStatementIds(rootId, geometry));
  return geometry.statements.filter(s => ids.has(s.id));
}

export function reachableSubgraphSource(rootId: string, geometry: Geometry): string {
  return formatStatements(collectReachableStatements(rootId, geometry));
}

function collectRefsFromArg(arg: Arg, visit: (id: string) => void): void {
  if (arg.kind === 'ref') {
    visit(arg.name);
  } else if (arg.kind === 'list') {
    for (const item of arg.items) collectRefsFromArg(item, visit);
  }
}
