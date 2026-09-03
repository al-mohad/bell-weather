/**
 * Cost model.
 *
 * The VM rate is NOT hard-coded to a guess: Solari's price list is the source of
 * truth and it changes. Leave it at 0 and the report says "cost not measured";
 * set it from the current price list and every result gains a cost_usd column.
 * Publishing an invented rate would be worse than publishing no rate.
 */
export interface CostModel {
  vmUsdPerMinute: number;
  /** Agent-reported model spend is always trusted and simply summed. */
}

export const FREE: CostModel = { vmUsdPerMinute: 0 };

export function vmCost(model: CostModel, wallMs: number): number {
  return (model.vmUsdPerMinute * wallMs) / 60_000;
}

export function costIsMeasured(model: CostModel): boolean {
  return model.vmUsdPerMinute > 0;
}
