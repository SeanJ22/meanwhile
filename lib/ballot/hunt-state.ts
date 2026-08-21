/**
 * **THE HUNT-STATE WORK QUEUE — DATA, NEVER A GATE** (RULING 23 and RULING 26,
 * Prompt D items 1 and 2, 2026-08-20).
 *
 * Every Kelly field, per candidate, carries exactly one of four states. They
 * are how a hunt session knows what is left to do. **Nothing reads them to
 * decide what renders, and no reader ever sees one.**
 *
 *   NOT_HUNTED       no completed hunt for this field.
 *   FOUND            the field is present, with its source recorded.
 *   VERIFIED_ABSENT  a completed hunt walked every applicable rung and the
 *                    thing does not exist — a FINDING, earned by a hunt
 *                    session and NEVER by a backfill, carrying the rungs
 *                    walked and the date checked.
 *   NOT_APPLICABLE   the field cannot exist for this candidate — structural
 *                    absence, with its reason and its date. A candidate who
 *                    has never held the office has no voting record to find,
 *                    and counting one as owed is what stopped the queue ever
 *                    reaching zero.
 *
 * ## What this file used to be, and why it is not that any more
 *
 * RULING 18 (Prompt C) made these states the measurement behind a GATE: a
 * contest rendered candidate cards only when no field anywhere in it was
 * NOT_HUNTED. That gate withheld all 36 contests across the four pilot zips,
 * so the product rendered no candidate cards at all while holding portraits,
 * finance figures and verified pages in the database.
 *
 * **RULING 26 killed it.** Completeness is a property of the HUNT. It kept
 * being treated as a property of the record. Everything the product holds
 * about a candidate renders; collection state never governs display; the
 * correct response to an incomplete hunt is more hunting. RULING 18 and
 * RULING 22 are superseded and neither returns in any form —
 * `tests/no-suppression.test.ts` fails the build if one does.
 *
 * ## Why presence still wins at read time
 *
 * `stateFor` below takes the recorded state AND what the data actually holds.
 * A field that is present is FOUND whatever the file says; a field that is
 * absent can never read FOUND, because that would be the render-default
 * failure — a stored value turning into a claim the data does not support.
 * The file's only authority over an absent field is to raise it out of
 * NOT_HUNTED, and only with evidence behind it.
 */

import { type Branch, isEvidencedByBranches } from "../hunt/discovery.ts";

/** The four reader-visible Kelly fields, in the order they are reported. */
export const KELLY_FIELDS = ["photo", "blurb", "contact", "campaignSite"] as const;

export type KellyField = (typeof KELLY_FIELDS)[number];

export const HUNT_STATES = [
  "NOT_HUNTED",
  "FOUND",
  "VERIFIED_ABSENT",
  "NOT_APPLICABLE",
] as const;

export type HuntState = (typeof HUNT_STATES)[number];

/**
 * One rung of the ladder, walked. The shape matches what
 * `docs/source-ladder.md` records everywhere else: which rung, when, and what
 * came back. `rung` is the CANONICAL retrieval-mechanics numbering from
 * `CLAUDE.md` (RULING 16), written as a number or as its short name.
 */
export interface WalkedRung {
  rung: string;
  attemptedAt: string;
  result: string;
}

/** The recorded state of one field for one candidate, as it sits in the file. */
export type RecordedFieldState =
  | { state: "NOT_HUNTED" }
  | { state: "FOUND" }
  | {
      state: "VERIFIED_ABSENT";
      rungs: WalkedRung[];
      /**
       * **RULING 52, 2026-08-21: the BRANCHES walked, not only the rungs.**
       *
       * Rungs prove the retrieval discipline was followed on one route.
       * Branches prove more than one route was tried at all — and every one of
       * the three wrong verdicts that produced RULING 52 had a defensible rung
       * history behind it. `gc.nh.gov` was recorded as refusing every client
       * this project has and answers rung 2 at HTTP 200; Kearsarge's nine board
       * emails were recorded absent twice and were in the page's own hrefs.
       *
       * Required, and validated by `isEvidencedAbsence` below. There are zero
       * `VERIFIED_ABSENT` records in the product as of this ruling, so nothing
       * is grandfathered and nothing needs to be.
       */
      branches: Branch[];
      checkedAt: string;
    }
  | { state: "NOT_APPLICABLE"; reason: string; checkedAt: string };

/** Every field's recorded state for one candidate. */
export type RecordedCandidateHunt = Record<KellyField, RecordedFieldState>;

export interface CandidateHuntFile {
  /** Wall clock from `corepack pnpm stamp`, America/Phoenix. */
  migratedAt: string;
  note: string;
  candidates: Record<string, RecordedCandidateHunt>;
}

/** What the ballot data actually holds for one candidate, field by field. */
export type FieldPresence = Record<KellyField, boolean>;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a `VERIFIED_ABSENT` record the product is allowed to act on?
 *
 * A claim that a public person has no campaign site is a claim about them, and
 * the transparency mandate's evidence standard applies: the rungs walked, each
 * with its attempt date and its result, and the date the hunt was completed.
 * A record missing any of that is not a finding — it is an assertion of
 * absence wearing a finding's name, which is the one thing this repo may never
 * render. `tests/hunt-state.test.ts` fails if such a record is ever written.
 */
