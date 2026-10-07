import type { Sql } from "../control-plane/repository/pg-store.ts";
import { analyzeStore, type IntakeDayCount, type TripwireFlag } from "../signal/tripwire.ts";

/** Owner-facing observation of the live intake stores, attached to the runner's existing durable heartbeat. */
export const INTAKE_RUNTIME_FORMAT_VERSION = 1;
export const INTAKE_RUNTIME_WINDOW_HOURS = 24;

export type IntakeRuntimeOutcome = "HEALTHY" | "ATTENTION" | "UNREADABLE";

export interface IntakeRunClassCensus {
  readonly organic: number;
  readonly synthetic: number;
  readonly unknown: number;
  readonly author: number;
  readonly total: number;
  readonly unaccounted: number;
}

export interface IntakeRuntimeObservation {
  readonly formatVersion: number;
  readonly observedAt: string;
  readonly outcome: IntakeRuntimeOutcome;
  readonly reactionDays: readonly IntakeDayCount[];
  readonly searchLogDays: readonly IntakeDayCount[];
  readonly flags: readonly TripwireFlag[];
  readonly searchLogCensus: IntakeRunClassCensus | null;
  readonly limiterRowsPurged: number | null;
  readonly limiterRowsRemaining: number | null;
  readonly writeAlarmsInWindow: number | null;
  readonly writeAlarmsEver: number | null;
  readonly writeAlarmsByStore: readonly { readonly store: string; readonly count: number }[];
  readonly detail: string;
}

/** Stable append identity for an exact host observation; malformed clocks fail closed. */
export function intakeRuntimeObservationCycleId(host: string, observedAt: string): string {
  const normalizedHost = host.trim();
  if (normalizedHost === "" || /[\u0000-\u001f\u007f]/.test(normalizedHost)) {
    throw new Error("INTAKE_RUNTIME_OBSERVATION_HOST_INVALID");
  }
  const observedMs = Date.parse(observedAt);
  if (!Number.isFinite(observedMs) || new Date(observedMs).toISOString() !== observedAt) {
    throw new Error("INTAKE_RUNTIME_OBSERVATION_TIME_INVALID");
  }
  return `intake-runtime:${encodeURIComponent(normalizedHost)}:${observedAt}`;
}

