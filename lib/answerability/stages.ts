/**
 * **THE ANSWERABILITY LADDER — five different achievements, measured apart.**
 *
 * A discovered URL, an acquired document, extracted text, a canonically
 * linked record and an answer a reader can actually get are not the same
 * thing, and this repository had no place that said so. A `RouteTask` whose
 * disposition is `INGESTED` reads, to a session skimming, as *"a reader can
 * now ask about this"*. It is not: `INGESTED` is a fact about a ROUTE WALK.
 * The route walk is stage two of seven.
 *
 * ```
 * DISCOVERED -> ACQUIRED -> EXTRACTED -> NORMALIZED
 *            -> CANONICALLY_LINKED -> QUERY_RETRIEVABLE -> READER_VERIFIED
 * ```
 *
 * ## The rules this module exists to enforce
 *
 * 1. **No upstream success may imply downstream success.** Every stage has
 *    its OWN predicate over the actual evidence. A numerator is never carried
 *    forward. Where a downstream predicate passes over a unit whose upstream
 *    predicate failed, that is not a promotion — it is an INVARIANT
 *    VIOLATION, reported by name, and the unit is not counted downstream.
 * 2. **A denominator is measured or it is `DENOMINATOR_NOT_ESTABLISHED`.**
 *    Never guessed, never silently equal to the numerator. The publisher
 *    exposes a count of its own sittings or it does not.
 * 3. **Three different facts, three different states.** "No document",
 *    "extraction failed" and "the document yielded zero items" are not one
 *    thing. A zero-row extraction is a FAILED extraction, never an empty
 *    document (CLAUDE.md), so it never counts as reaching the stage.
 * 4. **A record class that cannot answer the question is refused before the
 *    ladder is climbed at all** (`record-class.ts`). Measuring an agenda
 *    corpus against *"what did they decide?"* yields zero at ACQUIRED with
 *    every unit named `RECORD_CLASS_CANNOT_ANSWER` — it does not yield a
 *    high number and a caveat.
 *
 * ## What this module REUSES rather than re-implements
 *
 * - `lib/meetings/agenda-documents.ts` is the evidence source. Its
 *   `AgendaDocument` already hashes raw bytes, keeps revisions, and records
 *   extraction failure honestly on the row. Nothing here re-fetches, re-hashes
 *   or re-extracts; the shapes below are structural readings of that record.
 * - `lib/routing/agenda-search.ts#agendaItems` is the normaliser. It is the
 *   one extractive item reader in the repository and it stays the one.
 * - `lib/workstate/types.ts` owns dispositions and permission/transport
 *   state. Nothing here re-declares them; a stage is orthogonal to a
 *   disposition and the two vocabularies are deliberately not merged.
 *
 * PURE and TOTAL. No clock, no disk, no network. The caller supplies the
 * corpus; a corpus it failed to load is a corpus of zero, and zero is
 * reported as zero rather than skipped.
 */

import { agendaItems } from "../routing/agenda-search.ts";
import {
  evidenceRecordsFor,
  ruleOnQuestion,
  type ClassRuling,
  type QuestionClass,
  type RecordClass,
} from "./record-class.ts";

/** The ladder, in order. Position in this array IS the ordering. */
export const ANSWERABILITY_STAGES = [
  /** The obligation is known to exist: a sitting, with a body and a time. */
  "DISCOVERED",
  /** A document's RAW BYTES were retrieved and hashed. Replayable, revisionable. */
  "ACQUIRED",
  /** Text came out of those bytes. Non-null, non-empty, extraction not failed. */
  "EXTRACTED",
  /** Structure came out of the text: at least one item a clerk actually wrote. */
  "NORMALIZED",
  /** The structure is bound to THIS sitting and to no other. */
  "CANONICALLY_LINKED",
  /** A query keyed on what a reader knows (body, tense) returns it. */
  "QUERY_RETRIEVABLE",
  /** A human checked the rendered answer against the source. */
  "READER_VERIFIED",
] as const;
export type AnswerabilityStage = (typeof ANSWERABILITY_STAGES)[number];

/**
 * **The denominator does not exist and we will not invent one.**
 *
 * A real value, carried in the measurement, printed in the table. It means:
 * the public source does not expose how many sittings this body held, so the
 * share of them we hold is unknown. It does NOT mean zero, it does not mean
 * "all of them", and it must never be quietly replaced by the numerator —
 * that substitution is how every coverage number in this trade becomes 100%.
 */
