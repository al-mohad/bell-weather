import { deflateSync } from 'node:zlib';
import { FONT_HEIGHT, FONT_WIDTH, glyphRows } from './sim/font-8x16';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Uint8Array): number {
  let crc = -1;
  for (const byte of buffer) crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ byte) & 0xff] as number);
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Minimal truecolour PNG encoder. Hand-rolled rather than pulled from npm because
 * the only image this repo produces is the simulator's frame, and a benchmark's
 * dependency tree should be short enough for a reviewer to read in full.
 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== width * height * 3) {
    throw new Error(`rgb buffer is ${rgb.length} bytes, expected ${width * height * 3}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(rgb.subarray(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface TerminalRenderOptions {
  /** Integer upscale. 1 renders at the font's native 8x16 cell. */
  scale?: number;
  ink?: readonly [number, number, number];
  paper?: readonly [number, number, number];
}

/** The font's native cell. Everything else derives from it and the scale. */
export const CELL_BASE = { width: FONT_WIDTH, height: FONT_HEIGHT } as const;

export function cellSize(scale = DEFAULT_SCALE): { width: number; height: number } {
  return { width: CELL_BASE.width * scale, height: CELL_BASE.height * scale };
}

export const DEFAULT_SCALE = 2;

/**
 * Renders a character grid as real glyphs.
 *
 * This is what makes a simulator frame worth showing to a vision model. The earlier
 * version drew one filled block per non-blank cell, which was enough to exercise the
 * harness and useless for anything else; a frame that a person cannot read is a frame
 * no visual-grounding claim can rest on.
 *
 * Geometry is exact by construction: cell (col, row) occupies pixels
 * [col*w, col*w+w) x [row*h, row*h+h), so a click coordinate maps back to a cell with
 * no calibration. `pixelToCell` is the inverse and the two are asserted against each
 * other in the tests.
 */
export function renderTerminalPng(
  grid: readonly string[],
  options: TerminalRenderOptions = {},
): Buffer {
  const scale = Math.max(1, Math.floor(options.scale ?? DEFAULT_SCALE));
  const cols = grid.reduce((max, row) => Math.max(max, row.length), 1);
  const rows = Math.max(grid.length, 1);
  const cell = cellSize(scale);
  const width = cols * cell.width;
  const height = rows * cell.height;

  const [ir, ig, ib] = options.ink ?? PHOSPHOR;
  const [pr, pg, pb] = options.paper ?? SCREEN_BLACK;

  const rgb = new Uint8Array(width * height * 3);
  // Paint the ground first; glyphs are then stamped over it.
  for (let offset = 0; offset < rgb.length; offset += 3) {
    rgb[offset] = pr;
    rgb[offset + 1] = pg;
    rgb[offset + 2] = pb;
  }

  for (let row = 0; row < rows; row++) {
    const line = grid[row] ?? '';
    for (let col = 0; col < cols; col++) {
      const code = line.charCodeAt(col);
      if (Number.isNaN(code) || code === 32) continue;
      const glyph = glyphRows(code);
      for (let gy = 0; gy < CELL_BASE.height; gy++) {
        const bits = glyph[gy] ?? 0;
        if (bits === 0) continue;
        for (let gx = 0; gx < CELL_BASE.width; gx++) {
          if ((bits & (0x80 >> gx)) === 0) continue;
          const originX = col * cell.width + gx * scale;
          const originY = row * cell.height + gy * scale;
          for (let dy = 0; dy < scale; dy++) {
            let offset = ((originY + dy) * width + originX) * 3;
            for (let dx = 0; dx < scale; dx++) {
              rgb[offset] = ir;
              rgb[offset + 1] = ig;
              rgb[offset + 2] = ib;
              offset += 3;
            }
          }
        }
      }
    }
  }

  return encodePng(width, height, rgb);
}

const PHOSPHOR: readonly [number, number, number] = [0x3b, 0xff, 0x7a];
const SCREEN_BLACK: readonly [number, number, number] = [0x03, 0x14, 0x0b];

/** Pixel coordinate -> character cell. The inverse of the renderer's geometry. */
export function pixelToCell(
  x: number,
  y: number,
  cell: { width: number; height: number } = cellSize(),
): { col: number; row: number } {
  return { col: Math.floor(x / cell.width), row: Math.floor(y / cell.height) };
}

export function cellToPixel(
  col: number,
  row: number,
  cell: { width: number; height: number } = cellSize(),
): { x: number; y: number } {
  return {
    x: col * cell.width + Math.floor(cell.width / 2),
    y: row * cell.height + Math.floor(cell.height / 2),
  };
}
