/**
 * The feedback inbox: what a reader wrote, and what the owner did about it.
 *
 * A feedback row's contact reference is never joined to any reader behaviour.
 * It is kept unavailable rather than guarded: the query selects
 * `(contact_ref IS NOT NULL)` as a boolean, the delivery store is never opened,
 * only one table is read, {@link assertInboxRowIsSafe} refuses a row carrying a
 * contact field under any spelling, and owner decisions are keyed by the
 * message's own row id.
 *
 * Production and staging are separate stores, each opened read-only.
 * {@link openFeedbackStore} refuses before any query: a staging handle resolving
 * to the live endpoint, one whose isolation cannot be established, one whose
 * role can write; an absent handle is a named gap, never an empty inbox.
 *
 * The table has no status or notes column: NEW is the absence of a decision,
 * HELD_BACK is the quarantine column, and the owner's statuses live in the
 * append-only decision log.
 *
 * The two `open*` functions are server-side; everything else is pure.
 */

import { collapseDecisionLog } from "./decision-log.ts";
import { type OwnerDecisionIntent } from "./owner-surface.ts";

/* ------------------------------------------------------------------ *
 * 1. THE TWO ENVIRONMENTS
 * ------------------------------------------------------------------ */

export const FEEDBACK_ENVIRONMENTS = ["PRODUCTION", "STAGING"] as const;
export type FeedbackEnvironment = (typeof FEEDBACK_ENVIRONMENTS)[number];

/* ------------------------------------------------------------------ *
 * 2. THE READ — ONE TABLE, AND A BOOLEAN WHERE THE HANDLE WOULD BE
 * ------------------------------------------------------------------ */

/** The list query. `(contact_ref IS NOT NULL)` is computed in the database so the handle never leaves it. */
export const FEEDBACK_INBOX_SQL =
  "SELECT id, received_at, message, surface, run_class, run_id, suspect_reason, " +
  "(contact_ref IS NOT NULL) AS reply_requested " +
  "FROM feedback ORDER BY received_at DESC LIMIT $1";

/**
 * The census over the whole table. Every run class and `total` are counted
 * independently, so an unknown run class shows up as a shortfall.
 */
export const FEEDBACK_CENSUS_SQL =
  "SELECT " +
  "COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic, " +
  "COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic, " +
  "COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown, " +
  "COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author, " +
  "COUNT(*) FILTER (WHERE suspect_reason IS NOT NULL) AS held_back, " +
  "COUNT(*) AS total " +
  "FROM feedback";

/** One message as the owner may see it. Flat by design: nothing to walk. */
export interface FeedbackInboxRow {
  /** The message's own row id. Not a person, not a device, not the handle. */
  readonly rowId: string;
  readonly environment: FeedbackEnvironment;
  readonly receivedAt: string;
  /** What the reader wrote, as the write path scrubbed it. */
  readonly message: string;
  /** Which entry point it came through, as stored. Rendered through words. */
  readonly surface: string;
  /** Someone asked to hear back. PRESENCE ONLY — the handle is never read. */
  readonly replyRequested: boolean;
  readonly runClass: string;
  /** The automated run that wrote it, when one declared itself. */
  readonly runLabel: string | null;
  /** Why the intake protections held it back, when they did. */
  readonly heldBackReason: string | null;
}

export interface FeedbackRunCensus {
  readonly organic: number;
  readonly synthetic: number;
  readonly unknown: number;
  readonly author: number;
  readonly heldBack: number;
  readonly total: number;
}

export const EMPTY_CENSUS: FeedbackRunCensus = {
  organic: 0,
  synthetic: 0,
  unknown: 0,
  author: 0,
  heldBack: 0,
  total: 0,
};

/** Field names a projected row may never carry: this store's contact spellings, checked by a flat key scan. */
export const CONTACT_FIELDS_REFUSED: readonly string[] = [
  "contactRef",
  "contact_ref",
  "replyTo",
  "reply_to",
  "address",
  "email",
];

