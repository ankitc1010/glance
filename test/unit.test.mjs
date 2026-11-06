import assert from 'node:assert/strict';
import test from 'node:test';
import zlib from 'node:zlib';
import { decodePng } from '../src/png.mjs';
import { inlineImage, overlayImage, renderCells, renderLines, Screen } from '../src/render.mjs';

function chunk(kind, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]);
}

function png(width, height, colourType, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = colourType;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('decodes every PNG filter type', () => {
  // Row filters 0 to 4 on RGB pixels. Expected values worked out by hand.
  const raw = [
    0, 10, 20, 30, 40, 50, 60,
    1, 1, 2, 3, 1, 1, 1,
    2, 1, 1, 1, 2, 2, 2,
    3, 1, 1, 1, 1, 1, 1,
    4, 1, 1, 1, 1, 1, 1,
  ];
  const img = decodePng(png(2, 5, 2, raw));
  assert.deepEqual([...img.data.subarray(0, 6)], [10, 20, 30, 40, 50, 60]);
  assert.deepEqual([...img.data.subarray(6, 12)], [1, 2, 3, 2, 3, 4]);
  assert.deepEqual([...img.data.subarray(12, 18)], [2, 3, 4, 4, 5, 6]);
  assert.deepEqual([...img.data.subarray(18, 24)], [2, 2, 3, 4, 4, 5]);
  assert.deepEqual([...img.data.subarray(24, 30)], [3, 3, 4, 5, 5, 6]);
});

test('rejects what it cannot decode', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /not a PNG/);
  assert.throws(() => decodePng(png(1, 1, 0, [0, 9])), /unsupported PNG/);
});

const twoByTwo = () => ({
  width: 2,
  height: 2,
  channels: 3,
  data: Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]),
});

test('half blocks put the top pixel in the foreground', () => {
  const out = renderLines(twoByTwo());
  assert.ok(out.includes('38;2;255;0;0;48;2;0;0;255m▀'));
  assert.ok(out.includes('38;2;0;255;0;48;2;9;9;9m▀'));
  assert.ok(out.endsWith('\x1b[0m'));
});

test('256 colour mode uses the palette form', () => {
  const out = renderLines(twoByTwo(), { palette: 256 });
  assert.ok(out.includes('38;5;196;48;5;21m▀'));
});

test('Screen redraws only cells that changed', () => {
  const screen = new Screen(2, 1);
  const img = twoByTwo();
  assert.equal(screen.draw(img).split('▀').length - 1, 2);
  assert.equal(screen.draw(img), '');
  img.data[0] = 200;
  const diff = screen.draw(img);
  assert.equal(diff.split('▀').length - 1, 1);
  assert.ok(diff.startsWith('\x1b[1;1H'));
});

// Reads each u32 itself, because small Buffers share a pool at an arbitrary offset.
function cellWords(base64) {
  const bytes = Buffer.from(base64, 'base64');
  return Uint32Array.from({ length: bytes.length / 4 }, (_, i) => bytes.readUInt32LE(i * 4));
}

test('raster cells centre the image and leave the rest default', () => {
  const words = cellWords(renderCells(twoByTwo(), 4, 1));
  const DEFAULT = 0x01000000;
  assert.equal(words.length, 12);
  assert.deepEqual([...words.subarray(0, 3)], [0x20, DEFAULT, DEFAULT]);
  assert.deepEqual([...words.subarray(3, 6)], [0x2580, 0xff0000, 0x0000ff]);
  assert.deepEqual([...words.subarray(6, 9)], [0x2580, 0x00ff00, 0x090909]);
  assert.deepEqual([...words.subarray(9, 12)], [0x20, DEFAULT, DEFAULT]);
});

test('raster cells use the default background under an odd last row', () => {
  const img = { width: 1, height: 1, channels: 3, data: Uint8Array.from([1, 2, 3]) };
  const words = cellWords(renderCells(img, 1, 1));
  assert.deepEqual([...words], [0x2580, 0x010203, 0x01000000]);
});

test('inline images use the iTerm2 protocol with the decoded byte size', () => {
  const data = Buffer.from('12345').toString('base64');
  assert.equal(inlineImage(data), `\x1b]1337;File=inline=1;size=5;width=100%;preserveAspectRatio=1:${data}\x07\n`);
});

test('overlay images draw from the top corner and put the cursor back', () => {
  const data = Buffer.from('12345').toString('base64');
  assert.equal(overlayImage(data), `\x1b7\x1b[H\x1b]1337;File=inline=1;size=5;width=100%;preserveAspectRatio=1:${data}\x07\x1b8`);
});
