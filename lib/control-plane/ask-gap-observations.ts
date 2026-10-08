/** `pgAskGapObservationSink` is one atomic upsert per observation, so concurrent asks cannot lose a count to a compare-and-set race. */
import { neon } from "@neondatabase/serverless";

import { ASK_GAP_RECORD_CLASS, isAskGapCode, type AskGapCode, type AskGapRecordClass } from "../ask/gap-codes.ts";
import type { AggregateRepository, Persisted } from "./repository/types.ts";
import {
  boundedQuery,
  CONTROL_PLANE_REQUEST_BOUNDS_MS,
  type BoundableSql,
  type ControlPlaneRequestBounds,
} from "./repository/request-bounds.ts";

export const ASK_GAP_OBSERVATION_FIELDS = ["bodyId", "code", "recordClass", "day", "count"] as const;

export const ASK_GAP_OBSERVATIONS_TABLE = "cp_ask_gap_observations";

export const ASK_GAP_OBSERVATION_WINDOW_DAYS = 30;

export const MAX_ASK_GAP_OBSERVATIONS_PER_ANSWER = 12;

export const ASK_GAP_OBSERVATION_WRITE_BOUND_MS = 2_500;

const DAY_MS = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_BODY_ID_CHARS = 200;
const BODY_ID = /^(?:ocd-division\/|curated:)[A-Za-z0-9_:/.~'-]+(?:#[A-Za-z0-9_.:-]+)?$/;

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

export interface AskGapObservationSink {
  readonly describe: string;
  record(observations: readonly AskGapObservation[]): Promise<number>;
}

const CAS_ATTEMPTS = 4;

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

export const ASK_GAP_OBSERVATION_UPSERT =
  `INSERT INTO ${ASK_GAP_OBSERVATIONS_TABLE} (id, revision, updated_at, value) ` +
  "VALUES ($1, 1, $2::timestamptz, $3::jsonb) " +
  "ON CONFLICT (id) DO UPDATE SET " +
  `revision = ${ASK_GAP_OBSERVATIONS_TABLE}.revision + 1, ` +
  "updated_at = EXCLUDED.updated_at, changed_at = now(), " +
  `value = jsonb_set(${ASK_GAP_OBSERVATIONS_TABLE}.value, '{count}', ` +
  `to_jsonb((${ASK_GAP_OBSERVATIONS_TABLE}.value->>'count')::bigint + (EXCLUDED.value->>'count')::bigint)) ` +
  "RETURNING revision";

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

export interface AskedGap {
  readonly bodyId: string;
  readonly code: AskGapCode;
  readonly recordClass: AskGapRecordClass;
  readonly asks: number;
  readonly days: number;
  readonly firstDay: string;
  readonly lastDay: string;
}

export function askedGapKey(bodyId: string, code: AskGapCode): string {
  return `${bodyId}#${code}`;
}

export function observationWindowStart(nowIso: string, windowDays = ASK_GAP_OBSERVATION_WINDOW_DAYS): string {
  return new Date(Date.parse(observationDayStart(observationDay(nowIso))) - (windowDays - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** A row that is not exactly an observation is not counted and is named in `refused`, never silently dropped. */
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

export function askedWords(asked: Pick<AskedGap, "asks" | "days" | "lastDay">, windowDays = ASK_GAP_OBSERVATION_WINDOW_DAYS): string {
  const times = `${asked.asks.toLocaleString("en-US")} time${asked.asks === 1 ? "" : "s"}`;
  const days = `${asked.days.toLocaleString("en-US")} day${asked.days === 1 ? "" : "s"}`;
  return `Readers were told this ${times} on ${days} in the last ${windowDays} days, most recently ${asked.lastDay}.`;
}

export type AskGapObservationReading =
  | { readonly rows: readonly AskGapObservation[]; readonly source: string }
  | { readonly unreadable: string };

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
