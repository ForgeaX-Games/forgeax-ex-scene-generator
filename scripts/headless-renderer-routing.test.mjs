import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  LOWPOLY_RENDERER_SPEC,
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
      url: 'http://127.0.0.1:18920/__fx-plugin/wb-scene-generator/?pane=renderer',
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
      LOWPOLY_FRONTEND_PORT: '9665',
    }, LOWPOLY_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'https://127.0.0.1:9665/?pane=viewer3d',
      mode: 'direct',
    });
  });

  it('uses the lowpoly override and pane independently of the scene plugin', () => {
    const resolved = resolveRendererUrl({
      LOWPOLY_RENDERER_URL: 'http://127.0.0.1:9565/?pane=viewer3d',
      FORGEAX_STANDALONE_PROXY: '1',
      FORGEAX_INTERFACE_PORT: '18920',
    }, LOWPOLY_RENDERER_SPEC);
    assert.equal(resolved.mode, 'override');
    assert.equal(resolved.url, 'http://127.0.0.1:9565/?pane=viewer3d');
  });

  it('uses the lowpoly proxy URL when standalone proxy is enabled', () => {
    const resolved = resolveRendererUrl({
      FORGEAX_STANDALONE_PROXY: '1',
      FORGEAX_INTERFACE_PORT: '18920',
      LOWPOLY_FRONTEND_PORT: '9565',
    }, LOWPOLY_RENDERER_SPEC);
    assert.deepEqual(resolved, {
      url: 'http://127.0.0.1:18920/__fx-plugin/wb-3d-lowpoly/?pane=viewer3d',
      mode: 'proxy',
    });
  });
});

describe('headless renderer surface contract', () => {
  it('exposes a dedicated ready marker on scene and lowpoly surfaces', () => {
    const scene = readFileSync(
      join(root, '../apps/wb-scene-generator/frontend/src/surfaces/RendererSurface.tsx'),
      'utf8',
    );
    const lowpoly = readFileSync(
      join(root, '../apps/wb-3d-lowpoly/frontend/src/surfaces/Viewer3DSurface.tsx'),
      'utf8',
    );
    assert.match(scene, /data-forgeax-headless-renderer="wb-scene-generator"/);
    assert.match(scene, /data-pane="renderer"/);
    assert.match(lowpoly, /data-forgeax-headless-renderer="wb-3d-lowpoly"/);
    assert.match(lowpoly, /data-pane="viewer3d"/);
    assert.equal(
      rendererReadySelector('wb-scene-generator'),
      '[data-forgeax-headless-renderer="wb-scene-generator"]',
    );
  });

  it('keeps plugin wrappers as thin core entrypoints', () => {
    const scene = readFileSync(
      join(root, '../apps/wb-scene-generator/scripts/headless-renderer.mjs'),
      'utf8',
    );
    const lowpoly = readFileSync(
      join(root, '../apps/wb-3d-lowpoly/scripts/headless-renderer.mjs'),
      'utf8',
    );
    assert.match(scene, /runHeadlessRenderer/);
    assert.match(scene, /SCENE_RENDERER_SPEC/);
    assert.doesNotMatch(scene, /chromium\.launch/);
    assert.match(lowpoly, /runHeadlessRenderer/);
    assert.match(lowpoly, /LOWPOLY_RENDERER_SPEC/);
    assert.doesNotMatch(lowpoly, /chromium\.launch/);
  });
});
