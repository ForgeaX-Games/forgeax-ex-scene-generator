#!/usr/bin/env node
/**
 * Headless renderer daemon for wb-3d-lowpoly.
 *
 * The screenshot path (lowpoly:screenshot.capture) needs a LIVE browser viewer
 * connected to the backend `/ws`. This daemon keeps `?pane=viewer3d` mounted in
 * Chromium so capture is available even when no human has the URDF panel open.
 *
 * Lifecycle, routing, and Chromium ownership live in the shared core. This
 * file only supplies lowpoly identity and launch configuration.
 */
import { runHeadlessRenderer } from '../../../scripts/headless-renderer-core.mjs';
import { LOWPOLY_RENDERER_SPEC } from '../../../scripts/headless-renderer-routing.mjs';

await runHeadlessRenderer({ spec: LOWPOLY_RENDERER_SPEC });
