import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireKnownRelease } from "../lib/sources/known-release.ts";
import { acquireStatePeople } from "../lib/sources/plural/acquisition.ts";
import { PLURAL_REVISION_URL } from "../lib/sources/plural/targets.ts";
import { acquireCongressSourceRevision } from "../lib/officials/congress-source-revision.ts";
import { refreshCongressDirectory } from "../scripts/fetch-congress-legislators.mts";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { allowedColumns } from "../lib/sources/prl/index.ts";
import { openPrlSource } from "../lib/sources/prl/fetch-source.ts";
import { ingestDataset } from "../lib/sources/prl/ingest.ts";
import { readReceipt, writeReceipt } from "../lib/sources/prl/holding.ts";
import { PRL_CONTRACT } from "../lib/sources/prl/data-plane.ts";
import { refreshPrl } from "../scripts/prl-refresh.mts";

const T0 = "2026-10-01T00:00:00.000Z", T1 = "2026-10-03T00:00:00.000Z", SHA = "a".repeat(40);
// A new handle shares only persisted objects; it cannot reuse process-local in-flight state.
const reopened = (store: EvidenceStore): EvidenceStore => ({ get: store.get.bind(store), put: store.put.bind(store),
  head: store.head.bind(store), list: store.list.bind(store) });
async function oldRevisionParser(store: EvidenceStore) {
  for (const key of await store.list("project/")) {
    if (!key.endsWith("/manifest.json")) continue;
    const held = (await store.get(key))!, index = JSON.parse(new TextDecoder().decode(held.bytes));
    if (!index.requestedUrl.includes("api.github.com")) continue;
    const bytes = new TextEncoder().encode(JSON.stringify({ ...index, parsers: ["old-revision-parser"] }));
    await store.put(key, bytes, { ...held.meta, byteLength: bytes.length });
  }
}

test("OpenStates replays the rich saved archive before discovery on parser change and keeps it during an outage after restart", async () => {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const archive = zip([{ name: `people-${SHA}/data/az/legislature/A.yml`, data: Buffer.from("id: ocd-person/one\nname: Alice Adams\nroles:\n  - type: lower\n    district: '1'\n") },
    { name: `people-${SHA}/data/az/executive/B.yml`, data: Buffer.from("id: ocd-person/two\nname: Betty Baker\nroles:\n  - type: governor\n    jurisdiction: ocd-jurisdiction/country:us/state:az/government\n") }], "2026-10-01");
  const base = { store, locks, state: "az", divisions: [], signal: AbortSignal.timeout(10_000), now: () => T0 };
  const first = await acquireStatePeople({ ...base, fetchImpl: async url => new Response(String(url) === PLURAL_REVISION_URL ? JSON.stringify([{ sha: SHA }]) : archive) });
  await oldRevisionParser(store);
  let requests = 0;
  const offline: typeof fetch = async () => { requests++; throw new TypeError("offline fixture"); };
  const replay = await acquireStatePeople({ ...base, store: reopened(store), now: () => T1, fetchImpl: offline });
  assert.equal(requests, 0); assert.deepEqual(replay.roster, first.roster);
  const checked = await acquireStatePeople({ ...base, store: reopened(store), now: () => T1, fetchImpl: offline });
  assert.equal(requests, 1, "only current revision is checked; no CSV detour or archive re-download");
  assert.deepEqual(checked.roster, first.roster); assert.equal(checked.acquisitions[0].retrievedAt, T0);
  assert.equal(checked.acquisitions[0].sourceCheck?.checkedAt, T0);
  assert.ok(checked.gaps.some(gap => gap.detail.includes("Fresh source check failed")));
  const indexes = await Promise.all((await store.list("project/")).filter(key => key.endsWith("/manifest.json")).map(key => store.get(key)));
  assert.ok(indexes.some(item => item && JSON.parse(new TextDecoder().decode(item.bytes)).failedSourceCheck?.at === T1));
  const recovered = await acquireStatePeople({ ...base, store: reopened(store), now: () => T1,
    fetchImpl: async () => new Response(null, { status: 304 }) });
  assert.equal(recovered.acquisitions[0].retrievedAt, T0);
  assert.equal(recovered.acquisitions[0].sourceCheck?.checkedAt, T1);
  assert.deepEqual(recovered.gaps, []);
});

