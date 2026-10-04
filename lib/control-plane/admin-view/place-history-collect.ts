import { appendPoint, isPlaceHistory, pointOf, type PlaceHistoryPoint } from "../../coverage/place-history.ts";
import { measuresByFamily, placeMeasures } from "../../coverage/place-measures.ts";
import { huntPlaceKey } from "./v6-hunts-read.ts";
import type { ExpansionScopeDecision } from "../expansion/scopes.ts";
import type { PlaceOwedRead, PlaceOwedRefusal } from "./place-owed-read.ts";

/**
 * **THE DAILY POINT FOR EACH PLACE WITH A SAVED SCOPE.** The owner snapshot
 * publisher calls this each round. A place already holding today's point is
 * skipped, so the owed list is read at most once a day per place, through the
 * same memoized read the Admin card uses. Places without a saved scope are never
 * scored here. A place that cannot be read keeps its earlier points untouched.
 */
export async function collectPlaceHistory(input: {
  readonly scopes: readonly Pick<ExpansionScopeDecision, "geography">[] | null;
  readonly previous: Readonly<Record<string, unknown>> | undefined;
  readonly now: string;
  readonly read: (placeKey: string) => Promise<PlaceOwedRead | PlaceOwedRefusal>;
  /** Places scored in one round, so a long list cannot stall the publisher; the rest follow next round. */
  readonly limit?: number;
}): Promise<Record<string, PlaceHistoryPoint[]>> {
  const out: Record<string, PlaceHistoryPoint[]> = {};
  const today = input.now.slice(0, 10);
  const keys = [...new Set((input.scopes ?? []).map(scope => huntPlaceKey(scope)))];
  for (const key of keys) { const prior = input.previous?.[key]; out[key] = isPlaceHistory(prior) ? prior : []; }
  let budget = input.limit ?? 6;
  for (const key of keys) {
    if (budget <= 0) break;
    if (out[key].some(point => point.day === today)) continue;
    budget--;
    try {
      const read = await input.read(key);
      if (read.state === "REFUSED") continue;
      out[key] = appendPoint(out[key], pointOf(input.now, placeMeasures(read.rows), measuresByFamily(read.rows, [])));
    } catch { /* an unreadable place keeps its earlier points */ }
  }
  return out;
}
