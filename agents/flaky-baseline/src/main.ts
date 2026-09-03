import { makeRng, type Rng } from '@bellwether/core';
import { PROTOCOL_VERSION, serveAgent } from '@bellwether/protocol';
import type { Action, InitParams } from '@bellwether/protocol';
import { Erp5250Policy, parseGoal } from '@bellwether/agent-scripted-baseline';

/**
 * Why this agent exists.
 *
 * The interesting number in computer-use reliability is not "can it do the task
 * once" but "does per-step error compound faster than the agent can self-correct".
 * Measuring that with a real model costs money, needs an API key and cannot be
 * reproduced by a reader. This agent isolates the same arithmetic: it is the
 * calibrated ceiling flow with a known per-step error rate, and - critically - it
 * *believes its own errors succeeded*, so it does not re-check the field it fumbled.
 *
 * That single property is what turns a self-correcting flow into a curve that
 * collapses with k, and it is the failure mode observed in real computer-use
 * agents: not confusion, but misplaced confidence.
 *
 * Tune with BELLWETHER_FLAKY_P (default 0.08).
 */
const P = Number(process.env.BELLWETHER_FLAKY_P ?? 0.08);

let policy: Erp5250Policy | undefined;
let rng: Rng | undefined;

function corrupt(action: Action, random: Rng): { action: Action; noticed: boolean } {
  switch (action.kind) {
    case 'click': {
      // Off-by-one field: the classic coordinate-grounding error.
      const dx = random.pick([-64, -32, 32, 64]);
      return { action: { ...action, x: Math.max(0, action.x + dx) }, noticed: false };
    }
    case 'type': {
      if (action.text.length <= 1) return { action, noticed: true };
      const cut = random.int(0, action.text.length - 1);
      const mangled = action.text.slice(0, cut) + action.text.slice(cut + 1);
      return { action: { ...action, text: mangled }, noticed: false };
    }
    case 'key': {
      // Committing early is the expensive mistake: it writes a partial record.
      const substitute = random.pick(['Enter', 'Tab', 'F10']);
      return { action: { ...action, keys: substitute }, noticed: true };
    }
    default:
      return { action, noticed: true };
  }
}

await serveAgent({
  init(params: InitParams) {
    policy = new Erp5250Policy(parseGoal(params.goal));
    rng = makeRng(params.seed);
    process.stderr.write(`flaky-baseline: p=${P} seed=${params.seed}\n`);
    return {
      agent: 'flaky-baseline',
      version: '0.1.0',
      protocol: PROTOCOL_VERSION,
      capabilities: ['text-screen', 'seeded-error-injection'],
    };
  },
  step({ observation }) {
    if (!policy || !rng) throw new Error('agent.step before agent.init');
    if (!observation.screenText) {
      return { action: { kind: 'abstain', reason: 'no character grid on this surface' } };
    }

    const intended = policy.next(observation.screenText);
    if (!rng.chance(P)) return { action: intended.action };

    const { action, noticed } = corrupt(intended.action, rng);
    // The agent moves on believing the field is done. Nothing re-checks it.
    if (!noticed && intended.field) policy.trust(intended.field);
    process.stderr.write(
      `flaky-baseline: perturbed ${intended.action.kind} (field=${intended.field ?? '-'})\n`,
    );
    return { action };
  },
});