test("the Congress runner publishes saved files with a failed fresh discovery check kept separate", async t => {
  t.mock.method(console, "log", () => {});
  const evidence = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), store = new MemoryRoutineDataStore();
  const files: Record<string, unknown> = {
    "legislators-current": [{ id: { bioguide: "A000001" }, name: { first: "Alice", last: "Adams" },
      terms: [{ type: "rep", state: "AZ", district: 1, start: "2025-01-03", end: "2027-01-03", phone: "202-225-1000" }] }],
    "legislators-social-media": [], "legislators-district-offices": [], "committees-current": [], "committee-membership-current": {},
  };
  let now = T0, offline = false, requests = 0;
  const fetchImpl: typeof fetch = async url => {
    requests++; if (offline) throw new TypeError("offline fixture");
    const path = String(url);
    return new Response(path.includes("api.github.com") ? JSON.stringify([{ sha: SHA }]) : JSON.stringify(files[path.split("/").at(-1)!.replace(".yaml", "")]));
  };
  const run = () => refreshCongressDirectory({ store, now: () => now,
    revision: () => acquireCongressSourceRevision({ store: reopened(evidence), locks, now: () => now, fetchImpl }),
    acquire: options => acquireKnownRelease({ ...options, store: reopened(evidence), locks, now: () => now, fetchImpl }),
    portraits: async projection => ({ projection, attempted: 0, excludedFacts: [] }) });
  await run(); assert.equal(requests, 6);
  await oldRevisionParser(evidence); now = T1; offline = true;
  await run(); assert.equal(requests, 6, "changed parser replays without discovery");
  await run(); assert.equal(requests, 7, "an overdue failed discovery check still permits held files");
  const saved = (await store.readPromotion<{ roster: { officeholders: { name: string }[] } }>("FEDERAL_DIRECTORY", "US:current-congress-directory"))!;
  assert.equal(saved.payload.roster.officeholders[0].name, "Alice Adams");
  const candidate = (await store.readCandidate(saved.versionId))!.candidate;
  assert.equal(candidate.retrieval.retrievedAt, T0); assert.equal(candidate.retrieval.sourceCheck?.checkedAt, T0);
  assert.ok(candidate.excludedFacts?.some(gap => gap.code === "CONGRESS_SOURCE_CHECK_FAILED"));
});

test("the PRL runner reparses saved bytes without network discovery and keeps published profiles through an outage", async t => {
  t.mock.method(console, "log", () => {});
  const root = await mkdtemp(join(tmpdir(), "prl-replay-runner-"));
  try {
    const archive = new LocalFileArchiveStore(root), dataset = requiredPrlDataset("profiles-national");
    const values: Record<string, string> = { bioguide_id: "A000001", full_name: "Alice Adams", communication_count: "10",
      communication_source: "Official statements", communication_last_update: "2026-09-30" };
    const cols = allowedColumns(), csv = `${cols.join(",")}\n${cols.map(key => values[key] ?? "10").join(",")}\n`;
    const body = zip([{ name: "profiles.csv", data: Buffer.from(csv) }], "2026-10-01");
    const first = await ingestDataset({ dataset, archive, now: Date.parse(T0), priorReceipt: null,
      open: () => openPrlSource(dataset, async () => new Response(body), archive, undefined, { now: () => T0 }) });
    await writeReceipt(archive, { ...first, parserVersion: "old-parser" });
    const store = new MemoryRoutineDataStore(); let requests = 0;
    const offline: typeof fetch = async () => { requests++; throw new TypeError("offline fixture"); };
    assert.equal(await refreshPrl({ archives: false, store, archive: new LocalFileArchiveStore(root), fetchImpl: offline }), 0);
    assert.equal(requests, 0); assert.equal((await readReceipt(archive, dataset.id))!.fetchedAt, T0);
    const before = await store.readPromotion("PRL_PROFILE", PRL_CONTRACT.scope);
    assert.ok(before);
    assert.equal(await refreshPrl({ archives: false, store, archive: new LocalFileArchiveStore(root), fetchImpl: offline }), 2);
    assert.equal(requests, 1); assert.deepEqual((await store.readPromotion("PRL_PROFILE", PRL_CONTRACT.scope))?.payload, before.payload);
    const receipt = (await readReceipt(archive, dataset.id))!;
    assert.equal(receipt.fetchedAt, T0); assert.ok(receipt.failedSourceCheck?.detail.includes("publisher request"));
    assert.equal(await refreshPrl({ archives: false, store, archive: new LocalFileArchiveStore(root),
      fetchImpl: async () => new Response(null, { status: 304 }) }), 0);
    const recovered = (await readReceipt(archive, dataset.id))!;
    assert.equal(recovered.fetchedAt, T0); assert.equal(recovered.failedSourceCheck, undefined);
    const source = JSON.parse(new TextDecoder().decode((await archive.get(`${dataset.id}/source.json`))!));
    assert.equal(source.failedSourceCheck, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
