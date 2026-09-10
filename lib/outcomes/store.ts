/**
 * **READING THE DURABLE OUTCOME STORE — the retrieval half.**
 * (WS-LEGI, 2026-08-29.)
 *
 * `types.ts` in this directory says what is persisted and why. This file is how
 * anything gets it back out, and it is deliberately the ONLY way: the store's
 * whole value is that a caller asking *what did they decide* cannot be handed an
 * agenda, and that guarantee has to live in the accessor rather than in a
 * convention every caller is trusted to follow.
 *
 * ## The contract, for the integration owner
 *
 * ```ts
 * outcomeEvidenceFor({
 *   bodyId: "ocd-division/country:us/state:az/county:pima#governing",
 *   questionClass: "WHAT_WAS_DECIDED",
 * })
 * ```
 *
 * returns an {@link OutcomeEvidence} whose `state` is a NAMED state and whose
 * `records` are already filtered to the classes that answer that question. When
 * nothing answers, `gap` is a sentence that says WHOSE gap it is — and the
 * states are kept apart precisely so that sentence can be true:
 *
 * | state | what is actually true |
 * |---|---|
 * | `HELD` | We hold records that answer the question. |
 * | `NO_SITTING_HELD` | We hold no sitting for this body at all. OURS. |
 * | `NOT_YET_INGESTED` | We hold the sitting; no outcome ingest has run on it. OURS. |
 * | `EXTRACTION_FAILED` | Ingest ran and the route returned nothing. OURS, and RETRYABLE. |
 * | `NO_ACTION_RECORDED` | Ingest succeeded; the publisher recorded no action. THEIRS. |
 * | `ACTION_WITHOUT_ROLL_CALL` | Actions held; no per-person roll exists. THEIRS. |
 *
 * The last two are the only ones that are facts about a government, and they are
 * the two the render default must never let the others impersonate. `CLAUDE.md`:
 * *"We haven't recorded this yet" is a fact about us; "not in this chamber for
 * this vote" is a fact about them. They may never render as the same sentence.*
 *
 * `ACTION_WITHOUT_ROLL_CALL` is not a hypothetical. It is **108 acted Pima items
 * in four months** — items the board demonstrably decided and for which the
 * clerk entered no per-person roll. A store that returned "no records" for those
 * would be describing a real, well-documented decision as an absence.
 */

import { readFileSync } from "node:fs";

import {
  evidenceRecordsFor,
  ruleOnQuestion,
} from "../answerability/record-class.ts";
import type {
  QuestionClass,
  RecordClass,
} from "../answerability/record-class.ts";

import type {
  LegistarAgendaRecord,
  LegistarOutcomeRecord,
  LegistarRollCallRecord,
} from "../sources/legistar/outcomes.ts";
import { reconcilePublicationObservations } from "./publication.ts";
import type { ReconciledPublication } from "./publication.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "./types.ts";
import {
  civicDataReadNotInitialized,
  mayUseTestFixture,
  promotedVersionOrThrow,
  readPromotedCivicData,
  readPromotedOrBootstrap,
  type CivicDataBootstrap,
  type CivicDataReadResult,
  type PromotedCivicDataReadOptions,
} from "../civic-data/read-model.ts";
import { PIMA_LEGISTAR_OUTCOMES_CONTRACT } from "./data-plane.ts";

/** Where the committed store lives, relative to the repo root. */
export const OUTCOME_SNAPSHOT_PATH = ["data", "states", "az", "outcomes", "legistar-outcomes.json"];

const EMPTY: OutcomeSnapshot = {
  generatedOn: "UNKNOWN",
  generatedAt: "UNKNOWN",
  tenants: [],
  sittings: [],
};

let outcomeReadState: CivicDataReadResult<OutcomeSnapshot> = civicDataReadNotInitialized(
  PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
  PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
  "The Pima Legistar outcome pointer has not been read for this process.",
);

/**
 * The committed store, read once per process.
 *
 * **A missing file returns the EMPTY store rather than throwing**, and that is a
 * deliberate difference from `getVotesSnapshot`, which throws so its callers can
 * choose a fallback. The difference is that every state this module reports is
 * already a named honest state: an empty store makes every query return
 * `NO_SITTING_HELD`, which is exactly true — we hold no sitting — and produces
 * the correct reader gap. Throwing here would make a missing artefact an
 * exception in a request path whose honest answer is a sentence.
 *
 * It is NOT a silent empty: `loadedFrom` reports whether a file was actually
 * read, and the ingest script and the tests both assert against real content.
 */