export const DENOMINATOR_NOT_ESTABLISHED = "DENOMINATOR_NOT_ESTABLISHED";
export type Denominator = number | typeof DENOMINATOR_NOT_ESTABLISHED;

/**
 * Why a unit stopped where it stopped. Every value distinguishes a fact about
 * THEM from a fact about US, because they may never render as one sentence.
 */
export const BLOCK_CODES = [
  /* --- fact about them ------------------------------------------------- */
  /** The publisher linked no document for this sitting. */
  "NO_DOCUMENT_URL_PUBLISHED",
  /* --- fact about us --------------------------------------------------- */
  /** The obligation row itself carries no id or no body name. Malformed input. */
  "OBLIGATION_NOT_IDENTIFIED",
  /* --- fact about us --------------------------------------------------- */
  /** A URL is published and we hold no bytes for it. */
  "DOCUMENT_URL_PUBLISHED_NOT_ACQUIRED",
  /** Somebody read the document but no artifact was kept: unreplayable. */
  "ACQUIRED_WITHOUT_ARTIFACT",
  /** The extractor ran and failed. The link survives; the text is null. */
  "EXTRACTION_FAILED",
  /** Extraction "succeeded" and produced nothing. A failed extraction. */
  "EXTRACTED_TEXT_EMPTY",
  /** Text is held and no item structure could be read off it. */
  "NORMALIZED_ZERO_ITEMS",
  /** The document names a sitting that is not in the corpus. */
  "LINK_MEETING_UNKNOWN",
  /** The document's division disagrees with the sitting's. */
  "LINK_DIVISION_MISMATCH",
  /** One URL stored against several sittings: a portal root, not an agenda. */
  "LINK_URL_SHARED_ACROSS_MEETINGS",
  /** An older revision. Current is a later one; this one may not stand in. */
  "SUPERSEDED_REVISION",
  /** No body id: a reader naming the body cannot reach this sitting. */
  "NOT_ADDRESSABLE_NO_BODY_ID",
  /** No usable start time: a reader asking "last"/"next" cannot reach it. */
  "NOT_ADDRESSABLE_NO_START_TIME",
  /** Nobody has checked the rendered answer against the source. */
  "NOT_READER_VERIFIED",
  /** We hold records, and not one of a class that can answer this question. */
  "RECORD_CLASS_CANNOT_ANSWER",
] as const;
export type BlockCode = (typeof BLOCK_CODES)[number];

/** Block codes that are facts about a GOVERNMENT, not about this product. */
export const BLOCKS_ABOUT_THEM: readonly BlockCode[] = ["NO_DOCUMENT_URL_PUBLISHED"];

/* ---------------------------------------------------------------- inputs */

/**
 * One civic obligation. A SITTING: the unit a reader's question is about.
 *
 * A structural reading of the snapshot's meeting row — deliberately not an
 * import of `Meeting`, so a synthetic failure case in a test is three fields
 * rather than a whole provenance envelope.
 */
export interface ObligationInput {
  readonly meetingId: string;
  readonly bodyId: string | null;
  readonly ocdId: string | null;
  readonly bodyName: string;
  /** ISO. Null and unparseable are different inputs and the same block. */
  readonly startsAt: string | null;
  /** The document link the publisher exposed, if any. */
  readonly agendaUrl: string | null;
}

/**
 * One retrieved document. A structural reading of `AgendaDocument`, plus the
 * record class (which `AgendaDocument` does not carry — see the note on
 * `classifySnapshotDocument`).
 */
export interface DocumentInput {
  readonly id: string;
  readonly meetingId: string;
  readonly ocdId: string | null;
  readonly documentUrl: string;
  /**
   * SHA-256 of the raw bytes. **Null means no artifact was kept** — a curated
   * read with a URL and a date is real evidence and is NOT `ACQUIRED`, because
   * nothing about it can be replayed or revision-checked.
   */
  readonly contentHash: string | null;
  readonly retrievedAt: string | null;
  readonly recordClass: RecordClass | string;
  readonly text: string | null;
  readonly extraction: "html" | "pdf" | "failed" | "none";
  readonly extractionNote: string | null;
  readonly verifiedAt: string | null;
}

