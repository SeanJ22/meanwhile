/**
 * RULING 18 — EQUAL DEPTH IS MEASURED BY HUNT COMPLETION, NOT FIELD PRESENCE.
 *
 * (Prompt C item 2, 2026-08-20. This supersedes the strict-equality
 * implementation Prompt B shipped in `equalDepthGate`.)
 *
 * ## What went wrong with counting fields
 *
 * RULING 7 says no candidate cards ship in a contest until every candidate in
 * it can ship at equal depth, and Prompt B implemented that as exact equality
 * across the four Kelly fields — photo, blurb, contact, campaign site. The
 * gate then withheld 6 of 9 contests at 85701, 7 of 9 at 85641, 6 of 12 at
 * 03255 and 3 of 6 at 07866, overwhelmingly the federal races. That is the
 * gate doing its job, and the measurement was still wrong.
 *
 * A minor-party or write-in candidate may genuinely have no campaign site and
 * never will. Under strict equality their contest can never render, no matter
 * how much hunting is done, because the incumbent beside them has one. That is
 * not equal effort — it is a permanent blackout produced by an artifact of a
 * candidate's circumstances, and it withholds the contest from the reader
 * forever as a side effect.
 *
 * ## The three states
 *
 * Every Kelly field, per candidate, carries exactly one:
 *
 *   NOT_HUNTED       no completed hunt for this field.
 *   FOUND            the field is present, with its source recorded.
 *   VERIFIED_ABSENT  a completed hunt walked every applicable rung and the
 *                    thing does not exist.
 *
 * `VERIFIED_ABSENT` is a FINDING, not a gap. It is the state that says "we did
 * the work; there is no campaign site" — and because it is a claim about a
 * named person, it carries the rungs walked and the date checked, the same
 * evidence standard the transparency mandate puts on every other claim of
 * absence. It is earned by a hunt session and NEVER by a backfill.
 *
 * ## The gate
 *
 * A contest renders candidate cards when, for every candidate in it, every
 * Kelly field is either FOUND or VERIFIED_ABSENT — that is, when no field
 * anywhere in the contest is NOT_HUNTED. Equality is on hunt completion. It is
 * not on field presence.
 *
 * ## Why presence still wins at read time
 *
 * `stateFor` below takes the recorded state AND what the data actually holds.
 * A field that is present is FOUND whatever the file says; a field that is
 * absent can never read FOUND, because that would be the render-default
 * failure — a stored value turning into a claim the data does not support.
 * The file's only authority is to raise an absent field from NOT_HUNTED to
 * VERIFIED_ABSENT, and only with rungs and a date behind it.
 */

/** The four reader-visible Kelly fields, in the order they are reported. */
export const KELLY_FIELDS = ["photo", "blurb", "contact", "campaignSite"] as const;

export type KellyField = (typeof KELLY_FIELDS)[number];

export const HUNT_STATES = ["NOT_HUNTED", "FOUND", "VERIFIED_ABSENT"] as const;

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
  | { state: "VERIFIED_ABSENT"; rungs: WalkedRung[]; checkedAt: string };

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
): record is { state: "VERIFIED_ABSENT"; rungs: WalkedRung[]; checkedAt: string } {
  if (!record || record.state !== "VERIFIED_ABSENT") return false;
  if (!Array.isArray(record.rungs) || record.rungs.length === 0) return false;
  if (typeof record.checkedAt !== "string" || !ISO_DATE.test(record.checkedAt)) {
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
  return isEvidencedAbsence(record) ? "VERIFIED_ABSENT" : "NOT_HUNTED";
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
 * THE READER-FACING WORDING for a completed hunt that found nothing.
 *
 * Level register — this is a claim surface, about a real person. Each sentence
 * separates OUR action from THEIR absence, which is the attribution the render
 * -default rule requires: the reader must be able to tell "we haven't looked"
 * from "there is nothing to find", and these say the second one out loud.
 *
 * The RULE is the attribution, never these particular sentences; they may be
 * rewritten any day. What may not be lost is that a completed hunt reads
 * differently from an unfinished one.
 */
export const VERIFIED_ABSENT_WORDING: Record<KellyField, string> = {
  photo: "We searched for a portrait. This candidate has not published one.",
  blurb:
    "We searched for something in this candidate's own words. They have not published any.",
  contact:
    "We searched for a way to contact this candidate. They have not published one.",
  campaignSite: "We searched for a campaign site. This candidate does not have one.",
};

/** Plain-language field names for a reader surface — never the enum key. */
export const KELLY_FIELD_LABEL: Record<KellyField, string> = {
  photo: "Photo",
  blurb: "In their own words",
  contact: "Contact",
  campaignSite: "Campaign site",
};
