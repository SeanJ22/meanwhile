/**
 * **AN UNANSWERED ASK LEAVES A BODY, A GAP, A DAY AND A COUNT — NOTHING
 * ELSE.** (2026-09-25.)
 *
 * The owner's decision (Sean, 2026-09-25): "Recording the government body
 * behind an unanswered Ask question is approved. Record the body identifier
 * and necessary work metadata so the system can create targeted work to fill
 * the information gap. This does not approve new storage of personal
 * information, raw question histories, or tracking individual readers."
 *
 * ## One observation
 *
 * ```
 *   id      <body id>#<gap code>#<UTC day>                one row per body, gap and day
 *   value   { bodyId, code, recordClass, day, count }     exactly these five keys
 *   table   cp_ask_gap_observations (an aggregate, control-plane schema v13)
 *   updated_at   the day's start, never the instant of an ask
 * ```
 *
 * When Ask tells a reader a coded gap about a body (`lib/ask/gap-codes.ts`),
 * that body's count for that gap and that day goes up by one. A second ask the
 * same day raises the count; it never adds a row, and no row says which ask,
 * when within the day, or by whom.
 *
 * ## What is deliberately not here
 *
 * No question text, no answer text, no IP address, no session, cookie,
 * continuity key or user agent, no reader ZIP or division, no run id, and no
 * time finer than the day. The value's keys are an exact list
 * ({@link ASK_GAP_OBSERVATION_FIELDS}) checked at every write, and a body id
 * must be a canonical registry id (no spaces, no free text), so a question
 * cannot ride in through it.
 *
 * ## Who reads it
 *
 * The standing runner's `ask-gaps` provider folds the last
 * {@link ASK_GAP_OBSERVATION_WINDOW_DAYS} days ({@link foldAskGapObservations})
 * to raise the priority of the gaps readers were told about, and to create the
 * one gap the held reading cannot see on its own (`MEETINGS_NOT_HELD`). Admin's
 * Work page states the same fold in {@link askedWords}.
 *
 * ## The two writers, one contract
 *
 * {@link repositoryAskGapObservationSink} adds through any
 * `AggregateRepository` by read and compare-and-set (memory, file, tests).
 * {@link pgAskGapObservationSink} is what Ask's route uses: ONE atomic upsert
 * per observation against the same aggregate table — revision plus one per
 * accepted write, as the repository contract states — so concurrent asks
 * cannot lose a count to a compare-and-set race, and the reader's route does
 * not carry the whole repository layer. Both refuse a value that is not
 * exactly an observation.
 */
import { neon } from "@neondatabase/serverless";

import { ASK_GAP_RECORD_CLASS, isAskGapCode, type AskGapCode, type AskGapRecordClass } from "../ask/gap-codes.ts";
import type { AggregateRepository, Persisted } from "./repository/types.ts";
import {
  boundedQuery,
  CONTROL_PLANE_REQUEST_BOUNDS_MS,
  type BoundableSql,
  type ControlPlaneRequestBounds,
} from "./repository/request-bounds.ts";

/** Every key an observation holds, and the only ones it may hold. */
export const ASK_GAP_OBSERVATION_FIELDS = ["bodyId", "code", "recordClass", "day", "count"] as const;

/** The aggregate table (`pg-schema.ts` AGGREGATE_KINDS `ask_gap_observations`). */
export const ASK_GAP_OBSERVATIONS_TABLE = "cp_ask_gap_observations";

/** How far back a reader's ask raises or creates work. */
export const ASK_GAP_OBSERVATION_WINDOW_DAYS = 30;

/** At most this many (body, gap) pairs are counted from one answer; an area answer names many bodies. */
export const MAX_ASK_GAP_OBSERVATIONS_PER_ANSWER = 12;

