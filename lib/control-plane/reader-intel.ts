/**
 * **READER INTELLIGENCE — WHAT AND WHERE, NEVER WHO.** (Admin Pass C, ADM-C12,
 * from the 9.6.26 owner feedback; §3.10 privacy, §3.11 the two databases,
 * §5 the existing product-intelligence contract, §16 bounded reads.)
 *
 * This is the read model behind `/admin/reader`. It is the FIRST admin surface
 * in this repository that opens the **application** database. Everything else
 * under `app/(admin)/` reads the control plane, and the two must never be
 * conflated (§3.11): operational state — work items, attempts, obligations,
 * receipts — lives in the control plane; what a reader did lives here, in the
 * collection stores. They are different Neon projects, named by different
 * variables, and this module reads exactly one of them.
 *
 * ## The privacy model, and why "users" is not a word this file can use
 *
 * There is no person in these stores. `search_log` records an event type, the
 * divisions it touched, a five-digit ZIP as orientation, a bounded scalar
 * detail bag and nothing else; `lib/db/search-log.ts` refuses a detail key
 * containing user/session/device/ip/email and scrubs every string value before
 * insert. `reactions` carries a hashed browser continuity key in its own
 * digest namespace. `feedback` carries a random contact reference minted per
 * submission and never derived from the address — and this module DOES NOT
 * READ THE FEEDBACK STORE AT ALL, because the one thing §5.3 forbids by name
 * is joining that reference to search behaviour, Ask activity, reaction
 * history or ZIP usage. The cheapest way to never make that join is to never
 * hold both halves in one place. The feedback inbox is its own surface.
 *
 * So every figure this module produces is a count of EVENTS, and the page says
 * so. "43% of users" is not a number that can be computed here, and it is not
 * a number that is being withheld — the concept does not exist in the schema.
 * Every rate therefore travels as a {@link Measured}: a value, the exact
 * denominator it came out of, the sentence saying what it licenses, and where
 * the denominator itself came from.
 *
 * ## ORGANIC is the default, and the other three classes are named, not hidden
 *
 * Every collection row carries a `run_class`. Roughly 537 rows on production
 * were written by this project's own Playwright walks and every walk adds ~28
 * more, because `/api/meetings` writes a `SEARCH` row on every GET. Counting
 * those as readers would be a false claim about demand — the exact failure
 * `lib/signal/search-log-reads.ts` exists to prevent, and the reason
 * `tests/search-log-exclusion.test.ts` refuses any read of that table which
 * does not carry the organic filter.
 *
 * This module carries it. Every aggregate here is filtered to EXACTLY ONE run
 * class; there is no "all classes" aggregate and no parameter that removes the
 * filter. The default is `ORGANIC` and an unrecognised request falls back to
 * `ORGANIC` rather than widening. The owner may select `AUTHOR`, `SYNTHETIC`
 * or `UNKNOWN` deliberately — the brief requires it — and when he does, the
 * page states which class every number on it counted. The only unfiltered read
 * is the four-class census, whose entire job is to describe the window
 * including the part that is not readers, and which reconciles against the
 * total the way `scripts/census-run-class.mts` does: `run_class` has no CHECK
 * constraint, so four buckets summing to the total is a fact to be checked
 * rather than assumed.
 *
 * ## Bounded and scoped (§16)
 *
 * No card loads a collection. Every query is a single server-side aggregation
 * over one stated window with a stated denominator: the census and the
 * per-event counts are closed-cardinality `GROUP BY`s, and every "top" list is
 * ranked inside Postgres with `ROW_NUMBER()` and cut at {@link READER_TOP_N},
 * carrying its own distinct-key count so the page can say "top 8 of 61" rather
 * than implying it showed everything. The window is a half-open interval
 * computed once, so every panel on one render describes the same span.
 *
 * ## What is deliberately not here
 *
 * - **No free text, ever.** A refused Ask question rides in `detail->>'question'`
 *   capped and scrubbed; this module counts refusals by topic and never selects
 *   that key. Reaction verbatims (`free_text`) are not read.
 * - **No `coverage_tier_distribution`.** The encoded per-government
 *   distribution is stored-only by decision (`lib/db/schema.ts`) and appears on
 *   no surface. Rendering it would be the first surface to do so, which is an
 *   author decision and not an implementation detail. The floor tier, which is
 *   stated publicly, is aggregated.
 * - **No cross-store run rollup.** `search_log.run_id` holds a raw label while
 *   every other store holds a digest in its own namespace. There is no session,
 *   no device and no visit in this product, so there is no such rollup to build.
 *
 * Server-side only. `DATABASE_URL` is read here and its value never leaves.
 */
import { neon } from "@neondatabase/serverless";

import { SEARCH_LOG_EVENT_TYPES, type SearchLogEventType } from "../db/search-log.ts";
import { ripcordPulled } from "../ripcords.ts";
import {
  REACTION_TARGET_TYPES,
  REACTION_VALUES,
  VERIFICATION_TIERS,
  questionForRow,
  type ReactionTargetType,
  type ScaleVersion,
} from "../signal/reactions.ts";
import { organicDenominatorSentence, type RunClassCensus } from "../signal/search-log-reads.ts";
/*
 * The three-answer read outcome and its failure constructor, taken from the
 * control-plane read model because there is exactly one implementation of that
 * shape in this repository (RULING 103). Nothing else is taken from it: no
 * connection, no read, no control-plane record ever reaches this file.
 */
import { unreachable, type ReadOutcome } from "./admin-data.ts";
import { assertAggregateOnly, gap, held, measured, type Held, type Measured, type RenderedNumber, type CountClaim } from "./owner-surface.ts";
import { plainCode } from "./plain-words.ts";

/* ------------------------------------------------------------------ *
 * 1. SCOPE — WHOSE TRAFFIC, AND OVER WHAT SPAN
 * ------------------------------------------------------------------ */

/**
 * The four classes a collection row can declare itself.
 *
 * ORGANIC first because it is the default and the only one the product's
 * demand figures are ever about. The other three exist so that traffic which
 * is NOT a reader can be looked at deliberately rather than silently mixed in.
 */
export type ReaderRunClass = "ORGANIC" | "AUTHOR" | "SYNTHETIC" | "UNKNOWN";

export const READER_RUN_CLASSES: readonly ReaderRunClass[] = [
  "ORGANIC",
  "AUTHOR",
  "SYNTHETIC",
  "UNKNOWN",
];