export interface IntakeRuntimeRows {
  readonly reactionDays: readonly unknown[];
  readonly searchLogDays: readonly unknown[];
  readonly searchLogCensus: readonly unknown[];
  readonly limiterRowsRemaining: readonly unknown[];
  readonly writeAlarms: readonly unknown[];
  readonly writeAlarmsEver: readonly unknown[];
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function count(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function dayRows(value: readonly unknown[], withSuspect: boolean): IntakeDayCount[] | null {
  const rows: IntakeDayCount[] = [];
  for (const raw of value) {
    const row = object(raw);
    const day = typeof row?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.day)
      ? row.day
      : null;
    const total = count(row?.total);
    const suspect = withSuspect ? count(row?.suspect) : 0;
    if (day === null || total === null || suspect === null || suspect > total) return null;
    rows.push({ day, total, suspect });
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

function oneCount(rows: readonly unknown[], key: string): number | null {
  if (rows.length !== 1) return null;
  return count(object(rows[0])?.[key]);
}

function runClassCensus(rows: readonly unknown[]): IntakeRunClassCensus | null {
  if (rows.length !== 1) return null;
  const row = object(rows[0]);
  if (!row) return null;
  const organic = count(row.organic);
  const synthetic = count(row.synthetic);
  const unknown = count(row.unknown);
  const author = count(row.author);
  const total = count(row.total);
  if ([organic, synthetic, unknown, author, total].some((value) => value === null)) return null;
  const classified = organic! + synthetic! + unknown! + author!;
  if (classified > total!) return null;
  return {
    organic: organic!,
    synthetic: synthetic!,
    unknown: unknown!,
    author: author!,
    total: total!,
    unaccounted: total! - classified,
  };
}

function alarmRows(rows: readonly unknown[]): { readonly total: number; readonly byStore: readonly { readonly store: string; readonly count: number }[] } | null {
  const byStore: { store: string; count: number }[] = [];
  let total = 0;
  for (const raw of rows) {
    const row = object(raw);
    const store = typeof row?.store === "string" && row.store.trim() !== "" ? row.store.trim() : null;
    const n = count(row?.count);
    if (store === null || n === null) return null;
    byStore.push({ store, count: n });
    total += n;
  }
  return { total, byStore: byStore.sort((a, b) => a.store.localeCompare(b.store)) };
}

function flagRows(rows: readonly unknown[]): TripwireFlag[] | null {
  const flags: TripwireFlag[] = [];
  for (const raw of rows) {
    const row = object(raw);
    if (
      typeof row?.day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row.day) ||
      typeof row.store !== "string" ||
      row.store.trim() === "" ||
      (row.kind !== "VOLUME_SPIKE" && row.kind !== "SUSPECT_SHARE") ||
      typeof row.detail !== "string" ||
      row.detail.trim() === ""
    ) return null;
    flags.push({ day: row.day, store: row.store, kind: row.kind, detail: row.detail });
  }
  return flags.sort((a, b) => b.day.localeCompare(a.day));
}

function nullableCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = count(value);
  return parsed === null ? undefined : parsed;
}

export function unreadableIntakeRuntimeObservation(observedAt: string, detail: string): IntakeRuntimeObservation {
  return {
    formatVersion: INTAKE_RUNTIME_FORMAT_VERSION,
    observedAt,
    outcome: "UNREADABLE",
    reactionDays: [],
    searchLogDays: [],
    flags: [],
    searchLogCensus: null,
    limiterRowsPurged: null,
    limiterRowsRemaining: null,
    writeAlarmsInWindow: null,
    writeAlarmsEver: null,
    writeAlarmsByStore: [],
    detail,
  };
}

/** Strict projection: a malformed aggregate is an unreadable observation, never zero. */
export function projectIntakeRuntimeObservation(
  rows: IntakeRuntimeRows,
  observedAt: string,
  limiterRowsPurged: number,
): IntakeRuntimeObservation {
  const reactions = dayRows(rows.reactionDays, true);
  const searches = dayRows(rows.searchLogDays, false);
  const census = runClassCensus(rows.searchLogCensus);
  const remaining = oneCount(rows.limiterRowsRemaining, "count");
  const alarms = alarmRows(rows.writeAlarms);
  const alarmsEver = oneCount(rows.writeAlarmsEver, "count");
  if (!reactions || !searches || !census || remaining === null || !alarms || alarmsEver === null) {
    return unreadableIntakeRuntimeObservation(
      observedAt,
      "The production intake aggregate returned a shape that could not be reconciled; no zero or healthy verdict was inferred.",
    );
  }
  const flags = [
    ...analyzeStore("reactions", reactions),
    ...analyzeStore("search_log", searches),
  ].sort((a, b) => b.day.localeCompare(a.day));
  const attention = flags.length > 0 || alarms.total > 0 || census.unaccounted > 0;
  return {
    formatVersion: INTAKE_RUNTIME_FORMAT_VERSION,
    observedAt,
    outcome: attention ? "ATTENTION" : "HEALTHY",
    reactionDays: reactions,
    searchLogDays: searches,
    flags,
    searchLogCensus: census,
    limiterRowsPurged,
    limiterRowsRemaining: remaining,
    writeAlarmsInWindow: alarms.total,
    writeAlarmsEver: alarmsEver,
    writeAlarmsByStore: alarms.byStore,
    detail: attention
      ? `${flags.length} intake flag(s), ${alarms.total} write alarm(s) in ${INTAKE_RUNTIME_WINDOW_HOURS}h, and ${census.unaccounted} unclassified search-log row(s).`
      : `No intake flag, write alarm, or unclassified search-log row was found; ${limiterRowsPurged} expired limiter row(s) were purged and ${remaining} remain.`,
  };
}

/**
 * One production reading plus the limiter's bounded housekeeping write. All
 * reads describe the live stores; the callback is the existing sanctioned
 * purge door and is injected so the whole path has deterministic tests.
 */
export async function collectIntakeRuntimeObservation(input: {
  readonly sql: Sql;
  readonly observedAt: string;
  readonly purgeExpired: () => Promise<number>;
}): Promise<IntakeRuntimeObservation> {
  try {
    const cutoff = input.observedAt;
    const [reactionDays, searchLogDays, searchLogCensus, writeAlarms, writeAlarmsEver] = await Promise.all([
      input.sql.query(
        "SELECT occurred_at::date::text AS day, count(*)::int AS total, count(*) FILTER (WHERE suspect_reason IS NOT NULL)::int AS suspect FROM reactions WHERE occurred_at > $1::timestamptz - interval '30 days' GROUP BY 1 ORDER BY 1",
        [cutoff],
      ),
      input.sql.query(
        "SELECT occurred_at::date::text AS day, count(*)::int AS total FROM search_log WHERE occurred_at > $1::timestamptz - interval '30 days' AND run_class = 'ORGANIC' GROUP BY 1 ORDER BY 1",
        [cutoff],
      ),
      input.sql.query(
        "SELECT count(*) FILTER (WHERE run_class = 'ORGANIC')::int AS organic, count(*) FILTER (WHERE run_class = 'SYNTHETIC')::int AS synthetic, count(*) FILTER (WHERE run_class = 'UNKNOWN')::int AS unknown, count(*) FILTER (WHERE run_class = 'AUTHOR')::int AS author, count(*)::int AS total FROM search_log",
      ),
      input.sql.query(
        `SELECT store, count(*)::int AS count FROM write_alarm WHERE raised_at > $1::timestamptz - interval '${INTAKE_RUNTIME_WINDOW_HOURS} hours' GROUP BY store ORDER BY store`,
        [cutoff],
      ),
      input.sql.query("SELECT count(*)::int AS count FROM write_alarm"),
    ]);
    const limiterRowsPurged = await input.purgeExpired();
    const limiterRowsRemaining = await input.sql.query("SELECT count(*)::int AS count FROM intake_limiter");
    return projectIntakeRuntimeObservation({
      reactionDays: Array.isArray(reactionDays) ? reactionDays : [],
      searchLogDays: Array.isArray(searchLogDays) ? searchLogDays : [],
      searchLogCensus: Array.isArray(searchLogCensus) ? searchLogCensus : [],
      limiterRowsRemaining: Array.isArray(limiterRowsRemaining) ? limiterRowsRemaining : [],
      writeAlarms: Array.isArray(writeAlarms) ? writeAlarms : [],
      writeAlarmsEver: Array.isArray(writeAlarmsEver) ? writeAlarmsEver : [],
    }, input.observedAt, limiterRowsPurged);
  } catch (error) {
    return unreadableIntakeRuntimeObservation(
      input.observedAt,
      `The standing runner could not complete the production intake reading (${error instanceof Error ? error.name : "error"}); no healthy verdict was recorded.`,
    );
  }
}

export function parseIntakeRuntimeObservation(value: unknown): IntakeRuntimeObservation | null {
  const row = object(value);
  if (
    row?.formatVersion !== INTAKE_RUNTIME_FORMAT_VERSION ||
    typeof row.observedAt !== "string" ||
    !Number.isFinite(Date.parse(row.observedAt)) ||
    !["HEALTHY", "ATTENTION", "UNREADABLE"].includes(String(row.outcome)) ||
    typeof row.detail !== "string" ||
    row.detail.trim() === "" ||
    !Array.isArray(row.reactionDays) ||
    !Array.isArray(row.searchLogDays) ||
    !Array.isArray(row.flags) ||
    !Array.isArray(row.writeAlarmsByStore)
  ) return null;

  const outcome = row.outcome as IntakeRuntimeOutcome;
  const reactionDays = dayRows(row.reactionDays, true);
  const searchLogDays = dayRows(row.searchLogDays, false);
  const flags = flagRows(row.flags);
  const alarmProjection = alarmRows(row.writeAlarmsByStore);
  const census = row.searchLogCensus === null
    ? null
    : runClassCensus([row.searchLogCensus]);
  const limiterRowsPurged = nullableCount(row.limiterRowsPurged);
  const limiterRowsRemaining = nullableCount(row.limiterRowsRemaining);
  const writeAlarmsInWindow = nullableCount(row.writeAlarmsInWindow);
  const writeAlarmsEver = nullableCount(row.writeAlarmsEver);
  if (
    reactionDays === null ||
    searchLogDays === null ||
    flags === null ||
    alarmProjection === null ||
    limiterRowsPurged === undefined ||
    limiterRowsRemaining === undefined ||
    writeAlarmsInWindow === undefined ||
    writeAlarmsEver === undefined
  ) return null;

  if (outcome === "UNREADABLE") {
    if (
      census !== null ||
      limiterRowsPurged !== null ||
      limiterRowsRemaining !== null ||
      writeAlarmsInWindow !== null ||
      writeAlarmsEver !== null ||
      reactionDays.length !== 0 ||
      searchLogDays.length !== 0 ||
      flags.length !== 0 ||
      alarmProjection.byStore.length !== 0
    ) return null;
  } else {
    if (
      census === null ||
      limiterRowsPurged === null ||
      limiterRowsRemaining === null ||
      writeAlarmsInWindow === null ||
      writeAlarmsEver === null ||
      alarmProjection.total !== writeAlarmsInWindow ||
      writeAlarmsEver < writeAlarmsInWindow
    ) return null;
    const derivedFlags = [
      ...analyzeStore("reactions", reactionDays),
      ...analyzeStore("search_log", searchLogDays),
    ].sort((a, b) => b.day.localeCompare(a.day));
    const flagKey = (flag: TripwireFlag): string =>
      `${flag.day}\0${flag.store}\0${flag.kind}\0${flag.detail}`;
    if (
      flags.length !== derivedFlags.length ||
      flags.some((flag, index) => flagKey(flag) !== flagKey(derivedFlags[index]))
    ) return null;
    const attention = flags.length > 0 || writeAlarmsInWindow > 0 || census.unaccounted > 0;
    if ((outcome === "ATTENTION") !== attention) return null;
  }

  return {
    formatVersion: INTAKE_RUNTIME_FORMAT_VERSION,
    observedAt: row.observedAt,
    outcome,
    reactionDays,
    searchLogDays,
    flags,
    searchLogCensus: census,
    limiterRowsPurged,
    limiterRowsRemaining,
    writeAlarmsInWindow,
    writeAlarmsEver,
    writeAlarmsByStore: alarmProjection.byStore,
    detail: row.detail,
  };
}
