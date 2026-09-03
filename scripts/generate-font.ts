/**
 * Generates packages/solari/src/sim/font-8x16.ts from a BDF bitmap font.
 *
 * The simulator's frames used to be a coarse "ink map" — one filled block per
 * non-blank cell — which exercised the harness but was unreadable, so nothing
 * measured on it could say anything about vision. Rendering real glyphs makes a
 * simulator frame something a vision agent can actually be pointed at.
 *
 * The font is generated rather than hand-typed so the glyphs are correct, and the
 * generated file is committed so a build needs no network.
 *
 *   pnpm tsx scripts/generate-font.ts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = 'https://raw.githubusercontent.com/fcambus/spleen/master/spleen-8x16.bdf';
const FIRST = 32;
const LAST = 126;
const WIDTH = 8;
const HEIGHT = 16;

const bdf = await fetch(SOURCE).then((response) => {
  if (!response.ok) throw new Error(`${SOURCE} returned ${response.status}`);
  return response.text();
});

const glyphs = new Map<number, number[]>();
let encoding: number | null = null;
let bbx: number[] | null = null;
let rows: number[] | null = null;

for (const line of bdf.split('\n')) {
  const text = line.trim();
  if (text.startsWith('ENCODING ')) {
    encoding = Number(text.slice(9));
  } else if (text.startsWith('BBX ')) {
    bbx = text.slice(4).split(/\s+/).map(Number);
  } else if (text === 'BITMAP') {
    rows = [];
  } else if (text === 'ENDCHAR') {
    if (encoding !== null && rows && bbx && encoding >= FIRST && encoding <= LAST) {
      const [w, h] = bbx;
      if (w !== WIDTH || h !== HEIGHT) {
        throw new Error(
          `glyph ${encoding} has bounding box ${w}x${h}, expected ${WIDTH}x${HEIGHT}`,
        );
      }
      glyphs.set(encoding, rows);
    }
    encoding = null;
    bbx = null;
    rows = null;
  } else if (rows && /^[0-9A-Fa-f]+$/.test(text)) {
    rows.push(parseInt(text.slice(0, 2), 16));
  }
}

const missing: number[] = [];
for (let code = FIRST; code <= LAST; code++) {
  const glyph = glyphs.get(code);
  if (!glyph || glyph.length !== HEIGHT) missing.push(code);
}
if (missing.length > 0) {
  throw new Error(`font is missing or malformed for code points: ${missing.join(', ')}`);
}

const lines: string[] = [];
for (let code = FIRST; code <= LAST; code++) {
  const glyph = glyphs.get(code) as number[];
  const hex = glyph.map((row) => row.toString(16).padStart(2, '0')).join('');
  const label = code === 32 ? 'space' : String.fromCharCode(code);
  lines.push(`  '${hex}', // ${code} ${label === "'" ? 'apostrophe' : label}`);
}

const output = `/**
 * 8x16 bitmap font for the simulator's terminal surface.
 *
 * GENERATED FILE — do not edit. Regenerate with:
 *   pnpm tsx scripts/generate-font.ts
 *
 * Source: Spleen 8x16 by Frederic Cambus, BSD-2-Clause.
 * https://github.com/fcambus/spleen — see NOTICE.
 *
 * Each entry is one glyph: ${HEIGHT} rows of ${WIDTH} pixels, one hex byte per row,
 * most significant bit leftmost. Index 0 is code point ${FIRST}.
 */

export const FONT_FIRST_CODE = ${FIRST};
export const FONT_LAST_CODE = ${LAST};
export const FONT_WIDTH = ${WIDTH};
export const FONT_HEIGHT = ${HEIGHT};

const GLYPH_HEX: readonly string[] = [
${lines.join('\n')}
];

/** Rows of a glyph as bytes, or the space glyph for anything unprintable. */
export function glyphRows(code: number): readonly number[] {
  const index = code >= FONT_FIRST_CODE && code <= FONT_LAST_CODE ? code - FONT_FIRST_CODE : 0;
  const hex = GLYPH_HEX[index] ?? GLYPH_HEX[0] ?? '';
  const rows: number[] = [];
  for (let i = 0; i < hex.length; i += 2) rows.push(parseInt(hex.slice(i, i + 2), 16));
  return rows;
}
`;

const target = fileURLToPath(new URL('../packages/solari/src/sim/font-8x16.ts', import.meta.url));
writeFileSync(target, output);
console.log(`wrote ${target} (${glyphs.size} glyphs from Spleen 8x16)`);
