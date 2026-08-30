/**
 * `pnpm exec tsx scripts/answerability-report.mts` — the measured answerability
 * ladder over the COMMITTED corpus.
 *
 * Reads `data/meetings-snapshot.json` and `lib/meetings/minutes-summaries.ts`
 * and prints, per scope and per question class, a numerator and a denominator
 * for every stage. It writes nothing and fetches nothing.
 *
 * The scopes are the two the answerability workstream was asked to measure:
 * the Pima County Board of Supervisors, and the governments over AZ ZIP 85641.
 * The second one carries a caveat the code enforces rather than narrates —
 * see `zip85641Scope` below.
 */

import { readFileSync } from "node:fs";
import { getOutcomeSnapshot } from "../lib/outcomes/store.ts";
import { join } from "node:path";

import { MINUTES_SUMMARIES } from "../lib/meetings/minutes-summaries.ts";
import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import {
  classifySnapshotDocument,
  measureAnswerability,
  type AnswerabilityCorpus,
  type DocumentInput,
  type LadderMeasurement,
  type ObligationInput,
} from "../lib/answerability/stages.ts";
import { renderScopeReport } from "../lib/answerability/report.ts";
import type { QuestionClass } from "../lib/answerability/record-class.ts";

interface SnapshotMeeting {
  id: string;
  ocdId: string | null;
  bodyId: string | null;
  bodyName: string;
  startsAt: string | null;
  agendaUrl: string | null;
}

interface SnapshotDocument {
  id: string;
  meetingId: string;
  ocdId: string | null;
  documentUrl: string;
  contentHash: string | null;
  retrievedAt: string | null;
  text: string | null;
  extraction: "html" | "pdf" | "failed";
  extractionNote: string | null;
  verifiedAt: string | null;
}

interface Snapshot {
  meetings: SnapshotMeeting[];
  agendaDocuments: SnapshotDocument[];
}

export function loadSnapshot(root = process.cwd()): Snapshot {
  const raw = readFileSync(join(root, "data", "meetings-snapshot.json"), "utf8");
  const parsed = JSON.parse(raw) as Snapshot;
  if (!Array.isArray(parsed.meetings) || !Array.isArray(parsed.agendaDocuments)) {
    throw new Error(
      "meetings-snapshot.json parsed without `meetings` and `agendaDocuments` arrays. " +
        "A corpus we failed to read is not a corpus of zero.",
    );
  }
  return parsed;
}

export function obligationsFrom(snapshot: Snapshot): ObligationInput[] {
  return snapshot.meetings.map((meeting) => ({
    meetingId: meeting.id,
    bodyId: meeting.bodyId ?? null,
    ocdId: meeting.ocdId ?? null,
    bodyName: meeting.bodyName ?? "",
    startsAt: meeting.startsAt ?? null,
    agendaUrl: meeting.agendaUrl ?? null,
  }));
}

