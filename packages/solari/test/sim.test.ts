import { describe, expect, it } from 'vitest';
import { normalizeKey } from '@bellwether/protocol';
import {
  Erp5250Sim,
  SimDriver,
  SIM_STATE_PATH,
  encodePng,
  inkMapPng,
  pixelToCell,
} from '../src/index';

const CELL = { width: 8, height: 16 };

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

  it('renders a character grid at cell resolution', () => {
    const png = inkMapPng(['ab', 'cd']);
    expect(png.length).toBeGreaterThan(60);
  });

  it('maps pixels to cells consistently with the sim', () => {
    expect(pixelToCell(8 * 26 + 4, 16 * 8 + 4)).toEqual({ col: 26, row: 8 });
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

it('cell mapping matches the exported constant', () => {
  expect(pixelToCell(CELL.width, CELL.height)).toEqual({ col: 1, row: 1 });
});
