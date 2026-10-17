import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { stateRetirementCandidate } from "../lib/civic-data/state-retirement-publication.ts";
import { sealStateRetirementUnit, verifyStateRetirementUnitSeal, STATE_RETIREMENT_KEY_ENV } from "../lib/civic-data/state-retirement-proof.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate, processRegisteredStateRetirementCandidate } from "../lib/civic-data/promotion.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";

const T0 = "2026-10-14T12:00:00.000Z", T1 = "2026-10-15T12:00:00.000Z";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const sealInput = { fileSha256: hash("bytes"), originId: "cv-origin", originRecordClass: "VOTING_SITE",
  originScope: "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions", originReadModelHash: hash("original"), state: "AZ", contractId: "voting-sites:AZ" };
const env: NodeJS.ProcessEnv = { NODE_ENV: "test", [STATE_RETIREMENT_KEY_ENV]: "5".repeat(64) };
function voting(key: string, at: string): RoutineCandidate {
  const url = `https://elections.example.gov/${key}`;
  return votingSitesCandidate({ state: "AZ", current: { generatedAt: at.slice(0, 10), jurisdictions: [{
    ocdId: `ocd-division/country:us/state:az/county:${key}`, name: key, state: "AZ", model: "VOTE_CENTER", election: "2026 General",
    sites: [{ id: key, name: `${key} Library`, address: "1 Main St, Tucson AZ", room: null, lat: 32.2, lng: -110.9,
      kind: "ELECTION_DAY", election: "2026 General", serves: null }], sourceOrg: "County Elections", sourceUrl: url,
    collectedAt: at.slice(0, 10), refusal: null,
  }] }, prior: null, failures: [],
  acquisition: [{ url, contentType: "text/html", vaultKey: `capture/${key}`, rawHash: hash(key), byteLength: key.length }],
  successfulAuthorityReads: 1, requestedUrl: url, finalUrl: url, retrievedAt: at });
}
async function transfer() {
  const store = new MemoryRoutineDataStore(), held = voting("held", T1), original = voting("incoming", T0);
  const current = (await processRegisteredManualCandidate(store, "voting-sites:AZ", held, T1)).promoted!;
  const currentMetadata = (await store.readPublishedCandidateMetadata(current.versionId))!.candidate;
  const sourceExcluded = { key: "source-only", code: "SOURCE_LIMITATION", detail: "Original receipt limitation." };
  const receipt = { ...validateRoutineCandidate(original, null, T0).receipt, excludedFacts: [sourceExcluded] };
  assert.equal(receipt.decision, "GOOD");
  const payload: VotingSitesFile = { generatedAt: T1.slice(0, 10), jurisdictions: [
    ...(current.payload as VotingSitesFile).jurisdictions, ...(original.readModel as VotingSitesFile).jurisdictions,
  ] };
  const candidate = stateRetirementCandidate({ contractId: "voting-sites:AZ", state: "AZ", unitSha256: sealInput.fileSha256,
    origin: { candidate: original, receipt, readModelHash: original.normalization.normalizedHash! }, current, currentMetadata,
    payload, normalizedMetadata: { acquisition: [] } });
  return { store, current, currentMetadata, original, candidate, payload };
}

test("terminal unit signatures bind exact bytes, immutable origin, state, and contract", () => {
  const seal = sealStateRetirementUnit(sealInput, env);
  assert.doesNotThrow(() => verifyStateRetirementUnitSeal(sealInput, seal, env));
  for (const changed of [{ fileSha256: hash("modified bytes") }, { originId: "other" }, { originReadModelHash: hash("other") },
    { originRecordClass: "CANDIDATE_PROFILE" }, { originScope: "other" }, { state: "NJ" }, { contractId: "voting-sites:NJ" }]) {
    assert.throws(() => verifyStateRetirementUnitSeal({ ...sealInput, ...changed }, seal, env), /UNIT_SEAL_INVALID/);
  }
  assert.throws(() => sealStateRetirementUnit(sealInput, { NODE_ENV: "test" }), /PRODUCER_KEY_MISSING/);
  assert.throws(() => verifyStateRetirementUnitSeal(sealInput, seal, { ...env, [STATE_RETIREMENT_KEY_ENV]: "6".repeat(64) }), /UNIT_SEAL_INVALID/);
});

