import { createHash } from "node:crypto";

import { getDb } from "./index.ts";
import { demandSignals } from "./schema.ts";
import { DIVISION_VINTAGE } from "./search-log.ts";
import { assertWriteAllowed } from "./write-guard.ts";
import type { RunMarker } from "./run-marker.ts";

/**
 * The demand-signal write path. There is deliberately no read export: results
 * are never shown to readers, and tests assert the export surface. No identity
 * or continuity key: two taps are two unrelated rows. The declaration check
 * runs before the database check so it fails the same with or without one.
 */

/** The one value the pill can send. */
export const DEMAND_SIGNALS = ["WANT_THIS_SOONER"] as const;
export type DemandSignal = (typeof DEMAND_SIGNALS)[number];

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

/** Its own digest space, so no query can relate a run's demand signals to its searches or reactions. */
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

  // Null on ORGANIC rows, so the id can never relate two readers' rows.
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
