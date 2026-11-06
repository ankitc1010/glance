import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { decodePng } from '../src/png.mjs';

const run = promisify(execFile);
const CLI = fileURLToPath(new URL('../bin/glance.mjs', import.meta.url));
const HOME = path.join(os.homedir(), `.glance-test-${process.pid}`);
const env = { ...process.env, GLANCE_HOME: HOME };

const glance = async (...args) => (await run(process.execPath, [CLI, ...args], { env, timeout: 120000, maxBuffer: 1 << 26 })).stdout;
const json = async (...args) => JSON.parse(await glance(...args));

const PAGE = `<!doctype html><title>glance test</title>
<body style="margin:0;background:#102030;height:3000px">
<canvas id=c width=200 height=100 style="display:block"></canvas>
<button id=b style="position:absolute;left:300px;top:300px;width:120px;height:40px">Press me</button>
<input id=i style="position:absolute;left:300px;top:400px">
<script>
const g = c.getContext('webgl2');
if (g) { g.clearColor(0, 1, 0, 1); g.clear(g.COLOR_BUFFER_BIT); }
window.wheel = 0;
addEventListener('wheel', (e) => { window.wheel += e.deltaY; });
b.onclick = () => { document.title = 'clicked'; };
console.error('planted error');
</script>`;

before(async () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  await json('open', `data:text/html,${encodeURIComponent(PAGE)}`, '--wait', 300);
});

after(async () => {
  await glance('stop').catch(() => {});
  fs.rmSync(HOME, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

test('status reports working software WebGL', async () => {
  const s = await json('status');
  assert.equal(s.title, 'glance test');
  assert.match(s.webgl, /llvmpipe/);
});

test('shot writes a real PNG with WebGL pixels in it', async () => {
  const { file } = await json('shot');
  const img = decodePng(fs.readFileSync(file));
  assert.deepEqual([img.width, img.height], [1280, 800]);
  const at = (x, y) => [...img.data.subarray((y * img.width + x) * img.channels, (y * img.width + x) * img.channels + 3)];
  assert.deepEqual(at(50, 50), [0, 255, 0]);
  assert.deepEqual(at(800, 700), [16, 32, 48]);
});

test('click by text reaches the page', async () => {
  await glance('click', '--text', 'Press me');
  assert.equal((await glance('eval', 'document.title')).trim(), 'clicked');
});

test('click by text accepts words that look like numbers', async () => {
  await glance('eval', `document.body.insertAdjacentHTML('beforeend', '<button style="position:fixed;left:0;top:200px" onclick="window.numeric = true">2024</button>')`);
  await glance('click', '--text', '2024');
  assert.equal(await json('eval', 'window.numeric'), true);
});

test('wheel events reach page listeners', async () => {
  await json('scroll', 240, '--steps', 2, '--delay', 10);
  assert.equal(await json('eval', 'window.wheel'), 480);
});

test('typing goes into the focused field', async () => {
  await glance('click', '--selector', '#i');
  await glance('type', 'hello');
  assert.equal((await glance('eval', 'document.querySelector("#i").value')).trim(), 'hello');
});

test('console errors are collected', async () => {
  const entries = await json('log');
  assert.ok(entries.some((e) => e.level === 'error' && e.text.includes('planted error')));
});

test('missing elements give a clear error', async () => {
  await assert.rejects(glance('click', '--text', 'no such words anywhere'), /nothing visible matches/);
});

test('show prints half blocks sized to the request', async () => {
  const out = await glance('show', '--cols', 40, '--rows', 21);
  const lines = out.trimEnd().split('\n');
  // A 1280x800 page fits 40 by 40 pixels as 40 by 25, which is 13 rows of half blocks.
  assert.equal(lines.length, 13);
  assert.equal((lines[0].match(/▀/g) ?? []).length, 40);
});

test('view streams frames over the socket', async () => {
  const out = await glance('view', '--cols', 40, '--rows', 21, '--frames', 1);
  assert.ok(out.includes('\x1b[?1049h'));
  assert.ok(out.includes('▀'));
  assert.ok(out.endsWith('\x1b[?1049l'));
});

test('image prints a real PNG scaled to the requested width', async () => {
  const out = await glance('image', '--width', 400);
  const m = /^\x1b\]1337;File=inline=1;size=(\d+);width=100%;preserveAspectRatio=1:([A-Za-z0-9+/=]+)\x07\n$/.exec(out);
  assert.ok(m, 'expected one inline image sequence');
  const bytes = Buffer.from(m[2], 'base64');
  assert.equal(bytes.length, Number(m[1]));
  const img = decodePng(bytes);
  assert.deepEqual([img.width, img.height], [400, 250]);
});

test('image --tty reaches the terminal of a parent when its own output is captured', async () => {
  const driver = fileURLToPath(new URL('./pty_image.py', import.meta.url));
  const { stdout } = await run('python3', ['-I', driver, CLI], { env, timeout: 90000 });
  assert.match(stdout, /all checks passed/);
});

test('raster returns a full grid of cells and the page details', async () => {
  const frame = await json('raster', '--cols', 20, '--rows', 10);
  assert.equal(Buffer.from(frame.cells, 'base64').length, 20 * 10 * 12);
  assert.deepEqual(frame.page, { w: 1280, h: 800 });
  assert.equal(frame.title, 'clicked');
});

test('raster never starts a browser', async () => {
  const empty = path.join(os.homedir(), `.glance-test-${process.pid}-empty`);
  const noBrowser = { ...process.env, GLANCE_HOME: empty };
  await assert.rejects(run(process.execPath, [CLI, 'raster', '--cols', '5', '--rows', '5'], { env: noBrowser }));
  assert.equal(fs.existsSync(empty), false);
});

test('view takes keys and mouse and quits cleanly in a real terminal', async () => {
  const driver = fileURLToPath(new URL('./pty_drive.py', import.meta.url));
  const { stdout } = await run('python3', ['-I', driver, CLI], { env, timeout: 90000 });
  assert.match(stdout, /all checks passed/);
});