/** The class every view starts in. Never widened by anything a request says. */
export const DEFAULT_READER_RUN_CLASS: ReaderRunClass = "ORGANIC";

/** The windows the page offers. Bounded by construction: there is no "all time". */
export const READER_WINDOW_CHOICES: readonly number[] = [7, 30, 90];

export const DEFAULT_READER_WINDOW_DAYS = 30;

/** How many rows a "top" list shows. Every such list also states how many exist. */
export const READER_TOP_N = 8;

/**
 * The class a request asked for, or ORGANIC.
 *
 * Deliberately total: anything unrecognised — a typo, a stale bookmark, a
 * hand-edited query string — resolves to ORGANIC. A parser that threw would
 * turn a bad link into a broken page, and a parser that widened would turn one
 * into a demand chart quietly counting the project's own walks.
 */
export function readerRunClassFromParam(raw: string | string[] | undefined): ReaderRunClass {
  const one = Array.isArray(raw) ? raw[0] : raw;
  const wanted = (one ?? "").trim().toUpperCase();
  const found = READER_RUN_CLASSES.find((c) => c === wanted);
  return found === undefined ? DEFAULT_READER_RUN_CLASS : found;
}

/** The window a request asked for, or the default. Only the offered spans are honoured. */
export function readerWindowDaysFromParam(raw: string | string[] | undefined): number {
  const one = Array.isArray(raw) ? raw[0] : raw;
  const wanted = Number.parseInt((one ?? "").trim(), 10);
  const found = READER_WINDOW_CHOICES.find((d) => d === wanted);
  return found === undefined ? DEFAULT_READER_WINDOW_DAYS : found;
}

/** The span every panel on one render describes. Half-open: `[from, to)`. */
export interface ReaderWindow {
  readonly days: number;
  readonly fromIso: string;
  readonly toIso: string;
}

/**
 * Build the window once, from the page's own render clock.
 *
 * Computed in JavaScript rather than as `now() - interval` in each query so
 * that eight aggregates issued in parallel cannot describe eight slightly
 * different spans — the shape that makes two cards on one screen disagree by a
 * row and look like a bug in the arithmetic.
 */
