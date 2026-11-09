import { canonicalJson } from "../control-plane/repository/types.ts";
import type { SavedCopy } from "../facts/check.ts";
import { publishClaim, type Clocks, type FactDb } from "../facts/publish.ts";
import { doorMany, type ResultWrite, type ResultWriteOutcome } from "../core/door.ts";
import type { ReaderCachePurger } from "../reader/cache.ts";

export type { ResultWrite, ResultWriteOutcome };

/** Result facts go through the door in one pass; what its fast path leaves goes through the ordinary door one fact at a time. */
export async function publishResultWrites(db: FactDb, writes: readonly ResultWrite[], copy: SavedCopy, clocks: Clocks, now: Date,
  purge?: ReaderCachePurger): Promise<ResultWriteOutcome[]> {
  const { outcomes, slow } = await doorMany(db, writes, copy, clocks, now, purge);
  for (const index of slow) {
    const write = writes[index], derived = write.quotes.map((quote, i) => ({ quote, text: i === 0 ? canonicalJson(write.value) : "" }));
    const outcome = await publishClaim(db, {
      entity: { id: write.id, fullName: write.name, stateName: null, hosts: [], externalIds: [] },
      field: write.field, fieldKind: "ballot", provenance: "REFERENCE", value: write.value, valueText: derived.map(part => part.text).join(" "),
      quote: write.quotes.join("\n"), derived, copy, acquisition: "checked", producedBy: "election-results", costUsd: 0,
    }, clocks, now, { purge });
    outcomes[index] = "blank" in outcome ? { blank: outcome.blank } : { decision: outcome.decision };
  }
  return outcomes;
}
