import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHeadlessRenderer, runHeadlessRenderer } from './headless-renderer-core.mjs';
import { SCENE_RENDERER_SPEC } from './headless-renderer-routing.mjs';

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { fn, due: now + Number(ms) });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    pending() {
      return timers.size;
    },
    nextDue() {
      if (timers.size === 0) return null;
      return Math.min(...[...timers.values()].map((timer) => timer.due));
    },
    async pump(renderer) {
      for (let i = 0; i < 100; i++) {
        await Promise.resolve();
        const due = this.nextDue();
        if (due != null) {
          await this.advance(Math.max(0, due - now));
          continue;
        }
        if (renderer.getState().launchInFlight) {
          await renderer.awaitIdle();
          continue;
        }
        return;
      }
    },
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.due <= now)
        .sort((a, b) => a[1].due - b[1].due);
      for (const [id, timer] of due) {
        timers.delete(id);
        await timer.fn();
      }
    },
    async flush() {
      let guard = 0;
      while (timers.size > 0 && guard < 100) {
        guard += 1;
        const nextDue = Math.min(...[...timers.values()].map((timer) => timer.due));
        await this.advance(Math.max(0, nextDue - now));
      }
    },
  };
}

function createMockChromium(behavior) {
  const browsers = [];
  let launchCount = 0;

  const chromium = {
    async launch() {
      launchCount += 1;
      const listeners = new Map();
      const browser = {
        closed: false,
        launchIndex: launchCount,
        on(event, fn) {
          listeners.set(event, fn);
        },
        off(event, fn) {
          if (listeners.get(event) === fn) listeners.delete(event);
        },
        emit(event) {
          listeners.get(event)?.();
        },
        async close() {
          this.closed = true;
          this.emit('disconnected');
        },
        async newContext() {
          if (behavior.newContext === 'fail') throw new Error('context creation failed');
          return {
            closed: false,
            async close() { this.closed = true; },
            async newPage() {
              if (behavior.newPage === 'fail') throw new Error('page creation failed');
              return {
                closed: false,
                async goto() {
                  if (typeof behavior.goto === 'function') return behavior.goto(browser);
                  if (behavior.goto === 'fail') throw new Error('navigation failed');
                },
                url() {
                  if (typeof behavior.url === 'function') return behavior.url();
                  return behavior.url ?? 'http://127.0.0.1:9555/?pane=renderer';
                },
                async waitForSelector() {
                  return null;
                },
                async $(selector) {
                  const hasMarker = behavior.hasMarker !== false;
                  const hasCanvas = behavior.hasCanvas !== false;
                  if (selector.includes('data-forgeax-headless-renderer')) {
                    return hasMarker ? {} : null;
                  }
                  if (selector === 'canvas') return hasCanvas ? {} : null;
                  return null;
                },
                async close() { this.closed = true; },
              };
            },
          };
        },
      };
      browsers.push(browser);
      return browser;
    },
  };

  return {
    chromium,
    browsers,
    launchCount: () => launchCount,
    openBrowsers: () => browsers.filter((browser) => !browser.closed),
  };
}

function createRenderer(clock, mock, env = {}, extra = {}) {
  const logs = { warn: [], error: [], log: [] };
  const renderer = createHeadlessRenderer({
    spec: SCENE_RENDERER_SPEC,
    env: {
      SCENE_RENDERER_URL: 'http://127.0.0.1:9555/?pane=renderer',
      FORGEAX_HEADLESS_RENDERER_MAX_FAILURES: '5',
      FORGEAX_HEADLESS_RENDERER_BACKOFF_MS: '3000',
      FORGEAX_HEADLESS_RENDERER_BACKOFF_MAX_MS: '60000',
      ...env,
    },
    chromium: mock.chromium,
    fetchImpl: async () => ({ ok: true }),
    now: clock.now,
    setTimeoutFn: clock.setTimeout.bind(clock),
    clearTimeoutFn: clock.clearTimeout.bind(clock),
    keepAlive: false,
    navAttempts: extra.navAttempts ?? 1,
    navTimeoutMs: 10,
    readyTimeoutMs: 10,
    frontendWaitMs: extra.frontendWaitMs ?? 10,
    backoffMs: extra.backoffMs ?? 3000,
    backoffMaxMs: extra.backoffMaxMs ?? 60_000,
    maxFailures: extra.maxFailures ?? 5,
    log: {
      log: (...args) => logs.log.push(args.join(' ')),
      warn: (...args) => logs.warn.push(args.join(' ')),
      error: (...args) => logs.error.push(args.join(' ')),
    },
    exit: extra.exit ?? (() => {}),
  });
  return { renderer, logs };
}

