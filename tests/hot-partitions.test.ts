import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { hotMeetingPartitions } from "../lib/doors/hot-partitions.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { routineTaskFromContract, sittingWindowSignals } from "../lib/civic-data/runner.ts";
import { sittingStartsRead } from "../lib/civic-data/store.ts";
import { statedSittingEndsByScope, statedSittingEndsRead } from "../lib/civic-data/sitting-window-admission.ts";
import type { Query } from "../lib/facts/publish.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const at = (ms: number) => new Date(NOW + ms).toISOString();
const TASKS = MEETING_PARTITION_CONTRACTS.map(routineTaskFromContract);

/** The per-task path this replaces: each partition's own clock sittings, the stated ends, then the window rule. */
async function perTaskClockSelection(pg: PGlite, nowMs: number): Promise<ReadonlySet<string>> {
  const db = drizzle(pg);
  const reads = [];
  for (const task of TASKS) {
    const [present] = (await pg.query("SELECT 1 FROM civic_data_promotions WHERE record_class = $1 AND scope = $2", ["MEETING", task.scope])).rows;
    const [row] = present ? await sittingStartsRead(db as never, task.scope) : [];
    const starts = Array.isArray(row?.starts) ? row.starts.filter((start): start is string => typeof start === "string") : undefined;
    reads.push({ task, ok: true, clock: present ? { sittingStarts: starts } : undefined });
  }
  const byScope = statedSittingEndsByScope(await statedSittingEndsRead(db));
  const ends = new Map(TASKS.flatMap((task) => byScope.has(task.scope) ? [[task.id, byScope.get(task.scope)!] as const] : []));
  return new Set([...sittingWindowSignals(reads, nowMs, ends)].filter(([, hot]) => hot !== false).map(([id]) => id));
}

async function fixture() {
  const pg = new PGlite();
  await pg.exec("CREATE TABLE civic_data_promotions (key text PRIMARY KEY, record_class text NOT NULL, scope text NOT NULL, payload jsonb NOT NULL)");
  const put = (recordClass: string, scope: string, payload: unknown) => pg.query(
    "INSERT INTO civic_data_promotions VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO UPDATE SET payload = excluded.payload",
    [`${recordClass}:${scope}`, recordClass, scope, JSON.stringify(payload)]);
  const statements: string[] = [];
  const query: Query = async (text, params) => { statements.push(text); return (await pg.query<Record<string, unknown>>(text, params as unknown[])).rows; };
  return { pg, put, query, statements };
}

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
  ["payload held as a part", { $civicPayloadPart: "a".repeat(64) }],
  ["sittings without a string start", meetings({ startsAt: NOW + DAY }, { endsAt: at(DAY) }, null)],
  ["a date without a time", meetings({ startsAt: "2026-10-30" })],
  ["a time without an offset", meetings({ startsAt: "2026-11-20T10:00:00" }, { startsAt: "2026-10-19T10:00:00Z", endsAt: "2026-10-19T25:00:00Z" })],
  ["a day the calendar rolls over", meetings({ startsAt: "2026-11-31T10:00:00Z" })],
  ["an unreadable start", meetings({ startsAt: "next Tuesday" })],
  ["sub-millisecond digits", meetings({ startsAt: "2026-11-04T12:00:00.0004Z" })],
];

test("one statement selects exactly the hot partitions the per-task clocks did, across hot, cold, never-read and changed partitions", async () => {
  assert.ok(TASKS.length >= CASES.length + 4, "enough meeting partitions for the fixture");
  const { pg, put, query, statements } = await fixture();
  for (const [index, [, payload]] of CASES.entries()) await put("MEETING", TASKS[index]!.scope, payload);
  // Another record class under a never-read partition's scope is not its sittings.
  await put("MEETING_OUTCOME", TASKS[CASES.length]!.scope, meetings({ startsAt: at(30 * DAY) }));

  const compare = async (nowMs: number, label: string) => {
    statements.length = 0;
    const selected = await hotMeetingPartitions(query, nowMs);
    assert.equal(statements.length, 1, `${label}: one statement per pass`);
    assert.deepEqual([...selected].sort(), [...await perTaskClockSelection(pg, nowMs)].sort(), label);
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
    "payload held as a part": false,
    "sittings without a string start": false,
    "a date without a time": true,
    "a time without an offset": false,
    "a day the calendar rolls over": false,
    "an unreadable start": false,
    "sub-millisecond digits": true,
  });
  for (const task of TASKS.slice(CASES.length)) assert.ok(hot.has(task.id), `${task.id} was never read, so it is hot`);

  for (let offset = -12 * DAY; offset <= 40 * DAY; offset += 7 * 3_600_000 + 7) await compare(NOW + offset, `now ${at(offset)}`);

  // Changes between passes: a cold partition gains a sitting, a hot one loses its own, a never-read one is published cold.
  await put("MEETING", TASKS[2]!.scope, meetings({ startsAt: at(DAY) }));
  await put("MEETING", TASKS[0]!.scope, meetings({ startsAt: at(60 * DAY) }));
  await put("MEETING", TASKS[CASES.length + 1]!.scope, meetings());
  const changed = await compare(NOW, "after changes");
  assert.equal(changed.has(TASKS[2]!.id), true);
  assert.equal(changed.has(TASKS[0]!.id), false);
  assert.equal(changed.has(TASKS[CASES.length + 1]!.id), false);
  await pg.close();
});

test("the statement returns fingerprints and undecided sitting strings, never a stored record", async () => {
  const { pg, put, query } = await fixture();
  await put("MEETING", TASKS[0]!.scope, { ...meetings({ startsAt: at(30 * DAY), title: "x".repeat(10_000) }), agendaDocuments: ["y".repeat(10_000)] });
  await put("MEETING", TASKS[1]!.scope, meetings({ startsAt: "2026-10-30", title: "z".repeat(10_000) }));
  const rows: Record<string, unknown>[] = [];
  await hotMeetingPartitions(async (text, params) => { const result = await query(text, params); rows.push(...result); return result; }, NOW);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]!).sort(), ["cold", "undecided"]);
  assert.ok(JSON.stringify(rows[0]).length < 400, "a cold partition costs its 8-byte fingerprint; an undecided one its sitting strings");
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