test("inherited source candidates preserve both exact source clocks and the original absence of acquisition evidence", async () => {
  const { current, original, candidate, payload } = await transfer();
  assert.equal(candidate.readModel, payload);
  assert.equal((candidate.readModel as VotingSitesFile).jurisdictions[0], (current.payload as VotingSitesFile).jurisdictions[0]);
  assert.equal(candidate.retrieval.retrievedAt, T1);
  assert.equal(candidate.bootstrapImport, undefined);
  assert.deepEqual(candidate.excludedFacts, [{ key: "source-only", code: "SOURCE_LIMITATION", detail: "Original receipt limitation." }]);
  const normalized = candidate.normalizedPayload as { readModel: unknown; retainedState: { retrieval: unknown }; inherited: { retrieval: unknown; evidence: unknown } };
  assert.equal(normalized.readModel, payload);
  assert.deepEqual(normalized.inherited.retrieval, original.retrieval);
  assert.deepEqual(normalized.inherited.evidence, { acquisition: [] });
  assert.equal((normalized.retainedState.retrieval as { retrievedAt: string }).retrievedAt, T1);
});

test("terminal selection preserves family shape checks and rejects foreign state or invented schema", async () => {
  const { current, currentMetadata, original, payload } = await transfer();
  const build = (value: unknown, state = "AZ") => stateRetirementCandidate({ contractId: "voting-sites:AZ", state,
    unitSha256: sealInput.fileSha256, origin: { candidate: original, receipt: validateRoutineCandidate(original, null, T0).receipt,
      readModelHash: original.normalization.normalizedHash! }, current, currentMetadata, payload: value, normalizedMetadata: { acquisition: [] } });
  assert.throws(() => build(payload, "NH"), /STATE_CONTRACT_MISMATCH/);
  assert.throws(() => build({ ...payload, jurisdictions: payload.jurisdictions.map(row => ({ ...row, state: "NH" })) }), /another state/);
  assert.throws(() => build({ ...payload, jurisdictions: payload.jurisdictions.map(row => ({ ...row,
    sites: row.sites.map(site => ({ ...site, lat: 180 })) })) }), /invalid point/);
  assert.throws(() => build({ generatedAt: "2026-10-15" }), /jurisdictions are missing/);
});

test("ordinary doors and an unregistered terminal candidate cannot mint inherited GOOD authority", async () => {
  const { store, current, candidate } = await transfer();
  await assert.rejects(processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, T1, current.versionId), /REQUIRES_TERMINAL_DOOR/);
  await assert.rejects(processRegisteredRoutineCandidate(store, "candidate-campaign-sites-derived:AZ", candidate, T1, current.versionId), /REQUIRES_TERMINAL_DOOR/);
  await assert.rejects(processRegisteredStateRetirementCandidate(store, "voting-sites:AZ", candidate, T1, current.versionId), /STATE_RETIREMENT_AUTHORITY_INVALID/);
  const prior = await store.readCandidate(current.versionId);
  assert.equal(validateRoutineCandidate(candidate, prior, T1).receipt.checks.find(row => row.check === "SOURCE_AUTHENTICITY")?.code,
    "STATE_RETIREMENT_AUTHORITY_INVALID");
  assert.equal((await store.readPromotionIdentity("VOTING_SITE", current.scope))?.versionId, current.versionId);
});

test("terminal reclassification refuses missing IDs, different contests, incomplete lists, and a bare marker", async () => {
  const { store, current, candidate: template } = await transfer();
  const prior = (await store.readCandidate(current.versionId))!;
  const provenance = { source: "Official source", sourceUrl: "https://elections.example.gov/list", collectedAt: T1 };
  const before = { id: "candidate-one", contestId: "contest-one", givenName: "Candidate", familyName: "One", provenance };
  const check = (direction: "to-current" | "to-filing", row: typeof before | null, complete: boolean, authorized = true) => {
    const readModel = { kind: "ballot-contests", ballots: { "AZ:2026-general": {
      election: { id: "2026-general", state: "AZ", date: "2026-11-03" },
      contests: [{ id: "contest-one", type: "CANDIDACY", candidateListComplete: complete, provenance }],
      candidacies: direction === "to-current" && row ? [row] : [], filingCandidacies: direction === "to-filing" && row ? [row] : [],
    } } };
    const hash = canonicalCivicDataHash(readModel);
    const candidate: RoutineCandidate = { ...template, sourceId: "official-ballot-authorities", recordClass: "BALLOT_CANDIDACY",
      scope: "US-AZ:state-election-ballots", readModel, normalizedPayload: readModel,
      normalization: { ...template.normalization, normalizedHash: hash, normalizedPayloadHash: hash },
      stateRetirement: { ...template.stateRetirement!, readModelHash: hash },
      changeSet: { outcome: "CHANGED", added: [], changed: [], held: [], removed: [{
        key: `${direction === "to-current" ? "filing-candidacy" : "candidacy"}:${before.id}`, before, after: null }] },
    };
    return validateRoutineCandidate(candidate, prior, T1, [], authorized ? candidate.stateRetirement : undefined).receipt.checks
      .find(result => result.check === "COMPLETENESS_HORIZON_VALIDITY")!;
  };
  assert.equal(check("to-current", before, true).code, "STATE_RETIREMENT_CANDIDACY_RECLASSIFIED");
  assert.equal(check("to-filing", before, false).code, "STATE_RETIREMENT_CANDIDACY_RECLASSIFIED");
  for (const outcome of [check("to-current", null, true), check("to-current", { ...before, id: "someone-else" }, true),
    check("to-current", { ...before, contestId: "other-contest" }, true), check("to-current", before, false), check("to-current", before, true, false)]) {
    assert.equal(outcome.code, "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");
    assert.notEqual(outcome.verdict, "PASS");
  }
});

