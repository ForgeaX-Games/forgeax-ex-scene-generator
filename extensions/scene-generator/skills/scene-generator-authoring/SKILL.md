---
name: scene-generator-authoring
description: Author procedural assets and scenes with the Scene Generator TypeScript library, publish native pack.ts assets, and use their Engine GUIDs in ForgeaX games. Use for scenes, buildings, terrain, props, and reusable scene modules when this extension is enabled.
---

# Scene Generator

Accept a creative request such as "Use Scene Generator to generate a medieval market" as the complete authoring brief. Resolve technical details from the current game, installed extension configuration, and CLI results. Choose a project name and an asset directory from the request; handle validation, native Pack publication, and Engine GUID integration as part of completing the scene. Ask about creative intent only when it materially changes the result. Respect requests limited to editing or source delivery.

Run commands from the game project directory. The `@forgeax/game` host keeps this extension disabled until explicitly enabled and installs this Skill on enable. Use the installation-specific `{{CLI}}` command sequentially; extension operations share the host's project lock.

This extension connects to the local Scene Generator API configured during enable. The independent Scene Generator UI and service must already be running. Use `{{CLI}} doctor --json` to verify the connection; report a connection failure before continuing dependent work. Native publication requires the game's declared and installed `@forgeax/engine` version to be `0.3.3`; the host version is `@forgeax/game 0.3.10` and requires Node.js 22.13 or newer.

## Open the authoring UI

For scene creation or editing, read `uiUrl` from `{{CLI}} doctor --json`. Open it through the available Codex/Studio browser or page capability, reusing an existing page when possible. Wait for the project list and preview to load and keep the page available while authoring. The service supplies its actual UI address, including customized ports or a Studio-managed URL. Obtain project IDs, revisions, asset paths, and GUIDs from the current project and command results; keep these details out of user input requirements.

The user or Studio manages the independent service. This Skill does not start, register, or manage background services. If the service is unavailable or `uiUrl` is missing, report the installation/service problem without asking the user to discover ports or construct CLI commands. Resume dependent work once the service is available. The extension's standard commands handle business operations; the host manages enable/disable and Skill installation.

## Author and deliver

[Authoring workflow](references/authoring.md)

The host manages enable/disable, configuration, and Skill installation. Disabling the extension preserves generated assets and Scene Generator projects.
