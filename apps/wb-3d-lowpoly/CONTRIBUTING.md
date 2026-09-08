# Contributing to 3D Lowpoly Generator

## Setup

```bash
# From the monorepo root:
bun install
bun run build           # build kernel packages + both apps

# Serve the plugin (frontend :9565, backend :9567):
cd apps/wb-3d-lowpoly
bun run serve

# Or run subpackages individually for hot-reload during development:
cd backend  && bun run dev   # Fastify backend on port 9567
cd frontend && bun run dev   # Vite dev server on port 9565 (proxies /api,/ws to 9567)
```

## Verify

```bash
bun run hygiene              # forbidden-term gate — must stay green
bun run --filter backend test
bun run --filter frontend test
bun run smoke:screenshot     # WS screenshot round-trip smoke test
```

## Coding conventions

Same as the monorepo — see root [`AGENTS.md`](../../AGENTS.md):

- TypeScript `strict: true`
- English-only comments / commit messages / identifiers
- Conventional Commits
- No `g[r]asshopper`, `d[e]vcloud`, `t[e]ncent` (or vendor-internal terms) in
  tracked files

## Adding a geometry battery (file-based ops)

All domain ops in this plugin are **file-based batteries** — there is no
programmatic registration in `main.ts`. The `backend/src/ops/index.ts` is an
intentional empty stub.

1. Create the directory `batteries/<Stage>/<Family>/<id>/` (pick the pipeline
   stage `Generate`/`Modify`/`Assemble`/`Output`) with three files:
   - `meta.json` — unique `id`, `label`, `inputs`/`outputs`, `params`, UI fields.
     Use `"type":"geometry"` for geometry I/O ports.
   - `index.ts` — export one lowercase-named entry function. Import kernel
     helpers by package name `@forgeax/node-runtime` only (never a relative
     path into `packages/`).
   - `icon.svg` — battery icon shown in the palette.
2. Restart the backend; confirm `loaded N ops (0 skipped)` and the op appears in
   `GET /api/v1/ops`.
3. Add tests under `backend/tests/` or the relevant `__tests__/` directory.
4. Document the op in `SKILL.md` (input ports, output ports, params, examples).

## Adding a bakeable op (OCCT/replicad)

Bakeable ops produce real mesh geometry via the OCCT/replicad WASM baker:

1. Add a builder function in
   `backend/src/services/baker/ops/<family>.ts` that returns a `BakeableShape`.
2. Register it in `backend/src/services/baker/ops/index.ts`.
3. Reuse the shared toolkits: `gears/gear_helpers.ts`, `csg_helpers.ts`,
   `curves.ts`, `arg_readers.ts`. Follow the canonical-param cache contract
   (`canonical.ts`) — canonical params drive the SHA cache key.
4. See [extension-and-contracts.md](./docs/architecture/extension-and-contracts.md#add-a-baker-op)
   for the full contract.

## Changing kernel behaviour

The kernel (`packages/*`) is in the same monorepo. Edit `packages/*` directly,
run `bun run build` from the monorepo root, and both apps pick up the change.
There is no submodule pin to bump, no `link:`→dist to rebuild separately, and
no cross-repo dist sync needed.
