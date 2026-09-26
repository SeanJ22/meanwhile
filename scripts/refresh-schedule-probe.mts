/**
 * `refresh-schedule-probe` — DID THE NORMAL SCHEDULER READ ONE MEETING
 * PARTITION, PUBLISH THE RESULT, DELIVER IT TO READERS, AND PUT ITS NEXT READ
 * BACK ON THE NORMAL RULE? READ FROM PRODUCTION, WRITTEN NOWHERE.
 * (Owner instruction, 2026-09-25: verify the refresh schedule without waiting
 * twelve hours.)
 *
 * The accelerated test: an owner due request (lib/civic-data/routine-due-request.ts,
 * made through the owner door `node scripts/installed-runtime-command.mjs routine-due
 * --contract=<id>`) brings one partition's next read forward, and the standing
 * runner's ORDINARY pass takes it. This probe then proves, from durable records only:
 *
 *  1. REQUEST      the request is on the owner's config row, and is spent by the read.
 *  2. NOT_RUN_NOW  no owner refresh (the `--force --only` shortcut) was asked for this
 *                  partition since the test began, and the pass that read it recorded
 *                  "admitted by this ordinary pass" in its supervisor outcome.
 *  3. ACQUIRED     a durable attempt at or after the request: a candidate's first event
 *                  or an unchanged confirmation.
 *  4. PUBLISHED    a new version the pointer names, or an unchanged confirmation of the
 *                  pointed version; the pass's task receipt names it a verified success.
 *  5. READER       a new version: a PASS Reader readback on it after the read, and the
 *                  composed Reader snapshot composed from it. An unchanged read: readers
 *                  stay on the pointed version, whose newest readback is PASS.
 *                  CHECK_TIME_AT_READER: the public Reader manifest's "Last checked"
 *                  is no older than this read's retrieval, and for a read that found
 *                  nothing new, so is its route's check (`freshChecks`,
 *                  lib/meetings/fresh-checks.ts). WAITING for 15 minutes after the
 *                  read, while the pass's Reader repair publishes the edge.
 *  6. NEXT_DUE     the runner's own clock (the store's `clock()`, through the read-only
 *                  credential) and its own functions give the next deadline, and it is
 *                  the normal rule's: an hour after the read while hourly, twelve hours
 *                  otherwise, or the retry after a failed read.
 *
 * READ-ONLY, enforced by the database: production reads go through
 * `WTP_PRODUCTION_DATABASE_URL_READONLY` (a read-only role; the raw queries also
 * run inside a READ ONLY transaction), and the control plane is read inside a
 * READ ONLY transaction on `WTP_CONTROL_PLANE_DATABASE_URL`. Variable names
 * only; no value is printed. The public Reader manifest (`/api/reader/manifest`,
 * about 140 KB) is read once and writes nothing; `--edge` also compares it with
 * the database's serving copy. A few kilobytes cross the database wire.
 *
 * ```
 *   node --env-file=<checkout>/.env.local --experimental-strip-types \
 *        scripts/refresh-schedule-probe.mts --contract=<meeting partition id> \
 *        --since=<ISO instant the request was made> [--request=<routine-due:id>] [--edge]
 * ```
 *
 * Exit 0: every check passed. 3: the read has not happened yet (run it again
 * after the next pass). 1: a check failed. 2: misuse or unreadable store.
 */

import { neon } from "@neondatabase/serverless";

import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import {
  ROUTINE_SOURCE_TASKS,
  routineTaskDeadlineMs,
  routineTaskDue,
  sittingWindowSignals,
  type RoutineTaskClock,
} from "../lib/civic-data/runner.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  parseRoutineDueRequests,
  routineDueRequestState,
  type RoutineDueRequest,
} from "../lib/civic-data/routine-due-request.ts";
import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const HOUR = 3_600_000;
type Row = Record<string, unknown>;
type Verdict = "PASS" | "FAIL" | "WAITING";

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => args.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const redact =(text: string): string => text.replace(/postgres(?:ql)?:\/\/\S+/gi, "<connection string redacted>");
/** Arizona time: MST is UTC-7 all year (Arizona keeps no daylight time), so it is a fixed offset. */
const MST_OFFSET_MS = 7 * 3_600_000;
const mst = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms)
    ? `${new Date(ms - MST_OFFSET_MS).toISOString().slice(0, 19).replace("T", " ")} MST`
    : String(value);
};
/** A column as text; the driver returns timestamps as Date objects, rendered here as ISO instants. */
const text = (value: unknown): string => (typeof value === "string" ? value : value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : "");

