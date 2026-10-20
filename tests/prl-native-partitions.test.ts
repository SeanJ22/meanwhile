import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { zip } from "../scripts/xlsx.mjs";
import { refreshPrl } from "../scripts/prl-refresh.mts";
import { ingestDataset, prlSubjectShard } from "../lib/sources/prl/ingest.ts";
import { LocalFileArchiveStore } from "../lib/sources/prl/archive-store-local.ts";
import type { PrlArchiveStore } from "../lib/sources/prl/archive-store.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { prlProfileForSubject } from "../lib/sources/prl/snapshot.ts";
import { readPrlPerson } from "../lib/sources/prl/reader.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { PRL_CONTRACT } from "../lib/sources/prl/data-plane.ts";
import type { PrlSnapshot } from "../lib/sources/prl/types.ts";
import { PGlite } from "@electric-sql/pglite";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { PRL_RHETORIC_ATTRIBUTION } from "../lib/sources/prl/types.ts";
import { PRL_ARCHIVE_SCOPE, type PrlArchiveProjection } from "../lib/sources/prl/archive-publication.ts";

const NOW = Date.parse("2026-10-20T00:00:00Z");
const header = "bioguide_id,full_name,communication_count,communication_source,communication_last_update,communication_policy_mean,communication_outcome_bipartisanship_mean,communication_outcome_creditclaiming_mean,communication_attack_policy_mean,communication_attack_personal_mean\n";
const row = (id: number) => `A${String(id).padStart(6, "0")},Member ${id},100,all,2026-10-19,50,5,20,20,5\n`;