export interface AnswerabilityCorpus {
  readonly obligations: readonly ObligationInput[];
  readonly documents: readonly DocumentInput[];
  /**
   * How many sittings the PUBLISHER says this scope held over the window.
   * Supply it only when a public source states it. `null` or absent is the
   * honest and common answer, and it produces `DENOMINATOR_NOT_ESTABLISHED`.
   */
  readonly publishedObligationCount?: number | null;
  /** Where that number came from. Required whenever the number is supplied. */
  readonly publishedObligationSource?: string | null;
}

/* ---------------------------------------------------------------- results */

export type StageState = "REACHED" | "BLOCKED" | "NOT_REACHED";

export interface ObligationLadder {
  readonly meetingId: string;
  readonly bodyId: string | null;
  /** The highest CONTIGUOUS stage reached. Never a stage with a gap below it. */
  readonly reached: AnswerabilityStage | null;
  readonly stageStates: Readonly<Record<AnswerabilityStage, StageState>>;
  /** Why it stopped. Null only when the whole ladder was climbed. */
  readonly blockedBy: BlockCode | null;
  readonly blockedAt: AnswerabilityStage | null;
  /** The document the ladder was measured over — the CURRENT revision. */
  readonly currentDocumentId: string | null;
  readonly supersededDocumentIds: readonly string[];
  readonly itemCount: number;
  /**
   * A downstream predicate passed that is IMPOSSIBLE without its upstream —
   * text with no artifact behind it, items with no text. This is a
   * contradiction in the evidence, not a promotion, and it is reported.
   */
  readonly invariantViolations: readonly string[];
  /**
   * A downstream predicate passed over a failed upstream where the two are
   * genuinely orthogonal — a correctly linked document that yielded no items,
   * for instance. Not a contradiction, and **still not credited**: the ladder
   * measures what a reader can actually get, and a link to nothing is nothing.
   * Reported by name so the count is never mistaken for a defect or lost.
   */
  readonly uncreditedDownstreamPasses: readonly string[];
}

export interface StageMeasurement {
  readonly stage: AnswerabilityStage;
  readonly numerator: number;
  readonly denominator: Denominator;
  /** What the denominator IS, in words. A bare number is not auditable. */
  readonly denominatorBasis: string;
  /** Block code -> how many units stopped here for that reason. */
  readonly blocked: Readonly<Record<string, number>>;
}

export interface LadderMeasurement {
  readonly scope: string;
  readonly questionClass: QuestionClass;
  /** Any ONE of these classes would make the question answerable. */
  readonly requiredRecordClasses: readonly RecordClass[];
  /** The class ruling over the corpus as a whole. */
  readonly classRuling: ClassRuling;
  readonly stages: readonly StageMeasurement[];
  readonly ladders: readonly ObligationLadder[];
  /** Records excluded because their class cannot answer, with their reasons. */
  readonly refusedRecords: readonly { documentId: string; reason: string }[];
  readonly invariantViolations: readonly string[];
  readonly uncreditedDownstreamPasses: readonly string[];
}

/**
 * Stages whose evidence is LITERALLY PRODUCED by the stage before them.
 *
 * A downstream pass over a failed upstream is impossible here and is a
 * contradiction in the record: extracted text with no artifact behind it did
 * not come from anywhere, and items read off text we do not hold were read
 * off nothing.
 *
 * The other transitions are ordered but orthogonal — a document can be
 * correctly linked to its sitting and still have yielded no items — so a
 * downstream pass there is uncredited, named, and NOT called a violation.
 * Calling it one would bury the real contradictions in noise.
 */
const CONTRADICTION_STAGES: readonly AnswerabilityStage[] = ["EXTRACTED", "NORMALIZED"];

/* -------------------------------------------------------------- machinery */

function blankStates(): Record<AnswerabilityStage, StageState> {
  const states = {} as Record<AnswerabilityStage, StageState>;
  for (const stage of ANSWERABILITY_STAGES) states[stage] = "NOT_REACHED";
  return states;
}

/** A start time a query can order on. Unparseable is not a time. */
function hasUsableStart(startsAt: string | null): boolean {
  if (!startsAt) return false;
  return Number.isFinite(Date.parse(startsAt));
}

