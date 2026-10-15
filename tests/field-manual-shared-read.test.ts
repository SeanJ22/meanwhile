import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { newFieldManualEntry, readFieldManualForPlaces, readFieldManualRows, writeFieldManual, type FieldManualQuery } from "../lib/control-plane/field-manual.ts";
import { scoutFieldManualQuery } from "../lib/control-plane/scheduler/field-manual-scout.ts";

/*
 * A cycle briefs every due place's Scout before dispatch. 17 read one manual slice per place and held them all, so a
 * cycle with ~1,700 due places built ~1,700 copies of the rows and Node aborted at its heap limit. The places now
 * share one read: each place's rows are the same row objects, narrowed to it, and each place still gets exactly the
 * rows, order, projection and evidence its own read gave it.
 */

const NOW = "2026-10-08T12:00:00.000Z";
const AZ = "ocd-division/country:us/state:az";
const PLACES = [
  `${AZ}/county:pima/place:tucson`, `${AZ}/county:pima/place:marana`, `${AZ}/county:graham/place:safford`,
  "ocd-division/country:us/state:nh/county:merrimack/place:concord", "ocd-division/country:us/state:nj/county:morris",
];

async function seeded() {
  const repos = createMemoryRepositories();
  const entries = [
    newFieldManualEntry("t", "everywhere", { role: "SCOUT", kind: "PLAYBOOK", title: "Scout playbook", summary: "s", outcome: "YIELDED" }),
    newFieldManualEntry("t", "shared", { role: "SHARED", kind: "LESSON", title: "Shared lesson", summary: "s", outcome: "YIELDED" }),
    newFieldManualEntry("t", "parser", { role: "PARSER", kind: "PLAYBOOK", title: "Parser only", summary: "s", outcome: "YIELDED" }),
    ...PLACES.map((place, i) => newFieldManualEntry("t", `door-${i}`, { role: "SCOUT", kind: "LESSON", title: `Door at ${place}`, summary: "s",
      outcome: "YIELDED", ocdIds: [place], states: [place.split("state:")[1]!.slice(0, 2)] })),
  ];
  assert.equal((await writeFieldManual(repos, entries, NOW)).error, undefined);
  return repos;
}

test("many places' Scout reads are one manual read, and each place's rows are the shared row objects", async () => {
  const repos = await seeded();
  let reads = 0;
  const slice = repos.fieldManual.slice.bind(repos.fieldManual);
  repos.fieldManual.slice = (query: FieldManualQuery) => { reads += 1; return slice(query); };
  const queries = Array.from({ length: 60 }, (_, i) => scoutFieldManualQuery({ subjectId: PLACES[i % PLACES.length]!, obligationId: `ob-${i}`, divisions: [PLACES[i % PLACES.length]!] }));

  const shared = await readFieldManualForPlaces(repos, { role: "SCOUT", everywhere: true }, queries);
  assert.equal(reads, 1, "one read for every place");
  assert.equal(shared.length, queries.length);
  const byId = new Map<string, object>();
  for (const read of shared) {
    assert.equal(read.error, undefined);
    assert.ok(read.store.entries.length > 0);
    for (const entry of read.store.entries) {
      const first = byId.get(entry.id) ?? entry;
      byId.set(entry.id, first);
      assert.equal(entry, first, `${entry.id} is one object across places, never a copy`);
    }
  }
  assert.ok(!byId.has(shared[0]!.store.entries.find((e) => e.role === "PARSER")?.id ?? "-"), "another role's rows are not handed to a Scout");

  reads = 0;
  for (const [i, query] of queries.entries()) {
    const own = await readFieldManualRows(repos, query);
    assert.deepEqual(shared[i]!.store.entries.map((e) => e.id), own.store.entries.map((e) => e.id), "the same rows in the same order");
    assert.deepEqual(shared[i]!.store.entries, own.store.entries);
    assert.deepEqual(shared[i]!.projection, own.projection);
    assert.deepEqual(shared[i]!.evidence ?? null, own.evidence ?? null);
  }
  assert.equal(reads, queries.length, "the per-place read it replaces reads once per place");
});

test("a failed shared read fails every place by name and holds nothing", async () => {
  const repos = await seeded();
  repos.fieldManual.slice = async () => { throw new Error("store unreachable"); };
  const reads = await readFieldManualForPlaces(repos, { role: "SCOUT", everywhere: true }, [scoutFieldManualQuery({ subjectId: PLACES[0]!, obligationId: "ob", divisions: [] })]);
  assert.equal(reads[0]!.error, "store unreachable");
  assert.deepEqual(reads[0]!.store.entries, []);
});
