import { randomUUID } from "node:crypto";
import { DIGEST_LOG_KEY } from "../admin-data.ts";
import { fingerprint } from "../ids.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type FreshnessDetailReference, type OwnerDigestRecord } from "../owner-surface.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { appendFreshnessCycleDetails } from "../freshness-cycle-details.ts";
import { RESEARCH_STATE_ID } from "../scheduler/research-policy.ts";
import type { AssignmentCycleReading, AssignmentReading, StreamedAssignmentCycleReading } from "./assignment-budget.ts";
import { READING_LIST_CAP } from "./reading.ts";

type Repositories = Pick<ControlPlaneRepositories, "ownerDigests" | "researchState">;
export type AssignmentCycleHeader = Omit<AssignmentCycleReading, "assignments">;
const refLog = (details: FreshnessDetailReference, ref: string | null) => `${details.logKey}:ref:${fingerprint([JSON.stringify(ref)])}`;
const rowId = (log: string, key: string) => `${log}:${fingerprint([key])}`;
const headerRevisions = new WeakMap<AssignmentCycleHeader, number>();
const ROW_PROJECTION = { key: true, kind: true, label: true, ref: true, members: true, budget: true,
  budgetWhyNot: true, completion: true } as const satisfies Record<keyof AssignmentReading, true>;

/** The current state carries examples and a pointer; every exact Send remains in existing owner history. */
export async function publishAssignmentCycleReading(repos: ControlPlaneRepositories,
  cycle: { readonly cycleId: string; readonly finishedAt: string; readonly testedSha: string | null },
  reading: StreamedAssignmentCycleReading): Promise<AssignmentCycleReading> {
  const section = `assignments:${randomUUID()}`;
  const details = await appendFreshnessCycleDetails(repos, cycle, section, reading.assignments);
  const examples: AssignmentReading[] = [];
  for await (const row of reading.assignments) {
    if (examples.length < READING_LIST_CAP) examples.push(row);
    const log = refLog(details, row.ref), id = rowId(log, row.key);
    const record: OwnerDigestRecord = { formatVersion: OWNER_SURFACE_FORMAT_VERSION, digestId: id, writtenAt: cycle.finishedAt,
      headline: "Freshness Send reading", lines: [], cycleOk: null, testedSha: cycle.testedSha,
      freshnessDetails: { cycleId: cycle.cycleId, section, page: 0, rows: [row] } };
    await repos.ownerDigests.append(log, id, record, cycle.finishedAt);
  }
  return { formatVersion: reading.formatVersion, at: reading.at, costsReadable: reading.costsReadable,
    intentsReadable: reading.intentsReadable, rule: reading.rule, assignments: examples, details };
}

/** No historical Send array is decoded to decide which record a single receipt needs. */
export async function readAssignmentCycleHeader(repos: Repositories): Promise<AssignmentCycleHeader | null> {
  const held = await repos.researchState.readNarrowed(RESEARCH_STATE_ID,
    { assignments: ["formatVersion", "at", "costsReadable", "intentsReadable", "rule", "details"] });
  const header = (held?.value as { assignments?: AssignmentCycleHeader } | undefined)?.assignments ?? null;
  if (header !== null && (typeof header !== "object" || header.formatVersion !== 1 || typeof header.at !== "string" ||
    typeof header.costsReadable !== "boolean" || typeof header.intentsReadable !== "boolean" || typeof header.rule !== "string"))
    throw new Error("ASSIGNMENT_READING_HEADER_INVALID");
  if (header !== null && held) headerRevisions.set(header, held.revision);
  return header;
}

function validReference(details: FreshnessDetailReference): void {
  if (!details.cycleId.startsWith("freshness-cycle:") || !details.section.startsWith("assignments:") ||
    details.logKey !== `freshness-details:${details.cycleId}:${details.section}` || !Number.isSafeInteger(details.rows) || details.rows < 0 ||
    !Number.isSafeInteger(details.pages) || details.pages < 0 ||
    (details.rows === 0 ? details.pages !== 0 : details.pages < 1 || details.rows < details.pages || details.rows > details.pages * 32)) throw new Error("ASSIGNMENT_READING_REFERENCE_INVALID");
}
function exactRow(record: OwnerDigestRecord | undefined, details: FreshnessDetailReference, ref: string | null, key?: string): AssignmentReading | null {
  if (!record) return null;
  const page = record.freshnessDetails, row = page?.rows[0] as AssignmentReading | undefined;
  if (!page || page.cycleId !== details.cycleId || page.section !== details.section || page.page !== 0 || page.rows.length !== 1 ||
    typeof row?.key !== "string" || row.ref !== ref || key !== undefined && row.key !== key ||
    record.digestId !== rowId(refLog(details, ref), row.key)) throw new Error("ASSIGNMENT_READING_IDENTITY_INVALID");
  return row;
}

