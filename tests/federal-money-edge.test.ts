import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { absentFederalMoneyStateEntries } from "../lib/federal-money/edge.ts";
import { federalMoneyScope, type FederalMoneyProjection } from "../lib/federal-money/model.ts";
import { parseFederalMoney } from "../lib/federal-money/parse.ts";
import { readFederalMoneyProjection } from "../lib/federal-money/reader.ts";
import { readFederalMoneyEdgePublication } from "../lib/federal-money/edge-publication.ts";
import { publishRoutineReaderEdgeOutcome } from "../lib/civic-data/reader-edge-publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { ensureReaderAuthorityEdge, publishReaderEdgeArtifacts } from "../lib/meetings/edge-serving.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { currentPromotedEdge, withReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";
import { promotedFamily, provenEdgeEntry } from "./helpers/promoted-edge-entry.ts";

const NOW = "2026-10-12T23:01:00.000Z";
const META = { sourceThrough: null, retrievedAt: null, promotedThrough: null };
const CAPTURE = { url: "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$top=1",
  body: readFileSync(new URL("./fixtures/federal-money/openfema-live.json", import.meta.url), "utf8"),
  retrievedAt: NOW, publicationDate: null };

function stateValue(state: string, version: string) {
  const records = state === "AR" ? parseFederalMoney("openfema", CAPTURE, state) : [];
  const projection: FederalMoneyProjection = { formatVersion: 1, source: "openfema", state, records,
    counts: { loaded: records.length, joined: 0, unjoined: records.length } };
  const entry = provenEdgeEntry({ recordClass: "FEDERAL_MONEY", scope: federalMoneyScope("openfema", state),
    sourceId: "openfema", versionId: version, value: projection, retrievedAt: NOW });
  const entries = absentFederalMoneyStateEntries(state).map(absent => absent.scope === entry.projection.scope ? entry : absent);
  return promotedFamily(entries, version);
}

test("federal sources load one requested state lazily, share its four pointers, and stay isolated across requests", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store,
    federalMoney: { ar: stateValue("AR", "ar-1"), oh: stateValue("OH", "oh-1") } })).status, "PUBLISHED");
  const manifest = (await store.readManifest())!.manifest;
  assert.equal(manifest.authorityArtifacts, undefined, "the national authority bundle carries no federal records");
  const reads: string[] = [];
  const counted: ReaderArtifactStore = new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async (path: string) => { reads.push(path); return target.readBytes(path); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const bundle = await ensureReaderAuthorityEdge(manifest, counted, []);
  assert.deepEqual(reads, [], "assembling a request opens no state records");
  await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, async () => {
    const [fema, spending] = await Promise.all([
      readFederalMoneyProjection("openfema", "AR", { now: NOW }),
      readFederalMoneyProjection("usaspending", "AR", { now: NOW }),
    ]);
    assert.equal(fema.kind, "PROMOTED");
    if (fema.kind === "PROMOTED") assert.equal(fema.value.records[0].sourceId, "ac5ae0bd-30cc-4973-9a9f-6a0b9901496e");
    assert.equal(spending.kind, "NOT_RECORDED");
    assert.deepEqual(reads, [manifest.federalMoney!.ar.key], "parallel source reads fetch the state once");
    assert.equal(currentPromotedEdge("FEDERAL_MONEY", "openfema:OH"), null);
    assert.equal((await readFederalMoneyProjection("openfema", "WY", { now: NOW })).kind, "NOT_RECORDED");
    assert.equal(reads.length, 1, "a state with no promoted federal pointer costs no artifact read");
  });
  await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, async () => {
    assert.equal(currentPromotedEdge("FEDERAL_MONEY", "openfema:AR"), null, "another request starts with no Arkansas pointers");
    assert.equal((await readFederalMoneyProjection("openfema", "OH", { now: NOW })).kind, "PROMOTED");
  });
  assert.deepEqual(reads, [manifest.federalMoney!.ar.key, manifest.federalMoney!.oh.key]);
});

test("a missing state artifact keeps an unavailable source and never calls the database", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-missing-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  await publishReaderEdgeArtifacts(null, META, { store, federalMoney: { ar: stateValue("AR", "ar-missing-1") } });
  const manifest = (await store.readManifest())!.manifest;
  const missing: ReaderArtifactStore = new Proxy(store, { get(target, key) {
    if (key === "readBytes") return async () => null;
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const bundle = await ensureReaderAuthorityEdge(manifest, missing, []);
  await withReaderAuthorityEdge({ ...bundle, edgeOnly: true }, async () => {
    const read = await readFederalMoneyProjection("openfema", "AR", { now: NOW });
    assert.equal(read.kind, "STORE_UNREACHABLE");
    assert.equal(currentPromotedEdge("FEDERAL_MONEY", "openfema:AR"), null);
  });
});

test("state artifacts carry unchanged references and update one state independently", async t => {
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-carry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new LocalFileArtifactStore(directory);
  await publishReaderEdgeArtifacts(null, META, { store, federalMoney: { ar: stateValue("AR", "ar-carry-1"), oh: stateValue("OH", "oh-carry-1") } });
  const first = (await store.readManifest())!.manifest;
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, federalMoney: {
    ar: { carried: true, versionId: "ar-carry-1" }, oh: { carried: true, versionId: "oh-carry-1" },
  } })).status, "CURRENT");
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, federalMoney: {
    ar: stateValue("AR", "ar-carry-2"), oh: { carried: true, versionId: "oh-carry-1" },
  } })).status, "PUBLISHED");
  const second = (await store.readManifest())!.manifest;
  assert.notEqual(second.federalMoney!.ar.key, first.federalMoney!.ar.key);
  assert.equal(second.federalMoney!.oh.key, first.federalMoney!.oh.key);
  assert.equal((await publishReaderEdgeArtifacts(null, META, { store, federalMoney: {
    ar: { carried: true, versionId: "older-ar" }, oh: { carried: true, versionId: "oh-carry-1" },
  } })).status, "RACED");
  assert.deepEqual((await store.readManifest())!.manifest, second);
});

test("an optional source or state with no promoted records succeeds without reading candidate payloads", async t => {
  const store = new Proxy(new MemoryRoutineDataStore(), { get(target, key) {
    if (["readCandidate", "readPromotion", "readCandidateProof"].includes(String(key))) return async () => { throw new Error("unrecorded source read payload"); };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  const empty = await readFederalMoneyEdgePublication({ store, servedManifest: null, now: NOW,
    readServedState: async () => { throw new Error("unrecorded state read served artifact"); } });
  assert.deepEqual(empty, { states: {}, skipped: [] });
  const directory = mkdtempSync(join(tmpdir(), "federal-edge-optional-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifactStore = new LocalFileArtifactStore(directory);
  const outcome = await publishRoutineReaderEdgeOutcome(store, NOW, [{ recordClass: "FEDERAL_MONEY", scope: "openfema:US" }], { artifactStore });
  assert.equal(outcome.ok, true);
  assert.deepEqual((await artifactStore.readManifest())!.manifest.federalMoney, {});
});
