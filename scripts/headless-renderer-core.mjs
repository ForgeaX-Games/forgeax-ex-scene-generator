/**
 * Shared Chromium lifecycle for authoring headless renderer daemons.
 *
 * Ownership rules:
 * - Each launch attempt owns a local browser/context/page session.
 * - Failure paths close the session before scheduling a replacement.
 * - catch and disconnected share one relaunch timer (single-flight).
 * - Consecutive failures back off and then stop creating Chromium.
 */
import { rendererReadySelector, resolveRendererUrl } from './headless-renderer-routing.mjs';

export const HEADLESS_CHROMIUM_ARGS = Object.freeze([
  '--enable-webgl',
  '--use-gl=swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--no-sandbox',
]);

const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_BACKOFF_MS = 3000;
const DEFAULT_BACKOFF_MAX_MS = 60_000;
const DEFAULT_FRONTEND_WAIT_MS = 60_000;
const DEFAULT_NAV_ATTEMPTS = 30;
const DEFAULT_NAV_TIMEOUT_MS = 15_000;
const DEFAULT_READY_TIMEOUT_MS = 25_000;

function envInt(env, key, fallback) {
  const raw = env[key];
  if (raw == null || String(raw).trim() === '') return fallback;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clip(text, max = 220) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function createHeadlessRenderer(options) {
  const spec = options.spec;
  const env = options.env ?? process.env;
  const chromium = options.chromium;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  const log = options.log ?? console;
  const exit = options.exit ?? ((code) => process.exit(code));
  const keepAlive = options.keepAlive !== false;
  const launchArgs = options.launchArgs ?? HEADLESS_CHROMIUM_ARGS;

  const maxFailures = options.maxFailures ?? envInt(env, 'FORGEAX_HEADLESS_RENDERER_MAX_FAILURES', DEFAULT_MAX_FAILURES);
  const backoffMs = options.backoffMs ?? envInt(env, 'FORGEAX_HEADLESS_RENDERER_BACKOFF_MS', DEFAULT_BACKOFF_MS);
  const backoffMaxMs = options.backoffMaxMs ?? envInt(env, 'FORGEAX_HEADLESS_RENDERER_BACKOFF_MAX_MS', DEFAULT_BACKOFF_MAX_MS);
  const frontendWaitMs = options.frontendWaitMs ?? DEFAULT_FRONTEND_WAIT_MS;
  const navAttempts = options.navAttempts ?? DEFAULT_NAV_ATTEMPTS;
  const navTimeoutMs = options.navTimeoutMs ?? DEFAULT_NAV_TIMEOUT_MS;
  const readyTimeoutMs = options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;

  const routing = resolveRendererUrl(env, spec);
  const url = routing.url;
  const markerSelector = rendererReadySelector(spec.pluginId);

  let stopping = false;
  let generation = 0;
  let active = null;
  let launchInFlight = null;
  let relaunchTimer = null;
  let keepAliveTimer = null;
  let consecutiveFailures = 0;
  let lastFailure = null;
  let lastReadyAt = null;
  let started = false;

  function delay(ms) {
    return new Promise((resolve) => setTimeoutFn(resolve, ms));
  }

  function backoffDelay() {
    const exp = Math.max(0, consecutiveFailures - 1);
    return Math.min(backoffMs * (2 ** exp), backoffMaxMs);
  }

  async function closeQuietly(resource) {
    if (!resource || typeof resource.close !== 'function') return;
    try { await resource.close(); } catch { /* already gone */ }
  }

  async function teardownActive() {
    const session = active;
    active = null;
    if (!session) return;
    session.intentionalClose = true;
    try {
      session.browser?.off?.('disconnected', session.onDisconnected);
    } catch { /* noop */ }
    await closeQuietly(session.page);
    await closeQuietly(session.context);
    await closeQuietly(session.browser);
  }

  function cancelRelaunch() {
    if (relaunchTimer != null) {
      clearTimeoutFn(relaunchTimer);
      relaunchTimer = null;
    }
  }

  function scheduleRelaunch(reason, delayMs) {
    if (stopping) return;
    if (consecutiveFailures >= maxFailures) {
      log.error?.(
        `${spec.logPrefix} giving up after ${consecutiveFailures} consecutive failures (${reason}) — not launching more Chromium`,
      );
      return;
    }
    cancelRelaunch();
    const wait = delayMs ?? backoffDelay();
    log.warn?.(`${spec.logPrefix} scheduling relaunch in ${wait}ms (${reason}, failures=${consecutiveFailures}, mode=${routing.mode})`);
    relaunchTimer = setTimeoutFn(() => {
      relaunchTimer = null;
      void launchOnce();
    }, wait);
  }

  async function waitForFrontend() {
    const deadline = now() + frontendWaitMs;
    while (now() < deadline && !stopping) {
      try {
        await fetchImpl(url).catch((error) => {
          if (String(error).includes('ECONNREFUSED')) throw error;
        });
        return;
      } catch {
        await delay(1000);
      }
    }
    if (stopping) throw new Error('stopped');
    throw new Error(`frontend not reachable → ${url}`);
  }

  async function createSession(gen) {
    const browser = await chromium.launch({
      headless: true,
      args: [...launchArgs],
    });
    let context = null;
    let page = null;
    try {
      context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1280, height: 960 },
      });
      page = await context.newPage();
    } catch (error) {
      // chromium.launch() already transferred ownership to this attempt. If
      // context/page construction fails before `active` is assigned, the outer
      // failure handler cannot see the browser, so release it here.
      await closeQuietly(page);
      await closeQuietly(context);
      await closeQuietly(browser);
      throw error;
    }
    const session = {
      generation: gen,
      browser,
      context,
      page,
      ready: false,
      intentionalClose: false,
      onDisconnected: null,
    };
    session.onDisconnected = () => {
      if (session.intentionalClose || stopping) return;
      if (session.generation !== generation) return;
      if (active === session) active = null;
      if (!session.ready) return;
      log.warn?.(`${spec.logPrefix} browser disconnected — relaunching`);
      scheduleRelaunch('disconnected', backoffMs);
    };
    browser.on('disconnected', session.onDisconnected);
    return session;
  }

  async function navigate(page) {
    let lastError = null;
    for (let i = 0; i < navAttempts && !stopping; i++) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeoutMs });
        return;
      } catch (error) {
        lastError = error;
        if (i < navAttempts - 1) await delay(2000);
      }
    }
    if (stopping) throw new Error('stopped');
    throw new Error(`navigation to surface failed after retries: ${clip(lastError)}`);
  }

  async function assertReady(page) {
    const pageUrl = typeof page.url === 'function' ? page.url() : url;
    if (!String(pageUrl).includes(`pane=${spec.pane}`)) {
      throw new Error(`unexpected page identity: ${pageUrl}`);
    }
    await page.waitForSelector(markerSelector, { timeout: readyTimeoutMs }).catch(() => {});
    const marker = await page.$(markerSelector);
    if (!marker) throw new Error('renderer surface absent');
    await page.waitForSelector('canvas', { timeout: readyTimeoutMs }).catch(() => {});
    const canvas = await page.$('canvas');
    if (!canvas) throw new Error('canvas absent');
  }

  async function runLaunchAttempt() {
    await teardownActive();
    if (stopping) return;

    const gen = ++generation;
    let session = null;
    try {
      await waitForFrontend();
      if (stopping) return;
      session = await createSession(gen);
      if (stopping || gen !== generation) {
        session.intentionalClose = true;
        await closeQuietly(session.page);
        await closeQuietly(session.context);
        await closeQuietly(session.browser);
        return;
      }
      active = session;
      await navigate(session.page);
      await assertReady(session.page);
      if (stopping || gen !== generation) throw new Error('stopped');
      session.ready = true;
      consecutiveFailures = 0;
      lastFailure = null;
      lastReadyAt = now();
      log.log?.(
        `${spec.logPrefix} ready & serving (renderer mounted) → ${url} (mode=${routing.mode})`,
      );
    } catch (error) {
      const reason = clip(error);
      lastFailure = { reason, url, mode: routing.mode, at: now() };
      if (stopping) {
        await teardownActive();
        return;
      }
      consecutiveFailures += 1;
      log.warn?.(`${spec.logPrefix} launch failed: ${reason}`);
      await teardownActive();
      scheduleRelaunch('failure');
    }
  }

  function launchOnce() {
    if (stopping) return Promise.resolve();
    if (launchInFlight) return launchInFlight;
    launchInFlight = runLaunchAttempt().finally(() => {
      launchInFlight = null;
    });
    return launchInFlight;
  }

  function start() {
    if (started || stopping) return;
    started = true;
    if (keepAlive) {
      keepAliveTimer = setTimeoutFn(() => {}, 1 << 30);
    }
    void launchOnce();
  }

  function awaitIdle() {
    return launchInFlight ?? Promise.resolve();
  }

  async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    cancelRelaunch();
    if (keepAliveTimer != null) {
      clearTimeoutFn(keepAliveTimer);
      keepAliveTimer = null;
    }
    const inFlight = launchInFlight;
    if (inFlight) {
      try { await inFlight; } catch { /* noop */ }
    }
    await teardownActive();
    exit(exitCode);
  }

  return {
    start,
    shutdown,
    launchOnce,
    scheduleRelaunch,
    awaitIdle,
    getState() {
      return {
        url,
        mode: routing.mode,
        stopping,
        generation,
        consecutiveFailures,
        lastFailure,
        lastReadyAt,
        hasActiveSession: active != null,
        activeReady: Boolean(active?.ready),
        pendingRelaunch: relaunchTimer != null,
        launchInFlight: launchInFlight != null,
      };
    },
  };
}

export async function runHeadlessRenderer(options) {
  const spec = options.spec;
  const env = options.env ?? process.env;
  const log = options.log ?? console;
  const exit = options.exit ?? ((code) => process.exit(code));

  if (env.FORGEAX_SCENE_HEADLESS_RENDERER === '0') {
    log.log?.(`${spec.logPrefix} ${spec.skipMessage}`);
    exit(0);
    return null;
  }

  let chromium = options.chromium;
  if (!chromium) {
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      log.warn?.(`${spec.logPrefix} ${spec.playwrightMissing}`);
      exit(0);
      return null;
    }
  }

  const renderer = createHeadlessRenderer({ ...options, spec, env, chromium, log, exit });
  const runtime = options.processImpl ?? process;
  runtime.on?.('SIGTERM', () => { void renderer.shutdown(); });
  runtime.on?.('SIGINT', () => { void renderer.shutdown(); });
  renderer.start();
  return renderer;
}
