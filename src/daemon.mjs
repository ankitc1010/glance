import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Cdp } from './cdp.mjs';
import { HOME, LOG, PROFILE, SHOTS, SOCK, sleep } from './common.mjs';

const BIN = process.env.GLANCE_CHROMIUM || 'chromium';

// --no-sandbox is required: proot cannot provide Chromium's sandbox. WebGL runs on
// Mesa llvmpipe through ANGLE, because Chromium's bundled SwiftShader and Mesa
// lavapipe both segfault the GPU process on real sites in this environment.
const FLAGS = [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=gl-egl',
  '--ignore-gpu-blocklist',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-sync',
  '--disable-extensions',
  '--hide-scrollbars',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--remote-debugging-pipe',
];

const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36';

const KEYS = {
  Enter: [13, '\r'],
  Tab: [9, '\t'],
  Escape: [27],
  Backspace: [8],
  Delete: [46],
  Space: [32, ' '],
  ArrowUp: [38],
  ArrowDown: [40],
  ArrowLeft: [37],
  ArrowRight: [39],
  PageUp: [33],
  PageDown: [34],
  Home: [36],
  End: [35],
};

const MAX_LOG = 500;

function locateScript(selector, text) {
  return `(() => {
    let e = null;
    const sel = ${JSON.stringify(selector ?? null)};
    const txt = ${JSON.stringify(text ? String(text).toLowerCase() : null)};
    if (sel) { e = document.querySelector(sel); if (e) e.scrollIntoView({ block: 'center' }); }
    else {
      let area = Infinity;
      for (const x of document.querySelectorAll('body *')) {
        if (!x.textContent.toLowerCase().includes(txt)) continue;
        const r = x.getBoundingClientRect();
        const a = r.width * r.height;
        if (a > 0 && a < area && r.bottom > 0 && r.top < innerHeight) { e = x; area = a; }
      }
    }
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: e.tagName.toLowerCase(), text: (e.innerText || '').trim().slice(0, 60) };
  })()`;
}

