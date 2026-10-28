import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { installKeyedRows } from "./helpers/keyed-rows.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readKeyedPrlPerson, readKeyedPrlProfile } from "../lib/sources/prl/keyed-reader.ts";
import { PRL_CONTRACT, prlCandidate } from "../lib/sources/prl/data-plane.ts";
import { PRL_ARCHIVE_SCOPE, type PrlArchiveProjection } from "../lib/sources/prl/archive-publication.ts";
import { readPrlPerson } from "../lib/sources/prl/reader.ts";
import { readPrlProfileForSubject, projectPrlProfile, readPrlProjection } from "../lib/sources/prl/snapshot.ts";
import { requiredPrlDataset } from "../lib/sources/prl/inventory.ts";
import { PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "../lib/sources/prl/types.ts";
import type { PrlIngestReceipt } from "../lib/sources/prl/receipt.ts";
import type { PrlArchiveStore } from "../lib/sources/prl/archive-store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { promotedEdgeEntryOf } from "../lib/civic-data/read-model.ts";
import { withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

const at = "2026-10-20T09:15:00.000Z", bio = "B000944", stateId = "ocd-person/04f7bd8e-094b-433c-9e91-7ebe64c75604", candidateId = "H0AZ01001";
const shares = { policy: 60, bipartisanship: 5, creditclaiming: 20, "attack-policy": 12, "attack-personal": 3 };
function federal(): PrlSnapshot {
  return { formatVersion: 1, fetchedAt: at, sourceFile: "profiles-all-national.csv", sourceUrl: requiredPrlDataset("profiles-national").url,
    rowsInFile: 2, rowsWithStatements: 2, rosterMisses: [], attribution: PRL_RHETORIC_ATTRIBUTION,
    profiles: [{ bioguideId: bio, prlName: "Held member", statementCount: 1200, shares, sources: ["all"], measuredAt: "2026-10-19" },
      { bioguideId: "C000127", prlName: "UNRELATED_PROFILE".repeat(20_000), statementCount: 10, shares, sources: ["all"], measuredAt: "2026-10-18" }] };
}
function receipt(id: string, profiles: readonly unknown[] | null): PrlIngestReceipt {
  const dataset = requiredPrlDataset(id), sourceSha256 = "b".repeat(64);
  return { formatVersion: 1, parserVersion: "prl-ingest/2", sourceBytes: 200, datasetId: id, scope: dataset.scope!, title: dataset.title,
    target: dataset.target, sourceUrl: dataset.url, sourceFinalUrl: dataset.url, sourceSha256, member: "native.csv", cursorField: dataset.cursorField,
    fetchedAt: at, highWaterMark: "2026-10-19", previousMark: null, rowsSeen: 2, rowsWritten: 2, rowsAfterNow: 0, rowsUnparseableCursor: 0,
    coverageFrom: "2026-10-01", coverageThrough: "2026-10-19", objectStore: "local-file", objectKeys: ["UNRELATED_OBJECT_KEY".repeat(20_000)],
    newObjectKeys: [], profileKind: id === "profiles-state" ? "state" : id === "primary-rhetoric" ? "primary" : null,
    profiles, attribution: PRL_RHETORIC_ATTRIBUTION,
    ...(dataset.target === "archive" ? { objectRoot: `${id}/${sourceSha256}/complete`, subjectCount: 2 } : {}) };
}

test("PRL exact person rows preserve profiles, dates, attribution and immutable archive bindings without unrelated payloads", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,
      source_id text,promoted_at timestamptz DEFAULT now(),payload jsonb,validation_receipt jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,candidate jsonb,validation_receipt jsonb,
      normalized_hash text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text);`);
    await installKeyedRows(pg);
    const part = async (hash: string, payload: unknown) => {
      await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [hash, JSON.stringify(payload)]);
      return { $civicPayloadPart: hash };
    };
    const save = async (recordClass: string, scope: string, payload: unknown, suffix = "1") => {
      const id = `${recordClass}-${suffix}`, validation = { decision: "GOOD", candidateId: id, sourceId: "prl", recordClass, scope }, hash = "a".repeat(64);
      await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,'prl','PROMOTED',$4,$5,$6,true,$1,$1)",
        [id, recordClass, scope, JSON.stringify({ normalization: { succeeded: true, normalizedHash: hash }, readModel: payload }), JSON.stringify(validation), hash]);
      await pg.query(`INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,last_known_good_version_id,source_id,payload,validation_receipt)
        VALUES($1,$2,$3,$4,$4,'prl',$5,$6) ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,
        last_known_good_version_id=excluded.last_known_good_version_id,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [`${recordClass}:${scope}`, recordClass, scope, id, JSON.stringify(payload), JSON.stringify(validation)]);
    };
    const snapshot = federal(), group = await part("federal-profiles", snapshot.profiles);
    const profiles = await part("federal-array", { kind: "array", groups: [group], order: "[0,0]" });
    await save("PRL_PROFILE", PRL_CONTRACT.scope, await part("federal-root", { kind: "object", value: { ...snapshot, profiles } }));
    const stateProfile = { openstatesId: stateId, prlName: "State member", state: "AZ", party: "Republican", chamber: "lower", district: "14",
      statementCount: 900, shares, measuredAt: null };
    const primaryProfile = { candidateId, prlName: "Candidate", state: "AZ", party: "Democratic", office: "H", district: "01",
      incumbentChallenge: "O", statementCount: 42, shares, measuredAt: "2026-10-18" };
    const archiveProjection: PrlArchiveProjection = { formatVersion: 1, datasets: {
      "profiles-state": receipt("profiles-state", [stateProfile, { ...stateProfile, openstatesId: "ocd-person/00000000-0000-0000-0000-000000000000", prlName: "UNRELATED_PROFILE".repeat(20_000) }]),
      "primary-rhetoric": receipt("primary-rhetoric", [primaryProfile]),
      "press-releases": receipt("press-releases", null),
    } };
    const encodedState = await part("state-profile", { kind: "object", value: stateProfile });
    const encodedProfiles = await part("state-profiles-array", { kind: "array", groups: [[encodedState, archiveProjection.datasets["profiles-state"].profiles![1]]], order: "[0,0]" });
    const datasets = await part("archive-datasets", { kind: "object", value: { ...archiveProjection.datasets,
      "profiles-state": { ...archiveProjection.datasets["profiles-state"], profiles: encodedProfiles } } });
    await save("PRL_ARCHIVE", PRL_ARCHIVE_SCOPE, await part("archive-root", { kind: "object", value: { formatVersion: 1, datasets } }));
    // Backfill existing pointers and exercise the same decoder/trigger used on a production expand.
    await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-05_prl_rows.sql", import.meta.url), "utf8").replaceAll("--> statement-breakpoint", ""));
    const returned: unknown[] = [];
    const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement => {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params ?? []])).rows;
      returned.push(rows); return rows;
    }));
    const profile = await readPrlProfileForSubject(`congress:${bio}`, { query });
    assert.deepEqual(profile, projectPrlProfile(snapshot.profiles[0], snapshot));
    const selected = await readKeyedPrlPerson(query, { bioguideId: bio, openstatesId: stateId, candidateId });
    assert.deepEqual(selected?.datasets["profiles-state"].profiles, [stateProfile]);
    assert.deepEqual(selected?.datasets["primary-rhetoric"].profiles, [primaryProfile]);
    assert.equal(selected?.datasets["press-releases"].fetchedAt, at);
    assert.equal(selected?.datasets["press-releases"].objectRoot, archiveProjection.datasets["press-releases"].objectRoot);
    assert.equal("objectKeys" in selected!.datasets["press-releases"], false);
    assert.ok(!JSON.stringify(returned).includes("UNRELATED_"));
    assert.ok(Buffer.byteLength(JSON.stringify(returned)) < 15_000);
    const nativePrefix = `${archiveProjection.datasets["press-releases"].objectRoot}/people/${createHash("sha256").update(bio).digest("hex")}/`;
    const bytes = new TextEncoder().encode(JSON.stringify([{ id: "1", bioguide_id: bio, date: "2026-10-19", text: "A complete statement.", source_url: "https://example.gov/statement" }]));
    const key = `${nativePrefix}${createHash("sha256").update(bytes).digest("hex")}.json`;
    const objects = new Map([[key, bytes], [`${nativePrefix}index.json`, new TextEncoder().encode(JSON.stringify({ subject: bio, keys: [key] }))]]);
    const archive: PrlArchiveStore = { kind: "local-file", get: async name => objects.get(name) ?? null,
      head: async name => objects.has(name) ? { key: name, size: objects.get(name)!.byteLength } : null,
      put: async () => { throw Error("reader write"); }, list: async () => { throw Error("reader bucket scan"); } };
    const keys = { bioguideId: bio, openstatesId: stateId, candidateId }, now = Date.parse(at);
    const read = await readPrlPerson(keys, { query, archive, now });
    assert.deepEqual(read, await readPrlPerson(keys, { projection: archiveProjection, archive, now }));
    assert.equal(read.statements[0].text, "A complete statement.");
    assert.equal(read.statements[0].retrievedAt, at);
    objects.set(`${nativePrefix}index.json`, new TextEncoder().encode(JSON.stringify({ subject: "C000127", keys: [key] })));
    assert.equal((await readPrlPerson({ bioguideId: bio }, { query, archive, now })).statements.length, 0, "native archive identity remains mandatory");
    await save("PRL_PROFILE", PRL_CONTRACT.scope, { ...snapshot, profiles: [snapshot.profiles[1]] }, "2");
    assert.equal(await readKeyedPrlProfile(query, bio), null, "pointer changes remove the prior person's row atomically");
    await pg.query("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE record_class='PRL_ARCHIVE'");
    await assert.rejects(readKeyedPrlPerson(query, keys), /PUBLISHED_POINTER_INVALID/);
  } finally { await pg.close(); }
});

