# Contributing to Scene Generator

## Setup

```bash
# From the monorepo root — build kernel packages first:
bun install
bun run build

# Then work in this app:
cd apps/wb-scene-generator
bun run serve          # backend :9557 + frontend :9555 (serves from dist; self-builds if missing)
bun run hygiene        # forbidden-term gate
bun run --filter backend test
bun run --filter frontend test
```

For a faster inner loop while editing frontend or backend source:

```bash
cd apps/wb-scene-generator
bun run dev            # backend + frontend in watch/HMR mode
```

## Coding conventions

- TypeScript `strict: true`
- English-only comments / commit messages / identifiers
- Conventional Commits
- Pre-commit hook runs hygiene + lint
- No `g[r]asshopper`, `d[e]vcloud`, `t[e]ncent` (or vendor-internal terms) in
  tracked files

## Adding a scene battery (domain op)

Batteries are **file-based** — the kernel loader discovers them automatically.
There is no programmatic registration step.

1. Create the battery directory:
   `batteries/<bigTag>/<smallTag>/<id>/meta.json` + `batteries/<bigTag>/<smallTag>/<id>/index.ts`

2. `meta.json` — declare the op contract:
   ```json
   {
     "id": "my_op_id",
     "label": "My Op",
     "inputs": [{ "id": "grid", "type": "grid", "access": "item" }],
     "outputs": [{ "id": "out", "type": "scene" }],
     "params": [],
     "tags": ["scene"],
     "frontend": { "displayGroup": "scene30/mygroup" }
   }
   ```

3. `index.ts` — export one lowercase-named entry function:
   ```ts
   import type { DataTree } from "@forgeax/node-runtime";
   export async function myOpId(input: { grid: DataTree }, ctx: unknown) {
     // ...
     return { out: result };
   }
   ```
   Always import kernel helpers by **package name** (`@forgeax/node-runtime`),
   never a deep relative path into `packages/`.

4. Restart the backend (or trigger a hot-reload); confirm:
   ```
   loaded N ops (0 skipped)
   ```
   and verify the op appears in `GET /api/v1/ops` with the expected `category`.

5. Add a JSON schema under `schemas/batteries/<id>.json` for AI consumption.
6. Document the op in `SKILL.md` (input ports, output ports, params, examples).
7. Add tests under `backend/tests/` or `batteries/<bigTag>/<id>/__tests__/`.

## Adding an API route

1. Add / extend a file in `backend/src/routes/`.
2. Register it in `backend/src/main.ts`.
3. Keep mutations going through kernel `applyBatch` — never mutate graph state
   directly. Mirror the endpoint in `apps/wb-3d-lowpoly/` if it is generic.

## Kernel changes

If your change requires a fix in the editor canvas, stores, transport,
`applyBatch`, battery loader, or any other kernel primitive, edit
`packages/*` in the monorepo root directly, run `bun run build` from the root,
and land the kernel + app changes in a single commit. There is no separate
kernel repo and no submodule pin to manage.

## Backend port: 9557

The Fastify backend runs on port **9557** (not the generic dev port). The
frontend dev server at **9555** proxies `/api` and `/ws` to it.
