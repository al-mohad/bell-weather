import { PROTOCOL_VERSION, serveAgent } from '@bellwether/protocol';
import type { InitParams } from '@bellwether/protocol';
import { Erp5250Policy, parseGoal } from './policy';
import type { FocusStrategy } from './policy';

let policy: Erp5250Policy | undefined;

await serveAgent({
  init(params: InitParams) {
    const focus = (process.env.BELLWETHER_FOCUS as FocusStrategy | undefined) ?? 'click';
    policy = new Erp5250Policy(parseGoal(params.goal), params.display, focus);
    process.stderr.write(`scripted-baseline: task=${params.taskId} seed=${params.seed}\n`);
    return {
      agent: 'scripted-baseline',
      version: '0.1.0',
      protocol: PROTOCOL_VERSION,
      capabilities: ['text-screen', 'deterministic', `focus:${focus}`],
    };
  },
  step({ observation }) {
    if (!policy) throw new Error('agent.step before agent.init');
    if (!observation.screenText) {
      return {
        action: {
          kind: 'abstain',
          reason: 'this flow reads the character grid and the surface provided none',
        },
      };
    }
    return { action: policy.next(observation.screenText).action };
  },
});
