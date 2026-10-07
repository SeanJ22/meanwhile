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

import { neon } from "@neondatabase/serverless";

import type { ReadOutcome } from "./admin-data.ts";
import { collapseDecisionLog } from "./decision-log.ts";
import { isReadonlyUser } from "../db/write-handle.ts";
import { classifyDatabaseUrl, sameEndpointIdentity } from "../ops/staging-isolation.ts";
import {
  measured,
  type CountClaim,
  type Measured,
  type OwnerDecisionIntent,
  type RenderedNumber,
} from "./owner-surface.ts";
import type { Sql } from "./repository/pg-store.ts";

/* ------------------------------------------------------------------ *
 * 1. THE TWO ENVIRONMENTS
 * ------------------------------------------------------------------ */

export const FEEDBACK_ENVIRONMENTS = ["PRODUCTION", "STAGING"] as const;
export type FeedbackEnvironment = (typeof FEEDBACK_ENVIRONMENTS)[number];

/**
 * The variables that name each store. Never rendered. The staging one is the
 * existing read-only handle to the staging application database; it is not
 * provisioned today.
 */
export const PRODUCTION_FEEDBACK_URL_VAR = "DATABASE_URL";
export const STAGING_STORE_URL_VAR = "WTP_STAGING_DATABASE_URL_READONLY";

export const FEEDBACK_STORE_VAR: Readonly<Record<FeedbackEnvironment, string>> = {
  PRODUCTION: PRODUCTION_FEEDBACK_URL_VAR,
  STAGING: STAGING_STORE_URL_VAR,
};

/** How each environment is named on the face, and what it means. */
export const ENVIRONMENT_WORDS: Readonly<
  Record<FeedbackEnvironment, { readonly words: string; readonly means: string }>
> = {
  PRODUCTION: {
    words: "Live site",
    means: "Sent by someone using the public site.",
  },
  STAGING: {
    words: "Review site",
    means: "Sent from the private build you review before it ships.",
  },
};

/* ------------------------------------------------------------------ *
 * 2. THE READ — ONE TABLE, AND A BOOLEAN WHERE THE HANDLE WOULD BE
 * ------------------------------------------------------------------ */

/** How many messages the page lists. The census counts the whole table. */
export const FEEDBACK_INBOX_LIMIT = 200;

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

export interface StoreReading {
  readonly environment: FeedbackEnvironment;
  /** When this reading was taken, so the page never implies it is live. */
  readonly readAt: string;
  readonly rows: readonly FeedbackInboxRow[];
  /** Rows the query returned that could not be read as a message. */
  readonly unreadable: number;
  readonly census: FeedbackRunCensus;
}

function censusFrom(raw: Record<string, unknown> | undefined): FeedbackRunCensus {
  const n = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  };
  if (!raw) return EMPTY_CENSUS;
  return {
    organic: n(raw.organic),
    synthetic: n(raw.synthetic),
    unknown: n(raw.unknown),
    author: n(raw.author),
    heldBack: n(raw.held_back),
    total: n(raw.total),
  };
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

export type StoreHandle =
  | { readonly ok: true; readonly sql: Sql }
  | {
      readonly ok: false;
      readonly reason:
        | "NOT_CONNECTED"
        | "NOT_READ_ONLY"
        | "SAME_STORE_AS_LIVE"
        | "UNPROVEN_ISOLATION"
        | "UNOPENABLE";
      /** Plain English for the owner. Never a variable name, never a value. */
      readonly says: string;
      /** What he would have to do, when there is something he can do. */
      readonly action: string | null;
    };

/** The exact thing the owner does to turn the review site's messages on. */
export const STAGING_OWNER_ACTION =
  "Create a read-only database role on the review site's own database branch, and give the " +
  "console that read-only connection. Nothing else changes: the review site keeps its own " +
  "store, and the console only ever reads from it.";