/**
 * Which revision is CURRENT, and which are superseded.
 *
 * Ordering is `retrievedAt` where it parses, and array order otherwise — the
 * same "append, never overwrite" ordering `AgendaDocumentStore` keeps. An
 * older revision may never stand in for the current one: a silently revised
 * agenda is itself news, and answering from the superseded copy is answering
 * about a sitting that changed.
 */
function splitRevisions(docs: readonly DocumentInput[]): {
  current: DocumentInput | null;
  superseded: DocumentInput[];
} {
  if (docs.length === 0) return { current: null, superseded: [] };
  const ordered = docs
    .map((doc, index) => ({ doc, index }))
    .sort((a, b) => {
      const at = a.doc.retrievedAt ? Date.parse(a.doc.retrievedAt) : Number.NaN;
      const bt = b.doc.retrievedAt ? Date.parse(b.doc.retrievedAt) : Number.NaN;
      if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt;
      return a.index - b.index;
    })
    .map((entry) => entry.doc);
  return {
    current: ordered[ordered.length - 1],
    superseded: ordered.slice(0, -1),
  };
}

export interface MeasureInput {
  readonly scope: string;
  readonly questionClass: QuestionClass;
  readonly corpus: AnswerabilityCorpus;
  /**
   * The normaliser. Defaults to `agendaItems`, the repository's one extractive
   * item reader. Injectable so a test can prove the ZERO-ITEM state without
   * having to author a document the real extractor happens to fail on.
   */
  readonly itemsOf?: (text: string) => readonly string[];
}

/**
 * **Measure the ladder over a real corpus.**
 *
 * Each stage's numerator is counted from that stage's own predicate over the
 * unit's own evidence. No stage reads another stage's count.
 */
