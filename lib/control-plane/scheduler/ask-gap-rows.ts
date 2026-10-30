import type { WorkInput, WorkList } from "../../core/work.ts";
import { ASK_GAPS_PROVIDER_ID, ASK_GAP_NAMESPACE, parseAskGapObligationId } from "../ask-gap-id.ts";
import type { RegisteredUnit } from "./registry.ts";

/** One waiting row for each gap Ask would state; the row's series is the gap's obligation id. */
function askGapRows(units: readonly RegisteredUnit[]): readonly WorkInput[] {
  return units.flatMap((unit): WorkInput[] => {
    const gap = unit.providerId === ASK_GAPS_PROVIDER_ID ? parseAskGapObligationId(unit.obligation.id) : null;
    if (gap === null) return [];
    const { obligation, route } = unit;
    return [{ kind: "recheck", tier: "coverage", placeId: obligation.scopeDivisions?.[0] ?? gap.bodyId, subjectId: gap.bodyId, claimKey: gap.code,
      series: obligation.id, origin: { from: "planner" }, source: { source: "Ask would state this gap" },
      value: { gap: gap.code, label: route.label, citation: route.citation, readerImpactAt: obligation.readerImpactAt, everyHours: obligation.declaredCycleHours ?? null } }];
  });
}

/** The gaps are put on the list; when the provider read cleanly, the state's rows of gaps it no longer yields are finished. */
export async function keepAskGapRows(list: WorkList, units: readonly RegisteredUnit[], readCleanly: boolean, state: string): Promise<void> {
  const rows = askGapRows(units);
  await list.ensure(rows);
  if (readCleanly) await list.retireSeries(ASK_GAP_NAMESPACE, rows.map(row => row.series!), state);
}