/** The write's own bound, far inside the function's life after the response. */
export const ASK_GAP_OBSERVATION_WRITE_BOUND_MS = 2_500;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_ID_CHARS = 200;
/** A canonical body id: an OCD division or a curated id, with an optional `#role`. No space, no `@`, nothing a sentence needs. */
const BODY_ID = /^(?:ocd-division\/|curated:)[A-Za-z0-9_:/.~'-]+(?:#[A-Za-z0-9_.:-]+)?$/;

/** One body, one gap, one UTC day, and how many answers told a reader that gap. */
export interface AskGapObservation {
  readonly bodyId: string;
  readonly code: AskGapCode;
  readonly recordClass: AskGapRecordClass;
  /** `YYYY-MM-DD`, UTC. Never an hour, never an instant. */
  readonly day: string;
  readonly count: number;
}

export function isCanonicalBodyId(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_BODY_ID_CHARS && BODY_ID.test(value);
}

/** The UTC day of an instant. Throws on a clock that is not an instant. */
export function observationDay(nowIso: string): string {
  const at = Date.parse(nowIso);
  if (!Number.isFinite(at)) throw new Error(`ASK_GAP_OBSERVATION_CLOCK_INVALID: ${JSON.stringify(nowIso)} is not an instant`);
  return new Date(at).toISOString().slice(0, 10);
}

/** The instant a day's row is stamped with: its start, so the store holds no time finer than the day. */
export function observationDayStart(day: string): string {
  return `${day}T00:00:00.000Z`;
}

export function askGapObservationId(bodyId: string, code: AskGapCode, day: string): string {
  return `${bodyId}#${code}#${day}`;
}

/** The body, code and day an id names, or null. The day and the code are the last two `#` parts (a body id may carry `#`). */
export function parseAskGapObservationId(id: string): { readonly bodyId: string; readonly code: AskGapCode; readonly day: string } | null {
  const dayHash = id.lastIndexOf("#");
  if (dayHash <= 0) return null;
  const rest = id.slice(0, dayHash);
  const codeHash = rest.lastIndexOf("#");
  if (codeHash <= 0) return null;
  const [bodyId, code, day] = [rest.slice(0, codeHash), rest.slice(codeHash + 1), id.slice(dayHash + 1)];
  return DAY.test(day) && isAskGapCode(code) && isCanonicalBodyId(bodyId) ? { bodyId, code, day } : null;
}

/** Why a value is not exactly an observation, or null when it is. */
export function askGapObservationIssue(value: unknown): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "an observation is an object";
  const keys = Object.keys(value).sort();
  const allowed = [...ASK_GAP_OBSERVATION_FIELDS].sort();
  if (keys.length !== allowed.length || keys.some((key, i) => key !== allowed[i])) {
    return `an observation holds exactly ${allowed.join(", ")}; this one holds ${keys.join(", ") || "nothing"}`;
  }
  const v = value as Record<string, unknown>;
  if (!isCanonicalBodyId(v.bodyId)) return "bodyId is not a canonical body id";
  if (!isAskGapCode(v.code)) return "code is not an Ask gap code";
  if (v.recordClass !== ASK_GAP_RECORD_CLASS[v.code]) return `recordClass is not ${v.code}'s`;
  if (typeof v.day !== "string" || !DAY.test(v.day) || !Number.isFinite(Date.parse(observationDayStart(v.day)))) return "day is not a YYYY-MM-DD day";
  if (typeof v.count !== "number" || !Number.isSafeInteger(v.count) || v.count < 1) return "count is not a positive whole number";
  return null;
}

export function assertAskGapObservation(value: unknown): asserts value is AskGapObservation {
  const issue = askGapObservationIssue(value);
  if (issue !== null) throw new Error(`ASK_GAP_OBSERVATION_REFUSED: ${issue}`);
}

/** One answer's observation of one gap it stated: a count of one, on the day of `nowIso`. */
export function askGapObservation(stated: { readonly bodyId: string; readonly code: AskGapCode }, nowIso: string): AskGapObservation {
  const value: AskGapObservation = {
    bodyId: stated.bodyId,
    code: stated.code,
    recordClass: ASK_GAP_RECORD_CLASS[stated.code],
    day: observationDay(nowIso),
    count: 1,
  };
  assertAskGapObservation(value);
  return value;
}