export function readerWindow(nowIso: string, days: number): ReaderWindow {
  const to = Date.parse(nowIso);
  if (!Number.isFinite(to)) {
    throw new Error(
      `readerWindow() needs a readable render clock and got ${JSON.stringify(nowIso)}. ` +
        "A window with an unreadable bound would put every figure on the page over an unknown span.",
    );
  }
  return {
    days,
    fromIso: new Date(to - days * 24 * 60 * 60 * 1000).toISOString(),
    toIso: new Date(to).toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * 2. WORDING — A STORED CONSTANT IS NOT DISPLAY TEXT
 * ------------------------------------------------------------------ */

/** A stored constant as the owner reads it, with the sentence that says what it is. */
export interface ReaderWord {
  readonly label: string;
  readonly means: string;
}

/**
 * The reader domain's constants in ordinary English.
 *
 * `app/(admin)/fleet-wording.ts` is the precedent: a machine key renders as a
 * name on the face and keeps its raw form in the hover. The shared dictionary
 * in `plain-words.ts` covers the control plane's constants; these are the
 * collection stores' and they belong beside the queries that produce them.
 */
export const READER_WORDS: Readonly<Record<string, ReaderWord>> = {
  /* ------------------------------------------------- search_log.event_type */
  SEARCH: {
    label: "Looked up an address or ZIP",
    means: "Someone asked what governs a place. This is the event the whole product starts from.",
  },
  BODY_OPENED: {
    label: "Opened a governing body",
    means: "Someone opened a council, board or district to read about it.",
  },
  MEETING_OPENED: {
    label: "Opened a meeting",
    means: "Someone opened a specific meeting — its time, place or agenda.",
  },
  OFFICIAL_OPENED: {
    label: "Opened an official",
    means: "Someone opened an elected official to read who they are.",
  },
  DISTRICT_SELECTED: {
    label: "Chose a district",
    means: "Someone picked one district on the map to look at on its own.",
  },
  FILTER_APPLIED: {
    label: "Changed what the map shows",
    means: "Someone narrowed the map — a level of government, a kind of meeting.",
  },
  QUESTION_ASKED: {
    label: "Asked a question",
    means: "Someone typed a question into the ask box. The topic is recorded; what they typed is not, unless nothing could answer it.",
  },
  /* -------------------------------------------------------------- run_class */
  ORGANIC: {
    label: "Readers",
    means: "Traffic that arrived with no automation marker on it. This is the only class product demand is ever measured from.",
  },
  AUTHOR: {
    label: "You, using the product",
    means: "Traffic you declared as your own. Real use, but not a reader, so it is never counted as demand.",
  },
  SYNTHETIC: {
    label: "Automated runs",
    means: "Walks, deploy checks and tests that declared themselves. Every browser walk writes rows here.",
  },
  UNKNOWN: {
    label: "Cannot be attributed",
    means: "Rows written before the marker existed, or that arrived declaring automation without a usable run id. Never counted as readers in either direction.",
  },
  /* ---------------------------------------------------------- coverage_tier */
  TIER_0: { label: "Floor coverage", means: "The place is covered at the base tier only." },
  TIER_1: { label: "Tier 1 coverage", means: "The place is covered one tier above the floor." },
  TIER_2: { label: "Tier 2 coverage", means: "The place is covered two tiers above the floor." },
  TIER_3: { label: "Tier 3 coverage", means: "The place is covered at the deepest tier recorded." },
  /* ------------------------------------------------- reactions.target_type */
  FEDERAL_VOTE: { label: "A vote in Congress", means: "A recorded federal vote a reader answered about." },
  CANDIDATE: { label: "A candidate", means: "A candidate on a ballot a reader answered about." },
  MEASURE_PROVISION: { label: "Part of a ballot measure", means: "One provision of a measure a reader answered about." },
  FUNDING_TOTAL_REACTION: {
    label: "How a campaign is funded",
    means: "A reader's answer about a campaign's funding totals. Campaign finance renders for you and never enters anything sold.",
  },
  CONTRIBUTOR_REACTION: {
    label: "Who gave to a campaign",
    means: "A reader's answer about a campaign's contributors. Campaign finance renders for you and never enters anything sold.",
  },
  /* ----------------------------------------------- reactions.reaction values */
  YES: { label: "Yes", means: "" },
  NO: { label: "No", means: "" },
  UNSURE: { label: "Not sure", means: "" },
  SOMEONE_ELSE: { label: "Would rather someone else", means: "Only offered where one candidate is standing unopposed." },
  LOVE: { label: "Love it", means: "" },
  LIKE: { label: "Like it", means: "" },
  DISLIKE: { label: "Dislike it", means: "" },
  HATE: { label: "Hate it", means: "" },
  DONT_CARE: { label: "Do not care", means: "" },
  /* --------------------------------------- reactions.verification_tier */
  ANONYMOUS: { label: "Anonymous", means: "Nothing about the person was checked, and nothing was asked." },
  LOCALITY_VERIFIED: { label: "Place checked", means: "The place the answer came from was checked. The person was not." },
  VOTER_MATCHED: { label: "Matched to a voter file", means: "A path that exists in the schema and is not in use." },
  /* -------------------------------------------- demand_signals.subject_type */
  BODY: { label: "A governing body", means: "" },
  /* ------------------------------------- ask topic sentinels (detail.topic) */
  NO_ROUTE: {
    label: "Nothing could answer it",
    means: "The question reached the ask box and no route, digest or grounded answer could take it. This is the roadmap.",
  },
  DIGEST: { label: "Answered from the digest", means: "" },
  DESTINATION_ONLY: { label: "Sent to where it belongs", means: "The product could not answer it but knew who could." },
  GROUNDED: { label: "Answered from records", means: "" },
};

/** A stored constant as words, falling back to the shared plain-words rule. */
export function readerWord(key: string | null | undefined): ReaderWord {
  const raw = (key ?? "").trim();
  const entry = READER_WORDS[raw];
  if (entry !== undefined) return entry;
  return { label: plainCode(raw), means: "" };
}

/**
 * Which key in a row's `detail` bag names the thing that was opened.
 *
 * These are the keys the browser actually writes (`components/map/map-entry.tsx`
 * and `components/ask/ask-box.tsx`). The SQL below hard-writes the same pairs
 * into a `CASE`, and `tests/admin-reader-intel.test.ts` asserts the two agree —
 * a map that drifted from the query would produce an empty "top bodies" list
 * that looked exactly like nobody opening a body.
 */
export const DETAIL_KEY_BY_EVENT: Readonly<Partial<Record<SearchLogEventType, string>>> = {
  BODY_OPENED: "venueKey",
  MEETING_OPENED: "meetingId",
  OFFICIAL_OPENED: "officialId",
  FILTER_APPLIED: "filter",
  QUESTION_ASKED: "topic",
};

/* ------------------------------------------------------------------ *
 * 3. THE CONNECTION — THE APPLICATION DATABASE, BY ITS OWN VARIABLE
 * ------------------------------------------------------------------ */

/**
 * The variable the application itself uses for its own database
 * (`lib/db/index.ts`). Named here so a failure can say WHICH handle is missing
 * without ever printing its value, and so the difference from the control
 * plane's variable is legible in one line rather than inferred.
 */
export const READER_STORE_URL_VAR = "DATABASE_URL";

/**
 * A tagged-template query against the reader store.
 *
 * Narrowed to the one shape this module uses so a test can hand `readReaderIntel`
 * a recorded fake and exercise every projection without a live database. The
 * driver's own overloads are wider than this; the cast at the open site is the
 * only place the two meet.
 */
export type ReaderStoreQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

/**
 * Open the application database, or say precisely why not.
 *
 * A missing variable is a legitimate state on a machine that has no reader
 * store bound, and it must not read as an outage — but on the deployed admin
 * host it is a real defect, because this page has nothing else to read. So the
 * detail names the variable and never its value: some driver errors carry the
 * whole connection string in the message, which is why the failure branch
 * reports the error's NAME rather than its text.
 */
export function openReaderStore(
  env: Record<string, string | undefined> = process.env,
): { readonly ok: true; readonly sql: ReaderStoreQuery } | { readonly ok: false; readonly detail: string } {
  const url = (env[READER_STORE_URL_VAR] ?? "").trim();
  if (url === "") {
    return {
      ok: false,
      detail:
        `${READER_STORE_URL_VAR} is not set in this runtime, so the reader store was never opened. ` +
        "That is a fact about how this machine is configured and not a fact about readers: nothing " +
        "has been counted and found empty — nothing has been counted.",
    };
  }
  try {
    return { ok: true, sql: neon(url) as unknown as ReaderStoreQuery };
  } catch (error) {
    return {
      ok: false,
      detail:
        `The reader store named by ${READER_STORE_URL_VAR} could not be opened ` +
        `(${(error as Error)?.name ?? "error"}). Nothing was asked, so nothing is being said.`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * 4. THE READINGS
 * ------------------------------------------------------------------ */

/** One aggregated row: the stored key, what it reads as, and how many events. */
export interface CountedKey {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/** One day of the window, in Eastern days, so the strip matches every stamp on the page. */
export interface CountedDay {
  readonly day: string;
  readonly count: number;
}

/** A ranked list that knows what it left out. */
export interface TopList {
  readonly rows: readonly CountedKey[];
  /** How many distinct keys exist in the window for this class. */
  readonly distinct: number;
  /** How many events carried a key at all — the denominator the rows are out of. */
  readonly keyed: number;
}

export const EMPTY_TOP_LIST: TopList = { rows: [], distinct: 0, keyed: 0 };

/** What the search log holds for one class over one window. */
export interface ActivityReading {
  /** All four classes over the window, whatever class is being viewed. */
  readonly census: RunClassCensus;
  /** Do the four classes account for every row? `run_class` has no CHECK constraint. */
  readonly reconciles: boolean;
  /** Events in the selected class. The denominator for every figure in this reading. */
  readonly total: number;
  /** Every event type, present at zero when it did not happen. */
  readonly byEvent: readonly CountedKey[];
  readonly byDay: readonly CountedDay[];
  /** Coverage tier at the floor. The stored per-government distribution is not read. */
  readonly byTier: readonly CountedKey[];
  readonly topZips: TopList;
  /** The first three digits of a ZIP — the coarse geography the brief asks for. */
  readonly topZipAreas: TopList;
  readonly topDivisions: TopList;
  /** How many division memberships the events in this class touched in total. */
  readonly divisionTouches: number;
  readonly topBodies: TopList;
  readonly topMeetings: TopList;
  readonly topOfficials: TopList;
  readonly topFilters: TopList;
  readonly topAskTopics: TopList;
}

/** One answer group: a target type, the instrument that asked, the answer, the count. */
export interface AnswerGroup {
  readonly targetType: ReactionTargetType;
  readonly scaleVersion: ScaleVersion;
  /** The exact question this group's rows answered. Versions are never blended. */
  readonly question: string;
  /** The stored answer value. Never named `reaction`: that field name is refused on an owner record. */
  readonly choice: string;
  readonly choiceLabel: string;
  readonly count: number;
}

export interface ReactionReading {
  readonly census: RunClassCensus;
  readonly reconciles: boolean;
  /** Rows in the selected class, before the quarantine filter. */
  readonly total: number;
  /** Rows an aggregate may count: in class, not quarantined. */
  readonly clean: number;
  /** Rows held out by the rate limiter. Shown beside, never merged, never hidden. */
  readonly quarantined: number;
  readonly byAnswer: readonly AnswerGroup[];
  readonly byTier: readonly CountedKey[];
  readonly topTargets: readonly { readonly targetType: ReactionTargetType; readonly list: TopList }[];
}

export interface DemandReading {
  readonly census: RunClassCensus;
  readonly reconciles: boolean;
  readonly total: number;
  readonly topSubjects: TopList;
}

/** The Ask store, which is built, wired and switched off. */
export interface AskReading {
  /** Is `ripcord.askSignalCapture` pulled? When it is, an empty table is a fact about the switch. */
  readonly capturePulled: boolean;
  /** Rows in the window, every class. Zero with the ripcord pulled is expected, not a finding. */
  readonly rowsInWindow: number;
}

/** Everything one render of the page reads, with each panel's own outcome. */
export interface ReaderIntel {
  readonly window: ReaderWindow;
  readonly runClass: ReaderRunClass;
  readonly activity: ReadOutcome<ActivityReading>;
  readonly reactions: ReadOutcome<ReactionReading>;
  readonly demand: ReadOutcome<DemandReading>;
  readonly ask: ReadOutcome<AskReading>;
}

/* -------------------------------------------------------- row coercion */

function numAt(row: Record<string, unknown>, key: string): number {
  const raw = row[key];
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function textAt(row: Record<string, unknown>, key: string): string {
  const raw = row[key];
  return raw === null || raw === undefined ? "" : String(raw);
}

function censusFrom(rows: Record<string, unknown>[]): RunClassCensus {
  const row = rows[0] ?? {};
  return {
    organic: numAt(row, "organic"),
    synthetic: numAt(row, "synthetic"),
    unknown: numAt(row, "unknown"),
    author: numAt(row, "author"),
    total: numAt(row, "total"),
  };
}

/**
 * Do the four named classes account for every row in the window?
 *
 * `run_class` carries no CHECK constraint — the four values are a TypeScript
 * union only — so a fifth value can exist in the data before it exists in this
 * file. `scripts/census-run-class.mts` reports that as DOES NOT RECONCILE
 * rather than smoothing it, and so does the page.
 */
export function censusReconciles(census: RunClassCensus): boolean {
  return census.organic + census.synthetic + census.unknown + census.author === census.total;
}

/** How many rows the census holds for one class. */
export function censusCountFor(census: RunClassCensus, runClass: ReaderRunClass): number {
  if (runClass === "ORGANIC") return census.organic;
  if (runClass === "SYNTHETIC") return census.synthetic;
  if (runClass === "AUTHOR") return census.author;
  return census.unknown;
}

/** Ranked rows out of the `ROW_NUMBER()` projection, with the totals it carried. */
function topListFrom(rows: Record<string, unknown>[], keyColumn: string): TopList {
  if (rows.length === 0) return EMPTY_TOP_LIST;
  return {
    rows: rows.map((r) => {
      const key = textAt(r, keyColumn);
      return { key, label: readerWord(key).label, count: numAt(r, "n") };
    }),
    distinct: numAt(rows[0], "distinct_keys"),
    keyed: numAt(rows[0], "keyed_rows"),
  };
}

/* --------------------------------------------------------- the queries */

/**
 * The search log for one class over one window.
 *
 * Seven statements, issued together. Each is a single server-side aggregation:
 * no card walks a collection, and the two ranked projections cut inside
 * Postgres with `ROW_NUMBER()` while carrying their own `COUNT(*) OVER` and
 * `SUM(n) OVER` so the page can state what it did not show.
 *
 * The class predicate is a bound parameter and the census below is the one
 * unfiltered read — the four-class description of the window that makes the
 * excluded rows visible instead of merely absent.
 */
export async function readActivity(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
  runClass: ReaderRunClass,
  topN: number = READER_TOP_N,
): Promise<ReadOutcome<ActivityReading>> {
  const from = window.fromIso;
  const to = window.toIso;
  try {
    const [censusRows, eventRows, dayRows, tierRows, zipRows, zipAreaRows, divisionRows, keyedRows] =
      await Promise.all([
        sql`
          SELECT
            COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic,
            COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic,
            COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown,
            COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author,
            COUNT(*)                                             AS total
          FROM search_log
          WHERE occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
        `,
        sql`
          SELECT event_type, COUNT(*) AS n
          FROM search_log
          WHERE run_class = ${runClass}
            AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          GROUP BY event_type
        `,
        sql`
          SELECT to_char(occurred_at AT TIME ZONE 'America/New_York', 'YYYY-MM-DD') AS day,
                 COUNT(*) AS n
          FROM search_log
          WHERE run_class = ${runClass}
            AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          GROUP BY 1
          ORDER BY 1
        `,
        sql`
          SELECT coverage_tier, COUNT(*) AS n
          FROM search_log
          WHERE run_class = ${runClass}
            AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          GROUP BY coverage_tier
        `,
        sql`
          WITH keyed AS (
            SELECT approximate_location AS zip, COUNT(*) AS n
            FROM search_log
            WHERE run_class = ${runClass}
              AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
              AND approximate_location IS NOT NULL
            GROUP BY 1
          ), ranked AS (
            SELECT zip, n,
                   ROW_NUMBER() OVER (ORDER BY n DESC, zip) AS rk,
                   (COUNT(*) OVER ()) AS distinct_keys,
                   (SUM(n) OVER ()) AS keyed_rows
            FROM keyed
          )
          SELECT zip, n, distinct_keys, keyed_rows FROM ranked WHERE rk <= ${topN}::int ORDER BY rk
        `,
        sql`
          WITH keyed AS (
            SELECT left(approximate_location, 3) AS zip_area, COUNT(*) AS n
            FROM search_log
            WHERE run_class = ${runClass}
              AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
              AND approximate_location IS NOT NULL
            GROUP BY 1
          ), ranked AS (
            SELECT zip_area, n,
                   ROW_NUMBER() OVER (ORDER BY n DESC, zip_area) AS rk,
                   (COUNT(*) OVER ()) AS distinct_keys,
                   (SUM(n) OVER ()) AS keyed_rows
            FROM keyed
          )
          SELECT zip_area, n, distinct_keys, keyed_rows FROM ranked WHERE rk <= ${topN}::int ORDER BY rk
        `,
        sql`
          WITH keyed AS (
            SELECT d AS ocd_id, COUNT(*) AS n
            FROM search_log, LATERAL jsonb_array_elements_text(ocd_ids) AS d
            WHERE run_class = ${runClass}
              AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
            GROUP BY 1
          ), ranked AS (
            SELECT ocd_id, n,
                   ROW_NUMBER() OVER (ORDER BY n DESC, ocd_id) AS rk,
                   (COUNT(*) OVER ()) AS distinct_keys,
                   (SUM(n) OVER ()) AS keyed_rows
            FROM keyed
          )
          SELECT ocd_id, n, distinct_keys, keyed_rows FROM ranked WHERE rk <= ${topN}::int ORDER BY rk
        `,
        /*
         * The four "what was opened" lists in ONE statement, ranked per event
         * type. The CASE names the detail key each browser event writes; the
         * pairs are mirrored in DETAIL_KEY_BY_EVENT and the test asserts the
         * two agree. A row whose detail bag carries no such key groups to NULL
         * and is dropped here — `keyed_rows` then differs from the event's own
         * count, which is the honest way to say "of the N opens, M carried an id".
         */
        sql`
          WITH keyed AS (
            SELECT event_type,
                   CASE event_type
                     WHEN 'BODY_OPENED'     THEN detail->>'venueKey'
                     WHEN 'MEETING_OPENED'  THEN detail->>'meetingId'
                     WHEN 'OFFICIAL_OPENED' THEN detail->>'officialId'
                     WHEN 'FILTER_APPLIED'  THEN detail->>'filter'
                     WHEN 'QUESTION_ASKED'  THEN detail->>'topic'
                     ELSE NULL
                   END AS subject,
                   COUNT(*) AS n
            FROM search_log
            WHERE run_class = ${runClass}
              AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
            GROUP BY 1, 2
          ), ranked AS (
            SELECT event_type, subject, n,
                   ROW_NUMBER() OVER (PARTITION BY event_type ORDER BY n DESC, subject) AS rk,
                   (COUNT(*) OVER (PARTITION BY event_type)) AS distinct_keys,
                   (SUM(n)   OVER (PARTITION BY event_type)) AS keyed_rows
            FROM keyed
            WHERE subject IS NOT NULL
          )
          SELECT event_type, subject, n, distinct_keys, keyed_rows
          FROM ranked WHERE rk <= ${topN}::int ORDER BY event_type, rk
        `,
      ]);

    const census = censusFrom(censusRows);
    /*
     * Nothing at all in the window, in any class. That is a different answer
     * from "nothing in the class you selected", which is a HELD reading with a
     * zero in it and a census beside it saying where the rows went, and it is a
     * different answer again from a store that could not be reached.
     */
    if (census.total === 0) {
      return {
        kind: "NOT_RECORDED",
        detail:
          `The search log was read and holds no rows at all in the last ${window.days} days — ` +
          "no readers, no automated runs, nothing. The store answered; it is empty over this span.",
      };
    }
    const total = censusCountFor(census, runClass);

    const counted = new Map<string, number>();
    for (const row of eventRows) counted.set(textAt(row, "event_type"), numAt(row, "n"));
    const byEvent: CountedKey[] = SEARCH_LOG_EVENT_TYPES.map((event) => ({
      key: event,
      label: readerWord(event).label,
      count: counted.get(event) ?? 0,
    }));

    const forEvent = (event: SearchLogEventType): TopList =>
      topListFrom(keyedRows.filter((r) => textAt(r, "event_type") === event), "subject");

    const divisions = topListFrom(divisionRows, "ocd_id");

    const reading: ActivityReading = {
      census,
      reconciles: censusReconciles(census),
      total,
      byEvent,
      byDay: dayRows.map((r) => ({ day: textAt(r, "day"), count: numAt(r, "n") })),
      byTier: tierRows.map((r) => {
        const key = textAt(r, "coverage_tier");
        return { key, label: readerWord(key).label, count: numAt(r, "n") };
      }),
      topZips: topListFrom(zipRows, "zip"),
      topZipAreas: topListFrom(zipAreaRows, "zip_area"),
      topDivisions: divisions,
      divisionTouches: divisions.keyed,
      topBodies: forEvent("BODY_OPENED"),
      topMeetings: forEvent("MEETING_OPENED"),
      topOfficials: forEvent("OFFICIAL_OPENED"),
      topFilters: forEvent("FILTER_APPLIED"),
      topAskTopics: forEvent("QUESTION_ASKED"),
    };

    return { kind: "HELD", value: reading };
  } catch (error) {
    return unreachable("the search log", error);
  }
}

/**
 * Reactions for one class over one window.
 *
 * Three things this reading refuses to blend, each for a reason that has
 * already cost this product a wrong number once:
 *
 *   scale versions   v1, v2 and v3 are different questions. Pooling them
 *                    reports a trend caused by the wording changing.
 *   quarantine       velocity-held rows are stored and excluded from every
 *                    aggregate, and shown separately rather than hidden.
 *   the row count    `reactions` is an upsert keyed on
 *                    (continuity hash, target type, target id), and an
 *                    overwrite re-stamps `occurred_at`. So a count here is
 *                    CURRENT POSITIONS LAST CHANGED IN THE WINDOW, never taps.
 */
export async function readReactions(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
  runClass: ReaderRunClass,
  topN: number = READER_TOP_N,
): Promise<ReadOutcome<ReactionReading>> {
  const from = window.fromIso;
  const to = window.toIso;
  try {
    const [censusRows, standingRows, answerRows, tierRows, targetRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic,
          COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic,
          COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown,
          COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author,
          COUNT(*)                                             AS total
        FROM reactions
        WHERE occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
      `,
      sql`
        SELECT COUNT(*)                                               AS total,
               COUNT(*) FILTER (WHERE suspect_reason IS NULL)     AS clean,
               COUNT(*) FILTER (WHERE suspect_reason IS NOT NULL) AS quarantined
        FROM reactions
        WHERE run_class = ${runClass}
          AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
      `,
      /*
       * Closed cardinality — five target types by three scale versions by nine
       * answer values — so this needs no limit and can never be truncated. A
       * LIMIT here would silently break "stated N equals rendered rows".
       */
      sql`
        SELECT target_type, scale_version, reaction AS choice, COUNT(*) AS n
        FROM reactions
        WHERE run_class = ${runClass}
          AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          AND suspect_reason IS NULL
        GROUP BY 1, 2, 3
        ORDER BY 1, 2, 3
      `,
      sql`
        SELECT verification_tier, COUNT(*) AS n
        FROM reactions
        WHERE run_class = ${runClass}
          AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          AND suspect_reason IS NULL
        GROUP BY 1
      `,
      sql`
        WITH keyed AS (
          SELECT target_type, target_id, COUNT(*) AS n
          FROM reactions
          WHERE run_class = ${runClass}
            AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
            AND suspect_reason IS NULL
          GROUP BY 1, 2
        ), ranked AS (
          SELECT target_type, target_id, n,
                 ROW_NUMBER() OVER (PARTITION BY target_type ORDER BY n DESC, target_id) AS rk,
                 (COUNT(*) OVER (PARTITION BY target_type)) AS distinct_keys,
                 (SUM(n)   OVER (PARTITION BY target_type)) AS keyed_rows
          FROM keyed
        )
        SELECT target_type, target_id, n, distinct_keys, keyed_rows
        FROM ranked WHERE rk <= ${topN}::int ORDER BY target_type, rk
      `,
    ]);

    const census = censusFrom(censusRows);
    if (census.total === 0) {
      return {
        kind: "NOT_RECORDED",
        detail:
          `The reaction store was read and holds no rows at all in the last ${window.days} days. ` +
          "The store answered; nothing was recorded over this span.",
      };
    }
    const standing = standingRows[0] ?? {};

    const answers = new Map<string, number>();
    for (const row of answerRows) {
      answers.set(
        `${textAt(row, "target_type")} ${numAt(row, "scale_version")} ${textAt(row, "choice")}`,
        numAt(row, "n"),
      );
    }
    /*
     * Every group the data produced, in a stable order, and no group the data
     * did not produce: an answer value that never came in is absent rather than
     * shown at zero, because a zero here would read as "nobody chose it" on a
     * scale that may not even have been offered for that target type.
     */
    const byAnswer: AnswerGroup[] = [];
    for (const targetType of REACTION_TARGET_TYPES) {
      for (const version of [1, 2, 3] as ScaleVersion[]) {
        for (const choice of REACTION_VALUES) {
          const count = answers.get(`${targetType} ${version} ${choice}`);
          if (count === undefined || count === 0) continue;
          byAnswer.push({
            targetType,
            scaleVersion: version,
            question: questionForRow(targetType, version),
            choice,
            choiceLabel: readerWord(choice).label,
            count,
          });
        }
      }
    }

    const tiers = new Map<string, number>();
    for (const row of tierRows) tiers.set(textAt(row, "verification_tier"), numAt(row, "n"));

    const reading: ReactionReading = {
      census,
      reconciles: censusReconciles(census),
      total: numAt(standing, "total"),
      clean: numAt(standing, "clean"),
      quarantined: numAt(standing, "quarantined"),
      byAnswer,
      /* Every tier present, at zero when it holds nothing: a tier that vanished
         from the list would read as a tier that does not exist. */
      byTier: VERIFICATION_TIERS.map((tier) => ({
        key: tier,
        label: readerWord(tier).label,
        count: tiers.get(tier) ?? 0,
      })),
      topTargets: REACTION_TARGET_TYPES.map((targetType) => ({
        targetType,
        list: topListFrom(targetRows.filter((r) => textAt(r, "target_type") === targetType), "target_id"),
      })).filter((t) => t.list.rows.length > 0),
    };

    return { kind: "HELD", value: reading };
  } catch (error) {
    return unreachable("the reaction store", error);
  }
}

/** The "want this sooner" pill, for one class over one window. */
export async function readDemand(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
  runClass: ReaderRunClass,
  topN: number = READER_TOP_N,
): Promise<ReadOutcome<DemandReading>> {
  const from = window.fromIso;
  const to = window.toIso;
  try {
    const [censusRows, subjectRows] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE run_class = 'ORGANIC')   AS organic,
          COUNT(*) FILTER (WHERE run_class = 'SYNTHETIC') AS synthetic,
          COUNT(*) FILTER (WHERE run_class = 'UNKNOWN')   AS unknown,
          COUNT(*) FILTER (WHERE run_class = 'AUTHOR')    AS author,
          COUNT(*)                                             AS total
        FROM demand_signals
        WHERE occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
      `,
      sql`
        WITH keyed AS (
          SELECT subject_id, COUNT(*) AS n
          FROM demand_signals
          WHERE run_class = ${runClass}
            AND occurred_at >= ${from}::timestamptz AND occurred_at < ${to}::timestamptz
          GROUP BY 1
        ), ranked AS (
          SELECT subject_id, n,
                 ROW_NUMBER() OVER (ORDER BY n DESC, subject_id) AS rk,
                 (COUNT(*) OVER ()) AS distinct_keys,
                 (SUM(n) OVER ()) AS keyed_rows
          FROM keyed
        )
        SELECT subject_id, n, distinct_keys, keyed_rows FROM ranked WHERE rk <= ${topN}::int ORDER BY rk
      `,
    ]);

    const census = censusFrom(censusRows);
    if (census.total === 0) {
      return {
        kind: "NOT_RECORDED",
        detail:
          `Nobody has asked for anything sooner in the last ${window.days} days. The store answered ` +
          "and holds no rows over this span, in any class.",
      };
    }
    const list = topListFrom(subjectRows, "subject_id");
    return {
      kind: "HELD",
      value: {
        census,
        reconciles: censusReconciles(census),
        total: censusCountFor(census, runClass),
        topSubjects: list,
      },
    };
  } catch (error) {
    return unreachable("the demand-signal store", error);
  }
}

/**
 * The Ask store — which exists, is wired, and is switched off.
 *
 * `ripcord.askSignalCapture` ships pulled pending privacy copy approval, so the
 * table holds nothing by design. An empty count here is a fact about a switch
 * and must never render as "no reader asked anything": the questions ARE being
 * asked, and `search_log`'s QUESTION_ASKED rows above are where they are
 * counted. This reading exists so the page can say which of the two it is.
 */
export async function readAsk(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
): Promise<ReadOutcome<AskReading>> {
  const capturePulled = ripcordPulled("ripcord.askSignalCapture");
  try {
    const rows = await sql`
      SELECT COUNT(*) AS n
      FROM ask_interactions
      WHERE occurred_at >= ${window.fromIso}::timestamptz AND occurred_at < ${window.toIso}::timestamptz
    `;
    return { kind: "HELD", value: { capturePulled, rowsInWindow: numAt(rows[0] ?? {}, "n") } };
  } catch (error) {
    return unreachable("the ask store", error);
  }
}

/**
 * One render's whole reading, issued in one round.
 *
 * Four reads, in parallel, against one connection. They are separate outcomes
 * on purpose: a reaction table that cannot be reached must not blank the
 * activity panel, and a page that reported all four as one failure would send
 * the owner looking in the wrong place.
 */
export async function readReaderIntel(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
  runClass: ReaderRunClass,
  topN: number = READER_TOP_N,
): Promise<ReaderIntel> {
  const [activity, reactions, demand, ask] = await Promise.all([
    readActivity(sql, window, runClass, topN),
    readReactions(sql, window, runClass, topN),
    readDemand(sql, window, runClass, topN),
    readAsk(sql, window),
  ]);
  const intel: ReaderIntel = { window, runClass, activity, reactions, demand, ask };
  /*
   * The boundary reaching the one surface a human reads. Aggregate-only is a
   * rule about EXPOSURE, and the owner reading his own console is an exposure
   * like any other — so the record is walked by field name before the page
   * gets it, and a field that could key back to one reader refuses the render
   * instead of appearing on it.
   */
  assertAggregateOnly(intel, "the reader-intelligence reading");
  return intel;
}

/* ------------------------------------------------------------------ *
 * 5. THE RENDER CONTRACT
 * ------------------------------------------------------------------ */

/**
 * The sentence that must sit beside any figure this page states.
 *
 * For ORGANIC it is the project's existing denominator sentence, unchanged and
 * shared, so the console and every export say the same words. For a class the
 * owner selected deliberately it says what he is looking at INSTEAD — because
 * the danger there is the opposite one: not that automated rows leak into a
 * demand figure, but that a deliberate look at automated rows is later
 * remembered as a reading about readers.
 */
export function scopeSentence(runClass: ReaderRunClass, census: RunClassCensus): string {
  if (runClass === "ORGANIC") return organicDenominatorSentence(census);
  const counted = censusCountFor(census, runClass);
  const words = readerWord(runClass);
  return (
    `You are looking at ${counted} of ${census.total} rows in this window, and they are not readers: ` +
    `${words.label.toLowerCase()} — ${words.means} Nothing on this screen is a demand figure while ` +
    "this class is selected."
  );
}

/** The window in the owner's own words, so the span is on the face and not implied. */
export function windowSentence(window: ReaderWindow): string {
  return `Everything below counts the last ${window.days} days only. Nothing on this page reads the whole history.`;
}

/**
 * A count out of the reading's own denominator, or the named gap where the
 * denominator itself is missing.
 *
 * A zero denominator is the shape `measured()` cannot express and must not be
 * papered over: nought out of nought is not nought percent, it is a question
 * nobody asked. It comes back as a gap that says whose it is.
 */
export function share(
  value: number,
  denominator: number,
  contract: string,
  denominatorSource: string,
): Held<Measured> {
  if (denominator <= 0) {
    return gap(
      "OURS",
      `Not measured: ${denominatorSource} holds no rows in this window, so there is nothing to be a share of.`,
    );
  }
  if (value > denominator) {
    return gap(
      "OURS",
      `Not measured: ${value} was counted out of ${denominator}, which means the two came from ` +
        "different populations. A percentage from them would be a confident sentence about nothing.",
    );
  }
  return held(measured(value, denominator, contract, denominatorSource));
}

/**
 * Numbers the page is about to print whose numerator exceeds their denominator.
 *
 * `measured()` refuses that shape by throwing, which is correct for a
 * constructor and wrong for a page: a throw on a server component is a 500
 * where a refusal would have been a sentence the owner can read. So the same
 * property is checked against the page's own declared output, and a failure
 * replaces the numbers rather than the page. Expected to be empty — it is a
 * seeded failure, and the projection that starts dividing two different
 * populations by each other is the one nobody notices.
 */
export function impossibleNumbersIn(numbers: readonly RenderedNumber[]): string[] {
  return numbers
    .filter((n) => n.denominator !== null && n.value > n.denominator)
    .map((n) => `${n.label}: ${n.value} counted out of ${n.denominator}`);
}

/**
 * Every number the page is about to print, declared for the page's audit of
 * itself. A figure that reaches the screen without a denominator and an
 * interpretation contract replaces the numbers with a refusal.
 */
export function renderedNumbersOf(intel: ReaderIntel): RenderedNumber[] {
  const out: RenderedNumber[] = [];
  const days = intel.window.days;
  const classWords = readerWord(intel.runClass).label;

  if (intel.activity.kind === "HELD") {
    const a = intel.activity.value;
    const source = `the search log over the last ${days} days`;
    out.push({
      label: "Events in the selected class",
      value: a.total,
      denominator: a.census.total,
      contract: `${classWords}: rows in this class, out of every search-log row in the window.`,
    });
    for (const event of a.byEvent) {
      out.push({
        label: `Activity — ${event.label}`,
        value: event.count,
        denominator: a.total,
        contract: `Events of this kind, out of every ${classWords.toLowerCase()} event in the window. Counted from ${source}.`,
      });
    }
    for (const day of a.byDay) {
      out.push({
        label: `Events on ${day.day}`,
        value: day.count,
        denominator: a.total,
        contract: `Events on this Eastern day, out of every event in the window. Counted from ${source}.`,
      });
    }
    for (const tier of a.byTier) {
      out.push({
        label: `Coverage at the floor — ${tier.label}`,
        value: tier.count,
        denominator: a.total,
        contract: "Events whose place was covered at this tier, out of every event in the window.",
      });
    }
    const lists: [string, TopList][] = [
      ["ZIP", a.topZips],
      ["ZIP area", a.topZipAreas],
      ["Division", a.topDivisions],
      ["Body", a.topBodies],
      ["Meeting", a.topMeetings],
      ["Official", a.topOfficials],
      ["Filter", a.topFilters],
      ["Question topic", a.topAskTopics],
    ];
    for (const [what, list] of lists) {
      for (const row of list.rows) {
        out.push({
          label: `${what} — ${row.label}`,
          value: row.count,
          denominator: list.keyed,
          contract: `Events naming this ${what.toLowerCase()}, out of the ${list.keyed} event(s) in the window that named one at all.`,
        });
      }
    }
  }

  if (intel.reactions.kind === "HELD") {
    const r = intel.reactions.value;
    out.push({
      label: "Reaction rows in the selected class",
      value: r.total,
      denominator: r.census.total,
      contract: `${classWords}: reaction rows in this class, out of every reaction row last changed in the window.`,
    });
    out.push({
      label: "Reaction rows an aggregate may count",
      value: r.clean,
      denominator: r.total,
      contract: "Rows not held by the rate limiter, out of rows in this class. Quarantined rows are shown beside and never merged in.",
    });
    for (const group of r.byAnswer) {
      out.push({
        label: `${readerWord(group.targetType).label} — ${group.choiceLabel} (scale ${group.scaleVersion})`,
        value: group.count,
        denominator: r.clean,
        contract: `Answers of this value on this instrument, out of every countable reaction row in the window. Scale versions are never pooled: this group answered "${group.question}"`,
      });
    }
    for (const tier of r.byTier) {
      out.push({
        label: `Reaction standing — ${tier.label}`,
        value: tier.count,
        denominator: r.clean,
        contract: "Countable rows at this standing, out of every countable reaction row in the window.",
      });
    }
    for (const group of r.topTargets) {
      for (const row of group.list.rows) {
        out.push({
          label: `${readerWord(group.targetType).label} — ${row.key}`,
          value: row.count,
          denominator: group.list.keyed,
          contract: `Current positions on this target, out of every countable row of this kind in the window. A count of positions, never of taps: an answer changed is an answer overwritten.`,
        });
      }
    }
  }

  if (intel.demand.kind === "HELD") {
    const d = intel.demand.value;
    out.push({
      label: "Asked for sooner, in the selected class",
      value: d.total,
      denominator: d.census.total,
      contract: `${classWords}: requests in this class, out of every request in the window.`,
    });
    for (const row of d.topSubjects.rows) {
      out.push({
        label: `Wanted sooner — ${row.key}`,
        value: row.count,
        denominator: d.topSubjects.keyed,
        contract: "Requests naming this subject, out of every request in this class in the window.",
      });
    }
  }

  return out;
}

/**
 * What the page said it would show, against what it will actually render.
 *
 * The two halves come from different places on purpose: `stated` is the
 * reading's own totals, `rendered` is the length of the array the page maps
 * over. Comparing anything else would compare a number to itself.
 */
export function countClaimsOf(intel: ReaderIntel, topN: number = READER_TOP_N): CountClaim[] {
  const claims: CountClaim[] = [];
  /*
   * Only claims whose two halves come from DIFFERENT places are here. "Days in
   * the window: as many as the query returned, and the page drew as many as the
   * query returned" is a number compared to itself, and a check that cannot
   * fail is a check that reports green about nothing. The distinct-key counts
   * come out of Postgres's own `COUNT(*) OVER`; the rendered counts are the
   * lengths of the arrays the page maps over.
   */
  if (intel.activity.kind === "HELD") {
    const a = intel.activity.value;
    claims.push({
      label: "Event kinds listed",
      stated: SEARCH_LOG_EVENT_TYPES.length,
      rendered: a.byEvent.length,
    });
    const lists: [string, TopList][] = [
      ["Top ZIPs", a.topZips],
      ["Top ZIP areas", a.topZipAreas],
      ["Top districts", a.topDivisions],
      ["Top bodies", a.topBodies],
      ["Top meetings", a.topMeetings],
      ["Top officials", a.topOfficials],
      ["Filters used", a.topFilters],
      ["Question topics", a.topAskTopics],
    ];
    for (const [label, list] of lists) {
      claims.push({
        label,
        stated: Math.min(list.distinct, topN),
        rendered: list.rows.length,
      });
    }
  }
  if (intel.reactions.kind === "HELD") {
    const r = intel.reactions.value;
    claims.push({
      label: "Reaction standings listed",
      stated: VERIFICATION_TIERS.length,
      rendered: r.byTier.length,
    });
    for (const group of r.topTargets) {
      claims.push({
        label: `Most answered — ${readerWord(group.targetType).label}`,
        stated: Math.min(group.list.distinct, topN),
        rendered: group.list.rows.length,
      });
    }
  }
  if (intel.demand.kind === "HELD") {
    const d = intel.demand.value;
    claims.push({
      label: "Subjects wanted sooner",
      stated: Math.min(d.topSubjects.distinct, topN),
      rendered: d.topSubjects.rows.length,
    });
  }
  return claims;
}

/**
 * The line a top list carries so it never implies it showed everything.
 *
 * "Top 8" over a list of eight with sixty-one behind it is the same defect as
 * a headline of seven over five rows, in the other direction.
 */
export function topListSentence(list: TopList, one: string, many: string): string {
  if (list.distinct === 0) return `No ${one} was named by any event in this window.`;
  const named = list.distinct === 1 ? one : many;
  const events = list.keyed === 1 ? "event" : "events";
  const tail = `named in this window, out of ${list.keyed} ${events} that named one.`;
  if (list.distinct <= list.rows.length) return `All ${list.distinct} ${named} ${tail}`;
  return `The top ${list.rows.length} of ${list.distinct} ${named} ${tail}`;
}
