/**
 * Pure URL selection for workbench headless renderer daemons.
 *
 * Host should pass an explicit SCENE_RENDERER_URL / LOWPOLY_RENDERER_URL.
 * Fallback inference must NOT treat FORGEAX_INTERFACE_PORT as proof that the
 * Studio `/__fx-plugin/` reverse proxy is registered — that proxy exists only
 * when FORGEAX_STANDALONE_PROXY=1.
 */

export const SCENE_RENDERER_SPEC = Object.freeze({
  logPrefix: '[scene-renderer]',
  pluginId: 'wb-scene-generator',
  pane: 'renderer',
  defaultPort: '9555',
  portEnvKeys: Object.freeze(['SCENE_FRONTEND_PORT', 'LOWPOLY_FRONTEND_PORT', 'VITE_DEV_PORT']),
  urlOverrideEnv: 'SCENE_RENDERER_URL',
  skipMessage: 'disabled via FORGEAX_LOWPOLY_HEADLESS_RENDERER=0',
  playwrightMissing:
    'playwright not installed — skipping headless renderer (agent screenshots need a manually-opened renderer panel).',
});

export const LOWPOLY_RENDERER_SPEC = Object.freeze({
  logPrefix: '[lowpoly-renderer]',
  pluginId: 'wb-3d-lowpoly',
  pane: 'viewer3d',
  defaultPort: '9565',
  portEnvKeys: Object.freeze(['LOWPOLY_FRONTEND_PORT', 'VITE_DEV_PORT']),
  urlOverrideEnv: 'LOWPOLY_RENDERER_URL',
  skipMessage: 'disabled via FORGEAX_LOWPOLY_HEADLESS_RENDERER=0',
  playwrightMissing:
    'playwright not installed — skipping headless renderer (agent screenshots need a manually-opened URDF panel).',
});

export const HEADLESS_RENDERER_MARKER_ATTR = 'data-forgeax-headless-renderer';

export function rendererReadySelector(pluginId) {
  return `[${HEADLESS_RENDERER_MARKER_ATTR}="${pluginId}"]`;
}

function firstDefined(env, keys) {
  for (const key of keys) {
    const value = env[key];
    if (value != null && String(value).trim() !== '') return String(value).trim();
  }
  return null;
}

export function resolveRendererUrl(env = {}, spec) {
  const override = env[spec.urlOverrideEnv];
  if (override != null && String(override).trim() !== '') {
    return { url: String(override).trim(), mode: 'override' };
  }

  const proto = env.VITE_DEV_HTTPS_CERT && env.VITE_DEV_HTTPS_KEY ? 'https' : 'http';
  const port = firstDefined(env, spec.portEnvKeys) ?? spec.defaultPort;
  const direct = `${proto}://127.0.0.1:${port}/?pane=${spec.pane}`;

  const proxyEnabled = env.FORGEAX_STANDALONE_PROXY === '1';
  const origin = env.FORGEAX_INTERFACE_ORIGIN
    || (env.FORGEAX_INTERFACE_PORT ? `http://127.0.0.1:${env.FORGEAX_INTERFACE_PORT}` : null);

  if (proxyEnabled && origin) {
    return {
      url: `${String(origin).replace(/\/$/, '')}/__fx-plugin/${spec.pluginId}/?pane=${spec.pane}`,
      mode: 'proxy',
    };
  }

  return { url: direct, mode: 'direct' };
}
