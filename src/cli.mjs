import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HOME, request, sleep, SOCK } from './common.mjs';
import { runDaemon } from './daemon.mjs';
import { decodePng } from './png.mjs';
import { inlineImage, overlayImage, renderCells, renderLines } from './render.mjs';
import { view } from './view.mjs';

const IMAGE_WIDTH = 800;
const IMAGE_SENT = "Picture sent to the terminal. If nothing appears, turn on Image support in Acode's Terminal Settings.";

const HELP = `glance: a headless browser you and an agent can both see from a terminal.

Look
  open <url> [--wait ms] [--timeout ms]   go to a page and report load errors
  shot [file] [--full] [--selector css]   save a PNG and print its path
  film <count> <everyMs> [dir]            save a timed series of PNGs
  text [selector]                         print visible text
  eval <js>                               run JavaScript and print the result
  log [--clear] [-n count]                console messages and failed requests
  status                                  page, viewport and WebGL renderer

Act
  scroll <dy> [--steps n] [--delay ms] [--x n --y n]
  click <x> <y> | --selector css | --text words
  hover <x> <y> | --selector css | --text words
  type <text>       key <name>       reload       back       forward
  size <w> <h> [--mobile] [--dpr n]
  wait <ms>

Watch in a terminal
  view [--cols n --rows n --256]          live view with mouse and keyboard
  show [--cols n --rows n --256]          print one frame as coloured blocks
  image [--width px] [--tty]              print a real picture, if the terminal can;
                                          --tty draws it over a program like Claude Code

Run
  start       stop
`;

function parse(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-n') opts.n = Number(argv[++i]);
    else if (/^--\d+$/.test(a)) opts.palette = Number(a.slice(2));
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        i++;
        opts[key] = next !== '' && !Number.isNaN(Number(next)) ? Number(next) : next;
      }
    } else pos.push(a);
  }
  return { pos, opts };
}

function need(value, usage) {
  if (value === undefined) throw new Error(`usage: glance ${usage}`);
  return value;
}

const pointArgs = (pos, opts, name) => {
  const args = { ...opts };
  if (pos.length) {
    args.x = Number(pos[0]);
    args.y = Number(need(pos[1], `${name} <x> <y>`));
  }
  return args;
};

async function ping() {
  try {
    await request('log', { n: 0 }, 3000);
    return true;
  } catch {
    return false;
  }
}

async function ensureDaemon() {
  if (await ping()) return;
  fs.mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const cli = fileURLToPath(new URL('../bin/glance.mjs', import.meta.url));
  spawn(process.execPath, [cli, '__daemon'], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 150; i++) {
    await sleep(200);
    if (await ping()) return;
  }
  throw new Error(`browser did not start; see ${HOME}/chromium.log`);
}

function terminalSize(opts) {
  return { cols: opts.cols ?? process.stdout.columns ?? 100, rows: opts.rows ?? process.stdout.rows ?? 30 };
}

function parentPid(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, 'latin1');
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
}

// The terminal of the nearest ancestor that has one. Claude Code captures what its `!`
// commands print, so a picture has to go to the terminal directly.
function ancestorTerminal() {
  for (let pid = process.pid; pid > 1; pid = parentPid(pid)) {
    const out = `/proc/${pid}/fd/1`;
    if (/^\/dev\/(pts\/|tty)/.test(fs.readlinkSync(out))) return out;
  }
  throw new Error('no terminal found among the parent processes');
}

function report(result) {
  if (result === undefined || result === null) return;
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}

const COMMANDS = {
  open: ({ pos, opts }) => request('open', { url: need(pos[0], 'open <url>'), ...opts }),
  reload: ({ opts }) => request('reload', opts),
  back: () => request('back'),
  forward: () => request('forward'),
  shot: ({ pos, opts }) => request('shot', { file: pos[0], ...opts }),
  film: ({ pos }) =>
    request('film', {
      count: Number(need(pos[0], 'film <count> <everyMs> [dir]')),
      every: Number(need(pos[1], 'film <count> <everyMs> [dir]')),
      dir: pos[2],
    }),
  scroll: ({ pos, opts }) => request('scroll', { dy: Number(need(pos[0], 'scroll <dy>')), ...opts }),
  click: ({ pos, opts }) => request('click', pointArgs(pos, opts, 'click')),
  hover: ({ pos, opts }) => request('hover', pointArgs(pos, opts, 'hover')),
  type: ({ pos }) => request('type', { text: need(pos[0], 'type <text>') }),
  key: ({ pos }) => request('key', { name: need(pos[0], 'key <name>') }),
  eval: ({ pos }) => request('eval', { js: need(pos[0], 'eval <js>') }),
  text: ({ pos }) => request('text', { selector: pos[0] }),
  log: ({ opts }) => request('log', opts),
  size: ({ pos, opts }) =>
    request('size', { w: Number(need(pos[0], 'size <w> <h>')), h: Number(need(pos[1], 'size <w> <h>')), ...opts }),
  status: () => request('status'),
  start: () => request('status'),
  async show({ opts }) {
    const { cols, rows } = terminalSize(opts);
    const { data } = await request('frame', { w: cols, h: (rows - 1) * 2 });
    return renderLines(decodePng(Buffer.from(data, 'base64')), { palette: opts.palette });
  },
  async image({ opts }) {
    const width = opts.width ?? IMAGE_WIDTH;
    const { data } = await request('frame', { w: width, h: width * 4 });
    if (!opts.tty) {
      process.stdout.write(inlineImage(data));
      return undefined;
    }
    fs.writeFileSync(ancestorTerminal(), overlayImage(data), { flag: fs.constants.O_WRONLY | fs.constants.O_NOCTTY });
    return IMAGE_SENT;
  },
  // One frame as JSON for the Claude Code preview mod. It never starts the browser,
  // so a pane polling this cannot launch Chromium on its own.
  async raster({ opts }) {
    const columns = Number(need(opts.cols, 'raster --cols n --rows n'));
    const rows = Number(need(opts.rows, 'raster --cols n --rows n'));
    const { data, w, h } = await request('frame', { w: columns, h: rows * 2 });
    const { title, url } = await request('info');
    const cells = renderCells(decodePng(Buffer.from(data, 'base64')), columns, rows);
    return JSON.stringify({ columns, rows, page: { w, h }, title, url, cells });
  },
  async view({ opts }) {
    const { cols, rows, palette, frames } = opts;
    await view({ cols, rows, palette, frames });
  },
};

const NO_AUTOSTART = new Set(['stop', 'wait', 'help', 'raster']);

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '__daemon') return runDaemon();
  if (!command || command === 'help' || command === '--help') {
    process.stdout.write(HELP);
    return;
  }
  const parsed = parse(rest);
  if (command === 'wait') {
    await sleep(Number(need(parsed.pos[0], 'wait <ms>')));
    return;
  }
  if (command === 'stop') {
    if (!(await ping())) {
      console.log('not running');
      return;
    }
    await request('stop');
    for (let i = 0; i < 40 && fs.existsSync(SOCK); i++) await sleep(250);
    console.log('stopped');
    return;
  }
  const run = COMMANDS[command];
  if (!run) throw new Error(`unknown command ${command}. Try: glance help`);
  if (!NO_AUTOSTART.has(command)) await ensureDaemon();
  report(await run(parsed));
}

main().catch((err) => {
  console.error(`glance: ${err.message}`);
  process.exit(1);
});