test("a complete PRL profile source publishes a bounded release and reads exactly one native person", async () => {
  const root = await mkdtemp(join(tmpdir(), "prl-release-test-"));
  const archive = new LocalFileArchiveStore(root), store = new MemoryRoutineDataStore();
  try {
    const csv = await readFile(new URL("./fixtures/prl/profiles-national.csv", import.meta.url), "utf8");
    const bytes = zip([{ name: "profiles.csv", data: Buffer.from(csv) }], "2026-10-19");
    const code = await refreshPrl({ archives: false, store, archive,
      fetchImpl: (async () => new Response(bytes, { headers: { "content-length": String(bytes.length) } })) as typeof fetch });
    const latest = await store.latestCandidate("prl", "PRL_PROFILE", PRL_CONTRACT.scope);
    assert.equal(code, 0, latest ? (await store.readCandidate(latest.id))?.failureDetail ?? latest.failureCode ?? "publication failed" : "no source candidate");
    const publication = await store.readPromotion<PrlSnapshot>("PRL_PROFILE", PRL_CONTRACT.scope);
    assert.ok(publication);
    assert.deepEqual(publication.payload.profiles, []);
    assert.equal(publication.payload.releases?.length, 1);
    assert.ok(JSON.stringify(publication.payload).length < 2048, "only the completed source root and counts enter the canonical release");
    const reads: string[] = [];
    const get = archive.get.bind(archive);
    archive.get = async key => { reads.push(key); return get(key); };
    archive.list = async () => { throw new Error("A person reader cannot list an archive"); };
    const profile = await prlProfileForSubject("congress:C000127", { store, archive, bypassCache: true });
    assert.equal(profile?.bioguideId, "C000127");
    assert.equal(profile?.statementCount, 16141);
    assert.equal(reads.length, 1);
    assert.ok(reads.every(key => key.includes(`/people/${prlSubjectShard("C000127")}/`)));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("profile source growth changes disk rows and object count while retained receipts and writes stay bounded", async () => {
  const run = async (count: number) => {
    let puts = 0, largestObject = 0;
    const archive: PrlArchiveStore = { kind: "local-file", async put(key, body) {
      puts++; largestObject = Math.max(largestObject, body.byteLength); return { key, size: body.byteLength };
    }, async head() { return null; }, async get() { throw new Error("Ingest cannot read another person's profile"); }, async list() { throw new Error("Ingest cannot list the country"); } };
    const receipt = await ingestDataset({ dataset: requiredPrlDataset("profiles-national"), archive, now: NOW, priorReceipt: null,
      open: async () => ({ textChunks: (async function* () { yield header; for (let id = 1; id <= count; id++) yield row(id); })(),
        sourceSha256: "a".repeat(64), finalUrl: requiredPrlDataset("profiles-national").url, member: "profiles.csv" }) });
    assert.equal(receipt.subjectCount, count);
    assert.equal(receipt.profiles, null);
    assert.equal(puts, count);
    assert.ok(largestObject < 1024);
    assert.ok(JSON.stringify(receipt).length < 1800);
    return JSON.stringify(receipt).length;
  };
  const small = await run(20), large = await run(5000);
  assert.ok(large - small < 32, "the receipt size grows only by the digits in its counters");
});

test("primary summaries are finalized one candidate at a time and loaded by exact native key", async () => {
  const root = await mkdtemp(join(tmpdir(), "prl-primary-test-"));
  const archive = new LocalFileArchiveStore(root);
  try {
    const csv = "id,candidate_id,name,party,state,office_full,district,incumbent_challenge,date,policy,outcome_bipartisanship,outcome_creditclaiming,attack_policy,attack_personal,text,source_url\n" +
      "1,H0AZ00001,One,Party,AZ,House,1,C,2026-10-18,1,0,0,0,0,First,https://example.gov/1\n" +
      "2,H0AZ00001,One,Party,AZ,House,1,C,2026-10-19,0,0,0,1,0,Second,https://example.gov/2\n" +
      "3,H0NJ00002,Two,Party,NJ,House,2,C,2026-10-18,1,0,0,0,0,Other,https://example.gov/3\n";
    const receipt = await ingestDataset({ dataset: requiredPrlDataset("primary-rhetoric"), archive, now: NOW, priorReceipt: null,
      open: async () => ({ textChunks: (async function* () { yield csv; })(), sourceSha256: createHash("sha256").update(csv).digest("hex"),
        finalUrl: requiredPrlDataset("primary-rhetoric").url, member: "primary.csv" }) });
    assert.equal(receipt.profiles, null);
    const read = await readPrlPerson({ candidateId: "H0AZ00001" }, { archive, now: NOW, projection: { formatVersion: 1, datasets: { "primary-rhetoric": receipt } } });
    assert.equal(read.summaries.length, 1);
    assert.equal(read.summaries[0].profile.statementCount, 2);
    assert.equal(read.summaries[0].profile.shares.policy, 50);
    assert.equal(read.statements.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the complete archive refresh publishes seven bounded roots with independent person summaries", async () => {
  const root = await mkdtemp(join(tmpdir(), "prl-all-releases-test-"));
  const archive = new LocalFileArchiveStore(root), store = new MemoryRoutineDataStore();
  const stateId = "ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604";
  try {
    const profile = "openstates_id,name,state,party,position,district,communication_count,communication_attack_personal_mean,communication_attack_policy_mean,communication_outcome_creditclaiming_mean,communication_policy_mean,communication_outcome_bipartisanship_mean\n" + `${stateId},One,AZ,Party,lower,1,100,5,20,20,50,5\n`;
    const primary = "id,candidate_id,name,party,state,office_full,district,incumbent_challenge,date,policy,outcome_bipartisanship,outcome_creditclaiming,attack_policy,attack_personal,text,source_url\n" + "1,H0AZ00001,One,Party,AZ,House,1,C,2026-10-18,1,0,0,0,0,Statement,https://example.gov/primary\n";
    const state = `id,openstates_id,date,last_updated,text,source_url\n1,${stateId},2026-10-18,2026-10-18,State statement,https://example.gov/state\n`;
    const federal = "id,bioguide_id,date,last_updated,text,source_url\n1,A000001,2026-10-18,2026-10-18,Federal statement,https://example.gov/federal\n";
    const text = JSON.stringify([{ id: 1, bioguide_id: "A000001", date: "2026-10-18", text: "A complete statement.", source_url: "https://example.gov/speech" }]);
    const ids = ["profiles-state", "primary-rhetoric", "state-rhetoric", "statements-national", "newsletters", "press-releases", "floor-speeches"];
    const code = await refreshPrl({ archives: true, store, archive, fetchImpl: (async (input: string | URL | Request) => {
      const id = ids.find(id => requiredPrlDataset(id).url === String(input));
      assert.ok(id);
      const dataset = requiredPrlDataset(id);
      const raw = id === "profiles-state" ? profile : id === "primary-rhetoric" ? primary : id === "state-rhetoric" ? state : id === "statements-national" ? federal : text;
      const body = zip([{ name: dataset.format === "json-zip" ? "rows.json" : "rows.csv", data: Buffer.from(raw) }], "2026-10-19");
      return new Response(body, { headers: { "content-length": String(body.length) } });
    }) as typeof fetch });
    const latest = await store.latestCandidate("prl", "PRL_ARCHIVE", PRL_ARCHIVE_SCOPE);
    assert.equal(code, 0, latest ? (await store.readCandidate(latest.id))?.failureDetail ?? "publication failed" : "no archive candidate");
    const published = await store.readPromotion<PrlArchiveProjection>("PRL_ARCHIVE", PRL_ARCHIVE_SCOPE);
    assert.ok(published);
    assert.equal(Object.keys(published.payload.datasets).length, 7);
    assert.ok(Object.values(published.payload.datasets).every(receipt => receipt.profiles === null && receipt.subjectCount === 1 && receipt.objectRoot));
    assert.ok(JSON.stringify(published.payload).length < 12000);
    const person = await readPrlPerson({ openstatesId: stateId, candidateId: "H0AZ00001" }, { store, archive, now: NOW });
    assert.deepEqual(person.summaries.map(summary => summary.kind).sort(), ["primary", "state"]);
    assert.equal(person.statements.length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a truncated profile or conflicting native identity cannot publish any person objects", async () => {
  for (const csv of [header + row(1) + 'A000002,"unfinished', header + row(1) + row(1).replace(",100,", ",101,")]) {
    let writes = 0, accepted = false;
    const archive: PrlArchiveStore = { kind: "local-file", async put(key, body) { writes++; return { key, size: body.length }; }, async head() { return null; }, async get() { return null; }, async list() { return []; } };
    await assert.rejects(ingestDataset({ dataset: requiredPrlDataset("profiles-national"), archive, now: NOW, priorReceipt: null,
      open: async () => ({ textChunks: (async function* () { yield csv; })(), sourceSha256: "b".repeat(64), finalUrl: requiredPrlDataset("profiles-national").url,
        member: "profiles.csv", accept: async () => { accepted = true; } }) }), /TRUNCATED|CONFLICT/);
    assert.equal(writes, 0);
    assert.equal(accepted, false);
  }
});

test("a retained national PRL pointer sends only the requested person's profile", async () => {
  const pg = new PGlite();
  const requested = { bioguideId: "A000001", prlName: "Requested member", statementCount: 100,
    shares: { policy: 50, bipartisanship: 5, creditclaiming: 20, "attack-policy": 20, "attack-personal": 5 }, sources: ["all"], measuredAt: "2026-10-19" };
  const snapshot: PrlSnapshot = { formatVersion: 1, fetchedAt: "2026-10-19T00:00:00Z", sourceFile: "profiles.csv",
    sourceUrl: requiredPrlDataset("profiles-national").url, rowsInFile: 51, rowsWithStatements: 51,
    profiles: [requested, ...Array.from({ length: 50 }, (_, index) => ({ ...requested, bioguideId: `B${String(index + 1).padStart(6, "0")}`, prlName: `Unrelated member ${index} ` + "country-wide stored evidence ".repeat(1000) }))],
    rosterMisses: [], attribution: PRL_RHETORIC_ATTRIBUTION };
  const encoded = partitionCivicPayload(snapshot), returned: unknown[] = [];
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    const scope = "US:congressional-rhetoric:attributed-profiles";
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: "prl", recordClass: "PRL_PROFILE", scope,
      readModel: snapshot, storedReadModel: encoded.value, at: "2026-10-19T00:00:00Z", sourceVersion: "2026-10-19", finalUrl: snapshot.sourceUrl});
    installReaderDatabaseQuery(async statements => {
      const out = [];
      for (const statement of statements) {
        const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
        returned.push(rows); out.push(rows);
      }
      return out;
    });
    const profile = await prlProfileForSubject("congress:A000001");
    assert.equal(profile?.bioguideId, requested.bioguideId);
    assert.equal(profile?.statementCount, 100);
    assert.ok(!JSON.stringify(returned).includes("Unrelated member") && !JSON.stringify(returned).includes("country-wide stored evidence"));
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
