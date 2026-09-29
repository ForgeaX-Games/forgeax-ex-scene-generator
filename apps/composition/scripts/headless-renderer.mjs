#!/usr/bin/env node
/**
 * Headless renderer daemon for scene-generator.
 *
 * The agent screenshot path (scene:screenshot.capture →
 * POST /api/v1/agent/screenshot/capture) needs a LIVE browser viewer connected
 * to the backend `/ws`. This daemon keeps `?pane=renderer` mounted in Chromium
 * so capture is available even when no human has the preview pane open.
 *
 * Lifecycle, routing, and Chromium ownership live in the shared core. This
 * file only supplies scene-generator identity and launch configuration.
 */
import { runHeadlessRenderer } from '../../../scripts/headless-renderer-core.mjs';
import { SCENE_RENDERER_SPEC } from '../../../scripts/headless-renderer-routing.mjs';

await runHeadlessRenderer({ spec: SCENE_RENDERER_SPEC });