/** Open one environment's feedback store, or say precisely why not. `env` is injected for tests. */
export function openFeedbackStore(
  environment: FeedbackEnvironment,
  env: Record<string, string | undefined> = process.env,
): StoreHandle {
  const url = (env[FEEDBACK_STORE_VAR[environment]] ?? "").trim();
  if (url === "") {
    return {
      ok: false,
      reason: "NOT_CONNECTED",
      says:
        environment === "PRODUCTION"
          ? "This copy of the console has no connection to the live site's message store, so " +
            "nothing has been read. That is a fact about how this copy is set up — not a " +
            "finding that nobody has written."
          : "The console has no connection to the review site's message store, so nothing has " +
            "been read from it. Messages sent there are being kept by the review site itself; " +
            "they have not been lost and they have not been looked at.",
      action: environment === "STAGING" ? STAGING_OWNER_ACTION : null,
    };
  }

  if (environment === "STAGING") {
    /*
     * Refused by where the connection points, not by its string: two connection
     * strings can name one endpoint. Uses `lib/ops/staging-isolation.ts`; an
     * identity that could not be established is refused (null is not false).
     */
    const live = (env[PRODUCTION_FEEDBACK_URL_VAR] ?? "").trim();
    const bypass = {
      ok: false as const,
      reason: "SAME_STORE_AS_LIVE" as const,
      says:
        "The connection offered for the review site's messages points at the live site's own " +
        "store. The console refused to read it: it could not then tell a review message from a " +
        "real one, and the review build must never write into the live store.",
      action:
        "Point the review site's store at its own database branch, then give the console a " +
        "read-only connection to that branch.",
    };
    if (classifyDatabaseUrl(url, { productionHostHint: live === "" ? null : live }) === "production") {
      return bypass;
    }
    if (live !== "") {
      const same = sameEndpointIdentity(live, url);
      if (same === null) {
        return {
          ok: false,
          reason: "UNPROVEN_ISOLATION",
          says:
            "The console could not establish that the review site's message store is a " +
            "different store from the live one, so it did not read either as the other. " +
            "Nothing was read from the review site, and nothing is being claimed about it.",
          action:
            "Check that the review site's connection names its own database branch, then load " +
            "this page again.",
        };
      }
      if (same) return bypass;
    }
    if (!isReadonlyUser(url)) {
      return {
        ok: false,
        reason: "NOT_READ_ONLY",
        says:
          "The connection offered for the review site's messages can write as well as read. " +
          "The console refused it: it only ever needs to read, and a handle that could write " +
          "is a handle that one day will.",
        action: STAGING_OWNER_ACTION,
      };
    }
  }

  try {
    return { ok: true, sql: neon(url) as unknown as Sql };
  } catch {
    return {
      ok: false,
      reason: "UNOPENABLE",
      says:
        environment === "PRODUCTION"
          ? "The live site's message store could not be opened, so nothing was read. Nothing " +
            "has been checked and found missing — it has not been checked."
          : "The review site's message store could not be opened, so nothing was read from it.",
      action: null,
    };
  }
}

/** Read one environment: the newest messages and the census, queried together. */
export async function readFeedbackStore(
  sql: Sql,
  environment: FeedbackEnvironment,
  nowIso: string,
  limit: number = FEEDBACK_INBOX_LIMIT,
): Promise<ReadOutcome<StoreReading>> {
  try {
    const [listed, counted] = await Promise.all([
      sql.query(FEEDBACK_INBOX_SQL, [limit]) as Promise<unknown>,
      sql.query(FEEDBACK_CENSUS_SQL) as Promise<unknown>,
    ]);
    const raw = Array.isArray(listed) ? (listed as Record<string, unknown>[]) : [];
    const rows: FeedbackInboxRow[] = [];
    let unreadable = 0;
    for (const one of raw) {
      const row = projectFeedbackRow(one, environment);
      if (row === null) unreadable += 1;
      else rows.push(row);
    }
    const censusRows = Array.isArray(counted) ? (counted as Record<string, unknown>[]) : [];
    return {
      kind: "HELD",
      value: {
        environment,
        readAt: nowIso,
        rows,
        unreadable,
        census: censusFrom(censusRows[0]),
      },
    };
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      detail:
        `Reading the ${ENVIRONMENT_WORDS[environment].words.toLowerCase()}'s messages failed ` +
        `(${(error as Error)?.name ?? "error"}). Nothing was read, so nothing is being claimed.`,
    };
  }
}

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