function urlOf(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (value === "") {
    console.error(`refresh-schedule-probe · ${name} is not set; run with --env-file pointing at the checkout's .env.local.`);
    process.exit(2);
  }
  return value;
}

/** Every statement in one READ ONLY transaction: Postgres itself refuses a write. */
async function readOnly(url: string, queries: readonly { readonly name: string; readonly sql: string; readonly params: readonly unknown[] }[]): Promise<Record<string, Row[]>> {
  const sql = neon(url);
  const results = await sql.transaction(queries.map((query) => sql.query(query.sql, [...query.params])), { readOnly: true });
  return Object.fromEntries(queries.map((query, index) => [query.name, results[index] as Row[]]));
}

/**
 * `--all [--from=<ISO>]`: every meeting partition's live gaps by the owner's
 * rule, the natural-interval observation. Reads are candidate first events
 * and unchanged confirmations since `from` less 13 hours; a partition is hot
 * by its current promoted sittings (and stated ends) under the runner's own
 * rule. An hourly gap is late when a read was owed 60 minutes after the later
 * of the previous read and the instant the body turned hourly; a twice-daily
 * gap is late past 12 hours, the open gap to now included.
 */
async function wholeRegistryGaps(fromArg: string | undefined): Promise<void> {
  const nowMs = Date.now();
  const fromMs = fromArg && Number.isFinite(Date.parse(fromArg)) ? Date.parse(fromArg) : nowMs - 12 * HOUR;
  const lookbackIso = new Date(fromMs - 13 * HOUR).toISOString();
  const rows = await readOnly(urlOf("WTP_PRODUCTION_DATABASE_URL_READONLY"), [
    {
      name: "reads",
      sql: `select c.scope, e.at from civic_data_candidates c
              join civic_data_candidate_events e on e.candidate_id = c.id
             where c.record_class = 'MEETING' and e.at >= $1::timestamptz
               and (e.sequence = 1 or left(e.detail, 26) = 'UNCHANGED_CONFIRMATION_V1 ')`,
      params: [lookbackIso],
    },
    {
      name: "sittings",
      sql: `select scope, (select coalesce(jsonb_agg(jsonb_build_array(m->'startsAt', m->'endsAt')), '[]'::jsonb)
                 from jsonb_array_elements(case when jsonb_typeof(payload->'meetings') = 'array' then payload->'meetings' else '[]'::jsonb end) m
                where jsonb_typeof(m->'startsAt') = 'string') as pairs
              from civic_data_promotions where record_class = 'MEETING'`,
      params: [],
    },
  ]);
  const byScope = new Map<string, number[]>();
  for (const row of rows.reads!) byScope.set(text(row.scope), [...(byScope.get(text(row.scope)) ?? []), Date.parse(text(row.at))]);
  const sittings = new Map(rows.sittings!.map((row) => [text(row.scope), (Array.isArray(row.pairs) ? row.pairs : []) as unknown[]]));
  const partitions = ROUTINE_SOURCE_TASKS.filter((row) => row.recordClass === "MEETING" && row.contract.schedule?.kind === "SITTING_WINDOW");
  const late: string[] = [];
  let judgedGaps = 0;
  let lateGapTotal = 0;
  let hourlyGaps = 0;
  let hourlyOnTime = 0;
  let twiceDailyGaps = 0;
  let twiceDailyOnTime = 0;
  let longestHourly = 0;
  let longestTwiceDaily = 0;
  for (const partition of partitions) {
    const pairs = sittings.get(partition.scope);
    const starts = pairs?.flatMap((pair) => (Array.isArray(pair) && typeof pair[0] === "string" ? [pair[0]] : []));
    const ends = new Map<string, number>();
    for (const pair of pairs ?? []) {
      if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" && Number.isFinite(Date.parse(pair[1]))) ends.set(pair[0], Date.parse(pair[1]));
    }
    // A partition never published has no meeting on record: twice daily (R20).
    const hotAt = (ms: number) => starts !== undefined && sittingWindowSignals(
      [{ task: partition, ok: true, clock: { sittingStarts: starts } }], ms, new Map([[partition.id, ends]]),
    ).get(partition.id) === true;
    const times = [...(byScope.get(partition.scope) ?? [])].sort((left, right) => left - right);
    times.push(nowMs);
    for (let index = 1; index < times.length; index += 1) {
      const from = times[index - 1]!;
      const to = times[index]!;
      if (to <= fromMs) continue;
      judgedGaps += 1;
      const lateBefore = late.length;
      const hotFrom = hotAt(from);
      if (to - from > 12 * HOUR) late.push(`${partition.id} twice daily: ${((to - from) / HOUR).toFixed(2)} h from ${mst(from)}${to === nowMs ? " (still unread)" : ""}`);
      if (!hotFrom && !hotAt(to)) {
        twiceDailyGaps += 1;
        if (to - from <= 12 * HOUR) twiceDailyOnTime += 1;
        longestTwiceDaily = Math.max(longestTwiceDaily, to - from);
      }
      // The hourly rule is judged only for gaps that began inside the window.
      if (from >= fromMs) {
        let owedFrom = hotFrom ? from : undefined;
        for (let minute = from + 60_000; minute < to; minute += 60_000) {
          if (!hotAt(minute)) { owedFrom = undefined; continue; }
          owedFrom ??= minute;
          if (minute - owedFrom >= HOUR) { late.push(`${partition.id} hourly: unread ${((to - owedFrom) / 60_000).toFixed(1)} min from ${mst(owedFrom)}`); break; }
        }
        if (hotFrom && hotAt(to)) {
          hourlyGaps += 1;
          if (to - from <= HOUR) hourlyOnTime += 1;
          longestHourly = Math.max(longestHourly, to - from);
        }
      }
      if (late.length > lateBefore) lateGapTotal += 1;
    }
  }
  const lateGaps = floored("late gaps", "meeting partition read gaps judged by the owner's rule", judgedGaps, lateGapTotal, judgedGaps === 0 ? "no gap in the window" : undefined);
  console.log(`refresh-schedule-probe --all · ${mst(fromMs)} to ${mst(nowMs)}`);
  console.log(`  ${floorLine(floored("hourly-body gaps within 60:00", "gaps between reads of an hourly body", hourlyGaps, hourlyOnTime, hourlyGaps === 0 ? "no hourly gap in the window" : undefined))}; longest ${(longestHourly / 60_000).toFixed(1)} min`);
  console.log(`  ${floorLine(floored("twice-daily-body gaps within 12:00:00", "gaps between reads of a twice-daily body", twiceDailyGaps, twiceDailyOnTime, twiceDailyGaps === 0 ? "no twice-daily gap in the window" : undefined))}; longest ${(longestTwiceDaily / HOUR).toFixed(2)} h`);
  console.log(`  ${floorLine(lateGaps)}`);
  for (const line of late) console.log(`  LATE ${line}`);
  process.exitCode = late.length > 0 ? 1 : 0;
}

