import http from 'node:http';
import { request, SOCK } from './common.mjs';
import { decodePng } from './png.mjs';
import { Screen } from './render.mjs';

const ENTER = '\x1b[?1049h\x1b[?25l\x1b[2J\x1b[?1003h\x1b[?1006h';
const LEAVE = '\x1b[?1006l\x1b[?1003l\x1b[0m\x1b[?25h\x1b[?1049l';
const TOKENS = /\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Z]|\x1b|[\s\S]/g;
const SCROLL_STEP = 240;
const HOVER_EVERY_MS = 40;

// Live viewer: renders the screencast with half blocks and forwards mouse and keys.
// --frames N stops after N frames and skips input, which tests use.
export async function view({ cols, rows, palette, frames }) {
  const out = process.stdout;
  const size = () => ({ c: cols ?? out.columns ?? 100, r: (rows ?? out.rows ?? 30) - 1 });
  const interactive = !frames && process.stdin.isTTY;

  let { c, r } = size();
  let screen = new Screen(c, r, { palette });
  let current = null;
  let queued = null;
  let drawing = false;
  let drawn = 0;
  let status = '';
  let mode = 'normal';
  let prompt = '';
  let stream;
  let lastHover = 0;
  let finish;
  const finished = new Promise((res) => (finish = res));

  const bar = () => {
    let text;
    if (mode === 'prompt') text = ` open: ${prompt}`;
    else if (mode === 'insert') text = ' typing into the page. Esc to stop';
    else text = ` ${status}  q quit  ↑↓ scroll  o open  i type  r reload  b back`;
    return `\x1b[${r + 1};1H\x1b[7m${text.slice(0, c).padEnd(c)}\x1b[0m`;
  };

  const write = (s) => (out.write(s) ? null : new Promise((res) => out.once('drain', res)));

  const pump = async () => {
    if (drawing) return;
    drawing = true;
    while (queued) {
      const frame = queued;
      queued = null;
      const img = decodePng(Buffer.from(frame.data, 'base64'));
      current = { ...frame, imgW: img.width, imgH: img.height };
      await write(screen.draw(img) + bar());
      if (frames && ++drawn >= frames) finish();
    }
    drawing = false;
  };
  const show = (frame) => {
    queued = frame;
    pump().catch(finish);
  };

  const refreshStatus = async () => {
    const s = await request('info').catch(() => null);
    if (!s) return;
    status = (s.title || s.url || 'about:blank').slice(0, Math.max(10, c - 50));
    await write(bar());
  };

  const connect = async () => {
    show(await request('frame', { w: c, h: r * 2 }));
    await new Promise((res) => {
      const mine = http.get({ socketPath: SOCK, path: `/stream?w=${c}&h=${r * 2}` }, (reply) => {
        res();
        let pending = '';
        reply.setEncoding('latin1');
        reply.on('error', () => {});
        reply.on('close', () => {
          if (stream === mine) finish(new Error('browser connection closed'));
        });
        reply.on('data', (d) => {
          pending += d;
          let nl;
          while ((nl = pending.indexOf('\n')) !== -1) {
            show(JSON.parse(pending.slice(0, nl)));
            pending = pending.slice(nl + 1);
          }
        });
      });
      stream = mine;
      mine.on('error', (err) => {
        if (stream === mine) finish(err);
      });
    });
  };

  // Maps a terminal cell to page coordinates, or null when it is off the image.
  const toPage = (col, row) => {
    if (!current || col > current.imgW || row * 2 > current.imgH) return null;
    return { x: ((col - 0.5) * current.w) / current.imgW, y: ((row - 0.5) * 2 * current.h) / current.imgH };
  };

  const fire = (cmd, args) => request(cmd, args).catch(() => {});

  const onMouse = (token) => {
    const m = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(token);
    const code = Number(m[1]);
    const at = toPage(Number(m[2]), Number(m[3]));
    if (!at) return;
    if (code === 64 || code === 65) fire('scroll', { dy: code === 64 ? -SCROLL_STEP : SCROLL_STEP, ...at });
    else if (code & 32) {
      if (Date.now() - lastHover < HOVER_EVERY_MS) return;
      lastHover = Date.now();
      fire('hover', at);
    } else if (code === 0 && m[4] === 'M') {
      fire('click', at).then(refreshStatus);
    }
  };

  const INSERT_KEYS = { '\r': 'Enter', '\t': 'Tab', '\x7f': 'Backspace', '\x1b[A': 'ArrowUp', '\x1b[B': 'ArrowDown', '\x1b[C': 'ArrowRight', '\x1b[D': 'ArrowLeft' };

  const onToken = (t) => {
    if (t.startsWith('\x1b[<')) return onMouse(t);
    if (mode === 'prompt') {
      if (t === '\r') {
        mode = 'normal';
        const url = prompt;
        prompt = '';
        if (url) fire('open', { url }).then(refreshStatus);
      } else if (t === '\x1b') {
        mode = 'normal';
        prompt = '';
      } else if (t === '\x7f') prompt = prompt.slice(0, -1);
      else if (t >= ' ' && t.length === 1) prompt += t;
      write(bar());
      return;
    }
    if (mode === 'insert') {
      if (t === '\x1b') {
        mode = 'normal';
        write(bar());
      } else if (INSERT_KEYS[t]) fire('key', { name: INSERT_KEYS[t] });
      else if (t >= ' ' && t.length === 1) fire('type', { text: t });
      return;
    }
    if (t === 'q' || t === '\x03') return finish();
    if (t === 'o') { mode = 'prompt'; write(bar()); }
    else if (t === 'i') { mode = 'insert'; write(bar()); }
    else if (t === 'r') fire('reload', {}).then(refreshStatus);
    else if (t === 'b') fire('back').then(refreshStatus);
    else if (t === '\x1b[A') fire('scroll', { dy: -SCROLL_STEP });
    else if (t === '\x1b[B') fire('scroll', { dy: SCROLL_STEP });
    else if (t === '\x1b[5~') fire('scroll', { dy: -SCROLL_STEP * 3 });
    else if (t === '\x1b[6~' || t === ' ') fire('scroll', { dy: SCROLL_STEP * 3 });
  };

  const onResize = async () => {
    ({ c, r } = size());
    screen = new Screen(c, r, { palette });
    const old = stream;
    stream = null;
    old?.destroy();
    await write('\x1b[2J');
    await connect();
  };

  await write(ENTER);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    out.write(LEAVE);
  };
  process.on('exit', restore);
  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  if (interactive) {
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => d.match(TOKENS)?.forEach(onToken));
    out.on('resize', () => onResize().catch(finish));
  }

  await connect();
  await refreshStatus();
  const err = await finished;
  const last = stream;
  stream = null;
  last?.destroy();
  // Restore first so an error is printed on the normal screen, not the alternate one.
  restore();
  if (err) throw err;
  // Terminal stdin would otherwise keep the process alive.
  if (interactive) process.exit(0);
}