/**
 * A snapshot a test installed, taking precedence over the file.
 *
 * **This exists because the read below must be a LITERAL.** A path a bundler
 * cannot see is a path it must assume could be anything, and when this module
 * was first imported by `app/api/ask/grounded/route.ts` the old
 * `join(base, ...OUTCOME_SNAPSHOT_PATH)` made Turbopack trace **4,532 files**
 * into that one route bundle against a committed ceiling of 220 — `tests/`
 * fixtures and `docs/feedback` screenshots included. That is the R23 shape
 * `lib/sources/ballot-curated/index.ts` documents, and the last time it
 * happened planted credential fixtures reached a deployed artefact and failed
 * Netlify's secrets scan.
 *
 * A `root` PARAMETER cannot be reintroduced to fix a test. Any variable in the
 * path re-arms the whole-project trace, which is why the seam is a parsed
 * snapshot rather than a directory: a test that wants a different store reads
 * its own fixture — test files are not bundled — and installs the result.
 */
let injected: OutcomeSnapshot | null = null;

/**
 * Install a snapshot for the duration of a test, or pass `null` to restore the
 * file. Always restore: a leaked injection makes the next test read a store it
 * did not choose.
 */
export function useOutcomeSnapshotForTests(snapshot: OutcomeSnapshot | null): void {
  injected = snapshot;
  outcomeReadState = civicDataReadNotInitialized(
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
    "The Pima Legistar outcome pointer has not been read for this process.",
  );
}

function testSeed(): OutcomeSnapshot | null {
  if (!mayUseTestFixture()) return null;
  try {
    return JSON.parse(
      readFileSync("data/states/az/outcomes/legistar-outcomes.json", "utf8"),
    ) as OutcomeSnapshot;
  } catch {
    return null;
  }
}

function outcomeTestBootstrap(): CivicDataBootstrap<OutcomeSnapshot> {
  const value = testSeed();
  if (!value) throw new Error("PIMA_LEGISTAR_OUTCOME_TEST_SEED_MISSING");
  return {
    value,
    sourceId: PIMA_LEGISTAR_OUTCOMES_CONTRACT.sourceId,
    version: value.generatedAt,
    versionId: `test-seed:pima-legistar-outcomes:${value.generatedAt}`,
    sourceThrough: value.generatedAt,
    retrievedAt: value.generatedAt,
    detail: "Node test fixture selected only inside the explicit test process.",
  };
}

function validateOutcomeProjection(value: OutcomeSnapshot, version: string): void {
  if (!Array.isArray(value.sittings) || !Array.isArray(value.tenants)) {
    throw new Error(`Pima Legistar outcome projection ${version} is malformed.`);
  }
  if (value.sittings.some((sitting) => sitting.slug !== "pima" || sitting.meetingId !== `legistar:pima:${sitting.eventId}`)) {
    throw new Error(`Pima Legistar outcome projection ${version} crosses its tenant or meeting-id scope.`);
  }
}