/** The consequence every triage button shows, captured on the record as read. */
export const TRIAGE_CONSEQUENCE =
  "Records this as your status for this message. It does not reply to anyone, it does not " +
  "change anything a reader sees, and you can change it again later.";

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

/** One environment's standing, whether or not it could be read. */
export interface EnvironmentView {
  readonly environment: FeedbackEnvironment;
  readonly connected: boolean;
  /** Plain English: what happened when the console tried to read it. */
  readonly says: string;
  /** What the owner would have to do, when there is something. */
  readonly action: string | null;
  readonly reading: StoreReading | null;
}

export interface InboxItem {
  readonly row: FeedbackInboxRow;
  readonly subjectId: string;
  readonly state: TriageState;
  readonly mark: TriageMark | null;
}

export interface FeedbackInboxView {
  readonly environments: readonly EnvironmentView[];
  readonly items: readonly InboxItem[];
  /** Messages with no recorded status and no quarantine — the work waiting. */
  readonly waiting: number;
  readonly heldBack: number;
  readonly replyRequested: number;
  readonly byState: Readonly<Record<TriageState, number>>;
  readonly shown: Measured;
  readonly organic: Measured;
  readonly needingYou: Measured;
  readonly denominatorSays: string;
  /** ACTIVE only when the review site's messages are actually being read. */
  readonly stagingFeedback: "ACTIVE" | "OWNER_GATED";
  readonly stagingSays: string;
  readonly stagingAction: string | null;
}

export interface InboxInput {
  readonly environments: readonly EnvironmentView[];
  readonly decisions: readonly OwnerDecisionIntent[];
}

/**
 * Build the whole view. Pure. Every count is derived from the same item list
 * the page renders; `countClaimsOf` checks it against the rendered output.
 */
export function buildFeedbackInboxView(input: InboxInput): FeedbackInboxView {
  const marks = triageBySubject(input.decisions);

  const items: InboxItem[] = [];
  for (const env of input.environments) {
    if (env.reading === null) continue;
    for (const row of env.reading.rows) {
      const subjectId = feedbackSubjectId(row.environment, row.rowId);
      const mark = marks.get(subjectId);
      items.push({
        row,
        subjectId,
        state: mark ? mark.state : "NEW",
        mark: mark ? mark : null,
      });
    }
  }
  items.sort((a, b) => {
    if (a.row.receivedAt !== b.row.receivedAt) return a.row.receivedAt < b.row.receivedAt ? 1 : -1;
    return a.row.rowId < b.row.rowId ? 1 : -1;
  });

  const byState: Record<TriageState, number> = {
    NEW: 0,
    REVIEWED: 0,
    NEEDS_ACTION: 0,
    RESOLVED: 0,
    NOT_ACTIONABLE: 0,
  };
  for (const item of items) byState[item.state] += 1;

  const heldBack = items.filter((i) => i.row.heldBackReason !== null).length;
  const replyRequested = items.filter((i) => i.row.replyRequested).length;
  const waiting = items.filter((i) => i.state === "NEW" && i.row.heldBackReason === null).length;
  const needingYou = waiting + byState.NEEDS_ACTION;

  const readEnvironments = input.environments.filter((e) => e.reading !== null);
  const storeTotal = readEnvironments.reduce(
    (sum, e) => sum + (e.reading ? e.reading.census.total : 0),
    0,
  );
  const organicTotal = readEnvironments.reduce(
    (sum, e) => sum + (e.reading ? e.reading.census.organic : 0),
    0,
  );
  const combined: FeedbackRunCensus = {
    organic: organicTotal,
    synthetic: readEnvironments.reduce((s, e) => s + (e.reading ? e.reading.census.synthetic : 0), 0),
    unknown: readEnvironments.reduce((s, e) => s + (e.reading ? e.reading.census.unknown : 0), 0),
    author: readEnvironments.reduce((s, e) => s + (e.reading ? e.reading.census.author : 0), 0),
    heldBack: readEnvironments.reduce((s, e) => s + (e.reading ? e.reading.census.heldBack : 0), 0),
    total: storeTotal,
  };

  /*
   * The list's denominator is the store. A census smaller than the page (a
   * write between the two queries) is widened to the rows actually rendered.
   */
  const listDenominator = Math.max(storeTotal, items.length);

  const staging = input.environments.find((e) => e.environment === "STAGING");
  const stagingActive = staging !== undefined && staging.reading !== null;

  return {
    environments: input.environments,
    items,
    waiting,
    heldBack,
    replyRequested,
    byState,
    shown: measured(
      items.length,
      listDenominator,
      "The most recent messages, out of every message in the stores the console could read. " +
        "Older messages are in the store and are not on this page.",
      "COUNT(*) over each connected feedback store, taken with the list itself",
    ),
    organic: measured(
      Math.min(organicTotal, storeTotal),
      Math.max(storeTotal, organicTotal),
      "Messages sent by readers, out of every message in the store. The rest were written by " +
        "automated runs, by the author, or before the run marker existed.",
      "COUNT(*) FILTER over run_class in each connected feedback store",
    ),
    needingYou: measured(
      needingYou,
      items.length,
      "Messages on this page with no status yet, plus the ones marked as needing work.",
      "derived from the same list this page renders",
    ),
    denominatorSays: feedbackDenominatorSentence(combined),
    stagingFeedback: stagingActive ? "ACTIVE" : "OWNER_GATED",
    stagingSays: staging
      ? staging.says
      : "The review site's messages were not looked for on this page.",
    stagingAction: staging ? staging.action : null,
  };
}

