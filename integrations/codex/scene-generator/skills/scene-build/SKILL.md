---
name: scene-build
description: Create or edit 3D environments with Scene Generator, automatically start its local authoring UI, write modular TypeScript scenes, and export native Engine Packs. Use when the user mentions Scene Generator or requests its scene-building workflow.
---

# Scene Generator

Treat a request such as "@Scene Generator create a medieval market" as the complete brief. Handle startup, project selection, source organization, validation, and delivery. Focus on environments, architecture, terrain, vegetation, and props; exclude people and character models.

## Start and open the UI

The plugin root is two directories above this Skill directory. Set `SCENE_CLI` to the absolute path of `<plugin-root>/codex/cli.mjs`; use the path of this installed Skill to locate it. Run commands from the user's working directory so projects and service discovery stay consistent across calls.

Run `node "$SCENE_CLI" start --json` at the beginning of scene creation or editing. This installs missing runtime dependencies, starts the packaged service on available local ports, or reuses the healthy service for this workspace. It returns `uiUrl`, `baseUrl`, `stateDir`, and the service log path. Do not ask the user to start a server or determine ports. A startup error identifies its cause and log; correct that cause before authoring.

Open the returned `uiUrl` through the available Codex browser/page capability and keep it visible during creation. Reuse the matching existing page. In the Codex app, use `open_in_codex` with a browser target; inspect the loaded page using the available browser automation capability. If the current environment has no browser capability, run `node "$SCENE_CLI" open --json` to open the system browser. Verify that the project list loads.

The service starts only when this workflow is used. Leave it available for the user after delivery. When the user requests shutdown, run `node "$SCENE_CLI" stop --json`; `status --json` reads its current state. Installation itself does not start the service.

## Author and deliver

Read [the authoring workflow](references/authoring.md). Its `{{CLI}}` means `node "$SCENE_CLI"` for this plugin. All scene operations use the same library, validation, export, and Engine integration as the Studio extension.

Run `projects --json` and select the user's existing project or use `create --name "Project name" --json`. Run `view --project <id> --json`, open the returned project URL, and publish useful intermediate results throughout authoring. Each building style belongs in its own `.scene.ts` module; `main.scene.ts` composes these modules with terrain, paths, and environmental dressing. Discover useful toolkit functions and read relevant implementations when adapting them; original algorithms remain equally valid.

After commits, run `execute --project <id> --json` and `completion --project <id> --json`. Read diagnostics and renderer completion; repair failures and repeat. A successful compiler result alone does not establish a visible scene. Inspect browser errors and the rendered scene using the capabilities and permissions available in the current task.

For a complete scene, deliver the editable source and native Pack and show the Engine result as described in the authoring workflow. Reuse the current Engine 0.2.1 game. If the workspace has no game, use the installed Engine CLI's project creation guidance to create a game directory appropriate to the brief, install its dependencies, and run subsequent publication commands from that directory. Keep the authoring workspace stable by passing the original working directory with `--workspace <directory>` on CLI calls made from the game directory. User requests limited to authoring or source delivery define their own scope.

Return the authoring page, Engine result when requested by the delivery workflow, source/Pack paths, and verified GUIDs. Preserve generated projects between sessions.