/** Read the exact GOOD pointer. A database error never reopens tracked state. */
export async function readOutcomeProjection(
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<OutcomeSnapshot>> {
  outcomeReadState = mayUseTestFixture()
    ? await readPromotedOrBootstrap<OutcomeSnapshot>({
        ...options,
        recordClass: PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
        scope: PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
        bootstrap: outcomeTestBootstrap,
        allowUnconfiguredBootstrap: true,
      })
    : await readPromotedCivicData<OutcomeSnapshot>(
        PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
        PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
        options,
      );
  if (outcomeReadState.kind === "PROMOTED" || outcomeReadState.kind === "BOOTSTRAP") {
    validateOutcomeProjection(outcomeReadState.value, outcomeReadState.metadata.versionId ?? "unknown");
  }
  return outcomeReadState;
}

export async function refreshOutcomeSnapshotFromPromoted(
  options: PromotedCivicDataReadOptions = {},
): Promise<string | null> {
  return promotedVersionOrThrow(await readOutcomeProjection(options));
}

export const outcomeProjectionReadState = (): CivicDataReadResult<OutcomeSnapshot> => outcomeReadState;

export function getOutcomeSnapshot(): OutcomeSnapshot {
  if (injected !== null) return injected;
  if (outcomeReadState.kind === "PROMOTED" || outcomeReadState.kind === "BOOTSTRAP") return outcomeReadState.value;
  return outcomeReadState.kind === "STORE_UNREACHABLE" && outcomeReadState.code === "READ_NOT_INITIALIZED"
    ? testSeed() ?? EMPTY
    : EMPTY;
}

/** Drop the process cache. For tests and for a run that has just written. */
export function resetOutcomeSnapshotCache(): void {
  outcomeReadState = civicDataReadNotInitialized(
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.recordClass,
    PIMA_LEGISTAR_OUTCOMES_CONTRACT.scope,
    "The Pima Legistar outcome pointer has not been read for this process.",
  );
}

/** Did a real file back the current snapshot, or is this the empty store? */
export function loadedFrom(): "DATA_PLANE" | "TEST_FIXTURE" | "EMPTY_STORE" {
  if (injected !== null) return injected.sittings.length === 0 && injected.generatedAt === "UNKNOWN" ? "EMPTY_STORE" : "TEST_FIXTURE";
  if (outcomeReadState.kind === "PROMOTED") return "DATA_PLANE";
  if (outcomeReadState.kind === "BOOTSTRAP") return "TEST_FIXTURE";
  const snapshot = getOutcomeSnapshot();
  return snapshot.sittings.length === 0 && snapshot.generatedAt === "UNKNOWN"
    ? "EMPTY_STORE"
    : "TEST_FIXTURE";
}

/**
 * The named states this store can be in for one question.
 *
 * Six of them where a naive store has two ("some records" / "no records"), and
 * every extra one is a distinction the constitution requires be visible.
 */
export type OutcomeEvidenceState =
  | "HELD"
  | "NO_SITTING_HELD"
  | "NOT_YET_INGESTED"
  | "EXTRACTION_FAILED"
  | "NO_ACTION_RECORDED"
  | "ACTION_WITHOUT_ROLL_CALL";

/**
 * **The states that are facts about a GOVERNMENT, as data rather than prose.**
 *
 * The table at the top of this file already said which two these are. A table
 * is not readable by a consumer, so the consumer restates the mapping — and a
 * restated mapping is one edit away from calling `NOT_YET_INGESTED` a fact
 * about a clerk, which is the precise defect repaired across this codebase on
 * 2026-08-29.
 *
 * Both members are earned by MEASUREMENT of the publisher's own records: the
 * ingest succeeded, the sitting's items were read, and the publisher recorded
 * no action (or recorded one and published no per-person roll). Everything
 * else in the union is a fact about us.
 */
export const OUTCOME_STATES_ABOUT_THEM: readonly OutcomeEvidenceState[] = [
  "NO_ACTION_RECORDED",
  "ACTION_WITHOUT_ROLL_CALL",
];

/** Whose gap a state names. Derived from the list above, never restated. */
export function outcomeGapWhose(state: OutcomeEvidenceState): "OURS" | "THEIRS" {
  return OUTCOME_STATES_ABOUT_THEM.includes(state) ? "THEIRS" : "OURS";
}

export interface OutcomeQuery {
  /** `ocd-division/...#governing`. Exact string equality, never a name match. */
  readonly bodyId?: string | null;
  /** `legistar:pima:1825`. Narrows to one sitting when the caller has it. */
  readonly meetingId?: string | null;
  /** Which question is being asked. Drives the record-class filter. */
  readonly questionClass: QuestionClass;
  /** ISO instant. Only sittings at or before it — "the last meeting". */
  readonly onOrBefore?: string | null;
  /** How many sittings back to consider. Default 1: the most recent. */
  readonly sittings?: number;
}

/**
 * Any record class this store holds.
 *
 * The union is discriminated by `recordClass`, which is the same field
 * `evidenceRecordsFor` filters on — so narrowing in a consumer and admission in
 * the filter are decided by one field rather than by two that could drift.
 */
export type OutcomeEvidenceRecord =
  | LegistarAgendaRecord
  | LegistarOutcomeRecord
  | LegistarRollCallRecord;

/** A record that was held and refused, with the sentence saying why. */
export interface RefusedRecord {
  readonly recordClass: RecordClass | string;
  readonly reason: string;
  readonly count: number;
}

export interface OutcomeEvidence {
  readonly state: OutcomeEvidenceState;
  /** True only for `HELD`. Derived, never asserted by a caller. */
  readonly answerable: boolean;
  /**
   * The records that ANSWER the question asked, already class-filtered.
   * Empty on every non-`HELD` state.
   *
   * Typed as the concrete union rather than as `ClassedRecord`, so a consumer
   * reads `tallyText` or `votes` off a narrowed record instead of casting. A
   * cast at this boundary would be the one place the class filter could be
   * undone by a caller in a hurry.
   */
  readonly records: readonly OutcomeEvidenceRecord[];
  /** The sittings consulted, newest first. Present on every state but the first. */
  readonly sittings: readonly PersistedSittingOutcomes[];
  /**
   * Classes we held and could not use. Carried so a caller can say *"we hold 135
   * agenda records and no outcome record"* rather than quietly answering from
   * the agendas — the failure `lib/ask/outcome-question.ts` was written for.
   */
  readonly refused: readonly RefusedRecord[];
  /**
   * The named gap, or null when `state` is `HELD`.
   *
   * Always says whose gap it is. `lib/ask/` owns the reader's wording; this is
   * the honest statement the wording must not contradict.
   */
  readonly gap: string | null;
  /**
   * Retrieval failures that are still OPEN — a failed extraction or a votes
   * request that threw. Never converted into an absence, and surfaced so a
   * refresh can retry them.
   */
  readonly openFailures: readonly string[];
}

/** Sittings for one body, newest first, honouring the query's window. */
function selectSittings(
  query: OutcomeQuery,
  snapshot: OutcomeSnapshot,
): PersistedSittingOutcomes[] {
  const wanted = snapshot.sittings.filter((sitting) => {
    if (query.meetingId && sitting.meetingId !== query.meetingId) return false;
    if (query.bodyId && sitting.bodyId !== query.bodyId) return false;
    if (query.onOrBefore && sitting.startsAt !== null) {
      if (sitting.startsAt > query.onOrBefore) return false;
    }
    return true;
  });

  wanted.sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
  const limit = query.meetingId ? wanted.length : Math.max(1, query.sittings ?? 1);
  return wanted.slice(0, limit);
}

/**
 * **THE HANDOFF. Outcome evidence for one question about one body.**
 *
 * Pure over the committed store: no network, no clock, no database. Everything
 * it returns is either a persisted record or a state derived from persisted
 * records, so the same query gives the same answer for a given store — which is
 * what makes it testable against a fixture and what makes a wrong answer
 * attributable to data rather than to timing.
 *
 * The class filter runs through `evidenceRecordsFor`, so AGENDA records are not
 * merely deprioritised for `WHAT_WAS_DECIDED` — they are absent from `records`
 * and present in `refused` with the sentence explaining the refusal.
 */
export function outcomeEvidenceFor(
  query: OutcomeQuery,
): OutcomeEvidence {
  const snapshot = getOutcomeSnapshot();
  const sittings = selectSittings(query, snapshot);

  if (sittings.length === 0) {
    return {
      state: "NO_SITTING_HELD",
      answerable: false,
      records: [],
      sittings: [],
      refused: [],
      gap:
        "We hold no sitting of that body in the outcome store, so we have not " +
        "recorded what it decided. That is a gap in what we have collected and " +
        "not a statement about what the body has published.",
      openFailures: [],
    };
  }

  const openFailures: string[] = [];
  for (const sitting of sittings) {
    if (sitting.extraction !== "RETRIEVED") {
      openFailures.push(
        `${sitting.meetingId}: ${sitting.extraction} — ${sitting.extractionNote ?? "no reason recorded"}`,
      );
    }
    for (const failure of sitting.voteRequestFailures) {
      openFailures.push(
        `${sitting.meetingId} item ${failure.eventItemId}: votes request failed — ${failure.reason}`,
      );
    }
    for (const itemId of sitting.failedRollCallExtractions) {
      openFailures.push(
        `${sitting.meetingId} item ${itemId}: the item's own record asserts a roll call ` +
          "and the votes route returned zero rows — a FAILED extraction, not an empty roll",
      );
    }
  }

  /*
   * A zero-row extraction is a FAILED extraction, never an empty document
   * (RULING 100). Checked BEFORE the record counts, because a failed sitting
   * has zero outcome records and would otherwise be indistinguishable from a
   * sitting where the body genuinely acted on nothing.
   */
  const allFailed = sittings.every((s) => s.extraction !== "RETRIEVED");
  if (allFailed) {
    return {
      state: "EXTRACTION_FAILED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "Our retrieval of that sitting's agenda items returned nothing, which is a " +
        "failed retrieval on our side and not a meeting with nothing on it. It is " +
        "retryable and it has not been retried yet.",
      openFailures,
    };
  }

  /*
   * Typed as the concrete union so `evidenceRecordsFor`'s generic carries it
   * through to `admitted`. Widening to `ClassedRecord` here would erase the
   * fields at exactly the point the consumer needs them.
   */
  const held: OutcomeEvidenceRecord[] = [];
  for (const sitting of sittings) {
    held.push(...sitting.agenda, ...sitting.outcomes, ...sitting.rollCalls);
  }

  if (held.length === 0) {
    return {
      state: "NOT_YET_INGESTED",
      answerable: false,
      records: [],
      sittings,
      refused: [],
      gap:
        "We hold that sitting but have not recorded any of its agenda, actions or " +
        "roll calls yet. That is a gap in our collection.",
      openFailures,
    };
  }

  const { admitted, refused } = evidenceRecordsFor(query.questionClass, held);

  const refusedSummary: RefusedRecord[] = [];
  const ruling = ruleOnQuestion(
    query.questionClass,
    [...new Set(refused.map((r) => r.record.recordClass))],
  );
  for (const substitution of ruling.refusedSubstitutions) {
    refusedSummary.push({
      recordClass: substitution.held,
      reason: substitution.reason,
      count: refused.filter((r) => r.record.recordClass === substitution.held).length,
    });
  }

  if (admitted.length > 0) {
    return {
      state: "HELD",
      answerable: true,
      records: admitted,
      sittings,
      refused: refusedSummary,
      gap: null,
      openFailures,
    };
  }

  /*
   * Nothing admitted, and the extraction SUCCEEDED. So this is a fact about the
   * publisher, and the two publisher-facts are not the same fact.
   *
   * A body that acted and whose clerk recorded no per-person roll is a real,
   * documented decision with no roll call — 108 acted Pima items in four
   * months. Reporting that as "no records" would describe a decision that
   * demonstrably happened as an absence, which is the exact inversion of the
   * transparency mandate.
   */
  const anyOutcome = sittings.some((s) => s.outcomes.length > 0);
  if (anyOutcome && query.questionClass === "HOW_DID_THEY_VOTE") {
    return {
      state: "ACTION_WITHOUT_ROLL_CALL",
      answerable: false,
      records: [],
      sittings,
      refused: refusedSummary,
      gap:
        "That body's own record of this sitting states the actions it took and does " +
        "not record how each member voted on them. The action is published; a " +
        "per-person roll call for it is not.",
      openFailures,
    };
  }

  return {
    state: "NO_ACTION_RECORDED",
    answerable: false,
    records: [],
    sittings,
    refused: refusedSummary,
    gap:
      "We read that sitting's agenda items and the body's own record shows no action " +
      "recorded against them. That is what the publisher's record says, not a gap in " +
      "our retrieval of it.",
    openFailures,
  };
}

/**
 * Sittings held for one body, newest first. For coverage reporting.
 *
 * Separate from {@link outcomeEvidenceFor} because a coverage question — *how
 * many of this body's sittings can we answer an outcome question about* — is not
 * a reader question and must not be answered through a reader accessor that
 * filters by record class.
 */
export function sittingsForBody(
  bodyId: string,
): readonly PersistedSittingOutcomes[] {
  return getOutcomeSnapshot()
    .sittings.filter((sitting) => sitting.bodyId === bodyId)
    .sort((a, b) => String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")));
}

/**
 * **THE SECOND HANDOFF — what the publisher said about one sitting's agenda.**
 *
 * Every reading held for that sitting, reconciled without a winner being
 * picked. The observations satisfy `PublisherAgendaObservation` in
 * `lib/ask/agenda-publication.ts` field for field, so the integration owner can
 * pass `reconciled.observations` straight to `classifyAgendaPublication`.
 *
 * **`actionable` is null on a DISAGREE**, and a caller must not fall back to
 * "whichever one is there" when it is. Two of this publisher's own surfaces
 * saying different things is a real state with a real cause — the Web API omits
 * sittings whose detail page is not publicly viewable, and a document published
 * between two reads lands on one surface first — and a caller that resolves it
 * by preference has converted a known uncertainty into a confident sentence.
 */
export function publicationObservationsFor(
  meetingId: string,
): ReconciledPublication {
  const sitting = getOutcomeSnapshot().sittings.find(
    (row) => row.meetingId === meetingId,
  );
  return reconcilePublicationObservations(
    meetingId,
    sitting?.publicationObservations ?? [],
  );
}

/** Every meeting id the store holds outcome records for. */
export function answerableMeetingIds(): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const sitting of getOutcomeSnapshot().sittings) {
    if (sitting.extraction === "RETRIEVED" && sitting.outcomes.length > 0) {
      ids.add(sitting.meetingId);
    }
  }
  return ids;
}