/** Refuse a row that carries a contact value rather than its presence. */
export function assertInboxRowIsSafe(row: Record<string, unknown>, context: string): void {
  const carried = Object.keys(row).filter((key) => CONTACT_FIELDS_REFUSED.includes(key));
  if (carried.length > 0) {
    throw new Error(
      `${context} refused: an inbox row carries ${carried.join(", ")}. The feedback inbox may ` +
        "know THAT someone asked to hear back and never WHO — §5.3 keeps the contact reference " +
        "out of every rendered surface, and the query selects a boolean so the value cannot " +
        "reach this process in the first place.",
    );
  }
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
/** One database row as an inbox row, or null (counted as `unreadable`) when it cannot be read. */
export function projectFeedbackRow(
  raw: Record<string, unknown>,
  environment: FeedbackEnvironment,
): FeedbackInboxRow | null {
  const rowId = textOf(raw.id).trim();
  const message = textOf(raw.message);
  if (rowId === "" || message === "") return null;

  const receivedAtRaw = raw.received_at;
  const receivedAt =
    receivedAtRaw instanceof Date
      ? receivedAtRaw.toISOString()
      : textOf(receivedAtRaw).trim();
  if (receivedAt === "") return null;

  const runLabelRaw = textOf(raw.run_id).trim();
  const heldBackRaw = textOf(raw.suspect_reason).trim();
  const surface = textOf(raw.surface).trim();
  const runClass = textOf(raw.run_class).trim();

  const row: FeedbackInboxRow = {
    rowId,
    environment,
    receivedAt,
    message,
    surface: surface === "" ? "UNKNOWN" : surface,
    replyRequested: raw.reply_requested === true,
    runClass: runClass === "" ? "UNKNOWN" : runClass,
    runLabel: runLabelRaw === "" ? null : runLabelRaw,
    heldBackReason: heldBackRaw === "" ? null : heldBackRaw,
  };
  assertInboxRowIsSafe(row as unknown as Record<string, unknown>, "projectFeedbackRow");
  return row;
}

/** The denominator sentence any rendered feedback figure carries; run classes are reconciled against the total. */
export function feedbackDenominatorSentence(census: FeedbackRunCensus): string {
  const classified = census.organic + census.synthetic + census.unknown + census.author;
  const excluded = census.total - census.organic;
  const shortfall = census.total - classified;
  const reconciliation =
    shortfall === 0
      ? ""
      : ` ${shortfall} row(s) carry a run class outside the four counted here and are ` +
        "excluded from every figure until they are classified.";
  return (
    `Counted from ${census.organic} message(s) sent by readers, out of ${census.total} in the ` +
    `store. ${excluded} further row(s) are excluded: ${census.synthetic} written by automated ` +
    `runs, ${census.unknown} that predate the run marker and cannot be attributed either way, ` +
    `${census.author} written by the author testing the product.${reconciliation}`
  );
}

/* ------------------------------------------------------------------ *
 * 3. OPENING A STORE, AND THE FOUR REFUSALS
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 4. TRIAGE — THE FOUR STATES THE OWNER HIMSELF RECORDS
 * ------------------------------------------------------------------ */

/**
 * ```
 *   NEW            no decision has been recorded about this message
 *   REVIEWED       read; needs nothing
 *   NEEDS_ACTION   read; something has to change
 *   RESOLVED       whatever it asked for has been done
 *   NOT_ACTIONABLE nothing to do: a duplicate, a mistake, or not about this
 *   HELD_BACK      quarantined by intake protections; never an owner decision
 * ```
 *
 * The middle four are append-only decision-log intents; a later decision
 * supersedes an earlier one and both survive.
 */
export const TRIAGE_STATES = [
  "NEW",
  "REVIEWED",
  "NEEDS_ACTION",
  "RESOLVED",
  "NOT_ACTIONABLE",
] as const;
export type TriageState = (typeof TRIAGE_STATES)[number];

/** What each state is called on the face, and what it means to the owner. */
export const TRIAGE_WORDS: Readonly<
  Record<TriageState, { readonly words: string; readonly means: string }>
> = {
  NEW: { words: "Not looked at", means: "You have not recorded anything about this one yet." },
  REVIEWED: { words: "Read, nothing to do", means: "You read it and decided it needs nothing." },
  NEEDS_ACTION: { words: "Needs work", means: "You read it and something has to change." },
  RESOLVED: { words: "Done", means: "What it asked for has been dealt with." },
  NOT_ACTIONABLE: { words: "Nothing to do", means: "Not something to act on — a duplicate, a mistake, or not about this." },
};

/**
 * The option text each button records. The recorded option IS this string, so
 * changing one changes what a past decision means — treat it as data, not copy.
 */
export const TRIAGE_OPTIONS: readonly { readonly state: TriageState; readonly option: string }[] = [
  { state: "REVIEWED", option: "Read, nothing to do" },
  { state: "NEEDS_ACTION", option: "Needs work" },
  { state: "RESOLVED", option: "Done" },
  { state: "NOT_ACTIONABLE", option: "Nothing to do" },
];

export function optionToState(option: string): TriageState | null {
  const found = TRIAGE_OPTIONS.find((o) => o.option === option.trim());
  return found ? found.state : null;
}

export const FEEDBACK_SUBJECT_PREFIX = "feedback:";

/**
 * The decision-log subject for one message: its own random row id and its
 * environment, never the contact reference or anything a reader typed.
 */
export function feedbackSubjectId(environment: FeedbackEnvironment, rowId: string): string {
  return `${FEEDBACK_SUBJECT_PREFIX}${environment}:${rowId}`;
}

export function isFeedbackTriageIntent(intent: Pick<OwnerDecisionIntent, "subjectId">): boolean {
  return intent.subjectId.startsWith(FEEDBACK_SUBJECT_PREFIX);
}

/** What the owner has recorded about one message, as the page shows it. */
export interface TriageMark {
  readonly state: TriageState;
  readonly decidedAt: string;
  /** His own words, when he typed any. Never the reader's. */
  readonly note: string | null;
  /** The option string as recorded, for the technical disclosure. */
  readonly recordedOption: string;
}

/**
 * Fold the decision log into one mark per message: the newest decision about a
 * subject wins. An unrecognised recorded option is ignored, leaving the message
 * looking untouched.
 */
export function triageBySubject(
  decisions: readonly OwnerDecisionIntent[],
): ReadonlyMap<string, TriageMark> {
  const marks = new Map<string, TriageMark>();
  for (const row of collapseDecisionLog(decisions)) {
    if (!isFeedbackTriageIntent(row)) continue;
    const state = optionToState(row.chosenOption);
    if (state === null) continue;
    const held = marks.get(row.subjectId);
    if (held && held.decidedAt >= row.decidedAt) continue;
    marks.set(row.subjectId, {
      state,
      decidedAt: row.decidedAt,
      note: row.ownerAnswer ?? null,
      recordedOption: row.chosenOption,
    });
  }
  return marks;
}

/* ------------------------------------------------------------------ *
 * 5. THE VIEW THE PAGE RENDERS
 * ------------------------------------------------------------------ */

