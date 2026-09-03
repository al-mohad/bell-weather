import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RecordingDriver, ReplayDriver, SimDriver, SIM_STATE_PATH } from '../src/index';

describe('record and replay', () => {
  it('replays a recorded session without a backing driver', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bw-cassette-')), 'cassette.jsonl');

    const recorder = new RecordingDriver(new SimDriver(), path);
    const live = await recorder.createDesktop({ template: 'sim-erp5250' });
    await live.type('3');
    await live.press('Enter');
    const recordedFrame = await live.frame();
    const recordedState = await live.readFile(SIM_STATE_PATH);
    await live.kill();
    await recorder.close();

    const replay = new ReplayDriver(path);
    const handle = await replay.createDesktop({ template: 'sim-erp5250' });
    await handle.type('3');
    await handle.press('Enter');
    expect((await handle.frame()).screenText).toBe(recordedFrame.screenText);
    expect(await handle.readFile(SIM_STATE_PATH)).toBe(recordedState);
  });

  it('fails loudly when the harness diverges from the recording', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'bw-cassette-')), 'cassette.jsonl');
    const recorder = new RecordingDriver(new SimDriver(), path);
    const live = await recorder.createDesktop({ template: 'sim-erp5250' });
    await live.type('3');
    await recorder.close();

    const replay = new ReplayDriver(path);
    const handle = await replay.createDesktop({ template: 'sim-erp5250' });
    await expect(handle.press('Enter')).rejects.toThrow(/divergence/);
  });
});
