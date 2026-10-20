import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readLineageHistory } from "./scoped-history.ts";
import { selectStandingLineages, type StandingLineage } from "./standing-lineage.ts";

/** Scheduling retains lineage identifiers, never the country's work items, captures or worker results. */
export async function readStandingLineages(repos: ControlPlaneRepositories, obligationIds: Iterable<string>): Promise<readonly StandingLineage[]> {
  const out: StandingLineage[] = [];
  for (const obligationId of new Set(obligationIds)) {
    const history = await readLineageHistory(repos, "", { obligationId, scouts: false });
    out.push(...selectStandingLineages(history));
  }
  return out;
}
