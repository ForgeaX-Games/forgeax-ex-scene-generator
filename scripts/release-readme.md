# Scene Generator

Create TypeScript scenes with an independent authoring UI and export native Engine Packs.

## Install and start

Requires Node.js 20.19 or newer, npm, and Bun 1.3.14.

### Codex plugin

With a Codex CLI that provides `codex plugin`, install the plugin into your
personal Codex configuration (available from Scene Generator 0.4.3):

```sh
npx --package @forgeax-extension/scene-generator@latest scene-generator install
```

Start a new Codex task, select **Scene Generator** from the `@` menu, and describe
the scene, for example: "Create a medieval market." The included `scene-build`
Skill starts the local service on demand, opens the authoring UI, and creates
modular TypeScript scenes. Native Pack and Engine GUID delivery use Engine 0.2.1.

Installation registers the plugin through `codex plugin add` and preserves other
personal plugins. Service startup occurs when the Skill is used. Workspaces keep
separate projects under `~/.forgeax/scene-generator/codex`; subsequent calls reuse
their healthy service. The Skill also provides status and shutdown commands.

Run `codex plugin list --json` to confirm that `scene-generator` is installed
and enabled. Installing the npm dependency alone downloads the package; the
`install` command performs Codex registration. Before updating, ask Scene
Generator to stop its service in the original task, repeat the installation
command, and start a new Codex task. Existing projects are preserved.

### Standalone UI

```sh
npm install @forgeax-extension/scene-generator
npm explore @forgeax-extension/scene-generator -- bun run serve
```

Open `http://127.0.0.1:9555/`. The service API listens on port `9557`.
Keep the command running while using the UI. Press Ctrl+C to stop both services.

Projects are stored in `~/.forgeax/scene-generator`, independently of the npm
installation. Set `FORGEAX_PROJECT_ROOT` to use a different data directory.
`VITE_DEV_PORT` selects the UI port, and `PORT` selects the API port.

## Agent integration

The Studio integration uses `extensions/scene-generator/` with the standard manifest,
CLI module, and authoring Skill. The `@forgeax/game` maintainer includes that
directory in a host release. In a host that contains the extension, enable it
for the game project through
`node node_modules/@forgeax/game/dist/main.js scene-generator enable --ide codex`, then request
scene authoring through the installed Skill. The independent service must be running.

Native asset publication uses Engine 0.2.1 and returns Engine asset GUIDs.
