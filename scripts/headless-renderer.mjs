#!/usr/bin/env node
/**
 * Headless renderer daemon for Scene Generator.
 */
import { runHeadlessRenderer } from './headless-renderer-core.mjs';
import { SCENE_RENDERER_SPEC } from './headless-renderer-routing.mjs';

await runHeadlessRenderer({ spec: SCENE_RENDERER_SPEC });