if (args.includes("--all")) {
  try {
    await wholeRegistryGaps(arg("from"));
  } catch (error) {
    console.error(`refresh-schedule-probe · a read failed: ${redact(error instanceof Error ? error.message : String(error))}`);
    process.exitCode = 2;
  }
  process.exit();
}
const contractId = arg("contract");
const since = arg("since");
const requestId = arg("request");
const edge = args.includes("--edge");
const task = ROUTINE_SOURCE_TASKS.find(({ id }) => id === contractId);
if (!task || task.recordClass !== "MEETING" || task.contract.schedule?.kind !== "SITTING_WINDOW" || !since || !Number.isFinite(Date.parse(since))) {
  console.error("refresh-schedule-probe · usage: --contract=<registered meeting partition id> --since=<ISO instant> [--request=<routine-due:id>] [--edge], or --all [--from=<ISO instant>]");
  process.exit(2);
}
const sinceMs = Date.parse(since);

const productionUrl = urlOf("WTP_PRODUCTION_DATABASE_URL_READONLY");
const controlPlaneUrl = urlOf("WTP_CONTROL_PLANE_DATABASE_URL");
const lookback = new Date(sinceMs - 13 * HOUR).toISOString();

let production: Record<string, Row[]>;
let control: Record<string, Row[]>;
try {
  production = await readOnly(productionUrl, [
    {
      name: "attempts",
      sql: `select c.id, c.state, c.failure_code, c.retrieved_at, e.at
              from civic_data_candidates c
              join civic_data_candidate_events e on e.candidate_id = c.id and e.sequence = 1
             where c.source_id = $1 and c.record_class = 'MEETING' and c.scope = $2 and e.at >= $3::timestamptz
             order by e.at`,
      params: [task.sourceId, task.scope, lookback],
    },
    {
      name: "evidence",
      sql: `select e.candidate_id, e.sequence, e.at, e.detail
              from civic_data_candidate_events e
             where e.candidate_id in (select id from civic_data_candidates where source_id = $1 and record_class = 'MEETING' and scope = $2)
               and e.at >= $3::timestamptz
               and (left(e.detail, 26) = 'UNCHANGED_CONFIRMATION_V1 ' or left(e.detail, 30) = 'READER_PROJECTION_READBACK_V2 ' or left(e.detail, 15) = 'Atomic pointer ')
             order by e.at`,
      params: [task.sourceId, task.scope, lookback],
    },
    {
      name: "newestReadback",
      sql: `select e.at, e.detail from civic_data_candidate_events e
             where e.candidate_id = (select current_version_id from civic_data_promotions where record_class = 'MEETING' and scope = $1)
               and left(e.detail, 30) = 'READER_PROJECTION_READBACK_V2 '
             order by e.sequence desc limit 1`,
      params: [task.scope],
    },
    {
      name: "pointer",
      sql: `select current_version_id, promoted_at,
               (select coalesce(jsonb_agg(jsonb_build_array(m->'startsAt', m->'endsAt')), '[]'::jsonb)
                  from jsonb_array_elements(case when jsonb_typeof(payload->'meetings') = 'array' then payload->'meetings' else '[]'::jsonb end) m
                 where jsonb_typeof(m->'startsAt') = 'string') as sittings
              from civic_data_promotions where record_class = 'MEETING' and scope = $1`,
      params: [task.scope],
    },
    {
      name: "snapshot",
      sql: `select sequence, generated_at, composed_at, retrieved_at, promoted_through,
               (select s from jsonb_array_elements(composed_from) s where s->>'contractId' = $1 limit 1) as member
              from civic_data_reader_projections where key = 'MEETING:composed-reader-snapshot'`,
      params: [task.id],
    },
  ]);
  control = await readOnly(controlPlaneUrl, [
    {
      name: "passes",
      sql: `select record->'runtimeOutcome'->>'cycleId' as cycle, record->'runtimeOutcome'->>'startedAt' as started,
               record->'runtimeOutcome'->>'finishedAt' as finished, record->'runtimeOutcome'->>'testedSha' as sha,
               (record->'runtimeOutcome'->>'attemptedTasks')::int as attempted,
               (select r from jsonb_array_elements(coalesce(record->'runtimeOutcome'->'taskReceipts', '[]'::jsonb)) r where r->>'taskId' = $1 limit 1) as receipt,
               (select r from jsonb_array_elements(coalesce(record->'runtimeOutcome'->'readerReadbacks', '[]'::jsonb)) r where r->>'contractId' = $1 limit 1) as readback,
               (select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements_text(coalesce(record->'lines', '[]'::jsonb)) l where l like 'Owner due request %') as due_lines
              from cp_log_owner_digests
             where record->'runtimeOutcome'->>'kind' = 'ROUTINE_CIVIC_DATA_SUPERVISOR'
               and (record->'runtimeOutcome'->>'startedAt')::timestamptz >= $2::timestamptz
             order by position`,
      params: [task.id, new Date(sinceMs - 10 * 60_000).toISOString()],
    },
    {
      name: "config",
      sql: `select coalesce(value->'routineDueRequests', '[]'::jsonb) as due,
               (select coalesce(jsonb_agg(r), '[]'::jsonb) from jsonb_array_elements(coalesce(value->'routineRefreshRequests', '[]'::jsonb)) r
                 where r->>'contractId' = $1 and (r->>'requestedAt')::timestamptz >= $2::timestamptz) as refreshes
              from cp_admin_config where id = 'current'`,
      params: [task.id, since],
    },
  ]);
} catch (error) {
  console.error(`refresh-schedule-probe · a read failed: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exit(2);
}

// The runner's own clock for this partition, through the read-only credential.
process.env.DATABASE_URL = productionUrl;
const clock: RoutineTaskClock = await new PostgresRoutineDataStore().clock(task.sourceId, "MEETING", task.scope);
const nowMs = Date.now();
const pointer = production.pointer![0];
const statedEnds = new Map<string, number>();
for (const pair of (Array.isArray(pointer?.sittings) ? pointer.sittings : []) as unknown[]) {
  if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" && Number.isFinite(Date.parse(pair[1]))) {
    statedEnds.set(pair[0], Math.max(Date.parse(pair[1]), statedEnds.get(pair[0]) ?? Number.NEGATIVE_INFINITY));
  }
}
const hot = sittingWindowSignals([{ task, ok: true, clock }], nowMs, new Map([[task.id, statedEnds]])).get(task.id);

const checks: { readonly name: string; readonly verdict: Verdict; readonly detail: string }[] = [];
const check = (name: string, verdict: Verdict, detail: string) => checks.push({ name, verdict, detail });

// 1. The request.
const due = parseRoutineDueRequests(control.config![0]?.due);
const request: RoutineDueRequest | undefined = requestId
  ? due.requests.find(({ id }) => id === requestId)
  : [...due.requests].reverse().find((row) => row.contractId === task.id && Date.parse(row.requestedAt) >= sinceMs - 60_000);
const requestedMs = request ? Date.parse(request.requestedAt) : sinceMs;
const requestState = request ? routineDueRequestState(request, clock, nowMs) : null;
if (!request) check("REQUEST", "FAIL", `no due request for ${task.id} on the owner's config row since ${mst(since)}`);
else {
  check("REQUEST", requestState === "SPENT" ? "PASS" : requestState === "WAITING" || requestState === "DUE" ? "WAITING" : "FAIL",
    `${request.id}: requested ${mst(request.requestedAt)}, due ${mst(request.dueAt)}, expires ${mst(request.expiresAt)}; now ${requestState}`);
}

// 3. The read: the first durable attempt at or after the request.
const confirmations = production.evidence!.filter((row) => text(row.detail).startsWith("UNCHANGED_CONFIRMATION_V1 "));
const attempts = [
  ...production.attempts!.map((row) => ({ at: Date.parse(text(row.at)), kind: text(row.state) === "PROMOTED" ? "NEW_VERSION" : `FAILED (${text(row.state)}${row.failure_code ? `: ${text(row.failure_code)}` : ""})`, candidateId: text(row.id), retrievedAt: text(row.retrieved_at) })),
  ...confirmations.map((row) => {
    const body = JSON.parse(text(row.detail).slice("UNCHANGED_CONFIRMATION_V1 ".length)) as { versionId: string; retrieval: { retrievedAt: string } };
    return { at: Date.parse(text(row.at)), kind: "UNCHANGED_CONFIRMATION", candidateId: body.versionId, retrievedAt: body.retrieval.retrievedAt };
  }),
].sort((left, right) => left.at - right.at);
const before = attempts.filter(({ at }) => at < requestedMs).at(-1);
const read = attempts.find(({ at }) => at >= requestedMs);
check("ACQUIRED", read ? "PASS" : "WAITING", read
  ? `${read.kind} at ${mst(read.at)} (retrieved ${mst(read.retrievedAt)}); the read before the request was ${before ? `${before.kind} at ${mst(before.at)}` : "older than the lookback"}`
  : `no attempt yet since the request at ${mst(requestedMs)}; the last was ${before ? `${before.kind} at ${mst(before.at)}` : "older than the lookback"}`);

// 2. Not a run-now shortcut, and read by an ordinary pass.
const refreshes = Array.isArray(control.config![0]?.refreshes) ? control.config![0]!.refreshes as unknown[] : [];
const passes = control.passes!;
const receiptCandidate = (row: Row): string => {
  const reference = row.receipt && typeof row.receipt === "object" ? row.receipt as Row : null;
  const body = reference?.receipt && typeof reference.receipt === "object" ? reference.receipt as Row : null;
  return text(body?.candidateId);
};
const readingPass = read ? passes.find((row) => receiptCandidate(row) === read.candidateId && Date.parse(text(row.finished)) >= read.at) : undefined;
const honoured = passes.find((row) => Array.isArray(row.due_lines) && (row.due_lines as unknown[]).some((line) => typeof line === "string" && line.includes(request?.id ?? "\u0000") && line.includes("admitted by this ordinary pass")));
check("NOT_RUN_NOW", refreshes.length > 0 ? "FAIL" : !read ? "WAITING" : honoured ? "PASS" : "FAIL", refreshes.length > 0
  ? `an owner refresh (run now) was requested for ${task.id} since ${mst(since)}: this is not the normal scheduler's read`
  : honoured
    ? `pass ${text(honoured.cycle)} (${mst(text(honoured.started))}, code ${text(honoured.sha).slice(0, 8)}, ${String(honoured.attempted)} task(s) attempted) admitted it as an ordinary pass`
    : read ? "the read happened, but no ordinary pass recorded admitting it for this request" : "waiting for the ordinary pass");

// 4. Published.
const receipt = readingPass?.receipt as Row | undefined;
const receiptBody = receipt?.receipt as Row | undefined;
if (!read) check("PUBLISHED", "WAITING", "no read yet");
else if (read.kind.startsWith("FAILED")) check("PUBLISHED", "FAIL", `the read failed at the source (${read.kind}); readers keep the last verified version and the retry clock owns the next attempt`);
else {
  const pointed = text(pointer?.current_version_id);
  const published = read.kind === "NEW_VERSION" ? production.evidence!.some((row) => text(row.candidate_id) === read.candidateId && text(row.detail).startsWith("Atomic pointer ")) : pointed === read.candidateId;
  check("PUBLISHED", published && receipt?.classification === "VERIFIED_SOURCE_SUCCESS" ? "PASS" : "FAIL",
    `${read.kind === "NEW_VERSION" ? `pointer moved to ${read.candidateId}` : `unchanged confirmation of the pointed version ${read.candidateId}`}; pointer now ${pointed}; pass receipt ${text(receipt?.classification) || "not found"}${receiptBody?.confirmedAt ? ` (confirmedAt ${mst(text(receiptBody.confirmedAt))})` : ""}`);
}

// 5. Reader delivery. The public Reader manifest is what readers are served;
// reading it writes nothing (no search row; the header marks the probe).
let publicManifest: Row | null = null;
let publicManifestError = "";
try {
  const response = await fetch(`${PUBLIC_SITE_ORIGIN}/api/reader/manifest`, { headers: { [SYNTHETIC_RUN_HEADER]: "refresh-schedule-probe" } });
  if (response.ok) publicManifest = await response.json() as Row;
  else publicManifestError = `HTTP ${response.status}`;
} catch (error) {
  publicManifestError = error instanceof Error ? error.message : String(error);
}
const snapshot = production.snapshot![0];
const member = snapshot?.member as Row | null | undefined;
const parseReadback = (detail: string): Row | null => {
  try { return JSON.parse(detail.slice("READER_PROJECTION_READBACK_V2 ".length)) as Row; } catch { return null; }
};
if (read && !read.kind.startsWith("FAILED")) {
  const served = text(member?.versionId);
  if (read.kind === "NEW_VERSION") {
    const readback = production.evidence!
      .filter((row) => text(row.candidate_id) === read.candidateId && text(row.detail).startsWith("READER_PROJECTION_READBACK_V2 "))
      .map((row) => parseReadback(text(row.detail)))
      .find((row) => row?.status === "PASS" && row.versionId === read.candidateId);
    // Composed from this version, or from a newer one that has since replaced it.
    const pointed = text(pointer?.current_version_id);
    const composed = served !== "" && (served === read.candidateId || (served === pointed && Date.parse(text(snapshot?.composed_at)) >= read.at));
    check("READER", readback && composed ? "PASS" : "WAITING",
      `readback ${readback ? `PASS at ${mst(text(readback.observedAt))}` : "not yet"}; Reader snapshot v${String(snapshot?.sequence)} composed ${mst(text(snapshot?.composed_at))} serves ${served || "no member"} for this partition`);
  } else {
    const newest = production.newestReadback![0] ? parseReadback(text(production.newestReadback![0].detail)) : null;
    const ok = served === read.candidateId && newest?.status === "PASS" && newest.versionId === read.candidateId;
    check("READER", ok ? "PASS" : "FAIL",
      `readers stay on ${read.candidateId}: snapshot v${String(snapshot?.sequence)} serves ${served || "no member"}; newest readback on it ${newest ? `${text(newest.status)} at ${mst(text(newest.observedAt))}` : "none"}`);
  }
  // What readers are told (lib/meetings/fresh-checks.ts): the public manifest's
  // "Last checked", and for a read that found nothing new, its route's check.
  const retrieved = Date.parse(read.retrievedAt);
  const lastChecked = Date.parse(text(publicManifest?.generatedAt));
  const partition = MEETING_PARTITION_CONTRACTS.find(({ id }) => id === task.id);
  const route = partition ? `${partition.meetingSource}|${partition.bodyId}` : "";
  const routeCheck = Date.parse(text((publicManifest?.freshChecks as Row | undefined)?.[route]));
  const delivered = lastChecked >= retrieved && (read.kind === "NEW_VERSION" || routeCheck >= retrieved);
  // The edge publish runs in the same pass's Reader repair, minutes after the read.
  const settling = nowMs - read.at < 15 * 60_000;
  check("CHECK_TIME_AT_READER", delivered ? "PASS" : settling ? "WAITING" : "FAIL",
    `public "Last checked" ${mst(lastChecked)}` +
      (read.kind === "NEW_VERSION" ? "" : `, this route's check ${Number.isFinite(routeCheck) ? mst(routeCheck) : "absent"}`) +
      `; this read retrieved at ${mst(read.retrievedAt)}`);
} else check("READER", read ? "FAIL" : "WAITING", read ? "a failed read publishes nothing new; readers keep the last verified version" : "no read yet");

// 6. The next due, from the runner's own clock and functions.
const deadline = routineTaskDeadlineMs(task, clock, hot);
const attempted = clock.lastAttemptedAt ? Date.parse(clock.lastAttemptedAt) : Number.NaN;
const succeeded = clock.lastSucceededObservedAt ? Date.parse(clock.lastSucceededObservedAt) : Number.NaN;
const period = hot === false ? 12 * HOUR : HOUR;
const expected = !Number.isFinite(attempted) ? Number.NEGATIVE_INFINITY
  : Number.isFinite(succeeded) && attempted <= succeeded ? succeeded + period
  : clock.sittingStarts === undefined ? attempted + Math.max(task.retryMs, MEETING_SITTING_WINDOW.baseEveryMs)
  : attempted + Math.min(task.retryMs, period);
if (!read) check("NEXT_DUE", "WAITING", `not read yet; the partition is ${hot === false ? "twice daily" : "hourly"} and owed by ${mst(deadline ?? Number.NaN)} without the request`);
else {
  const spent = requestState === "SPENT" || request === undefined;
  check("NEXT_DUE", deadline === expected && spent ? "PASS" : "FAIL",
    `${hot === false ? "twice daily" : hot ? "hourly" : "hourly (sittings unknown)"}; last read ${mst(attempted)}; next owed ${mst(deadline ?? Number.NaN)} ` +
      `(normal rule: ${mst(expected)}); due now: ${routineTaskDue(task, clock, nowMs, hot) ? "yes" : "no"}; request ${requestState ?? "none"}`);
}

// `--edge`: the edge serves the database's composition (the same, or a later, generation instant).
if (edge) {
  const edgeGenerated = Date.parse(text(publicManifest?.generatedAt));
  check("EDGE", publicManifest !== null && edgeGenerated >= Date.parse(text(snapshot?.generated_at)) ? "PASS" : publicManifest === null ? "FAIL" : "WAITING",
    publicManifest === null
      ? `the public manifest could not be read: ${publicManifestError}`
      : `public manifest: edge sequence ${String(publicManifest.sequence)}, generated ${mst(edgeGenerated)}; database snapshot v${String(snapshot?.sequence)} generated ${mst(text(snapshot?.generated_at))}`);
}

console.log(`refresh-schedule-probe · ${task.id}`);
console.log(`  lane ${task.acquisitionFailureDomain}; since ${mst(since)}; probed ${mst(nowMs)}`);
for (const { name, verdict, detail } of checks) console.log(`  ${verdict.padEnd(7)} ${name.padEnd(20)} ${detail}`);
console.log("REFRESH_PROBE=" + JSON.stringify({ contractId: task.id, since, probedAt: new Date(nowMs).toISOString(), requestId: request?.id ?? null, checks }));
process.exitCode = checks.some(({ verdict }) => verdict === "FAIL") ? 1 : checks.some(({ verdict }) => verdict === "WAITING") ? 3 : 0;