/* ------------------------------------------------------------------ writers --- */

/** Where an answer's observations are added. Resolves with how many were added; rejects when the store refused or did not answer. */
export interface AskGapObservationSink {
  readonly describe: string;
  record(observations: readonly AskGapObservation[]): Promise<number>;
}

const CAS_ATTEMPTS = 4;

/** Add one observation's count through an aggregate repository: read, then create or compare-and-set, retried on a lost race. */
export async function addAskGapObservation(
  repo: Pick<AggregateRepository<AskGapObservation>, "read" | "put" | "compareAndSet">,
  observation: AskGapObservation,
): Promise<Persisted<AskGapObservation>> {
  assertAskGapObservation(observation);
  const id = askGapObservationId(observation.bodyId, observation.code, observation.day);
  const at = observationDayStart(observation.day);
  let lost = "";
  for (let attempt = 1; attempt <= CAS_ATTEMPTS; attempt += 1) {
    try {
      const held = await repo.read(id);
      if (held === null) {
        const made = await repo.put(id, observation, at);
        if (made.created) return made.persisted;
        lost = "another writer created the row first";
        continue;
      }
      assertAskGapObservation(held.value);
      return await repo.compareAndSet(id, held.revision, { ...held.value, count: held.value.count + observation.count }, at);
    } catch (error) {
      const name = (error as { name?: unknown } | null)?.name;
      if (name !== "ConcurrentModification" && name !== "IdentityCollision") throw error;
      lost = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(`ASK_GAP_OBSERVATION_CONTENDED: ${id} lost ${CAS_ATTEMPTS} writes in a row (${lost})`);
}

/** A sink over any aggregate repository. */
export function repositoryAskGapObservationSink(
  repo: Pick<AggregateRepository<AskGapObservation>, "read" | "put" | "compareAndSet">,
  describe = "the Ask-gap observation repository",
): AskGapObservationSink {
  return {
    describe,
    async record(observations) {
      for (const observation of observations) await addAskGapObservation(repo, observation);
      return observations.length;
    },
  };
}

/**
 * The atomic add: create the day's row at revision 1, or add to its count and
 * move its revision by one. `updated_at` is the day's start.
 */
export const ASK_GAP_OBSERVATION_UPSERT =
  `INSERT INTO ${ASK_GAP_OBSERVATIONS_TABLE} (id, revision, updated_at, value) ` +
  "VALUES ($1, 1, $2::timestamptz, $3::jsonb) " +
  "ON CONFLICT (id) DO UPDATE SET " +
  `revision = ${ASK_GAP_OBSERVATIONS_TABLE}.revision + 1, ` +
  "updated_at = EXCLUDED.updated_at, " +
  `value = jsonb_set(${ASK_GAP_OBSERVATIONS_TABLE}.value, '{count}', ` +
  `to_jsonb((${ASK_GAP_OBSERVATIONS_TABLE}.value->>'count')::bigint + (EXCLUDED.value->>'count')::bigint)) ` +
  "RETURNING revision";

/** The Postgres control plane's sink: one bounded atomic upsert per observation. */
export function pgAskGapObservationSink(
  connectionString: string,
  options: { readonly sql?: BoundableSql; readonly boundMs?: number } = {},
): AskGapObservationSink {
  const sql: BoundableSql = options.sql ?? neon(connectionString);
  const bounds: ControlPlaneRequestBounds = { ...CONTROL_PLANE_REQUEST_BOUNDS_MS, POINT: options.boundMs ?? ASK_GAP_OBSERVATION_WRITE_BOUND_MS };
  return {
    describe: `${ASK_GAP_OBSERVATIONS_TABLE} in the control plane`,
    async record(observations) {
      for (const observation of observations) assertAskGapObservation(observation);
      await Promise.all(observations.map((o) =>
        boundedQuery(
          sql,
          { operation: `${ASK_GAP_OBSERVATIONS_TABLE}.add`, callClass: "POINT" },
          ASK_GAP_OBSERVATION_UPSERT,
          [askGapObservationId(o.bodyId, o.code, o.day), observationDayStart(o.day), JSON.stringify(o)],
          { bounds },
        )));
      return observations.length;
    },
  };
}

/* ------------------------------------------------------------------ reading --- */

/** What readers were told about one body's gap within the window. */
export interface AskedGap {
  readonly bodyId: string;
  readonly code: AskGapCode;
  readonly recordClass: AskGapRecordClass;
  /** Answers that stated it. */
  readonly asks: number;
  /** Distinct days it was stated on. */
  readonly days: number;
  readonly firstDay: string;
  readonly lastDay: string;
}

export function askedGapKey(bodyId: string, code: AskGapCode): string {
  return `${bodyId}#${code}`;
}

/** The first day inside the window that ends on `nowIso`'s day. */
export function observationWindowStart(nowIso: string, windowDays = ASK_GAP_OBSERVATION_WINDOW_DAYS): string {
  return new Date(Date.parse(observationDayStart(observationDay(nowIso))) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Every (body, gap) readers were told about in the window ending on `nowIso`'s
 * day, keyed by {@link askedGapKey}. A row that is not exactly an observation
 * is not counted and is named in `refused`, never silently dropped.
 */
export function foldAskGapObservations(
  rows: readonly unknown[],
  nowIso: string,
  windowDays = ASK_GAP_OBSERVATION_WINDOW_DAYS,
): { readonly asked: ReadonlyMap<string, AskedGap>; readonly refused: number; readonly fromDay: string; readonly toDay: string } {
  const fromDay = observationWindowStart(nowIso, windowDays);
  const toDay = observationDay(nowIso);
  const asked = new Map<string, AskedGap>();
  let refused = 0;
  for (const row of rows) {
    if (askGapObservationIssue(row) !== null) {
      refused += 1;
      continue;
    }
    const o = row as AskGapObservation;
    if (o.day < fromDay || o.day > toDay) continue;
    const key = askedGapKey(o.bodyId, o.code);
    const held = asked.get(key);
    asked.set(key, held === undefined
      ? { bodyId: o.bodyId, code: o.code, recordClass: o.recordClass, asks: o.count, days: 1, firstDay: o.day, lastDay: o.day }
      : {
          ...held,
          asks: held.asks + o.count,
          days: held.days + 1,
          firstDay: o.day < held.firstDay ? o.day : held.firstDay,
          lastDay: o.day > held.lastDay ? o.day : held.lastDay,
        });
  }
  return { asked, refused, fromDay, toDay };
}

/** One sentence the provider's evidence and Admin both state. */
export function askedWords(asked: Pick<AskedGap, "asks" | "days" | "lastDay">, windowDays = ASK_GAP_OBSERVATION_WINDOW_DAYS): string {
  const times = `${asked.asks.toLocaleString("en-US")} time${asked.asks === 1 ? "" : "s"}`;
  const days = `${asked.days.toLocaleString("en-US")} day${asked.days === 1 ? "" : "s"}`;
  return `Readers were told this ${times} on ${days} in the last ${windowDays} days, most recently ${asked.lastDay}.`;
}

/** The provider's and the publisher's reading of the table, or why it could not be taken. */
export type AskGapObservationReading =
  | { readonly rows: readonly AskGapObservation[]; readonly source: string }
  | { readonly unreadable: string };

/** Read every observation through the repository layer. Never throws: a failed read is named. */
export async function readAskGapObservations(
  repo: Pick<AggregateRepository<AskGapObservation>, "list">,
): Promise<AskGapObservationReading> {
  try {
    const rows = await repo.list();
    return { rows: rows.map((row) => row.value), source: `${ASK_GAP_OBSERVATIONS_TABLE} (${rows.length} day row${rows.length === 1 ? "" : "s"})` };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
}
