import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { hotMeetingPartitions } from "../lib/doors/hot-partitions.ts";
import { MEETING_PARTITION_CONTRACTS, meetingPartitionId, meetingPartitionScope } from "../lib/civic-data/meeting-partitions.ts";
import { CivicPayloadParts } from "../lib/civic-data/payload-parts.ts";
import { routineTaskFromContract, sittingWindowSignals } from "../lib/civic-data/runner.ts";
import { meetingPayloadSittingStarts, sittingStartsRead } from "../lib/civic-data/store.ts";
import { meetingPayloadStatedEnds, statedSittingEndsByScope, statedSittingEndsRead } from "../lib/civic-data/sitting-window-admission.ts";
import type { Query } from "../lib/facts/publish.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const TASKS = MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract);

/** Each partition's whole published payload, its stored parts assembled: a payload that cannot be assembled reads as unknown. */
async function wholePayloads(pg: PGlite) {
  const parts = partsOf(pg);
  const reads = [];
  const ends = new Map<string, Map<string, number>>();
  for (const task of TASKS) {
    const [row] = (await pg.query<{ payload: unknown }>("SELECT payload FROM civic_data_promotions WHERE record_class = $1 AND scope = $2", ["MEETING", task.scope])).rows;
    const payload = row ? await parts.load(row.payload).catch((error: Error) => { assert.match(error.message, /CIVIC_PAYLOAD_PART_MISSING/); return undefined; }) : undefined;
    if (payload !== undefined) ends.set(task.id, meetingPayloadStatedEnds(payload));
    reads.push({ task, ok: true, clock: row ? { sittingStarts: payload === undefined ? undefined : meetingPayloadSittingStarts(payload) } : undefined });
  }
  return { reads, ends };
}

/** The JS rule over those whole payloads. */
function wholePayloadSelection({ reads, ends }: Awaited<ReturnType<typeof wholePayloads>>, nowMs: number): ReadonlySet<string> {
  return new Set([...sittingWindowSignals(reads, nowMs, ends)].filter(([, hot]) => hot !== false).map(([id]) => id));
}

function partsOf(pg: PGlite): CivicPayloadParts {
  return new CivicPayloadParts({
    existing: async (hashes) => (await pg.query<{ hash: string }>("SELECT hash FROM civic_data_payload_parts WHERE hash = ANY($1::text[])", [[...hashes]])).rows.map((row) => row.hash),
    write: async (rows) => { for (const row of rows) await pg.query("INSERT INTO civic_data_payload_parts VALUES ($1, $2) ON CONFLICT DO NOTHING", [row.hash, JSON.stringify(row.payload)]); },
    read: async (hashes) => (await pg.query<{ hash: string; payload: unknown }>("SELECT hash, payload FROM civic_data_payload_parts WHERE hash = ANY($1::text[])", [[...hashes]])).rows,
  });
}

async function fixture() {
  const pg = new PGlite();
  await pg.exec("CREATE TABLE civic_data_promotions (key text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL, payload jsonb NOT NULL)");
  await pg.exec("CREATE TABLE civic_data_payload_parts (hash text PRIMARY KEY, payload jsonb NOT NULL)");
  const parts = partsOf(pg);
  const put = async (recordClass: string, scope: string, payload: unknown) => pg.query(
    "INSERT INTO civic_data_promotions VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET payload = excluded.payload",
    [`${recordClass}:${scope}`, recordClass, scope, JSON.stringify(!(payload instanceof Held) ? payload
      : payload.listOnly ? { ...payload.value as object, meetings: await parts.store((payload.value as { meetings: unknown }).meetings) }
        : await parts.store(payload.value))]);
  const statements: string[] = [];
  const query: Query = async (text, params) => { statements.push(text); return (await pg.query<Record<string, unknown>>(text, params as unknown[])).rows; };
  return { pg, put, query, statements };
}