describe('headless renderer lifecycle', () => {
  it('closes the browser when navigation fails and does not stack launches', async () => {
    const clock = createClock();
    const mock = createMockChromium({ goto: 'fail' });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 2, backoffMs: 1000 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 1);
    assert.equal(mock.openBrowsers().length, 0);
    assert.equal(renderer.getState().consecutiveFailures, 1);
  });

  it('closes a launched browser when context creation fails before activation', async () => {
    const clock = createClock();
    const mock = createMockChromium({ newContext: 'fail' });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 1 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 1);
    assert.equal(mock.openBrowsers().length, 0);
    assert.match(renderer.getState().lastFailure.reason, /context creation failed/);
  });

  it('closes browser and context when page creation fails before activation', async () => {
    const clock = createClock();
    const mock = createMockChromium({ newPage: 'fail' });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 1 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 1);
    assert.equal(mock.openBrowsers().length, 0);
    assert.match(renderer.getState().lastFailure.reason, /page creation failed/);
  });

  it('closes the browser before retrying when the renderer canvas is absent', async () => {
    const clock = createClock();
    const mock = createMockChromium({ hasCanvas: false });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 2, backoffMs: 1000 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 1);
    assert.equal(mock.openBrowsers().length, 0);
    assert.match(renderer.getState().lastFailure.reason, /canvas absent/);
  });

  it('closes the browser when the dedicated surface marker is missing', async () => {
    const clock = createClock();
    const mock = createMockChromium({ hasMarker: false, hasCanvas: true });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 1 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.openBrowsers().length, 0);
    assert.match(renderer.getState().lastFailure.reason, /renderer surface absent/);
  });

  it('rejects a successful document that is not the renderer pane', async () => {
    const clock = createClock();
    const mock = createMockChromium({
      url: 'http://127.0.0.1:18920/',
      hasMarker: true,
      hasCanvas: true,
    });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 1 });
    renderer.start();
    await renderer.awaitIdle();
    assert.match(renderer.getState().lastFailure.reason, /unexpected page identity/);
    assert.equal(mock.openBrowsers().length, 0);
  });

  it('allows only one Chromium launch while a launch is in flight', async () => {
    let releaseGoto;
    const gotoGate = new Promise((resolve) => { releaseGoto = resolve; });
    const clock = createClock();
    const mock = createMockChromium({
      goto: async () => { await gotoGate; },
    });
    const { renderer } = createRenderer(clock, mock);
    const first = renderer.launchOnce();
    const second = renderer.launchOnce();
    assert.equal(first, second);
    releaseGoto();
    await first;
    assert.equal(mock.launchCount(), 1);
    assert.equal(renderer.getState().activeReady, true);
  });

  it('schedules only one replacement when catch and disconnected race', async () => {
    const clock = createClock();
    const mock = createMockChromium({ hasCanvas: false });
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 3, backoffMs: 5000 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 1);
    const browser = mock.browsers[0];
    browser.emit('disconnected');
    renderer.scheduleRelaunch('failure');
    assert.equal(clock.pending(), 1);
    assert.equal(renderer.getState().pendingRelaunch, true);
  });

  it('caps exponential backoff and stops after the failure budget', async () => {
    const clock = createClock();
    const mock = createMockChromium({ hasCanvas: false });
    const { renderer, logs } = createRenderer(clock, mock, {}, {
      maxFailures: 5,
      backoffMs: 3000,
      backoffMaxMs: 10_000,
    });
    renderer.start();
    await clock.pump(renderer);
    const waits = logs.warn.filter((line) => line.includes('scheduling relaunch')).map((line) => {
      const match = line.match(/in (\d+)ms/);
      return Number(match[1]);
    });
    assert.deepEqual(waits, [3000, 6000, 10000, 10000]);
    assert.equal(mock.launchCount(), 5);
    assert.equal(mock.openBrowsers().length, 0);
    assert.match(logs.error.at(-1) ?? '', /giving up after 5 consecutive failures/);
    await clock.advance(30 * 60 * 1000);
    assert.equal(mock.launchCount(), 5);
  });

  it('does not grow Chromium browser roots across a 30 minute canvas-absent soak', async () => {
    const clock = createClock();
    const mock = createMockChromium({ hasCanvas: false });
    const { renderer } = createRenderer(clock, mock, {}, {
      maxFailures: 5,
      backoffMs: 3000,
      backoffMaxMs: 60_000,
    });
    renderer.start();
    await clock.pump(renderer);
    await clock.advance(30 * 60 * 1000);
    await renderer.awaitIdle();
    assert.equal(mock.launchCount(), 5);
    assert.equal(mock.openBrowsers().length, 0);
    assert.equal(renderer.getState().hasActiveSession, false);
  });

  it('cancels pending retries and closes the active browser on SIGTERM', async () => {
    const clock = createClock();
    const mock = createMockChromium({});
    let exitCode = null;
    const { renderer } = createRenderer(clock, mock, {}, { exit: (code) => { exitCode = code; } });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(mock.openBrowsers().length, 1);
    await renderer.shutdown(0);
    assert.equal(mock.openBrowsers().length, 0);
    assert.equal(exitCode, 0);
    assert.equal(renderer.getState().stopping, true);
    assert.equal(renderer.getState().pendingRelaunch, false);
  });

  it('does not relaunch when an intentional close emits disconnected', async () => {
    const clock = createClock();
    const mock = createMockChromium({});
    const { renderer } = createRenderer(clock, mock, {}, { maxFailures: 5, backoffMs: 1000 });
    renderer.start();
    await renderer.awaitIdle();
    assert.equal(renderer.getState().activeReady, true);
    await renderer.shutdown(0);
    await clock.advance(10_000);
    assert.equal(mock.launchCount(), 1);
  });

  it('exits immediately when the shared disable switch is set', async () => {
    const exits = [];
    const logs = [];
    const renderer = await runHeadlessRenderer({
      spec: SCENE_RENDERER_SPEC,
      env: { FORGEAX_SCENE_HEADLESS_RENDERER: '0' },
      chromium: { launch() { throw new Error('should not launch'); } },
      log: { log: (msg) => logs.push(msg), warn() {}, error() {} },
      exit: (code) => exits.push(code),
    });
    assert.equal(renderer, null);
    assert.deepEqual(exits, [0]);
    assert.match(logs[0], /disabled via FORGEAX_SCENE_HEADLESS_RENDERER=0/);
  });
});