/** A key and instruction receipt select one immutable row, never a bounded example standing in for it. */
export async function readAssignmentForSend(repos: Repositories, header: AssignmentCycleHeader | null,
  key: string, ref: string | null): Promise<AssignmentReading | null> {
  if (!header) return null;
  if (header.details) {
    validReference(header.details);
    const log = refLog(header.details, ref), id = rowId(log, key);
    const [record] = await repos.ownerDigests.readRecentWhere(log, ["digestId"], id, 1, { digestId: true, freshnessDetails: true });
    return exactRow(record as OwnerDigestRecord | undefined, header.details, ref, key);
  }
  if (!repos.researchState.readArrayPage) throw new Error("ASSIGNMENT_READING_EXACT_ARRAY_UNAVAILABLE");
  const page = await repos.researchState.readArrayPage(RESEARCH_STATE_ID, ["assignments", "assignments"],
    { match: { path: ["key"], value: key }, limit: 1, projection: ROW_PROJECTION });
  if (page && headerRevisions.has(header) && page.revision !== headerRevisions.get(header)) throw new Error("ASSIGNMENT_READING_CHANGED");
  const row = page?.values[0] as AssignmentReading | undefined;
  return row?.key === key && row.ref === ref ? row : null;
}

/** One consumed receipt is sufficient for the existing acknowledgement rule, including a bulk Send. */
export async function hasAssignmentReceipt(repos: Repositories, header: AssignmentCycleHeader | null, ref: string): Promise<boolean> {
  if (!header) return false;
  if (header.details) {
    validReference(header.details);
    const [record] = await repos.ownerDigests.readRecent(refLog(header.details, ref), 1);
    return exactRow(record, header.details, ref) !== null;
  }
  if (!repos.researchState.readArrayPage) throw new Error("ASSIGNMENT_READING_EXACT_ARRAY_UNAVAILABLE");
  const page = await repos.researchState.readArrayPage(RESEARCH_STATE_ID, ["assignments", "assignments"],
    { match: { path: ["ref"], value: ref }, limit: 1, projection: { ref: true } });
  if (page && headerRevisions.has(header) && page.revision !== headerRevisions.get(header)) throw new Error("ASSIGNMENT_READING_CHANGED");
  return (page?.values[0] as AssignmentReading | undefined)?.ref === ref;
}

export type AssignmentReportRead = { readonly kind: "READ"; readonly value: {
  readonly cycleId: string; readonly page: number; readonly rows: readonly AssignmentReading[];
  readonly total: number; readonly nextPage: number | null;
} } | { readonly kind: "NOT_RECORDED" | "OUT_OF_RANGE"; readonly says: string };

/** The completed cycle pins the snapshot; successive Admin pages cannot drift into a later in-flight reading. */
export async function readAssignmentCyclePage(repos: Repositories,
  input: { readonly cycleId: string | null; readonly page: number }): Promise<AssignmentReportRead> {
  const [digest] = await repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY,
    input.cycleId === null ? ["runtimeOutcome", "kind"] : ["runtimeOutcome", "cycleId"], input.cycleId ?? "FRESHNESS_CYCLE", 1,
    { runtimeOutcome: { kind: true, cycleId: true, research: ["assignmentDetails"] } });
  const outcome = (digest as OwnerDigestRecord | undefined)?.runtimeOutcome as { kind?: string; cycleId?: string; research?: { assignmentDetails?: FreshnessDetailReference } } | undefined;
  const ref = outcome?.research?.assignmentDetails;
  if (outcome?.kind !== "FRESHNESS_CYCLE" || !ref) return { kind: "NOT_RECORDED", says: "This cycle has no partitioned Send reading recorded." };
  validReference(ref);
  if (ref.cycleId !== outcome.cycleId || input.cycleId !== null && ref.cycleId !== input.cycleId) throw new Error("ASSIGNMENT_READING_CYCLE_INVALID");
  if (!Number.isSafeInteger(input.page) || input.page < 0 || input.page >= Math.max(1, ref.pages))
    return { kind: "OUT_OF_RANGE", says: "That page is outside this cycle's Send reading." };
  if (ref.rows === 0) return { kind: "READ", value: { cycleId: ref.cycleId, page: 0, rows: [], total: 0, nextPage: null } };
  const key = `${ref.logKey}:${input.page}`, [record] = await repos.ownerDigests.readRecent(key, 1), details = record?.freshnessDetails;
  if (record?.digestId !== key || details?.cycleId !== ref.cycleId || details.section !== ref.section || details.page !== input.page ||
    !Array.isArray(details.rows) || details.rows.length < 1 || details.rows.length > 32) throw new Error("ASSIGNMENT_READING_PAGE_INVALID");
  const rows = details.rows as readonly AssignmentReading[];
  for (const row of rows) if (typeof row?.key !== "string" || row.ref !== null && typeof row.ref !== "string" || !row.members ||
    !Number.isSafeInteger(row.members.created) || !Number.isSafeInteger(row.members.reordered)) throw new Error("ASSIGNMENT_READING_ROW_INVALID");
  return { kind: "READ", value: { cycleId: ref.cycleId, page: input.page, rows, total: ref.rows,
    nextPage: input.page + 1 < ref.pages ? input.page + 1 : null } };
}
