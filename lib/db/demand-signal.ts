import { randomUUID } from "node:crypto";
import { appendReaderEvents, type ReaderEventInput } from "./reader-events.ts";
import type { RunMarker } from "./run-marker.ts";

export const DEMAND_SIGNALS = ["WANT_THIS_SOONER"] as const;
export type DemandSignal = (typeof DEMAND_SIGNALS)[number];
export const DEMAND_SUBJECT_TYPES = ["BODY", "CANDIDATE"] as const;
export type DemandSubjectType = (typeof DEMAND_SUBJECT_TYPES)[number];
export interface StorableDemandSignal {
  readonly subjectType: DemandSubjectType;
  readonly subjectId: string;
  readonly signal: DemandSignal;
  readonly ocdIds: string[];
  readonly marker: RunMarker;
  readonly batchId?: string;
  readonly eventId?: string;
  readonly continuityKey?: string;
  readonly occurredAt?: string;
  readonly zip?: string | null;
  readonly question?: string | null;
  readonly durationMs?: number | null;
  readonly residencyRelation?: ReaderEventInput["residencyRelation"];
  readonly tester?: boolean;
}
/** Demand taps share immutable history, text scrubbing and class-aware counts with every reader event. */
export async function writeDemandSignal(row: StorableDemandSignal,
  options: Parameters<typeof appendReaderEvents>[1] = {}): Promise<boolean> {
  if (!row.marker || typeof row.marker.runClass !== "string") throw new Error("writeDemandSignal: no run marker");
  if ((row.batchId || row.eventId) && !row.occurredAt) throw new Error("writeDemandSignal: retry ids require occurredAt");
  if (!process.env.DATABASE_URL && !options.query) return false;
  const id = row.eventId ?? row.batchId ?? randomUUID();
  await appendReaderEvents({
    batchId: row.batchId ?? id, continuityKey: row.continuityKey ?? id, runClass: row.marker.runClass,
    events: [{
      id, type: "REACTION", occurredAt: row.occurredAt ?? new Date().toISOString(),
      zip: row.zip, districtIds: row.ocdIds, cardId: row.subjectId, cardKind: row.subjectType,
      reaction: row.signal, question: row.question, durationMs: row.durationMs,
      residencyRelation: row.residencyRelation, tester: row.tester,
    }],
  }, options);
  return true;
}