export async function runDaemon() {
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  fs.mkdirSync(SHOTS, { recursive: true });
  const logFd = fs.openSync(LOG, 'w');
  const extra = (process.env.GLANCE_FLAGS ?? '').split(/\s+/).filter(Boolean);
  const child = spawn(BIN, [...FLAGS, ...extra, `--user-data-dir=${PROFILE}`, '--window-size=1280,800', 'about:blank'], {
    stdio: ['ignore', logFd, logFd, 'pipe', 'pipe'],
    env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: '1', EGL_PLATFORM: 'surfaceless' },
  });
  const cdp = new Cdp(child.stdio[3], child.stdio[4]);
  const started = Date.now();
  let server;

  // The socket goes last, so its absence means the browser has really gone.
  const finish = (code) => {
    fs.rmSync(SOCK, { force: true });
    process.exit(code);
  };
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    child.kill();
    setTimeout(() => child.kill('SIGKILL'), 5000).unref();
  };
  child.on('exit', () => finish(stopping ? 0 : 1));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find((t) => t.type === 'page');
  const { sessionId: session } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
  const page = (method, params, opts = {}) => cdp.send(method, params, { sessionId: session, ...opts });

  const log = [];
  const pushLog = (level, text) => {
    log.push({ t: Date.now(), level, text: String(text).slice(0, 500) });
    if (log.length > MAX_LOG) log.shift();
  };
  const onPage = (name, fn) =>
    cdp.on(name, (p, s) => {
      if (s === session) fn(p);
    });
  onPage('Runtime.consoleAPICalled', (p) => {
    const text = p.args.map((a) => a.value ?? a.description ?? a.type).join(' ');
    pushLog(p.type === 'warning' ? 'warn' : p.type === 'error' ? 'error' : 'log', text);
  });
  onPage('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    pushLog('error', d.exception?.description || d.text);
  });
  onPage('Log.entryAdded', (p) => pushLog(p.entry.level === 'warning' ? 'warn' : p.entry.level, `${p.entry.text} ${p.entry.url ?? ''}`));
  onPage('Network.loadingFailed', (p) => {
    if (!p.canceled) pushLog('net', `failed: ${p.errorText} (${p.type})`);
  });
  onPage('Network.responseReceived', (p) => {
    if (p.response.status >= 400) pushLog('net', `${p.response.status} ${p.response.url}`);
  });
  onPage('Page.javascriptDialogOpening', (p) => {
    pushLog('dialog', `${p.type}: ${p.message}`);
    page('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
  });

  await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map((m) => page(m)));

  const view = { w: 1280, h: 800, mobile: false };

  const applySize = async ({ w, h, mobile = false, dpr = 1 }) => {
    Object.assign(view, { w, h, mobile });
    await page('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile });
    await page('Emulation.setTouchEmulationEnabled', { enabled: mobile });
    await page('Emulation.setUserAgentOverride', { userAgent: mobile ? MOBILE_UA : await desktopUa() });
  };
  let defaultUa;
  const desktopUa = async () => {
    if (!defaultUa) defaultUa = (await cdp.send('Browser.getVersion')).userAgent;
    return defaultUa;
  };
  await applySize(view);

  const evaluate = async (expression, timeout = 30000) => {
    const r = await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, { timeout });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };

  const waitEvent = (name, timeout) =>
    new Promise((resolve) => {
      const handler = (_, s) => {
        if (s !== session) return;
        clearTimeout(timer);
        cdp.off(name, handler);
        resolve(true);
      };
      const timer = setTimeout(() => {
        cdp.off(name, handler);
        resolve(false);
      }, timeout);
      cdp.on(name, handler);
    });

  const pageInfo = async () => {
    try {
      return await evaluate('({ title: document.title, url: location.href })', 5000);
    } catch {
      return { title: '(page busy)', url: '' };
    }
  };

  const settle = async (t0, wait, loadWait) => {
    const loaded = await loadWait;
    if (wait) await sleep(wait);
    const since = log.filter((e) => e.t >= t0);
    return {
      ...(await pageInfo()),
      loaded,
      seconds: +((Date.now() - t0) / 1000).toFixed(1),
      errors: since.filter((e) => e.level === 'error').length,
      failedRequests: since.filter((e) => e.level === 'net').length,
    };
  };

  const screenshot = async (params) => {
    const { data } = await page('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true, ...params }, { timeout: 90000 });
    return data;
  };

  const resolvePoint = async ({ x, y, selector, text }) => {
    if (x !== undefined && y !== undefined) return { x, y };
    if (!selector && !text) throw new Error('give coordinates, --selector or --text');
    const found = await evaluate(locateScript(selector, text));
    if (!found) throw new Error(`nothing visible matches ${selector ?? JSON.stringify(text)}`);
    return found;
  };

  const historyGo = async (delta) => {
    const { currentIndex, entries } = await page('Page.getNavigationHistory');
    const entry = entries[currentIndex + delta];
    if (!entry) throw new Error('no history entry in that direction');
    const t0 = Date.now();
    const load = waitEvent('Page.loadEventFired', 45000);
    await page('Page.navigateToHistoryEntry', { entryId: entry.id });
    return settle(t0, 500, load);
  };

  const commands = {
    async open({ url, wait = 1500, timeout = 45000 }) {
      const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
      const t0 = Date.now();
      const load = waitEvent('Page.loadEventFired', timeout);
      const r = await page('Page.navigate', { url: target }, { timeout });
      if (r.errorText) throw new Error(`${target}: ${r.errorText}`);
      return settle(t0, wait, load);
    },
    async reload({ wait = 1500, timeout = 45000 }) {
      const t0 = Date.now();
      const load = waitEvent('Page.loadEventFired', timeout);
      await page('Page.reload');
      return settle(t0, wait, load);
    },
    back: () => historyGo(-1),
    forward: () => historyGo(1),
    async shot({ file, full, selector }) {
      const params = {};
      if (full) params.captureBeyondViewport = true;
      if (selector) {
        const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`);
        if (!r) throw new Error(`no element matches ${selector}`);
        params.clip = { ...r, scale: 1 };
      }
      const out = path.resolve(file || path.join(SHOTS, `shot-${Date.now()}.png`));
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Buffer.from(await screenshot(params), 'base64'));
      return { file: out, viewport: `${view.w}x${view.h}` };
    },
    async film({ count, every, dir }) {
      const out = path.resolve(dir || path.join(SHOTS, `film-${Date.now()}`));
      fs.mkdirSync(out, { recursive: true });
      const frames = [];
      const t0 = Date.now();
      for (let i = 0; i < count; i++) {
        const due = t0 + i * every;
        if (due > Date.now()) await sleep(due - Date.now());
        const file = path.join(out, `frame-${String(i).padStart(3, '0')}.png`);
        const at = Date.now() - t0;
        fs.writeFileSync(file, Buffer.from(await screenshot({}), 'base64'));
        frames.push({ file, ms: at });
      }
      return { dir: out, frames };
    },
    // A frame scaled to fit w by h pixels, for drawing in a terminal.
    async frame({ w, h }) {
      const scale = Math.min(w / view.w, h / view.h);
      const data = await screenshot({ clip: { x: 0, y: 0, width: view.w, height: view.h, scale } });
      return { data, w: view.w, h: view.h };
    },
    async scroll({ dy, x, y, steps = 1, delay = 120 }) {
      const at = { x: x ?? view.w / 2, y: y ?? view.h / 2 };
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
      for (let i = 0; i < steps; i++) {
        await page('Input.dispatchMouseEvent', { type: 'mouseWheel', ...at, deltaX: 0, deltaY: dy });
        if (i < steps - 1) await sleep(delay);
      }
      return { scrolled: dy * steps, steps, windowScrollY: await evaluate('scrollY').catch(() => null) };
    },
    async click(args) {
      const p = await resolvePoint(args);
      const at = { x: p.x, y: p.y };
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
      await page('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, button: 'left', buttons: 1, clickCount: 1 });
      await page('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at, button: 'left', buttons: 0, clickCount: 1 });
      return p;
    },
    async hover(args) {
      const p = await resolvePoint(args);
      await page('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
      return p;
    },
    async type({ text }) {
      await page('Input.insertText', { text });
      return { typed: text.length };
    },
    async key({ name }) {
      const spec = KEYS[name];
      if (!spec) throw new Error(`unknown key ${name}; known: ${Object.keys(KEYS).join(', ')}`);
      const [vk, text] = spec;
      const base = { key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
      await page('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text });
      await page('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
      return { key: name };
    },
    eval: ({ js }) => evaluate(js),
    async text({ selector }) {
      const expr = selector
        ? `document.querySelector(${JSON.stringify(selector)})?.innerText ?? null`
        : 'document.body.innerText';
      return evaluate(expr);
    },
    log({ clear, n = 100 }) {
      const entries = n > 0 ? log.slice(-n) : [];
      if (clear) log.length = 0;
      return entries;
    },
    async size({ w, h, mobile, dpr }) {
      await applySize({ w, h, mobile: !!mobile, dpr: dpr ?? 1 });
      return { viewport: `${w}x${h}`, mobile: !!mobile };
    },
    info: pageInfo,
    async status() {
      const webgl = await evaluate(`(() => {
        const g = document.createElement('canvas').getContext('webgl2');
        if (!g) return null;
        const d = g.getExtension('WEBGL_debug_renderer_info');
        const name = d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
        // Browsers cap live contexts, so this probe must not push out the page's own.
        g.getExtension('WEBGL_lose_context')?.loseContext();
        return name;
      })()`, 10000).catch(() => null);
      return { ...(await pageInfo()), viewport: `${view.w}x${view.h}`, mobile: view.mobile, chromiumPid: child.pid, uptimeSeconds: Math.round((Date.now() - started) / 1000), webgl, home: HOME };
    },
    stop() {
      setTimeout(() => shutdown(), 50);
      return { stopped: true };
    },
  };

  // Live frames for terminal viewers. The ack waits for the socket write, so a slow
  // viewer slows the screencast down instead of queueing frames without limit.
  const viewers = new Set();
  onPage('Page.screencastFrame', (p) => {
    const ack = () => page('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
    if (!viewers.size) {
      ack();
      return;
    }
    const line = JSON.stringify({ data: p.data, w: view.w, h: view.h }) + '\n';
    let pending = viewers.size;
    for (const v of viewers) {
      v.write(line, () => {
        if (--pending === 0) ack();
      });
    }
  });

  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/stream') {
      const w = Number(url.searchParams.get('w'));
      const h = Number(url.searchParams.get('h'));
      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      viewers.add(res);
      page('Page.startScreencast', { format: 'png', maxWidth: w, maxHeight: h, everyNthFrame: 1 }).catch(() => {});
      res.on('close', () => {
        viewers.delete(res);
        if (!viewers.size) page('Page.stopScreencast').catch(() => {});
      });
      return;
    }
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', async () => {
      res.setHeader('content-type', 'application/json');
      try {
        const { cmd, args } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const fn = commands[cmd];
        if (!fn) throw new Error(`unknown command ${cmd}`);
        res.end(JSON.stringify({ ok: true, result: await fn(args ?? {}) }));
      } catch (err) {
        res.end(JSON.stringify({ ok: false, error: err.message }));
      }
    });
  });

  fs.rmSync(SOCK, { force: true });
  server.listen(SOCK, () => fs.chmodSync(SOCK, 0o600));
}
