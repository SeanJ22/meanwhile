import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceTextWithoutNuls } from "../lib/doors/source-text.ts";
import { recordSourceObservation } from "../lib/doors/source-capture.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { currentVotingSourceDoors, votingAcquisitionDeadline, votingReadHasFacts } from "../scripts/fetch-voting-sites.mts";
import { combineVotingSourceReads, mergeVotingSourceRead, saveVotingSourceDoor, votingSourceReadOrder, recordVotingSourceRead } from "../lib/ballot/voting-source-publication.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const now = "2026-10-23T08:00:00.000Z";
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const door = doors.find(row => row.url === "https://vip.sos.nd.gov/Precincts.aspx?eid=348")!;
const bytes = readFileSync("tests/fixtures/voting-sources/nd-2026-native.html");

test("decoded NULs never enter source notes or doors while original bytes remain exact", async () => {
  const repos = createMemoryRepositories();
  const native = new TextEncoder().encode("Polling\0places");
  let saved: Uint8Array | null = null;
  await recordSourceObservation(repos, { url: door.url, ocdId: door.scope.ocdId, state: "ND", names: ["North\0 Dakota"],
    disposition: { kind: "EVIDENCE", family: "voting", recordClass: "VOTING_SITE", belongs: true, quote: "Polling\0 places", reason: "Official\0 list" },
    capture: { contentType: "text/plain", bytes: native } }, now, { putBytes: async (_artifact, body) => { saved = body; return { stored: true, where: "test", why: "saved" }; } });
  assert.strictEqual(saved, native);
  assert.ok(!(JSON.stringify(await repos.fieldManual.list())).includes("\\u0000"));
  await saveVotingSourceDoor(repos.doors, { ...door, title: "Polling\0 list", office: { name: "Election\0 office" } }, now);
  assert.ok(!(JSON.stringify(await repos.doors.list())).includes("\\u0000"));
  assert.strictEqual(sourceTextWithoutNuls({ bytes: native }).bytes, native);
});

test("decoded NULs are cleaned after extraction before projection hashes", async () => {
  const read = await readVotingSource(door, { now: () => now, fetch: (async () => new Response(bytes, { headers: { "content-type": "text/html" } })) as typeof fetch });
  const tainted = { ...read, sites: read.sites.map(site => ({ ...site, name: site.name + "\0" })), fileTitle: "Official\0 list" };
  assert.equal(votingReadHasFacts({ ...door, url: "https://unlinked.example.org/voting", officialLinkingPage: undefined }, read), false, "a previously published sibling cannot establish an unlinked vendor source's authority");
  const combined = combineVotingSourceReads([tainted]);
  assert.equal(combined.sites[0]!.name, read.sites[0]!.name);
  assert.ok(!JSON.stringify(mergeVotingSourceRead(undefined, door, tainted, now)).includes("\\u0000"));
  assert.strictEqual(combined.rawBodies[0]!.bytes, read.rawBodies[0]!.bytes);
});

test("next scheduled pass starts with the untried list and keeps a newer verified route", async () => {
  const repos = createMemoryRepositories();
  const sources = [door, { ...door, id: "next-official-list", url: "https://vip.sos.nd.gov/other-list" }];
  for (const source of sources) await saveVotingSourceDoor(repos.doors, source, now);
  const read = await readVotingSource(door, { now: () => now, fetch: (async () => new Response(bytes, { headers: { "content-type": "text/html" } })) as typeof fetch });
  await recordVotingSourceRead(repos.doors, door, read, now);
  assert.equal((await votingSourceReadOrder(repos.doors, "ND", sources))[0]!.id, sources[1]!.id);
  const older = { ...door, access: { status: "open" as const, checkedAt: "2026-10-13", detail: "Earlier parser" } };
  const newer = { ...door, access: { status: "open" as const, checkedAt: "2026-10-23", detail: "Current parser" } };
  assert.equal(currentVotingSourceDoors([newer], [older])[0], newer);
  assert.equal(currentVotingSourceDoors([older], [newer])[0], newer);
});

test("source transports abort inside their slot even if a caller supplies an unbounded signal", async () => {
  let requests = 0;
  const session = votingFetchSession({ deadlineMs: Date.now() + 35, fetch: (async (_url, init) => {
    requests++;
    return await new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true }));
  }) as typeof fetch });
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const started = Date.now();
    await assert.rejects(session.get(door.url, { signal: new AbortController().signal }));
    assert.ok(Date.now() - started < 1000);
    assert.equal(requests, 1, "a timed-out robots read cannot launch a late source request");
  } finally { clearInterval(keepAlive); }
  const start = Date.parse(now);
  assert.equal(votingAcquisitionDeadline(start), start + 20 * 60_000);
  assert.ok(votingAcquisitionDeadline(start, start + 60_000) < start + 60_000);
});

test("the scheduled job reads a known HTML list before discovery and keeps it on tomorrow's pass", async (t) => {
  const { refreshVotingSources } = await import("../scripts/fetch-voting-sites.mts");
  const { MemoryRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const { cycleVault } = await import("../lib/control-plane/scheduler/vault.ts");
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { readVotingSitesProjection } = await import("../lib/ballot/voting-sites-server.ts");
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const root = await mkdtemp(join(tmpdir(), "vs07-job-"));
  const requests: string[] = [];
  const fetchSource = (async input => {
    const url = String(input); requests.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    return url === door.url ? new Response(bytes, { headers: { "content-type": "text/html" } }) : new Response(null, { status: 404 });
  }) as typeof fetch;
  try {
    let yesterday: string[] = [], clock = Date.parse(now);
    t.mock.method(Date, "now", () => clock);
    for (const at of [now, "2026-10-24T08:00:00.000Z"]) {
      clock = Date.parse(at);
      const report = await refreshVotingSources({ state: "ND", store, context: { repos }, now: () => at,
        deadlineMs: Date.now() + 10_000, fetch: fetchSource, geocode: async () => null,
        registry: { divisions: [], bodies: [] }, vault: cycleVault(root), seeds: [door] });
      assert.ok(report.terminal?.acquisitionSucceeded);
      assert.equal(report.attemptedSourceIds[0], door.id);
      const reader = await readVotingSitesProjection("ND", { store, now: at, bypassCache: true });
      assert.equal(reader.kind, "PROMOTED");
      if (reader.kind !== "PROMOTED") continue;
      const sites = reader.value.jurisdictions.flatMap(row => row.sites);
      assert.equal(sites.length, 26);
      const ids = sites.map(site => site.id);
      if (yesterday.length) assert.deepEqual(ids, yesterday);
      yesterday = ids;
    }
    assert.equal(requests[1], door.url);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("cleaned source metadata passes the actual PostgreSQL JSONB NUL constraint", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const source = { quote: "Polling\0 places", nested: [{ hours: "7\0am" }] };
    await assert.rejects(db.query("SELECT $1::jsonb AS source", [JSON.stringify(source)]), /unsupported Unicode escape sequence/);
    const saved = await db.query<{ source: typeof source }>("SELECT $1::jsonb AS source", [JSON.stringify(sourceTextWithoutNuls(source))]);
    assert.equal(saved.rows[0]!.source.quote, "Polling places");
    assert.equal(saved.rows[0]!.source.nested[0]!.hours, "7am");
  } finally { await db.close(); }
});