export function measureAnswerability(input: MeasureInput): LadderMeasurement {
  const { scope, questionClass, corpus } = input;
  const itemsOf = input.itemsOf ?? ((text: string) => agendaItems(text));

  /* ---- 0. Record class first. A record that cannot answer is not evidence. */
  const { admitted, refused } = evidenceRecordsFor(questionClass, corpus.documents);
  const classRuling = ruleOnQuestion(
    questionClass,
    corpus.documents.map((doc) => doc.recordClass),
  );

  const obligationIds = new Set(corpus.obligations.map((o) => o.meetingId));
  const byMeeting = new Map<string, DocumentInput[]>();
  for (const doc of admitted) {
    const list = byMeeting.get(doc.meetingId) ?? [];
    list.push(doc);
    byMeeting.set(doc.meetingId, list);
  }

  /*
   * The landing-page signal, measured over the ADMITTED set only: one URL
   * stored against several sittings is a portal root, not that sitting's
   * agenda. `AgendaDocumentStore.isUrlOnAnotherMeeting` asks the same
   * question of the live store; this is the same rule over a static corpus.
   */
  const meetingsPerUrl = new Map<string, Set<string>>();
  for (const doc of admitted) {
    const seen = meetingsPerUrl.get(doc.documentUrl) ?? new Set<string>();
    seen.add(doc.meetingId);
    meetingsPerUrl.set(doc.documentUrl, seen);
  }

  /* Which classes this unit holds at all — for the per-unit class refusal. */
  const heldClassesPerMeeting = new Map<string, Set<string>>();
  for (const doc of corpus.documents) {
    const held = heldClassesPerMeeting.get(doc.meetingId) ?? new Set<string>();
    held.add(String(doc.recordClass));
    heldClassesPerMeeting.set(doc.meetingId, held);
  }

  const ladders: ObligationLadder[] = [];
  const allViolations: string[] = [];
  const allUncredited: string[] = [];

  for (const obligation of corpus.obligations) {
    const states = blankStates();
    const violations: string[] = [];
    const uncredited: string[] = [];
    const docs = byMeeting.get(obligation.meetingId) ?? [];
    const { current, superseded } = splitRevisions(docs);

    /* ---- STAGE 1: DISCOVERED ------------------------------------------ */
    // Its own predicate: a sitting with an id and a named body. Nothing about
    // documents, because discovery is not acquisition.
    const discovered =
      obligation.meetingId.length > 0 && obligation.bodyName.length > 0;

    /* ---- STAGE 2: ACQUIRED -------------------------------------------- */
    // Raw bytes retrieved AND hashed. A hash is what makes a document
    // replayable and revision-detectable; without one there is no artifact.
    const acquired = current !== null && !!current.contentHash;

    /* ---- STAGE 3: EXTRACTED ------------------------------------------- */
    // Text came out. `extraction === "failed"` is not text. `""` is not text
    // either: a zero-row extraction is a FAILED extraction.
    const extracted =
      current !== null &&
      current.extraction !== "failed" &&
      current.extraction !== "none" &&
      current.text !== null &&
      current.text.trim().length > 0;

    /* ---- STAGE 4: NORMALIZED ------------------------------------------ */
    // Structure came out of the text. Zero items is a failed normalisation of
    // a real document, never "an agenda with nothing on it".
    const items =
      current && current.text ? itemsOf(current.text) : ([] as readonly string[]);
    const normalized = items.length > 0;

    /* ---- STAGE 5: CANONICALLY_LINKED ---------------------------------- */
    // Bound to THIS sitting and to no other.
    const meetingKnown = current !== null && obligationIds.has(current.meetingId);
    const divisionAgrees =
      current !== null && (current.ocdId ?? null) === (obligation.ocdId ?? null);
    const urlShared =
      current !== null && (meetingsPerUrl.get(current.documentUrl)?.size ?? 0) > 1;
    const canonicallyLinked =
      current !== null && meetingKnown && divisionAgrees && !urlShared;

    /* ---- STAGE 6: QUERY_RETRIEVABLE ----------------------------------- */
    // Reachable by what a reader actually knows: the body, and a tense.
    const addressable = obligation.bodyId !== null && hasUsableStart(obligation.startsAt);
    const queryRetrievable = addressable && items.length > 0;

    /* ---- STAGE 7: READER_VERIFIED ------------------------------------- */
    // A human checked the rendered answer against the source. Nothing else.
    const readerVerified = current !== null && !!current.verifiedAt;

    const predicates: Record<AnswerabilityStage, boolean> = {
      DISCOVERED: discovered,
      ACQUIRED: acquired,
      EXTRACTED: extracted,
      NORMALIZED: normalized,
      CANONICALLY_LINKED: canonicallyLinked,
      QUERY_RETRIEVABLE: queryRetrievable,
      READER_VERIFIED: readerVerified,
    };

    /*
     * Contiguity, and the invariant. A stage counts only when every stage
     * below it also passed its OWN predicate. Where a downstream predicate
     * passes over a broken upstream, that is a contradiction in the data and
     * it is REPORTED, never rounded up into a promotion.
     */
    let broken = false;
    let reached: AnswerabilityStage | null = null;
    for (const stage of ANSWERABILITY_STAGES) {
      if (!broken && predicates[stage]) {
        states[stage] = "REACHED";
        reached = stage;
        continue;
      }
      if (!broken) {
        broken = true;
        states[stage] = "BLOCKED";
        continue;
      }
      states[stage] = "NOT_REACHED";
      if (!predicates[stage]) continue;
      const note =
        `${obligation.meetingId}: ${stage} passed its own test while an earlier stage ` +
        "did not. A downstream success may not stand in for an upstream one; not counted.";
      if (CONTRADICTION_STAGES.includes(stage)) {
        violations.push(note);
        allViolations.push(note);
      } else {
        uncredited.push(note);
        allUncredited.push(note);
      }
    }

    /* ---- Why it stopped. One code, and it names whose fact it is. ------ */
    let blockedBy: BlockCode | null = null;
    let blockedAt: AnswerabilityStage | null = null;
    for (const stage of ANSWERABILITY_STAGES) {
      if (states[stage] !== "BLOCKED") continue;
      blockedAt = stage;
      if (stage === "DISCOVERED") {
        blockedBy = "OBLIGATION_NOT_IDENTIFIED";
      } else if (stage === "ACQUIRED") {
        const held = heldClassesPerMeeting.get(obligation.meetingId);
        if (docs.length === 0 && held && held.size > 0) {
          blockedBy = "RECORD_CLASS_CANNOT_ANSWER";
        } else if (docs.length === 0 && !obligation.agendaUrl) {
          blockedBy = "NO_DOCUMENT_URL_PUBLISHED";
        } else if (docs.length === 0) {
          blockedBy = "DOCUMENT_URL_PUBLISHED_NOT_ACQUIRED";
        } else {
          blockedBy = "ACQUIRED_WITHOUT_ARTIFACT";
        }
      } else if (stage === "EXTRACTED") {
        blockedBy =
          current && current.extraction !== "failed" && current.text !== null
            ? "EXTRACTED_TEXT_EMPTY"
            : "EXTRACTION_FAILED";
      } else if (stage === "NORMALIZED") {
        blockedBy = "NORMALIZED_ZERO_ITEMS";
      } else if (stage === "CANONICALLY_LINKED") {
        blockedBy = !meetingKnown
          ? "LINK_MEETING_UNKNOWN"
          : !divisionAgrees
            ? "LINK_DIVISION_MISMATCH"
            : "LINK_URL_SHARED_ACROSS_MEETINGS";
      } else if (stage === "QUERY_RETRIEVABLE") {
        blockedBy =
          obligation.bodyId === null
            ? "NOT_ADDRESSABLE_NO_BODY_ID"
            : !hasUsableStart(obligation.startsAt)
              ? "NOT_ADDRESSABLE_NO_START_TIME"
              : "NORMALIZED_ZERO_ITEMS";
      } else {
        blockedBy = "NOT_READER_VERIFIED";
      }
      break;
    }

    ladders.push({
      meetingId: obligation.meetingId,
      bodyId: obligation.bodyId,
      reached,
      stageStates: states,
      blockedBy,
      blockedAt,
      currentDocumentId: current?.id ?? null,
      supersededDocumentIds: superseded.map((doc) => doc.id),
      itemCount: items.length,
      invariantViolations: violations,
      uncreditedDownstreamPasses: uncredited,
    });
  }

  /* ---- The table. Each numerator counted from its own stage's state. --- */
  const stages: StageMeasurement[] = [];
  for (const [index, stage] of ANSWERABILITY_STAGES.entries()) {
    const numerator = ladders.filter((l) => l.stageStates[stage] === "REACHED").length;

    const blocked: Record<string, number> = {};
    for (const ladder of ladders) {
      if (ladder.blockedAt !== stage || !ladder.blockedBy) continue;
      blocked[ladder.blockedBy] = (blocked[ladder.blockedBy] ?? 0) + 1;
    }

    let denominator: Denominator;
    let denominatorBasis: string;
    if (index === 0) {
      const published = corpus.publishedObligationCount;
      if (typeof published === "number") {
        denominator = published;
        denominatorBasis = `sittings published by the source (${corpus.publishedObligationSource ?? "source not named"})`;
      } else {
        denominator = DENOMINATOR_NOT_ESTABLISHED;
        denominatorBasis =
          "the publisher exposes no count of its own sittings for this scope; the share " +
          "of them we hold is unknown and is not the numerator";
      }
    } else {
      const previous = ANSWERABILITY_STAGES[index - 1];
      denominator = ladders.filter((l) => l.stageStates[previous] === "REACHED").length;
      denominatorBasis = `units that reached ${previous}`;
    }

    stages.push({ stage, numerator, denominator, denominatorBasis, blocked });
  }

  return {
    scope,
    questionClass,
    requiredRecordClasses: classRuling.requires,
    classRuling,
    stages,
    ladders,
    refusedRecords: refused.map((entry) => ({
      documentId: entry.record.id,
      reason: entry.reason,
    })),
    invariantViolations: allViolations,
    uncreditedDownstreamPasses: allUncredited,
  };
}

/**
 * Read one stage's row out of a measurement. Convenience for callers and
 * tests; it looks the stage up rather than trusting a position.
 */
export function stageOf(
  measurement: LadderMeasurement,
  stage: AnswerabilityStage,
): StageMeasurement {
  const found = measurement.stages.find((row) => row.stage === stage);
  if (!found) throw new Error(`No measurement row for stage ${stage}`);
  return found;
}

/**
 * Classify a snapshot `agendaDocuments` row.
 *
 * **Provenance, never filename.** These rows are fed from `meeting.agendaUrl`
 * or from a curated NOTICE url override (`retrieveAgendaDocument`'s
 * `urlOverride`), so every one of them is notice-class by construction. Guessing
 * from the URL is not available: ten of the committed rows sit under a path
 * literally spelled `Public Notices, Agenda, Minutes/`, and a filename match
 * would classify a county's agenda packet as its minutes and let it answer an
 * outcome question.
 */
export function classifySnapshotDocument(): RecordClass {
  return "AGENDA";
}
