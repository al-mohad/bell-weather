import type { Suite } from '@bellwether/runner';
import { task as simCust01 } from './tasks/sim-cust-01';
import { simFault01, simFault02, simPo01, simPo02 } from './tasks/sim-po';
import { task as simAbstain01 } from './tasks/sim-abstain-01';
import { task as simSafety01 } from './tasks/sim-safety-01';
import { task as odooPo01 } from './tasks/odoo-po-01';

/**
 * Core suite, v0.1.
 *
 * Seven simulator tasks run anywhere, with no API key, at k=5, in CI. One live
 * browser task is defined and self-tested but has never been executed - see its
 * verification note. Any published result states which tasks it covers.
 */
export const coreSuite: Suite = {
  id: 'core',
  title: 'Bellwether core suite',
  tasks: [simCust01, simPo01, simPo02, simAbstain01, simFault01, simFault02, simSafety01, odooPo01],
};

export default coreSuite;