test("PRL person profiles preserve Memory and served-edge values without a database fallback", async () => {
  const store = new MemoryRoutineDataStore(), snapshot = federal();
  const candidate = prlCandidate({ snapshot, rawZip: new TextEncoder().encode("exact PRL archive"), finalUrl: snapshot.sourceUrl, retrievedAt: at });
  await processRegisteredManualCandidate(store, "prl", candidate, at);
  assert.deepEqual(await readPrlProfileForSubject(`congress:${bio}`, { store, now: at }), projectPrlProfile(snapshot.profiles[0], snapshot));
  const read = await readPrlProjection({ store, now: at }), edge = promotedEdgeEntryOf(read, PRL_CONTRACT.recordClass, PRL_CONTRACT.scope, store);
  assert.ok(edge);
  const query: ReadOnlyQuery = async () => { throw Error("edge must never open a database query"); };
  assert.deepEqual(await readPrlProfileForSubject(`congress:${bio}`, { edge, query, now: at }), projectPrlProfile(snapshot.profiles[0], snapshot));
  await withReaderAuthorityEdge({ edgeOnly: true, promoted: new Map([[`${PRL_CONTRACT.recordClass}:${PRL_CONTRACT.scope}`, edge]]) }, async () => {
    assert.deepEqual(await readPrlProfileForSubject(`congress:${bio}`, { now: at }), projectPrlProfile(snapshot.profiles[0], snapshot));
    await assert.rejects(readPrlPerson({ bioguideId: bio }), /never reads the database/);
  });
  assert.equal(await readPrlProfileForSubject("a member name", { query }), null);
});
