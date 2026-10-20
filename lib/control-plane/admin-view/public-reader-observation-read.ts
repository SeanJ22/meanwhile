import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { ServedReaderWitness } from "../served-reader.ts";
import type { WorkItem } from "../work-item.ts";
import { PUBLIC_SITE_ORIGIN } from "../../ops/origins.ts";

export const EXACT_SERVED_WITNESS_SQL = `
  SELECT entry.witness
  FROM cp_owner_snapshots AS snapshot
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(coalesce(snapshot.value->'servedReader',snapshot.value->'servedReaderReadback')->'witnesses') = 'array'
      THEN coalesce(snapshot.value->'servedReader',snapshot.value->'servedReaderReadback')->'witnesses' ELSE '[]'::jsonb END
  ) AS entry(witness)
  WHERE (snapshot.id = 'current' OR snapshot.id LIKE 'readback:%')
    AND entry.witness->>'itemId' = $1
    AND entry.witness->>'approvalId' = $2
    AND entry.witness->>'versionId' = $3
  ORDER BY entry.witness->>'checkedAt' DESC
  LIMIT 1`;

export interface PublishedResultSubjectKey {
  readonly kind: "WORK_ITEM";
  readonly workItemId: string;
  readonly subject: string;
}

export type ExactPublicObservation =
  | { readonly state: "UNAVAILABLE"; readonly witness: null }
  | { readonly state: "CONFIRMED" | "NOT_OBSERVED"; readonly witness: ServedReaderWitness };

export interface PublishedResultObservation {
  readonly subjectKey: PublishedResultSubjectKey;
  /** This read does not inspect the independent validation/audit chain. */
  readonly factualVerification: { readonly state: "NOT_READ" };
  readonly publication: null | {
    readonly state: "PUBLISHED" | "PARTIALLY_PUBLISHED";
    readonly at: string;
    readonly workerResultId: string;
    readonly versionId: string;
    readonly code: string;
  };
  readonly publicObservation: ExactPublicObservation;
}

export class PublishedResultQueryError extends Error {
  readonly code: "INVALID_SUBJECT_KEY" | "SUBJECT_MISMATCH";
  constructor(code: "INVALID_SUBJECT_KEY" | "SUBJECT_MISMATCH") { super(code); this.code = code; }
}

export function parsePublishedResultSubjectKey(workItemId: string | null, subject: string | null): PublishedResultSubjectKey {
  if (!workItemId || !subject || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/.test(workItemId) ||
    subject.length > 400 || /[\u0000-\u001f]/.test(subject)) throw new PublishedResultQueryError("INVALID_SUBJECT_KEY");
  return { kind: "WORK_ITEM", workItemId, subject };
}

function exactWitness(value: unknown, item: WorkItem): ServedReaderWitness | null {
  const outcome = item.publicationOutcome;
  if (!outcome?.versionId || !value || typeof value !== "object") return null;
  const w = value as Record<string, unknown>;
  if (w.itemId !== item.id || w.approvalId !== outcome.workerResultId || w.versionId !== outcome.versionId ||
    !["CONFIRMED", "NOT_OBSERVED"].includes(String(w.state)) || typeof w.readerKey !== "string" ||
    typeof w.url !== "string" || !(w.url === PUBLIC_SITE_ORIGIN || w.url.startsWith(`${PUBLIC_SITE_ORIGIN}/`)) ||
    typeof w.checkedAt !== "string" || !Number.isFinite(Date.parse(w.checkedAt)) ||
    typeof w.reason !== "string" || (w.responseSha256 !== null && typeof w.responseSha256 !== "string")) return null;
  return w as unknown as ServedReaderWitness;
}

export async function readExactServedWitness(sql: Sql, item: WorkItem): Promise<ServedReaderWitness | null> {
  const outcome = item.publicationOutcome;
  if (!outcome?.versionId || outcome.status === "HELD") return null;
  const rows = await boundedQuery(sql, { operation: "cp_owner_snapshots.exactServedWitness", callClass: "POINT" },
    EXACT_SERVED_WITNESS_SQL, [item.id, outcome.workerResultId, outcome.versionId]) as readonly { readonly witness?: unknown }[];
  return exactWitness(rows[0]?.witness, item);
}

export async function readPublishedResultObservation(input: {
  readonly repos: Pick<ControlPlaneRepositories, "workItems">;
  readonly subjectKey: PublishedResultSubjectKey;
  readonly readWitness: (item: WorkItem) => Promise<ServedReaderWitness | null>;
}): Promise<PublishedResultObservation | null> {
  const saved = await input.repos.workItems.read(input.subjectKey.workItemId);
  if (!saved) return null;
  const item = saved.value;
  if (item.subject !== input.subjectKey.subject) throw new PublishedResultQueryError("SUBJECT_MISMATCH");
  const outcome = item.publicationOutcome;
  const publication = outcome && outcome.status !== "HELD" && outcome.versionId ? {
    state: outcome.status, at: outcome.at, workerResultId: outcome.workerResultId,
    versionId: outcome.versionId, code: outcome.code,
  } as const : null;
  const witness = publication ? await input.readWitness(item) : null;
  return { subjectKey: input.subjectKey, factualVerification: { state: "NOT_READ" }, publication,
    publicObservation: witness ? { state: witness.state, witness } : { state: "UNAVAILABLE", witness: null } };
}