export function documentsFrom(snapshot: Snapshot): DocumentInput[] {
  const notices: DocumentInput[] = snapshot.agendaDocuments.map((doc) => ({
    id: doc.id,
    meetingId: doc.meetingId,
    ocdId: doc.ocdId ?? null,
    documentUrl: doc.documentUrl,
    contentHash: doc.contentHash ?? null,
    retrievedAt: doc.retrievedAt ?? null,
    recordClass: classifySnapshotDocument(),
    text: doc.text ?? null,
    extraction: doc.extraction,
    extractionNote: doc.extractionNote ?? null,
    verifiedAt: doc.verifiedAt ?? null,
  }));

  /*
   * The OUTCOME records the repository actually holds: curated minutes reads.
   *
   * `contentHash: null` is the honest value and it is load-bearing. A human
   * read the minutes and cited the URL and the date; nobody kept the bytes.
   * That is real evidence and it is NOT `ACQUIRED` — it cannot be replayed
   * and a silent revision of it could not be detected. The ladder therefore
   * stops these at `ACQUIRED_WITHOUT_ARTIFACT`, by name, rather than either
   * crediting them or pretending they do not exist.
   */
  const minutes: DocumentInput[] = MINUTES_SUMMARIES.map((summary) => ({
    id: `minutes-summary:${summary.meetingId}`,
    meetingId: summary.meetingId,
    ocdId:
      snapshot.meetings.find((m) => m.id === summary.meetingId)?.ocdId ?? null,
    documentUrl: summary.minutesUrl,
    contentHash: null,
    retrievedAt: summary.readAt,
    recordClass: "MINUTES",
    text: null,
    extraction: "none",
    extractionNote: "curated read; the document's own text was not stored",
    verifiedAt: null,
  }));

  /*
   * **THE DURABLE OUTCOME STORE — and why its rows are not `ACQUIRED`.**
   * (2026-08-29.)
   *
   * Until this was wired the report read only the agenda-document corpus, so
   * every outcome question came back `RECORD_CLASS_CANNOT_ANSWER` — "we hold
   * records, and not one of a class that can answer this". That sentence
   * became FALSE the moment the outcome store landed: 18 of 20 Pima Board
   * sittings hold ACTION_SUMMARY records and most hold per-person ROLL_CALLs,
   * and the reader path answers from them. A measurement that says we hold no
   * such class while the product answers from it is the instrument disagreeing
   * with the thing it measures, and the instrument was wrong.
   *
   * They stop at `ACQUIRED_WITHOUT_ARTIFACT`, deliberately, and that is not a
   * technicality. `contentHash` is null because the ingest kept the PARSED
   * records and not the raw JSON bytes, so a silent revision upstream could not
   * be detected and the read cannot be replayed from what we hold. The ladder's
   * `ACQUIRED` means bytes retrieved and hashed; these are real evidence and
   * they are not that. Storing the raw response beside the records is the work
   * that would move them, and naming the gap is what stops it being forgotten.
   *
   * One row per sitting per class, because the ladder is document-centric: a
   * sitting's 58 action records are one clerk's post-meeting record of it.
   */
  const outcomes: DocumentInput[] = [];
  for (const sitting of getOutcomeSnapshot().sittings) {
    const common = {
      meetingId: sitting.meetingId,
      ocdId: sitting.ocdId ?? null,
      contentHash: null,
      retrievedAt: sitting.publication?.observedAt ?? null,
      text: null,
      extraction: "none" as const,
      verifiedAt: null,
    };
    if (sitting.outcomes.length > 0) {
      outcomes.push({
        ...common,
        id: `legistar-actions:${sitting.meetingId}`,
        documentUrl: sitting.outcomes[0]?.provenance.endpoint ?? sitting.sourceUrl ?? "",
        recordClass: "ACTION_SUMMARY",
        extractionNote:
          `${sitting.outcomes.length} action record(s) parsed from the publisher's API; ` +
          "the raw response bytes were not stored, so this is not replayable",
      });
    }
    if (sitting.rollCalls.length > 0) {
      outcomes.push({
        ...common,
        id: `legistar-rollcalls:${sitting.meetingId}`,
        documentUrl: sitting.rollCalls[0]?.provenance.endpoint ?? sitting.sourceUrl ?? "",
        recordClass: "ROLL_CALL",
        extractionNote:
          `${sitting.rollCalls.length} per-person roll call(s) parsed from the publisher's API; ` +
          "the raw response bytes were not stored, so this is not replayable",
      });
    }
  }

  return [...notices, ...minutes, ...outcomes];
}

function scopedCorpus(
  snapshot: Snapshot,
  bodyIds: readonly string[],
): AnswerabilityCorpus {
  const wanted = new Set(bodyIds);
  const obligations = obligationsFrom(snapshot).filter(
    (o) => o.bodyId !== null && wanted.has(o.bodyId),
  );
  const ids = new Set(obligations.map((o) => o.meetingId));
  const documents = documentsFrom(snapshot).filter((d) => ids.has(d.meetingId));
  return {
    obligations,
    documents,
    /*
     * NOT ESTABLISHED, and not by omission. Legistar's calendar, the county
     * clerk's page and the body's own notice archive each list the sittings
     * they choose to list; none of them publishes a count of the sittings the
     * body HELD over a window. Until one does, the share of a body's sittings
     * we hold is unknown, and writing the numerator here would make it 100%.
     */
    publishedObligationCount: null,
    publishedObligationSource: null,
  };
}

const PIMA_BOS = "ocd-division/country:us/state:az/county:pima#governing";

/**
 * The bodies over AZ ZIP 85641, and the reason this is a scope and not an
 * answer.
 *
 * **A ZIP is not a territory** — `tests/body-territory.test.ts` proves it with
 * an address inside 85641 that is outside the Rocking K district's plats. So
 * the set below is derived from `data/derived/zip-governments.json`, which
 * records which government layers the ZIP's address samples fall in, filtered
 * to `entity: "GOVERNMENT"` (the CDPs in that file are statistical, not
 * governments), and then intersected with the bodies that actually appear in
 * the meetings snapshot. Empire Elementary District is a government over this
 * ZIP and has NO meetings in the corpus; it is listed here so that its zero is
 * a named zero rather than a silent omission.
 */