export function isEvidencedAbsence(
  record: RecordedFieldState | undefined,
): record is {
  state: "VERIFIED_ABSENT";
  rungs: WalkedRung[];
  branches: Branch[];
  checkedAt: string;
} {
  if (!record || record.state !== "VERIFIED_ABSENT") return false;
  if (!Array.isArray(record.rungs) || record.rungs.length === 0) return false;
  if (typeof record.checkedAt !== "string" || !ISO_DATE.test(record.checkedAt)) {
    return false;
  }
  /*
   * RULING 52 (2026-08-21). Two INDEPENDENT branches minimum, each with its
   * own date and result, and none of them may have found the thing. A single
   * empty branch is a measurement, and calling it an absence is the ladder's
   * `unreachable` verdict wearing a new name.
   */
  if (!isEvidencedByBranches({ branches: record.branches, checkedAt: record.checkedAt })) {
    return false;
  }
  return record.rungs.every(
    (r) =>
      r &&
      typeof r.rung === "string" &&
      r.rung.trim() !== "" &&
      typeof r.attemptedAt === "string" &&
      ISO_DATE.test(r.attemptedAt) &&
      typeof r.result === "string" &&
      r.result.trim() !== "",
  );
}

/**
 * The state of one field, reconciled against what the data actually holds.
 *
 * Presence is authoritative upward and the file is authoritative only for the
 * absent case. See the header: a stored `FOUND` on an absent field would be a
 * default manufacturing a claim.
 */
export function stateFor(
  present: boolean,
  record: RecordedFieldState | undefined,
): HuntState {
  if (present) return "FOUND";
  if (isEvidencedAbsence(record)) return "VERIFIED_ABSENT";
  if (isEvidencedNotApplicable(record)) return "NOT_APPLICABLE";
  return "NOT_HUNTED";
}

/** Every field's live state for one candidate. */
export function statesFor(
  presence: FieldPresence,
  recorded: RecordedCandidateHunt | undefined,
): Record<KellyField, HuntState> {
  const out = {} as Record<KellyField, HuntState>;
  for (const field of KELLY_FIELDS) {
    out[field] = stateFor(presence[field], recorded?.[field]);
  }
  return out;
}

/**
 * Is this a `NOT_APPLICABLE` record the product is allowed to act on?
 *
 * The same evidence discipline `isEvidencedAbsence` applies, for the same
 * reason. "This field cannot exist for this person" is a claim about a named
 * person, so it carries a REASON and a DATE, and a record missing either is
 * not a structural finding — it is a gap wearing one's name.
 */
export function isEvidencedNotApplicable(
  record: RecordedFieldState | undefined,
): record is { state: "NOT_APPLICABLE"; reason: string; checkedAt: string } {
  if (!record || record.state !== "NOT_APPLICABLE") return false;
  if (typeof record.reason !== "string" || record.reason.trim() === "") return false;
  return typeof record.checkedAt === "string" && ISO_DATE.test(record.checkedAt);
}

/**
 * **WHEN EACH KELLY FIELD IS STRUCTURALLY UNAVAILABLE** (Prompt D item 2.2,
 * 2026-08-20).
 *
 * Read straight off the frozen required-field matrix — `lib/evidence/
 * field-matrix.ts`, version `vH-1`, frozen 2026-08-16 before any hunting
 * began — rather than decided here, because a rule that decides when a field
 * leaves the denominator must not be written by the session that wants the
 * denominator smaller.
 *
 * **All four read `never`, and that is the finding.** A candidate can always
 * in principle have a portrait, words of their own, a way to be reached, and a
 * site; the matrix says so, and it said so before anybody counted. So nothing
 * in the `HD01`–`HD30` queue is structurally unavailable, and none of its
 * 249 owed fields moves out of the denominator.
 *
 * **THE CLEAR STRUCTURAL CASE IS A VOTING RECORD, and it is not tracked here.**
 * A candidate who has never held the office has no roll-call record to find.
 * That case is already handled structurally rather than by a state: the
 * voting-record door on a ballot card comes from the exact-key incumbent join
 * in `lib/ballot/incumbent-record.ts`, so a challenger simply has no door —
 * no join, no link, and never a wrong one. It is named here so the rule is
 * written down somewhere, and so the next session does not re-derive it and
 * mistake it for one of these four.
 *
 * A field that later grows a genuine structural case is a SCHEMA CORRECTION
 * with an audit trail, per the matrix's own rule — a new matrix entry with its
 * own version stamp, never a quiet edit to this table.
 */
export const KELLY_FIELD_NOT_APPLICABLE_WHEN: Record<KellyField, string> = {
  photo: "never — honest initials are a success",
  blurb: "never",
  contact: "never",
  campaignSite: "never",
};
