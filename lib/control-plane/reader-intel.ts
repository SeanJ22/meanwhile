import { neon } from "@neondatabase/serverless";

import { SEARCH_LOG_EVENT_TYPES, type SearchLogEventType } from "../db/search-log.ts";
import {
  REACTION_TARGET_TYPES,
  REACTION_VALUES,
  VERIFICATION_TIERS,
  questionForRow,
  type ReactionTargetType,
  type ScaleVersion,
} from "../signal/reactions.ts";
import { organicDenominatorSentence, type RunClassCensus } from "../signal/search-log-reads.ts";
/* The read-outcome shape is shared with the control-plane read model; nothing else crosses over. */
import { unreachable, type ReadOutcome } from "./admin-data.ts";
import { assertAggregateOnly, gap, held, measured, type Held, type Measured, type RenderedNumber, type CountClaim } from "./owner-surface.ts";
import { plainCode } from "./plain-words.ts";

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

/** Anything unrecognised resolves to ORGANIC, never widened. */
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

/** Built once from the render clock so parallel aggregates describe one span. */
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

export interface ReaderWord {
  readonly label: string;
  readonly means: string;
}

export const READER_WORDS: Readonly<Record<string, ReaderWord>> = {
  SEARCH: {
    label: "Viewed a place on the map",
    means: "Someone opened or moved the map to see meetings for a place.",
  },
  ADDRESS_ENTERED: {
    label: "Entered an address or ZIP",
    means: "Someone entered a place. Its ZIP and full resolved district set are recorded with the anonymous reader count.",
  },
  BALLOT_VIEWED: {
    label: "Viewed a ballot",
    means: "Someone opened the ballot for their ZIP or remembered address and districts.",
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
    means: "Someone typed a question into Ask. The full question and its topic are recorded with the reader's districts.",
  },
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
  TIER_0: { label: "Floor coverage", means: "The place is covered at the base tier only." },
  TIER_1: { label: "Tier 1 coverage", means: "The place is covered one tier above the floor." },
  TIER_2: { label: "Tier 2 coverage", means: "The place is covered two tiers above the floor." },
  TIER_3: { label: "Tier 3 coverage", means: "The place is covered at the deepest tier recorded." },
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
  YES: { label: "Yes", means: "" },
  NO: { label: "No", means: "" },
  UNSURE: { label: "Not sure", means: "" },
  SOMEONE_ELSE: { label: "Would rather someone else", means: "Only offered where one candidate is standing unopposed." },
  LOVE: { label: "Love it", means: "" },
  LIKE: { label: "Like it", means: "" },
  DISLIKE: { label: "Dislike it", means: "" },
  HATE: { label: "Hate it", means: "" },
  DONT_CARE: { label: "Do not care", means: "" },
  ANONYMOUS: { label: "Anonymous", means: "Nothing about the person was checked, and nothing was asked." },
  LOCALITY_VERIFIED: { label: "Place checked", means: "The place the answer came from was checked. The person was not." },
  VOTER_MATCHED: { label: "Matched to a voter file", means: "A path that exists in the schema and is not in use." },
  BODY: { label: "A governing body", means: "" },
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

/** Detail keys the browser writes; the SQL CASE below mirrors these pairs and a test asserts they agree. */
export const DETAIL_KEY_BY_EVENT: Readonly<Partial<Record<SearchLogEventType, string>>> = {
  BODY_OPENED: "venueKey",
  MEETING_OPENED: "meetingId",
  OFFICIAL_OPENED: "officialId",
  FILTER_APPLIED: "filter",
  QUESTION_ASKED: "topic",
};

/** Named so a failure can say which handle is missing without printing its value. */
export const READER_STORE_URL_VAR = "DATABASE_URL";

export type ReaderStoreQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, unknown>[]>;

/** The detail names the variable, never its value, and a failure reports the error's name, never its text. */
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

export interface CountedKey {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

export interface CountedDay {
  readonly day: string;
  readonly count: number;
}

export interface TopList {
  readonly rows: readonly CountedKey[];
  /** How many distinct keys exist in the window for this class. */
  readonly distinct: number;
  /** How many events carried a key at all — the denominator the rows are out of. */
  readonly keyed: number;
}

export const EMPTY_TOP_LIST: TopList = { rows: [], distinct: 0, keyed: 0 };

export interface ActivityReading {
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
  readonly divisionTouches: number;
  readonly topBodies: TopList;
  readonly topMeetings: TopList;
  readonly topOfficials: TopList;
  readonly topFilters: TopList;
  readonly topAskTopics: TopList;
}

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

export interface AskReading {
  readonly rowsInWindow: number;
}

export interface ReaderIntel {
  readonly window: ReaderWindow;
  readonly runClass: ReaderRunClass;
  readonly activity: ReadOutcome<ActivityReading>;
  readonly reactions: ReadOutcome<ReactionReading>;
  readonly demand: ReadOutcome<DemandReading>;
  readonly ask: ReadOutcome<AskReading>;
}

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

/** `run_class` has no CHECK constraint, so a fifth value can exist in the data; this reports it. */
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

/** Each statement is one server-side aggregation; ranked lists are cut inside Postgres with `ROW_NUMBER()`. */
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
        /* The CASE names the detail key each browser event writes, mirrored in DETAIL_KEY_BY_EVENT. */
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
    /* Nothing in any class differs from nothing in the selected class, and from an unreachable store. */
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
 * Never blended: scale versions (different questions), quarantined rows (shown separately), and
 * row counts. `reactions` is an upsert that re-stamps `occurred_at`, so a count is current positions
 * last changed in the window, never taps.
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
    /* An answer value that never came in is absent, not zero. */
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

/** How many Ask interactions were saved in the window. */
export async function readAsk(
  sql: ReaderStoreQuery,
  window: ReaderWindow,
): Promise<ReadOutcome<AskReading>> {
  try {
    const rows = await sql`
      SELECT COUNT(*) AS n
      FROM ask_interactions
      WHERE occurred_at >= ${window.fromIso}::timestamptz AND occurred_at < ${window.toIso}::timestamptz
    `;
    return { kind: "HELD", value: { rowsInWindow: numAt(rows[0] ?? {}, "n") } };
  } catch (error) {
    return unreachable("the ask store", error);
  }
}

/** Separate outcomes: one unreachable table must not blank another panel. */
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
  /* Walked by field name before the page gets it: the owner's console is an exposure too. */
  assertAggregateOnly(intel, "the reader-intelligence reading");
  return intel;
}

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

/** A zero denominator renders as a named gap, never as a percentage. */
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

/** `measured()` throws on these; the page refuses them instead of failing with a 500. */
export function impossibleNumbersIn(numbers: readonly RenderedNumber[]): string[] {
  return numbers
    .filter((n) => n.denominator !== null && n.value > n.denominator)
    .map((n) => `${n.label}: ${n.value} counted out of ${n.denominator}`);
}

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

/** `stated` comes from the reading's totals and `rendered` from the array the page maps over. */
export function countClaimsOf(intel: ReaderIntel, topN: number = READER_TOP_N): CountClaim[] {
  const claims: CountClaim[] = [];
  /* Only claims whose two halves come from different places; a number compared to itself cannot fail. */
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

/** A top list always says how many were left out. */
export function topListSentence(list: TopList, one: string, many: string): string {
  if (list.distinct === 0) return `No ${one} was named by any event in this window.`;
  const named = list.distinct === 1 ? one : many;
  const events = list.keyed === 1 ? "event" : "events";
  const tail = `named in this window, out of ${list.keyed} ${events} that named one.`;
  if (list.distinct <= list.rows.length) return `All ${list.distinct} ${named} ${tail}`;
  return `The top ${list.rows.length} of ${list.distinct} ${named} ${tail}`;
}