const ZIP_85641_BODIES = [
  PIMA_BOS,
  "ocd-division/country:us/state:az/school_district:vail_unified_district#board",
  "ocd-division/country:us/state:az/place:tucson#governing",
  "ocd-division/country:us/state:az/school_district:empire_elementary_district#board",
];

const QUESTION_CLASSES_MEASURED: QuestionClass[] = [
  "WHAT_WAS_NOTICED",
  "WHAT_WAS_DECIDED",
  "HOW_DID_THEY_VOTE",
];

export function measureScope(
  snapshot: Snapshot,
  scope: string,
  bodyIds: readonly string[],
): LadderMeasurement[] {
  const corpus = scopedCorpus(snapshot, bodyIds);
  return QUESTION_CLASSES_MEASURED.map((questionClass) =>
    measureAnswerability({ scope, questionClass, corpus }),
  );
}

/**
 * **THE FLOOR UNDER THIS REPORT (RULING 159).**
 *
 * Every number below is a share of the meetings held for a named scope, so the
 * one number that must never be defaulted to is the size of that scope. A
 * mistyped body id, a regenerated snapshot that dropped a body, or a registry
 * rename all produce the SAME output as a government that genuinely held no
 * sittings: a clean run reporting zero.
 *
 * That is the exact failure this ruling exists for, and it is worse here than
 * in most places, because a zero in an ANSWERABILITY report reads as *we cannot
 * answer questions about this body* — a claim about our coverage — when the
 * truth might be that the instrument never found the body at all.
 *
 * So the population is floored before any stage is printed. An empty scope with
 * no stated reason throws; an empty scope WITH one is reported as
 * COULD_NOT_ASSERT and named. Zero is a result to be earned.
 */
function flooredScope(
  snapshot: Snapshot,
  label: string,
  bodyIds: readonly string[],
): ReturnType<typeof floored> {
  const present = new Set(snapshot.meetings.map((m) => m.bodyId));
  const found = bodyIds.filter((id) => present.has(id));
  if (bodyIds.length === 0) {
    return floored(
      `bodies in ${label}`,
      "the scope's declared body list",
      0,
      0,
      "the scope was declared with no bodies, so there is no population to measure over",
    );
  }
  return floored(`bodies in ${label} present in the corpus`, "the meetings snapshot", bodyIds.length, found.length);
}

function main(): void {
  const snapshot = loadSnapshot();
  console.log(
    `corpus: ${snapshot.meetings.length} meetings, ${snapshot.agendaDocuments.length} agenda documents, ` +
      `${MINUTES_SUMMARIES.length} curated minutes reads\n`,
  );

  /* Floored before anything is measured: see `flooredScope`. A throw here is
     the instrument reporting that it is broken, which is the only honest thing
     it can say when it cannot find the governments it was asked about. */
  for (const [label, ids] of [
    ["Pima County Board of Supervisors", [PIMA_BOS]],
    ["AZ 85641 governing bodies", ZIP_85641_BODIES],
  ] as const) {
    console.log(floorLine(flooredScope(snapshot, label, ids)));
  }
  console.log("");

  console.log(
    renderScopeReport(
      "PIMA COUNTY BOARD OF SUPERVISORS",
      measureScope(snapshot, "Pima County Board of Supervisors", [PIMA_BOS]),
    ),
  );

  const present = new Set(snapshot.meetings.map((m) => m.bodyId));
  const missing = ZIP_85641_BODIES.filter((id) => !present.has(id));
  console.log(
    renderScopeReport(
      "AZ ZIP 85641 — the governments over it, per data/derived/zip-governments.json",
      measureScope(snapshot, "AZ 85641 governing bodies", ZIP_85641_BODIES),
    ),
  );
  console.log(
    "BODY DENOMINATOR FOR 85641: DENOMINATOR_NOT_ESTABLISHED. A ZIP is not a territory; " +
      "the set measured is the GOVERNMENT-entity layers the ZIP's address samples fall in. " +
      (missing.length > 0
        ? `Named and holding zero meetings in the corpus: ${missing.join(", ")}.`
        : "Every named body appears in the corpus."),
  );
}

main();
