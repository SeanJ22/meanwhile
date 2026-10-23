import assert from "node:assert/strict";
import test from "node:test";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { doorsFromWiringRow } from "../lib/doors/seed-meetings.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { readFactRosters } from "../lib/facts/roster-read.ts";
import { loadLegistarMembers } from "../lib/sources/legistar/members-cache.ts";
import { memberProbe } from "../lib/sources/legistar/members-model.ts";
import { publishLegistarMembers } from "../lib/sources/legistar/members-publication.ts";
import { refreshLegistarMembers } from "../lib/sources/legistar/members-refresh.ts";
import { factDb } from "./helpers/fact-db.ts";
import { NOW, rawFor, recordedMemberFetch, wiring } from "./helpers/legistar-member-fixtures.ts";

test("HTTP reads finish before publication is dated; identical full rereads confirm facts, while probes never restamp old bytes", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix");
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  const vault = new MemoryEvidenceStore(), calls: URL[] = [];
  const fetchSource = recordedMemberFetch(() => source, calls);
  const fetchImpl: typeof fetch = async (...args) => {
    t.mock.timers.tick(100);
    return fetchSource(...args);
  };
  const defaults = factClocks(null), clocks = { ...defaults, windowHours: () => 1 };
  const startedAt = new Date().toISOString();
  const first = await refreshLegistarMembers({ facts, clocks, now: startedAt, slug: "pima", vault, doors, fetchImpl });
  assert.ok(Date.parse(first.checkedAt) > Date.parse(startedAt), "the source's actual capture follows the pass start");
  assert.equal(first.members, 15);
  const firstChecks = await facts.query("SELECT id, checked_at FROM fact ORDER BY id");
  const copies = await facts.query("SELECT id, fetched_at, blob_key FROM source_copy ORDER BY id");
  assert.equal(copies.length, 2, "the body's name and its office records retain their own saved source pages");
  assert.ok((await readFactRosters(facts.query, rows.map(row => row.bodyId))).rosters.flatMap(row => row.members).some(member => member.name === "Rex Scott"));

  t.mock.timers.tick(2 * 3_600_000);
  const later = new Date().toISOString();
  calls.length = 0;
  const second = await refreshLegistarMembers({ facts, clocks, now: later, slug: "pima", vault, doors, fetchImpl });
  assert.equal(second.unchanged, true, "the member values remain exactly the same");
  assert.ok(calls.some(url => !memberProbe(url)), "the existing cache expiration fetches the full pages even when their contents are unchanged");
  assert.deepEqual(await facts.query("SELECT id, fetched_at, blob_key FROM source_copy ORDER BY id"), copies,
    "reading identical bytes again preserves the original immutable saved-copy row and fetched date");
  const secondChecks = await facts.query("SELECT id, checked_at FROM fact ORDER BY id");
  assert.equal(secondChecks.length, firstChecks.length);
  for (let index = 0; index < secondChecks.length; index++) {
    assert.equal(secondChecks[index].id, firstChecks[index].id);
    assert.ok(new Date(secondChecks[index].checked_at as string).getTime() > new Date(firstChecks[index].checked_at as string).getTime(),
      "fresh actual full evidence confirms the existing fact without creating another fact");
  }

  calls.length = 0;
  t.mock.timers.tick(1_000);
  const third = await refreshLegistarMembers({ facts, clocks, now: new Date().toISOString(), slug: "pima", vault, doors, fetchImpl });
  assert.equal(third.unchanged, true);
  assert.ok(calls.length > 0 && calls.every(memberProbe));
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM fact ORDER BY id"), secondChecks,
    "a fresh probe alone does not invent a new full capture or advance the facts' checked dates");
});

test("a Date-valued load clock retains milliseconds when comparing cached full evidence with a later load", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix");
  const vault = new MemoryEvidenceStore(), calls: URL[] = [];
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  await refreshLegistarMembers({ facts, clocks: factClocks(null), now: NOW, slug: "pima", vault, doors,
    fetchImpl: recordedMemberFetch(() => source, calls) });
  const raw = await (await loadLegistarMembers(vault, "pima"))!.read();
  const pageAt = Date.parse(NOW) + 300;
  raw.readings = raw.readings.map(reading => ({ ...reading, artifact: { ...reading.artifact, retrievedAt: new Date(pageAt).toISOString() } }));
  const [prior] = await facts.query("SELECT sha256 FROM fact_store_load WHERE source = $1", ["legistar-members:pima"]);
  let transactions = 0;
  const held = { query: async (text: string, params?: readonly unknown[]) => text === "SELECT sha256, loaded_at FROM fact_store_load WHERE source = $1"
    ? [{ sha256: prior.sha256, loaded_at: new Date(Date.parse(NOW) + 500) }] : facts.query(text, params),
    transaction: async <T>(work: (query: import("../lib/facts/publish.ts").Query) => Promise<T>) => { transactions++; return facts.transaction(work); } };
  const before = await facts.query("SELECT id, checked_at FROM fact ORDER BY id");
  const result = await publishLegistarMembers({ facts: held, vault, raw, rows, clocks: factClocks(null), now: new Date(Date.parse(NOW) + 1_000).toISOString() });
  assert.equal(result.unchanged, true);
  assert.equal(transactions, 0, "a .300 full capture is older than the Date-valued .500 load, not newer than a truncated whole second");
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM fact ORDER BY id"), before);
});

test("a stale-cache full reread that fails leaves existing facts dated at the last real complete read", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(NOW) });
  const facts = await factDb(); t.after(() => facts.pg.close());
  const source = rawFor("pima"), rows = wiring(source, "AZ", "America/Phoenix"), vault = new MemoryEvidenceStore();
  const doors = async () => rows.flatMap(row => doorsFromWiringRow(row).map(value => ({ value })));
  const clocks = { ...factClocks(null), windowHours: () => 1 }, calls: URL[] = [];
  const originalFetch = recordedMemberFetch(() => source, calls);
  await refreshLegistarMembers({ facts, clocks, now: NOW, slug: "pima", vault, doors, fetchImpl: originalFetch });
  const before = await facts.query("SELECT id, checked_at FROM fact ORDER BY id");
  t.mock.timers.tick(2 * 3_600_000);
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    return !memberProbe(url) && url.pathname.endsWith("officerecords") ? new Response("unavailable", { status: 500 }) : originalFetch(input, init);
  };
  await assert.rejects(refreshLegistarMembers({ facts, clocks, now: new Date().toISOString(), slug: "pima", vault, doors, fetchImpl }), /not a Legistar client/);
  assert.deepEqual(await facts.query("SELECT id, checked_at FROM fact ORDER BY id"), before);
});