/** A payload published the way the store keeps a large one: in stored parts, the pointer holding only a reference (or, `listOnly`, an inline payload whose sitting list alone is held). */
class Held {
  readonly value: unknown;
  readonly listOnly: boolean;
  constructor(value: unknown, listOnly = false) { this.value = value; this.listOnly = listOnly; }
}
/** Agenda text past the inline limit, so the whole payload is held as a part. */
const agenda = ["a".repeat(40_000)];
const held = (...rows: unknown[]) => new Held({ meetings: rows, agendaDocuments: agenda });
/**
 * Sittings past the inline limit, so the list itself is held as groups of parts, one sitting large enough to be its own part.
 * The older sittings name the newer ones, so no two lists share a group.
 */
const heldList = (...rows: unknown[]) => new Held({
  meetings: [...Array.from({ length: 30 }, (_, index) => ({ startsAt: at(-60 * DAY - index * DAY), title: "t".repeat(20_000) + JSON.stringify(rows) })),
    ...rows.map((row) => ({ ...row as object, title: "u".repeat(40_000) }))],
  agendaDocuments: agenda,
});

const meetings = (...rows: unknown[]) => ({ meetings: rows });
const CASES: readonly [string, unknown][] = [
  ["starts in three days", meetings({ startsAt: at(3 * DAY) })],
  ["starts exactly at the window's edge", meetings({ startsAt: at(7 * DAY) })],
  ["starts just past the window", meetings({ startsAt: at(7 * DAY + 1) })],
  ["stated end inside the window", meetings({ startsAt: at(-10 * DAY), endsAt: at(-6 * DAY) })],
  ["no end: the day bound concludes it inside the window", meetings({ startsAt: at(-7 * DAY - 12 * 3_600_000) })],
  ["concluded nine days ago", meetings({ startsAt: at(-9 * DAY) })],
  ["stated end before its start: the day bound decides", meetings({ startsAt: at(-7 * DAY - 12 * 3_600_000), endsAt: at(-30 * DAY) })],
  ["stated end earlier than the day bound", meetings({ startsAt: at(-7 * DAY - 12 * 3_600_000), endsAt: at(-7 * DAY - 11 * 3_600_000) })],
  ["the later of two stated ends for one start", meetings({ startsAt: at(-10 * DAY), endsAt: at(-8 * DAY) }, { startsAt: at(-10 * DAY), endsAt: at(-6 * DAY) })],
  ["offset times", meetings({ startsAt: "2026-11-01T16:00:00-07:00", endsAt: "2026-11-01T18:00:00-07:00" }, { startsAt: "2026-12-10T00:00:00-07:00" })],
  ["no sittings", meetings()],
  ["payload held as a part that is missing", { $civicPayloadPart: "a".repeat(64) }],
  ["sittings without a string start", meetings({ startsAt: NOW + DAY }, { endsAt: at(DAY) }, null)],
  ["a date without a time", meetings({ startsAt: "2026-10-30" })],
  ["a time without an offset", meetings({ startsAt: "2026-11-20T10:00:00" }, { startsAt: "2026-10-19T10:00:00Z", endsAt: "2026-10-19T25:00:00Z" })],
  ["a day the calendar rolls over", meetings({ startsAt: "2026-11-31T10:00:00Z" })],
  ["an unreadable start", meetings({ startsAt: "next Tuesday" })],
  ["sub-millisecond digits", meetings({ startsAt: "2026-11-04T12:00:00.0004Z" })],
  ["held payload: starts in three days", held({ startsAt: at(3 * DAY) })],
  ["held payload: concluded nine days ago", held({ startsAt: at(-9 * DAY) })],
  ["held payload: stated end inside the window", held({ startsAt: at(-10 * DAY), endsAt: at(-6 * DAY) })],
  ["held payload: no sittings", held()],
  ["held payload: a date without a time", held({ startsAt: "2026-10-30" })],
  ["held list: the last sitting, its own part, starts tomorrow", heldList({ startsAt: at(DAY) })],
  ["held list: every sitting past", heldList({ startsAt: at(-20 * DAY), endsAt: at(-19 * DAY) })],
  ["held list: a group part is missing", heldList({ startsAt: at(-20 * DAY) })],
  ["held list: a stated end inside the window", heldList({ startsAt: at(-12 * DAY), endsAt: at(-5 * DAY) })],
  ["inline payload, held list: starts in five days", new Held((heldList({ startsAt: at(5 * DAY) }).value as { meetings: unknown }), true)],
  ["inline payload, held list: every sitting past", new Held((heldList({ startsAt: at(-30 * DAY) }).value as { meetings: unknown }), true)],
];

