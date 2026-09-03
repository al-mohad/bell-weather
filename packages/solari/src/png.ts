import { deflateSync } from 'node:zlib';

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
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

export interface InkMapOptions {
  cellWidth?: number;
  cellHeight?: number;
  ink?: [number, number, number];
  paper?: [number, number, number];
}

/**
 * Renders a character grid as a coarse "ink map": one block per cell, filled where
 * the cell is not blank. It is deliberately low fidelity.
 *
 * The simulator exists to exercise the harness deterministically - scheduling,
 * budgets, faults, verifiers, pass^k arithmetic - not to test a vision model. Any
 * claim about visual grounding must come from a live run against a real surface.
 * Agents on the simulator are expected to read `observation.screenText`.
 */
export function inkMapPng(grid: readonly string[], options: InkMapOptions = {}): Buffer {
  const cw = options.cellWidth ?? 8;
  const ch = options.cellHeight ?? 16;
  const cols = grid.reduce((max, row) => Math.max(max, row.length), 1);
  const rows = Math.max(grid.length, 1);
  const width = cols * cw;
  const height = rows * ch;
  const [ir, ig, ib] = options.ink ?? [0x33, 0xff, 0x77];
  const [pr, pg, pb] = options.paper ?? [0x00, 0x1b, 0x0e];

  const rgb = new Uint8Array(width * height * 3);
  for (let py = 0; py < height; py++) {
    const row = grid[Math.floor(py / ch)] ?? '';
    const insetY = py % ch;
    for (let px = 0; px < width; px++) {
      const char = row[Math.floor(px / cw)] ?? ' ';
      const insetX = px % cw;
      const filled = char !== ' ' && insetY > 2 && insetY < ch - 3 && insetX < cw - 1;
      const offset = (py * width + px) * 3;
      rgb[offset] = filled ? ir : pr;
      rgb[offset + 1] = filled ? ig : pg;
      rgb[offset + 2] = filled ? ib : pb;
    }
  }
  return encodePng(width, height, rgb);
}

export const CELL = { width: 8, height: 16 } as const;

/** Pixel coordinate -> character cell. The simulator's only coordinate mapping. */
export function pixelToCell(x: number, y: number): { col: number; row: number } {
  return { col: Math.floor(x / CELL.width), row: Math.floor(y / CELL.height) };
}

export function cellToPixel(col: number, row: number): { x: number; y: number } {
  return { x: col * CELL.width + CELL.width / 2, y: row * CELL.height + CELL.height / 2 };
}
