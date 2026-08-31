import { createHash } from "node:crypto";

import { getDb } from "./index.ts";
import { demandSignals } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import type { RunMarker } from "./run-marker.ts";

/**
 * **THE DEMAND-SIGNAL WRITE PATH, AND THERE IS NO READ PATH.** (OWN-Q6, the
 * owner's amendment on Q6/Q7, authorized 2026-08-31.)
 *
 * The owner asked for a pill reading *"Want us to get this info sooner?"* that
 * registers the click with a brief confirmation. This module is the whole of
 * what that pill does.
 *
 * ## What this file deliberately does not export
 *
 * **A read.** No `readDemandSignals`, no aggregate, no export shape, no count.
 * `CLAUDE.md`'s no-user-to-user rule says reactions are write-only from the
 * reader's perspective — stored and aggregated, never rendered back to any
 * user, including in aggregate — and the owner's own instruction on this
 * feature was that results are never shown to readers.
 *
 * A missing function is a stronger guarantee than a filter, for the reason
 * `lib/signal/aggregate.ts` gives about free text: a filter can be forgotten,
 * and a function that does not exist cannot be called. `tests/demand-signal.test.ts`
 * asserts the module's export surface, so adding a reader is a test change
 * somebody has to justify.
 *
 * ## No identity, and no continuity either
 *
 * `writeReaction` hashes a browser-invented continuity key so a reader can
 * change their mind. There is nothing equivalent here, because the owner said
 * no identity and that hash is the nearest thing to one this product holds. A
 * reader who taps twice writes two rows and nothing relates them. That is not
 * a de-duplication bug: the signal is a COUNT OF ASKS, which is exactly what
 * the pill records.
 *
 * ## The declaration is required, exactly as it is on reactions
 *
 * A row the store cannot attribute must never be counted as a reader. The
 * check runs BEFORE the database check so it fails identically whether or not
 * a database is reachable — a refusal that only fires in production is a
 * refusal the suite cannot see.
 */

/** The one value the pill can send. A union of one, on purpose. */
export const DEMAND_SIGNALS = ["WANT_THIS_SOONER"] as const;
export type DemandSignal = (typeof DEMAND_SIGNALS)[number];

/** The two kinds of card the pill appears on. Symmetric across both. */
export const DEMAND_SUBJECT_TYPES = ["BODY", "CANDIDATE"] as const;
export type DemandSubjectType = (typeof DEMAND_SUBJECT_TYPES)[number];

export interface StorableDemandSignal {
  readonly subjectType: DemandSubjectType;
  readonly subjectId: string;
  readonly signal: DemandSignal;
  /** Approximate location, the same basis as the search log. Never an address. */
  readonly ocdIds: string[];
  readonly marker: RunMarker;
}

/**
 * `sha256("demand-run:" + runId)` — its own digest space.
 *
 * The n-stores rule is proven over VALUE SPACES, never column names
 * (RULING 132). The search log holds a raw run id and `reactions` holds
 * `sha256("reaction-run:" + id)`; this holds a third digest, so no query can
 * relate a run's demand signals to its searches or its reactions. Same
 * precedent, same reason.
 */
export function hashRunId(runId: string): string {
  return createHash("sha256").update(`demand-run:${runId}`, "utf8").digest("hex");
}

/** Write one demand signal. Returns false when there is no database at all. */
export async function writeDemandSignal(row: StorableDemandSignal): Promise<boolean> {
  if (!row.marker || typeof row.marker.runClass !== "string") {
    throw new Error(
      "writeDemandSignal: no run marker. Every write must declare whose traffic it is — " +
        "pass markerFromRequest(request) on the route, or an explicit SYNTHETIC marker from a " +
        "script. There is no default: a row the store cannot attribute must not be counted as " +
        "a reader.",
    );
  }

  if (!process.env.DATABASE_URL) return false;

  // No database is a state; the WRONG database is a misconfiguration.
  assertWriteAllowed("a demand signal");

  // Null on ORGANIC by construction, so the id can never relate two readers'
  // rows to each other.
  const runId =
    row.marker.runClass === "ORGANIC" || !row.marker.runId
      ? null
      : hashRunId(row.marker.runId);

  await getDb().insert(demandSignals).values({
    occurredAt: new Date().toISOString(),
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    signal: row.signal,
    ocdIds: row.ocdIds,
    divisionVintage: DIVISION_VINTAGE,
    runClass: row.marker.runClass,
    runId,
  });

  return true;
}