test("one statement selects exactly the hot partitions the rule selects over whole payloads, across inline, held, missing, never-read and changed partitions", async () => {
  assert.ok(TASKS.length >= CASES.length + 4, "enough meeting partitions for the fixture");
  const { pg, put, query, statements } = await fixture();
  for (const [index, [, payload]] of CASES.entries()) await put("MEETING", TASKS[index]!.scope, payload);
  // Lose one group of a held list: its partition cannot be read.
  const missingGroup = CASES.findIndex(([name]) => name === "held list: a group part is missing");
  const [{ hash }] = (await pg.query<{ hash: string }>(`SELECT p.hash FROM civic_data_promotions m, civic_data_payload_parts r, civic_data_payload_parts l,
    civic_data_payload_parts p WHERE m.scope = $1 AND r.hash = m.payload->>'$civicPayloadPart' AND l.hash = r.payload->'value'->'meetings'->>'$civicPayloadPart'
    AND p.hash = l.payload->'groups'->0->>'$civicPayloadPart'`, [TASKS[missingGroup]!.scope])).rows;
  await pg.query("DELETE FROM civic_data_payload_parts WHERE hash = $1", [hash]);
  // Another record class under a never-read partition's scope is not its sittings.
  await put("MEETING_OUTCOME", TASKS[CASES.length]!.scope, meetings({ startsAt: at(30 * DAY) }));

  let whole = await wholePayloads(pg);
  const compare = async (nowMs: number, label: string) => {
    statements.length = 0;
    const selected = await hotMeetingPartitions(query, nowMs);
    assert.equal(statements.length, 1, `${label}: one statement per pass`);
    assert.deepEqual([...selected].sort(), [...wholePayloadSelection(whole, nowMs)].sort(), label);
    return selected;
  };

  const hot = await compare(NOW, "now");
  const verdict = Object.fromEntries(CASES.map(([name], index) => [name, hot.has(TASKS[index]!.id)]));
  assert.deepEqual(verdict, {
    "starts in three days": true,
    "starts exactly at the window's edge": true,
    "starts just past the window": false,
    "stated end inside the window": true,
    "no end: the day bound concludes it inside the window": true,
    "concluded nine days ago": false,
    "stated end before its start: the day bound decides": true,
    "stated end earlier than the day bound": false,
    "the later of two stated ends for one start": true,
    "offset times": true,
    "no sittings": false,
    "payload held as a part that is missing": true,
    "sittings without a string start": false,
    "a date without a time": true,
    "a time without an offset": false,
    "a day the calendar rolls over": false,
    "an unreadable start": false,
    "sub-millisecond digits": true,
    "held payload: starts in three days": true,
    "held payload: concluded nine days ago": false,
    "held payload: stated end inside the window": true,
    "held payload: no sittings": false,
    "held payload: a date without a time": true,
    "held list: the last sitting, its own part, starts tomorrow": true,
    "held list: every sitting past": false,
    "held list: a group part is missing": true,
    "held list: a stated end inside the window": true,
    "inline payload, held list: starts in five days": true,
    "inline payload, held list: every sitting past": false,
  });
  for (const task of TASKS.slice(CASES.length)) assert.ok(hot.has(task.id), `${task.id} was never read, so it is hot`);

  for (let offset = -12 * DAY; offset <= 40 * DAY; offset += 7 * 3_600_000 + 7) await compare(NOW + offset, `now ${at(offset)}`);

  // Changes between passes: a cold partition gains a sitting, a hot one loses its own, a never-read one is published cold,
  // a held cold one gains a sitting and a held hot one loses its own.
  const task = (name: string) => TASKS[CASES.findIndex(([label]) => label === name)]!;
  await put("MEETING", TASKS[2]!.scope, meetings({ startsAt: at(DAY) }));
  await put("MEETING", TASKS[0]!.scope, meetings({ startsAt: at(60 * DAY) }));
  await put("MEETING", TASKS[CASES.length + 1]!.scope, meetings());
  await put("MEETING", task("held payload: concluded nine days ago").scope, held({ startsAt: at(2 * DAY) }));
  await put("MEETING", task("held list: the last sitting, its own part, starts tomorrow").scope, heldList({ startsAt: at(-40 * DAY) }));
  whole = await wholePayloads(pg);
  const changed = await compare(NOW, "after changes");
  assert.equal(changed.has(TASKS[2]!.id), true);
  assert.equal(changed.has(TASKS[0]!.id), false);
  assert.equal(changed.has(TASKS[CASES.length + 1]!.id), false);
  assert.equal(changed.has(task("held payload: concluded nine days ago").id), true);
  assert.equal(changed.has(task("held list: the last sitting, its own part, starts tomorrow").id), false);
  await pg.close();
});

