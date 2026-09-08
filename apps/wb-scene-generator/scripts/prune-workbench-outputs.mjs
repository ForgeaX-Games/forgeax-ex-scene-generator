#!/usr/bin/env node
/**
 * One-shot cleanup: cap state/outputs under every wb-scene-generator project.
 * Same retention defaults as @forgeax/node-runtime OutputCache.pruneByRetention.
 */
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MAX_NODE_DIRS = Number(process.env.WB_SG_OUTPUT_MAX_DIRS ?? '30');
const MAX_DIR_BYTES = Number(process.env.WB_SG_OUTPUT_MAX_DIR_BYTES ?? String(128 * 1024 * 1024));
const MAX_TOTAL_BYTES = Number(process.env.WB_SG_OUTPUT_MAX_TOTAL_BYTES ?? String(1024 * 1024 * 1024));

const wsRoot = resolve(
  process.env.FORGEAX_PROJECT_ROOT
    ?? process.argv[2]
    ?? join(process.cwd(), '..', '..', '..', '..', '..', '.forgeax', 'workbench', 'wb-scene-generator'),
);
const projectsDir = join(wsRoot, 'projects');

function directoryByteSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(cur, e.name);
      try {
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) total += statSync(p).size;
      } catch {
        /* race */
      }
    }
  }
  return total;
}

function pruneOutputs(outputsDir) {
  if (!existsSync(outputsDir)) return { removed: 0, kept: 0, freedBytes: 0 };
  const entries = readdirSync(outputsDir, { withFileTypes: true }).filter((e) => e.isDirectory());
  const rows = entries.map((e) => {
    const p = join(outputsDir, e.name);
    return { name: e.name, bytes: directoryByteSize(p), mtime: statSync(p).mtimeMs };
  });
  const toRemove = new Set();
  const mark = (n) => toRemove.add(n);

  for (const row of [...rows].sort((a, b) => a.mtime - b.mtime)) {
    if (row.bytes > MAX_DIR_BYTES) mark(row.name);
  }
  let survivors = rows.filter((r) => !toRemove.has(r.name));
  survivors.sort((a, b) => b.mtime - a.mtime);
  for (const row of survivors.slice(MAX_NODE_DIRS)) mark(row.name);
  survivors = rows.filter((r) => !toRemove.has(r.name));
  survivors.sort((a, b) => a.mtime - b.mtime);
  let total = survivors.reduce((s, r) => s + r.bytes, 0);
  for (const row of survivors) {
    if (total <= MAX_TOTAL_BYTES) break;
    mark(row.name);
    total -= row.bytes;
  }

  let removed = 0;
  let freedBytes = 0;
  for (const name of toRemove) {
    const row = rows.find((r) => r.name === name);
    try {
      rmSync(join(outputsDir, name), { recursive: true, force: true });
      removed += 1;
      if (row) freedBytes += row.bytes;
    } catch {
      /* best-effort */
    }
  }
  return { removed, kept: rows.length - removed, freedBytes };
}

if (!existsSync(projectsDir)) {
  console.error(`projects dir not found: ${projectsDir}`);
  process.exit(1);
}

let totalRemoved = 0;
let totalFreed = 0;
for (const id of readdirSync(projectsDir)) {
  const outputsDir = join(projectsDir, id, 'state', 'outputs');
  const r = pruneOutputs(outputsDir);
  if (r.removed > 0) {
    console.log(`${id}: removed ${r.removed} dirs, kept ${r.kept}, freed ${(r.freedBytes / (1024 * 1024)).toFixed(1)}MB`);
    totalRemoved += r.removed;
    totalFreed += r.freedBytes;
  }
}
console.log(`done: ${totalRemoved} dirs removed, ${(totalFreed / (1024 * 1024)).toFixed(1)}MB freed`);