test("origin proof reads expose only scalar immutable metadata and no payload or source receipt arrays", async () => {
  const { store, current } = await transfer();
  store.readCandidate = async () => { throw new Error("full envelope read"); };
  store.readPromotion = async () => { throw new Error("full payload read"); };
  const origin = await store.readStateRetirementOrigin("VOTING_SITE", current.scope);
  assert.equal(origin?.versionId, current.versionId);
  assert.equal(origin?.lastKnownGoodVersionId, current.versionId);
  assert.equal(origin?.promoted, true);
  assert.equal(origin?.sourceAuthenticity, "AUTHORITY_AND_RAW_PROVENANCE_VALID");
  assert.ok(Object.values(origin!).every(value => value === null || ["string", "boolean"].includes(typeof value)));
  assert.equal(await store.readStateRetirementBaseline("VOTING_SITE", current.scope), null);
});

test("Postgres retirement guards read exact scalar origin proof and only the selected state's restore index", async () => {
  const [{ PGlite }, { drizzle }, { PostgresRoutineDataStore }, { CivicPayloadParts }] = await Promise.all([
    import("@electric-sql/pglite"), import("drizzle-orm/pglite"), import("../lib/civic-data/store.ts"), import("../lib/civic-data/payload-parts.ts"),
  ]);
  const client = new PGlite();
  try {
    await client.exec(`CREATE TABLE civic_data_candidates (id text PRIMARY KEY,source_id text,record_class text,scope text,
      normalized_hash text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,
      validation_receipt jsonb,candidate jsonb);
      CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,current_version_id text,last_known_good_version_id text,validation_receipt jsonb);
      CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,at timestamptz,detail text);`);
    const receipt = { decision: "GOOD", checks: [{ check: "SOURCE_AUTHENTICITY", verdict: "PASS", code: "AUTHORITY_AND_RAW_PROVENANCE_VALID" }] };
    const hashes = { readModelHash: hash("state"), members: [{ key: "site:held", sha256: hash("row"), factsHash: hash("row") }] };
    await client.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,$5,'PROMOTED',true,$1,$1,$6,$7)",
      ["restored", "voting-sites", "VOTING_SITE", "US-AZ:voting-sites", hashes.readModelHash, receipt,
        { normalization: { stateRecordHashes: hashes }, readModel: { unselectedPayload: ["must stay in storage"] } }]);
    await client.query("INSERT INTO civic_data_promotions VALUES($1,'voting-sites','restored','restored',$2)", ["VOTING_SITE:US-AZ:voting-sites", receipt]);
    await client.query("INSERT INTO civic_data_candidate_events VALUES('restored',1,$1,'STATE_BUCKET_RESTORE_V1 held-source')", [T0]);
    const queries: string[] = [], store = Object.create(PostgresRoutineDataStore.prototype) as InstanceType<typeof PostgresRoutineDataStore>;
    Object.defineProperty(store, "db", { value: drizzle(client, { logger: { logQuery: query => { queries.push(query); } } }) });
    Object.defineProperty(store, "ownedPayloadParts", { value: new CivicPayloadParts({ existing: async () => [], write: async () => {},
      read: async () => { throw new Error("inline restore hashes should not read payload parts"); } }) });
    const origin = await store.readStateRetirementOrigin("VOTING_SITE", "US-AZ:voting-sites");
    assert.equal(origin?.promoted, true);
    assert.equal(origin?.normalizedHash, hashes.readModelHash);
    assert.deepEqual(await store.readStateRetirementBaseline("VOTING_SITE", "US-AZ:voting-sites"), hashes);
    assert.equal(await store.readStateRetirementBaseline("VOTING_SITE", "US-NH:voting-sites"), null);
    assert.ok(queries.every(query => !query.includes("readModel") && !query.includes('select "candidate"')));
    await client.query("UPDATE civic_data_promotions SET validation_receipt='{\"decision\":\"CANNOT_TELL\"}'");
    assert.equal((await store.readStateRetirementOrigin("VOTING_SITE", "US-AZ:voting-sites"))?.promoted, false);
  } finally { await client.close(); }
});