test("the statement returns fingerprints and undecided sitting strings, never a stored record", async () => {
  const { pg, put, query } = await fixture();
  await put("MEETING", TASKS[0]!.scope, { ...meetings({ startsAt: at(30 * DAY), title: "x".repeat(10_000) }), agendaDocuments: ["y".repeat(10_000)] });
  await put("MEETING", TASKS[1]!.scope, meetings({ startsAt: "2026-10-30", title: "z".repeat(10_000) }));
  await put("MEETING", TASKS[2]!.scope, heldList({ startsAt: at(30 * DAY) }));
  await put("MEETING", TASKS[3]!.scope, heldList({ startsAt: "2026-10-30" }));
  const rows: Record<string, unknown>[] = [];
  await hotMeetingPartitions(async (text, params) => { const result = await query(text, params); rows.push(...result); return result; }, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["cold", "undecided"]);
  assert.ok(JSON.stringify(rows[0]).length < 2_000, "a cold partition costs its 8-byte fingerprint; an undecided one its sitting strings");
  assert.equal(Buffer.from(String(rows[0]!.cold), "base64").length, 16, "the held list's partition is cold by its sittings, read from its parts");
  assert.deepEqual(Object.keys(rows[0]!.undecided as object).sort(), [TASKS[1]!.scope, TASKS[3]!.scope].sort());
  await pg.close();
});

test("a statement that cannot be read leaves every meeting partition hot", async () => {
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (line: string) => { warnings.push(line); };
  try {
    const hot = await hotMeetingPartitions(async () => { throw new Error("database unavailable"); }, NOW);
    assert.equal(hot.size, TASKS.length);
    assert.match(warnings.join("\n"), /RCD_HOT_PARTITIONS CANNOT_TELL/);
    assert.equal((await hotMeetingPartitions(async () => [{ cold: "AAAA", undecided: {} }], NOW)).size, TASKS.length, "a malformed answer is unreadable");
  } finally {
    console.warn = warn;
  }
});