/** Every number this view puts on screen, for the page's own audit. */
export function renderedNumbersOf(view: FeedbackInboxView): readonly RenderedNumber[] {
  const out: RenderedNumber[] = [
    { label: "messages shown", value: view.shown.value, denominator: view.shown.denominator, contract: view.shown.contract },
    { label: "messages from readers", value: view.organic.value, denominator: view.organic.denominator, contract: view.organic.contract },
    { label: "messages needing you", value: view.needingYou.value, denominator: view.needingYou.denominator, contract: view.needingYou.contract },
    {
      label: "messages held back by the intake protections",
      value: view.heldBack,
      denominator: view.items.length,
      contract: "Messages the intake protections quarantined, out of the messages on this page.",
    },
    {
      label: "messages whose sender asked to hear back",
      value: view.replyRequested,
      denominator: view.items.length,
      contract:
        "Messages that carry a reply handle, out of the messages on this page. Presence only — " +
        "the handle itself is never read.",
    },
  ];
  for (const state of TRIAGE_STATES) {
    out.push({
      label: `messages: ${TRIAGE_WORDS[state].words}`,
      value: view.byState[state],
      denominator: view.items.length,
      contract: TRIAGE_WORDS[state].means,
    });
  }
  return out;
}

/** Every "N of them" claim this view makes, checked against the rendered rows. */
export function countClaimsOf(view: FeedbackInboxView): readonly CountClaim[] {
  const claims: CountClaim[] = [
    { label: "messages shown", stated: view.shown.value, rendered: view.items.length },
    {
      label: "messages held back",
      stated: view.heldBack,
      rendered: view.items.filter((i) => i.row.heldBackReason !== null).length,
    },
    {
      label: "messages whose sender asked to hear back",
      stated: view.replyRequested,
      rendered: view.items.filter((i) => i.row.replyRequested).length,
    },
  ];
  for (const state of TRIAGE_STATES) {
    claims.push({
      label: `messages: ${TRIAGE_WORDS[state].words}`,
      stated: view.byState[state],
      rendered: view.items.filter((i) => i.state === state).length,
    });
  }
  return claims;
}
