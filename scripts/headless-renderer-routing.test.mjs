import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SCENE_RENDERER_SPEC,
  rendererReadySelector,
  resolveRendererUrl,
} from './headless-renderer-routing.mjs';

const root = dirname(fileURLToPath(import.meta.url));

describe('headless renderer URL matrix', () => {
  it('prefers an explicit SCENE_RENDERER_URL override', () => {
    const resolved = resolveRendererUrl({
      SCENE_RENDERER_URL: 'http://127.0.0.1:39555/?pane=renderer',
      FORGEAX_STANDALONE_PROXY: '1',
      FORGEAX_INTERFACE_PORT: '18920',
    }, SCENE_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:39555/?pane=renderer',
      mode: 'override',
    });
  });

  it('uses the plugin direct port when interface port exists but standalone proxy is off', () => {
    const resolved = resolveRendererUrl({
      FORGEAX_INTERFACE_PORT: '48920',
      FORGEAX_INTERFACE_ORIGIN: 'http://127.0.0.1:48920',
      SCENE_FRONTEND_PORT: '39555',
      FORGEAX_STANDALONE_PROXY: '0',
    }, SCENE_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:39555/?pane=renderer',
      mode: 'direct',
    });
  });

  it('uses the Studio plugin proxy only when standalone proxy is enabled', () => {
    const resolved = resolveRendererUrl({
      FORGEAX_STANDALONE_PROXY: '1',
      FORGEAX_INTERFACE_ORIGIN: 'http://127.0.0.1:18920',
      SCENE_FRONTEND_PORT: '9555',
    }, SCENE_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:18920/__fx-plugin/scene-generator/?pane=renderer',
      mode: 'proxy',
    });
  });

  it('falls back to the default direct port when no host contract is present', () => {
    const resolved = resolveRendererUrl({}, SCENE_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:9555/?pane=renderer',
      mode: 'direct',
    });
  });

  it('selects https for the direct URL when plugin TLS files are present', () => {
    const resolved = resolveRendererUrl({
      VITE_DEV_HTTPS_CERT: '/tmp/cert.pem',
      VITE_DEV_HTTPS_KEY: '/tmp/key.pem',
      SCENE_FRONTEND_PORT: '39555',
    }, SCENE_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'https://127.0.0.1:39555/?pane=renderer',
      mode: 'direct',
    });
  });
});

describe('headless renderer surface contract', () => {
  it('exposes a dedicated ready marker on the scene surface', () => {
    const scene = readFileSync(
      join(root, '../apps/composition/frontend/src/surfaces/RendererSurface.tsx'),
      'utf8',
    );
    assert.match(scene, /data-forgeax-headless-renderer="scene-generator"/);
    assert.match(scene, /data-pane="renderer"/);
    assert.equal(
      rendererReadySelector('scene-generator'),
      '[data-forgeax-headless-renderer="scene-generator"]',
    );
  });

  it('keeps the plugin wrapper as a thin core entrypoint', () => {
    const scene = readFileSync(
      join(root, '../apps/composition/scripts/headless-renderer.mjs'),
      'utf8',
    );
    assert.match(scene, /runHeadlessRenderer/);
    assert.match(scene, /SCENE_RENDERER_SPEC/);
    assert.doesNotMatch(scene, /chromium\.launch/);
  });
});
