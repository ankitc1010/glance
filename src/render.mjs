// Draws images as "▀" cells: the foreground colour is the top pixel and the background
// is the bottom one, so each terminal cell shows two roughly square pixels.
const BLOCK = '▀';
const EMPTY = 0;
const UPPER_HALF = 0x2580;
const SPACE = 0x20;
const DEFAULT_COLOUR = 0x01000000;

function pixel(img, x, y) {
  if (x >= img.width || y >= img.height) return EMPTY;
  const i = (y * img.width + x) * img.channels;
  return (img.data[i] << 16) | (img.data[i + 1] << 8) | img.data[i + 2];
}

function to256(c) {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const q = (v) => (v < 48 ? 0 : v < 115 ? 1 : Math.min(5, Math.floor((v - 35) / 40)));
  return 16 + 36 * q(r) + 6 * q(g) + q(b);
}

function colours(top, bottom, palette) {
  if (palette === 256) return `\x1b[38;5;${to256(top)};48;5;${to256(bottom)}m`;
  return `\x1b[38;2;${(top >> 16) & 255};${(top >> 8) & 255};${top & 255};48;2;${(bottom >> 16) & 255};${(bottom >> 8) & 255};${bottom & 255}m`;
}

// One-shot output for scrollback: plain lines, with no cursor movement.
export function renderLines(img, { palette = 24 } = {}) {
  const rows = Math.ceil(img.height / 2);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    let last = '';
    for (let c = 0; c < img.width; c++) {
      const seq = colours(pixel(img, c, r * 2), pixel(img, c, r * 2 + 1), palette);
      if (seq !== last) line += seq;
      last = seq;
      line += BLOCK;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines.join('\n');
}

// A real picture via the iTerm2 inline image protocol, for terminals that support it.
// Terminals that do not support it ignore the sequence and show nothing.
export function inlineImage(pngBase64) {
  const size = Buffer.byteLength(pngBase64, 'base64');
  return `\x1b]1337;File=inline=1;size=${size};width=100%;preserveAspectRatio=1:${pngBase64}\x07\n`;
}

// The same picture over the top of a full-screen program. The cursor goes back to where
// it was, so the program's own drawing stays aligned.
export function overlayImage(pngBase64) {
  return `\x1b7\x1b[H${inlineImage(pngBase64).trimEnd()}\x1b8`;
}

// The cell grid of Claude Code's Raster element, base64 of little-endian u32 triplets:
// code point, foreground, background. The image is centred and the rest stays default.
export function renderCells(img, cols, rows) {
  const words = new Uint32Array(cols * rows * 3);
  const left = Math.floor((cols - img.width) / 2);
  const top = Math.floor((rows - Math.ceil(img.height / 2)) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = (r * cols + c) * 3;
      const x = c - left;
      const y = (r - top) * 2;
      if (x < 0 || x >= img.width || y < 0 || y >= img.height) {
        words[i] = SPACE;
        words[i + 1] = DEFAULT_COLOUR;
        words[i + 2] = DEFAULT_COLOUR;
        continue;
      }
      words[i] = UPPER_HALF;
      words[i + 1] = pixel(img, x, y);
      words[i + 2] = y + 1 < img.height ? pixel(img, x, y + 1) : DEFAULT_COLOUR;
    }
  }
  return Buffer.from(words.buffer).toString('base64');
}

// Remembers what is on screen and emits only the cells that changed.
export class Screen {
  constructor(cols, rows, { palette = 24 } = {}) {
    this.cols = cols;
    this.rows = rows;
    this.palette = palette;
    this.top = new Int32Array(cols * rows).fill(-1);
    this.bottom = new Int32Array(cols * rows).fill(-1);
  }

  draw(img) {
    let out = '';
    let curR = -1;
    let curC = -1;
    let last = '';
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const i = r * this.cols + c;
        const t = pixel(img, c, r * 2);
        const b = pixel(img, c, r * 2 + 1);
        if (t === this.top[i] && b === this.bottom[i]) continue;
        this.top[i] = t;
        this.bottom[i] = b;
        if (r !== curR || c !== curC) out += `\x1b[${r + 1};${c + 1}H`;
        const seq = colours(t, b, this.palette);
        if (seq !== last) out += seq;
        last = seq;
        out += BLOCK;
        curR = r;
        curC = c + 1;
      }
    }
    return out ? out + '\x1b[0m' : '';
  }
}