test("the scheduler's sitting reads see sittings held in stored parts exactly as whole payloads give them, each in one statement", async () => {
  const { pg, put } = await fixture();
  for (const [index, [, payload]] of CASES.entries()) await put("MEETING", TASKS[index]!.scope, payload);
  const missingGroup = CASES.findIndex(([name]) => name === "held list: a group part is missing");
  const [{ hash }] = (await pg.query<{ hash: string }>(`SELECT p.hash FROM civic_data_promotions m, civic_data_payload_parts r, civic_data_payload_parts l,
    civic_data_payload_parts p WHERE m.scope = $1 AND r.hash = m.payload->>'$civicPayloadPart' AND l.hash = r.payload->'value'->'meetings'->>'$civicPayloadPart'
    AND p.hash = l.payload->'groups'->0->>'$civicPayloadPart'`, [TASKS[missingGroup]!.scope])).rows;
  await pg.query("DELETE FROM civic_data_payload_parts WHERE hash = $1", [hash]);
  await put("MEETING_OUTCOME", TASKS[CASES.length]!.scope, meetings({ startsAt: at(30 * DAY), endsAt: at(31 * DAY) }));
  const statements: string[] = [];
  const db = drizzle(pg, { logger: { logQuery: (text) => { statements.push(text); } } });
  const parts = partsOf(pg);

  const ends = statedSittingEndsByScope(await statedSittingEndsRead(db));
  assert.equal(statements.length, 1, "every pointer's stated ends: one statement");
  const reads: { task: (typeof TASKS)[number]; ok: boolean; clock: { sittingStarts?: readonly string[] } }[] = [];
  for (const [index, [name]] of [...CASES, ["never read", null] as const, ["another record class", null] as const].entries()) {
    const task = TASKS[index]!;
    const [row] = (await pg.query<{ payload: unknown }>("SELECT payload FROM civic_data_promotions WHERE record_class = 'MEETING' AND scope = $1", [task.scope])).rows;
    const whole = row ? await parts.load(row.payload).catch((error: Error) => { assert.match(error.message, /CIVIC_PAYLOAD_PART_MISSING/); return undefined; }) : undefined;
    statements.length = 0;
    const [read] = await sittingStartsRead(db, task.scope);
    assert.equal(statements.length, 1, `${name}: one statement`);
    if (!row) { assert.equal(read, undefined, `${name}: no pointer, no row`); continue; }
    const starts = read!.starts;
    if (whole === undefined) {
      assert.equal(starts, null, `${name}: a missing part leaves the sittings unknown, so the partition counts as hot`);
      assert.equal(ends.has(task.scope), false, `${name}: no stated ends from a payload that cannot be read`);
    } else {
      assert.deepEqual([...starts as string[]].sort(), [...meetingPayloadSittingStarts(whole)].sort(), `${name}: starts`);
      const stated = meetingPayloadStatedEnds(whole);
      assert.deepEqual(Object.fromEntries(ends.get(task.scope) ?? new Map()), Object.fromEntries(stated), `${name}: stated ends`);
    }
    reads.push({ task, ok: true, clock: { sittingStarts: Array.isArray(starts) ? starts as string[] : undefined } });
  }
  assert.ok(JSON.stringify(await statedSittingEndsRead(db)).length < 4_000, "only start and end strings cross, never a payload or part");
  // The scheduler's signals from these reads are the rule's over whole payloads.
  const whole = await wholePayloads(pg);
  const endsByTask = new Map(TASKS.flatMap((task) => ends.has(task.scope) ? [[task.id, ends.get(task.scope)!] as const] : []));
  for (let offset = -12 * DAY; offset <= 40 * DAY; offset += 11 * 3_600_000 + 13) {
    const nowMs = NOW + offset;
    const signals: ReadonlyMap<string, boolean | undefined> = new Map([...sittingWindowSignals(reads, nowMs, endsByTask)].filter(([id]) => reads.some((read) => read.task.id === id)));
    const expected: ReadonlyMap<string, boolean | undefined> = new Map([...sittingWindowSignals(whole.reads, nowMs, whole.ends)].filter(([id]) => signals.has(id)));
    assert.deepEqual(signals, expected, `signals at ${at(offset)}`);
  }
  await pg.close();
});

test("a door's own meeting partition is decided by the same rule though this process never installed the door", async () => {
  const { pg, put, query, statements } = await fixture();
  const body = (name: string) => `ocd-division/country:us/state:az/place:${name}#board`;
  const soon = meetingPartitionId("legistar", body("soon")), past = meetingPartitionId("legistar", body("past"), "0123456789abcdef");
  const unread = meetingPartitionId("legistar", body("unread")), heldId = meetingPartitionId("civicclerk", body("held"));
  assert.ok(![soon, past, unread, heldId].some((id) => MEETING_PARTITION_CONTRACTS.some((partition) => partition.id === id)), "none is a registered contract here");
  await put("MEETING", meetingPartitionScope("legistar", body("soon")), meetings({ startsAt: at(DAY) }));
  await put("MEETING", meetingPartitionScope("legistar", body("past"), "0123456789abcdef"), meetings({ startsAt: at(-30 * DAY) }));
  await put("MEETING", meetingPartitionScope("civicclerk", body("held")), held({ startsAt: at(2 * DAY) }));
  const hot = await hotMeetingPartitions(query, NOW, [soon, past, unread, heldId, "campaign-finance-source", TASKS[0]!.id]);
  assert.equal(statements.length, 1, "one statement for every partition");
  assert.deepEqual([...hot].sort(), [soon, unread, heldId, TASKS[0]!.id].sort(), "a sitting tomorrow, one held in parts, and never-read partitions are hot; a month-old one is not; a feed is no meeting partition");
  await pg.close();
});
