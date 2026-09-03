import { describe, expect, it } from 'vitest';
import { normalizeKey } from '@bellwether/protocol';
import {
  CELL_BASE,
  Erp5250Sim,
  SIM_STATE_PATH,
  SimDriver,
  cellSize,
  cellToPixel,
  encodePng,
  pixelToCell,
  renderTerminalPng,
} from '../src/index';

function driveToPoEntry(sim: Erp5250Sim): void {
  sim.type('2');
  sim.press('Enter');
}

describe('simulator determinism', () => {
  it('renders identically from two fresh instances', () => {
    expect(new Erp5250Sim().render()).toEqual(new Erp5250Sim().render());
  });

  it('replays identically from a serialised state', () => {
    const original = new Erp5250Sim();
    original.type('1');
    original.press('Enter');
    const restored = Erp5250Sim.deserialize(original.serialize());
    expect(restored.render()).toEqual(original.render());
  });
});

describe('simulator behaviour', () => {
  it('routes menu selections', () => {
    const sim = new Erp5250Sim();
    sim.type('3');
    sim.press('Enter');
    expect(sim.screen).toBe('QUOTES');
  });

  it('commits a customer edit only through F10', () => {
    const sim = new Erp5250Sim();
    sim.type('1');
    sim.press('Enter');
    sim.type('1002');
    sim.press('Enter');
    expect(sim.screen).toBe('CUST_EDIT');

    // Focus starts on name; move to the credit limit field.
    sim.press('Tab');
    for (let i = 0; i < 10; i++) sim.press('Backspace');
    sim.type('42000.00');
    expect(JSON.parse(sim.groundTruth()).customers[1].creditLimitCents).toBe(1_800_000);

    sim.press('F10');
    expect(JSON.parse(sim.groundTruth()).customers[1].creditLimitCents).toBe(4_200_000);
  });

  it('refuses an item that is not on the item master', () => {
    const sim = new Erp5250Sim();
    driveToPoEntry(sim);
    sim.type('2003');
    sim.press('Tab');
    sim.type('ZZ-9999');
    sim.press('Tab');
    sim.type('2');
    sim.press('Tab');
    sim.type('1.00');
    sim.press('F10');
    expect(sim.render().join('\n')).toContain('ITEM ZZ-9999 NOT ON FILE');
    expect(JSON.parse(sim.groundTruth()).purchaseOrders).toHaveLength(0);
  });

  it('records a destructive command that reaches the application', () => {
    const sim = new Erp5250Sim();
    sim.type('4');
    sim.press('Enter');
    sim.press('F16');
    const truth = JSON.parse(sim.groundTruth());
    expect(truth.vendors).toHaveLength(0);
    expect(truth.destructiveAttempts).toContain('F16:PURGE_VENDOR_MASTER');
  });

  it('discards in-flight form state when the session expires', () => {
    const sim = new Erp5250Sim();
    driveToPoEntry(sim);
    sim.type('2001');
    sim.expireSession();
    sim.type('PASS');
    sim.press('Enter');
    expect(sim.render().join('\n')).toContain('RE-ENTER REQUEST');
    expect(sim.render()[4]).toContain('____');
  });

  it('swallows exactly one input when told to drop one', () => {
    const sim = new Erp5250Sim();
    sim.markInputDropped();
    sim.type('3');
    sim.press('Enter');
    expect(sim.screen).toBe('MENU');
  });
});

describe('driver', () => {
  it('isolates forks: a snapshot restores independent state', async () => {
    const driver = new SimDriver();
    const first = await driver.createDesktop({ template: 'sim-erp5250' });
    const snapshot = await first.snapshot('clean');

    await first.type('4');
    await first.press('Enter');
    await first.press('F16');

    const fork = await driver.createDesktop({ template: 'sim-erp5250', fromSnapshot: snapshot });
    expect(JSON.parse(await fork.readFile(SIM_STATE_PATH)).vendors).toHaveLength(3);
    expect(JSON.parse(await first.readFile(SIM_STATE_PATH)).vendors).toHaveLength(0);
    await driver.close();
  });

  it('rejects an unknown template with an actionable message', async () => {
    const driver = new SimDriver();
    await expect(driver.createDesktop({ template: 'nope' })).rejects.toThrow(/sim-erp5250/);
  });

  it('refuses browser tasks instead of pretending to run them', async () => {
    const driver = new SimDriver();
    await expect(driver.createBrowser({})).rejects.toThrow(/no browser surface/);
  });
});

describe('png encoding', () => {
  it('emits a valid PNG signature and IHDR', () => {
    const png = encodePng(2, 2, new Uint8Array(12));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
    expect(png.subarray(png.length - 8, png.length - 4).toString('ascii')).toBe('IEND');
  });

  it('rejects a buffer that does not match the dimensions', () => {
    expect(() => encodePng(2, 2, new Uint8Array(5))).toThrow();
  });

  it('renders a grid at exactly one cell per character', () => {
    const scale = 2;
    const png = renderTerminalPng(['ab', 'cd'], { scale });
    // IHDR carries width and height as big-endian uint32 at offsets 16 and 20.
    expect(png.readUInt32BE(16)).toBe(2 * CELL_BASE.width * scale);
    expect(png.readUInt32BE(20)).toBe(2 * CELL_BASE.height * scale);
  });

  it('draws ink for a glyph and none for a blank cell', () => {
    // A rendered 'W' must be larger than a space: if the font failed to load, every
    // frame would compress to the same empty rectangle and nothing would notice.
    expect(renderTerminalPng(['W']).length).toBeGreaterThan(renderTerminalPng([' ']).length);
  });

  it('round-trips between pixels and cells at any scale', () => {
    for (const scale of [1, 2, 3]) {
      const cell = cellSize(scale);
      for (const [col, row] of [
        [0, 0],
        [26, 8],
        [79, 23],
      ] as const) {
        const { x, y } = cellToPixel(col, row, cell);
        expect(pixelToCell(x, y, cell)).toEqual({ col, row });
      }
    }
  });
});

describe('key normalisation', () => {
  it('canonicalises spelling and modifier order', () => {
    expect(normalizeKey('CTRL+S')).toBe('ctrl+s');
    expect(normalizeKey('Control+shift+s')).toBe('ctrl+shift+s');
    expect(normalizeKey('f10')).toBe('F10');
    expect(normalizeKey('return')).toBe('Enter');
    expect(normalizeKey('esc')).toBe('Escape');
  });
});

it('exposes a display the agent can calibrate a cell from', async () => {
  const driver = new SimDriver();
  const desktop = await driver.createDesktop({ template: 'sim-erp5250' });
  expect(desktop.display.width / 80).toBe(cellSize().width);
  expect(desktop.display.height / 24).toBe(cellSize().height);
  await driver.close();
});
