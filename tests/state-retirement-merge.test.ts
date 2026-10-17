import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { manualProjectionCandidate, readManualProjectionPrior, type CandidateProfilesProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { derivedCampaignSitesCandidate, type DerivedCampaignSitesPlan } from "../lib/civic-data/derived-campaign-site-writer.ts";
import type { DerivedCampaignSitesProjection } from "../lib/civic-data/derived-campaign-sites.ts";
import { processRegisteredManualCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { withStateRecordHashes } from "../lib/civic-data/state-publication.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { sourceProjectionEvidence, type RoutineCandidate } from "../lib/civic-data/types.ts";
import { sealStateRetirementUnit, STATE_RETIREMENT_KEY_ENV } from "../lib/civic-data/state-retirement-proof.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { reconcileRetirementStateInput } from "../lib/civic-data/state-retirement-merge.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { CandidateCardData } from "../lib/ballot/candidate-cards.ts";
import { genericBallotProblems, type GenericBallotProjection } from "../lib/ballot/generic-projection.ts";

const T0 = "2026-10-10T12:00:00.000Z", T1 = "2026-10-11T12:00:00.000Z", T2 = "2026-10-12T12:00:00.000Z", NOW = "2026-10-13T12:00:00.000Z";
const KAREN = "ballot-nh-merrimack:executive-council-2:liot-hill-karen", JOHN = "ballot-nh-merrimack:governor:doe-john", RORY = "ballot-nh-merrimack:governor:sample-rory";
const URL = "https://www.karenliothill.com/";
function card(bio: string): CandidateCardData {
  return { photoUrl: null, photoSource: null, bio, bioSourceUrl: URL, bioSourceLabel: "Candidate campaign biography", email: null,
    phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null };
}
function packageFor(cards: Record<string, CandidateCardData>, at: string): ManualProjectionPackage {
  const bytes = `<html><body>${Object.values(cards).map(value => value.bio).join("\n")}</body></html>`;
  return { contractId: "candidate-profiles:NH", version: at, sourceThrough: at,
    sourceReceipt: { contractVersion: 1, reviewedBy: "fixture-byte-review", reviewedAt: at, sources: [{ requestedUrl: URL, finalUrl: URL,
      publisher: "Candidate campaign", sourceClass: "CANDIDATE_CONTROLLED", retrievedAt: at, httpStatus: 200,
      rawHash: createHash("sha256").update(bytes).digest("hex"), reviewedEvidence: "Fixture HTML contains the candidate biography verbatim." }] },
    payload: { cards: { curatedAt: at, note: "Held candidate cards", cards, hunts: [] },
      links: { curatedAt: at, note: "Held verified links", links: {}, hunts: [] } } };
}

async function seedHeld(store: MemoryRoutineDataStore, input: RoutineCandidate, at: string, scope = input.scope, restored = false) {
  const candidate = withStateRecordHashes({ ...input, scope,
    sourceProjectionEvidence: sourceProjectionEvidence(input.sourceId, input.recordClass, scope) });
  const validation = validateRoutineCandidate({ ...input, changeSet: candidateChangeSet(input, null) }, null, at);
  assert.equal(validation.receipt.decision, "GOOD", JSON.stringify(validation.receipt.checks));
  const receipt = { ...validation.receipt, scope };
  const previous = await store.readPromotion(candidate.recordClass, scope);
  await store.create({ candidate, state: "FETCHED", acquisitionSucceeded: true, receipt: null, promotedVersion: null,
    lastKnownGoodVersion: previous?.versionId ?? null, failureCode: null, failureDetail: null },
  { candidateId: candidate.id, sequence: 1, state: "FETCHED", at, detail: restored ? "STATE_BUCKET_RESTORE_V1 exact historical state copy" : "Held historical national publication" });
  await store.transition(candidate.id, "NORMALIZED", at, "Normalized held capture");
  await store.transition(candidate.id, "VALIDATED", at, "Held GOOD source receipt", receipt);
  await store.promote(candidate.id, receipt, at);
  return { candidate, receipt };
}

test("terminal replay carries a later national card after ordinary state publication while keeping newer state facts", async t => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-merge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(packageFor({ [KAREN]: card("Original biography."), [RORY]: card("Original Rory biography.") }, T0));
  await seedHeld(store, first, T0, first.scope, true);
  const currentCard = card("Newer state worker biography.");
  const ordinary = manualProjectionCandidate(packageFor({ [KAREN]: currentCard, [RORY]: card("Original Rory biography.") }, T2));
  const state = await processRegisteredManualCandidate(store, "candidate-profiles:NH", ordinary, T2);
  assert.ok(state.promoted, state.candidate.failureDetail ?? "");
  const lateCard = card("A newly captured national candidate biography.");
  const source = manualProjectionCandidate(packageFor({ [KAREN]: card("Original biography."), [JOHN]: lateCard, [RORY]: card("Updated national Rory biography.") }, T1));
  const sourcePayload = source.readModel as CandidateProfilesProjection;
  const originScope = "US-AZ+US-NH+US-NJ:2026-supported-candidates";
  const held = await seedHeld(store, source, T1, originScope);
  const unit = { family: "candidate-profiles", state: "NH", originId: held.candidate.id, originScope,
    originRecordClass: "CANDIDATE_PROFILE", originReadModelHash: source.normalization.normalizedHash!,
    promotedAt: T1, candidate: held.candidate, receipt: held.receipt, normalizedMetadata: {},
    payload: { cards: { ...sourcePayload.cards, cards: {}, hunts: [] }, links: { ...sourcePayload.links, links: {}, hunts: [] } },
    members: Object.entries(sourcePayload.cards.cards).map(([key, value]) => ({ path: ["cards", "cards"], key, value })) };
  const serialized = JSON.stringify(unit), file = join(directory, "unit.json"), sha256 = createHash("sha256").update(serialized).digest("hex");
  await writeFile(file, serialized);
  const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "9".repeat(64);
  t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
  const seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId, originScope, originRecordClass: unit.originRecordClass,
    originReadModelHash: unit.originReadModelHash, state: "NH", contractId: "candidate-profiles:NH" });
  const result = await reconcileRetirementStateInput({ file, sha256, seal, contractId: "candidate-profiles:NH", store, now: NOW });
  assert.equal(result.status, "PUBLISHED");
  const read = await readPromotedCivicData<CandidateProfilesProjection>("CANDIDATE_PROFILE", "US-NH:candidate-profiles", { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  assert.deepEqual(read.value.cards.cards[KAREN], currentCard);
  assert.deepEqual(read.value.cards.cards[JOHN], lateCard);
  assert.equal(Object.keys(read.value.cards.cards).length, 3);
  assert.deepEqual(read.value.cards.cards[RORY], card("Updated national Rory biography."));
  assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId: "candidate-profiles:NH", store, now: NOW })).status, "CURRENT");
  await assert.rejects(reconcileRetirementStateInput({ file, sha256: "0".repeat(64), seal, contractId: "candidate-profiles:NH", store, now: NOW }), /INPUT_HASH_MISMATCH/);
  await assert.rejects(reconcileRetirementStateInput({ file, sha256, seal: "0".repeat(64), contractId: "candidate-profiles:NH", store, now: NOW }), /UNIT_SEAL_INVALID/);
  const forged = JSON.stringify({ ...unit, members: [...unit.members, { path: ["cards", "cards"], key: "invented", value: card("Invented") }] });
  await writeFile(file, forged);
  await assert.rejects(reconcileRetirementStateInput({ file, sha256: createHash("sha256").update(forged).digest("hex"), seal,
    contractId: "candidate-profiles:NH", store, now: NOW }), /UNIT_SEAL_INVALID/);
  await writeFile(file, serialized);
  const conflicting = manualProjectionCandidate(packageFor({ [KAREN]: card("Both sources changed this untimed biography.") }, NOW));
  const moved = await seedHeld(store, conflicting, NOW, originScope);
  await assert.rejects(reconcileRetirementStateInput({ file, sha256, seal, contractId: "candidate-profiles:NH", store, now: NOW }), /ORIGIN_MOVED/);
  const conflictUnit = { ...unit, originId: moved.candidate.id, originReadModelHash: conflicting.normalization.normalizedHash!,
    candidate: moved.candidate, receipt: moved.receipt, members: [{ path: ["cards", "cards"], key: KAREN, value: card("Both sources changed this untimed biography.") }] };
  const conflictBytes = JSON.stringify(conflictUnit), conflictHash = createHash("sha256").update(conflictBytes).digest("hex");
  await writeFile(file, conflictBytes);
  const conflictSeal = sealStateRetirementUnit({ fileSha256: conflictHash, originId: conflictUnit.originId, originScope,
    originRecordClass: unit.originRecordClass, originReadModelHash: conflictUnit.originReadModelHash, state: "NH", contractId: "candidate-profiles:NH" });
  await assert.rejects(reconcileRetirementStateInput({ file, sha256: conflictHash, seal: conflictSeal, contractId: "candidate-profiles:NH", store, now: NOW }), /UNTIMED_CONFLICT:cards\/cards/);
  const prior = await readManualProjectionPrior("candidate-profiles:NH", store, NOW);
  assert.ok(prior);
  const next = manualProjectionCandidate(packageFor({ [KAREN]: card("Later normal worker biography.") }, NOW), { prior });
  const normal = await processRegisteredManualCandidate(store, "candidate-profiles:NH", next, NOW, prior.versionId);
  assert.ok(normal.promoted, normal.candidate.failureDetail ?? "");
  assert.deepEqual((normal.promoted.payload as CandidateProfilesProjection).cards.cards[JOHN], lateCard);

});

function voting(keys: string[], at: string): RoutineCandidate {
  return votingSitesCandidate({ state: "NH", current: { generatedAt: at.slice(0, 10), jurisdictions: keys.map(key => ({
    ocdId: `ocd-division/country:us/state:nh/place:${key}`, name: key, state: "NH", model: "ASSIGNED", election: "2026 General",
    sites: [{ id: key, name: `${key} Library`, address: "1 Main St, Concord NH", room: null, lat: 43.2, lng: -71.5,
      kind: "ELECTION_DAY", election: "2026 General", serves: null }], sourceOrg: "Town Clerk", sourceUrl: `https://elections.example.gov/${key}`,
    collectedAt: at.slice(0, 10), refusal: null,
  })) }, prior: null, failures: [], acquisition: keys.map(key => ({ url: `https://elections.example.gov/${key}`, contentType: "text/html",
    vaultKey: `capture/${key}`, rawHash: createHash("sha256").update(key).digest("hex"), byteLength: key.length })),
    successfulAuthorityReads: keys.length, requestedUrl: `https://elections.example.gov/${keys[0]}`, finalUrl: `https://elections.example.gov/${keys[0]}`, retrievedAt: at });
}
function derived(keys: string[], at: string): RoutineCandidate {
  const inputs: DerivedCampaignSitesPlan["inputs"][number][] = [];
  const records = keys.map(key => {
    const id = `ballot-nh:${key}`, url = `https://${key}.example/`, sha256 = createHash("sha256").update(key).digest("hex");
    const evidence = { verifierId: "campaign-site-verifier/1", artifactId: `capture:${key}`, attemptId: `attempt:${key}`,
      sha256, requestedUrl: url, finalUrl: url, httpStatus: 200, readAt: at, approvalItemId: `item:${key}`,
      approvalRecordId: `approval:${key}`, approvedAt: at };
    inputs.push({ kind: "VAULTED_EVIDENCE", artifactId: evidence.artifactId, contentHash: `sha256-${sha256}`, tier: "RAW", retrievedAt: at },
      { kind: "PIPELINE_APPROVAL", itemId: evidence.approvalItemId, recordId: evidence.approvalRecordId, approvedAt: at });
    return { id, candidacyId: id, candidateName: key, campaign: { url, attemptedAt: at.slice(0, 10),
      verification: `Fetched ${at.slice(0, 10)} (campaign-site-verifier/1): '${key}' — names ${key}, the office ("State Senator"), and the 2026 election.`, evidence } };
  });
  return derivedCampaignSitesCandidate("NH", { records, inputs, held: [], published: records.map(row => ({ key: row.id,
    candidacyId: row.candidacyId, url: row.campaign.url, approvalRecordId: row.campaign.evidence.approvalRecordId })) }, at);
}

for (const family of ["voting-sites", "candidate-campaign-sites-derived"] as const) test(`terminal ${family} publishes new held records with original evidence and retains newer own-state facts`, async t => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-evidence-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "7".repeat(64);
  t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
  const store = new MemoryRoutineDataStore(), build = family === "voting-sites" ? voting : derived;
  const state = build(["held"], T2), contractId = `${family}:NH`;
  const published = family === "voting-sites" ? await processRegisteredManualCandidate(store, "voting-sites:NH", state, T2)
    : await processRegisteredRoutineCandidate(store, contractId, state, T2);
  assert.ok(published.promoted, published.candidate.failureDetail ?? "");
  const source = build(["held", "incoming"], T1), originScope = family === "voting-sites"
    ? "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions" : "US:candidate-campaign-sites-derived";
  const origin = await seedHeld(store, source, T1, originScope);
  const payload = source.readModel as VotingSitesFile & DerivedCampaignSitesProjection;
  const members = family === "voting-sites" ? payload.jurisdictions.flatMap(row => [
    { path: ["jurisdictions"], key: row.ocdId, value: { ...row, sites: [] } },
    ...row.sites.map(site => ({ path: ["jurisdictions", row.ocdId, "sites"], key: site.id, value: site })),
  ]) : payload.records.map(row => ({ path: ["records"], key: row.id, value: row }));
  const unit = { family, state: "NH", originId: origin.candidate.id, originRecordClass: source.recordClass, originScope,
    originReadModelHash: source.normalization.normalizedHash!, promotedAt: T1, ...origin, normalizedMetadata: family === "voting-sites" ? { acquisition: [] } : { decisions: { held: ["original held source decision"] } },
    payload: family === "voting-sites" ? { generatedAt: T1.slice(0, 10), jurisdictions: [] } : { kind: family, formatVersion: 1, records: [] }, members };
  const file = join(directory, "unit.json"), bytes = JSON.stringify(unit), sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(file, bytes);
  const seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId, originRecordClass: unit.originRecordClass, originScope,
    originReadModelHash: unit.originReadModelHash, state: "NH", contractId });
  const outcome = await reconcileRetirementStateInput({ file, sha256, seal, contractId, store, now: NOW });
  assert.equal(outcome.status, "PUBLISHED");
  const result = await readPromotedCivicData<VotingSitesFile & DerivedCampaignSitesProjection>(source.recordClass, state.scope, { store, now: NOW, bypassCache: true });
  assert.equal(result.kind, "PROMOTED");
  if (result.kind !== "PROMOTED") return;
  const field = family === "voting-sites" ? "jurisdictions" : "records";
  assert.deepEqual(result.value[field][0], (state.readModel as typeof result.value)[field][0]);
  assert.deepEqual(result.value[field][1], payload[field][1]);
  const candidate = (await store.readCandidate(result.projection.versionId))!.candidate;
  assert.equal(candidate.retrieval.retrievedAt, T2);
  assert.equal(candidate.stateRetirement!.origin.versionId, origin.candidate.id);
  assert.deepEqual((candidate.normalizedPayload as { inherited: { retrieval: unknown; evidence: unknown } }).inherited.retrieval, JSON.parse(JSON.stringify(source.retrieval)));
  assert.deepEqual((candidate.normalizedPayload as { inherited: { evidence: unknown } }).inherited.evidence, unit.normalizedMetadata);
});

function ballotPackage(names: readonly string[], at: string, complete = true): ManualProjectionPackage {
  const url = "https://elections.example.gov/nh-official-candidates", content = names.join("\n");
  const provenance = { sourceOrg: "Secretary of State", sourceUrl: url, collectedAt: at, verifiedAt: at };
  return { contractId: "ballot-contests:NH", version: at, sourceThrough: at, sourceReceipt: { contractVersion: 1,
    reviewedBy: "fixture source reader", reviewedAt: at, sources: [{ requestedUrl: url, finalUrl: url, publisher: "Secretary of State",
      sourceClass: "ELECTION_AUTHORITY", retrievedAt: at, httpStatus: 200, rawHash: createHash("sha256").update(content).digest("hex"),
      reviewedEvidence: "All candidate names are present in the held fixture source list." }] }, payload: { kind: "ballot-contests", ballots: {
        "NH:2026-general": { election: { id: "2026-general", state: "NH", date: "2026-11-03", name: "2026 General" },
          contests: [{ id: "ballot-nh:governor", electionId: "2026-general", ocdId: "ocd-division/country:us/state:nh",
            divisionVintage: "2026", title: "Governor", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null,
            candidateListComplete: complete, provenance }],
          candidacies: names.map(name => ({ id: `ballot-nh:governor:${name.toLowerCase()}`, contestId: "ballot-nh:governor", givenName: "Candidate",
            familyName: name, partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance })), measures: [], absences: [] },
      } } };
}

for (const family of ["ballot-contests", "candidate-profiles", "candidate-corpus", "voting-sites", "candidate-campaign-sites-derived"] as const)
  test(`terminal ${family} initializes five empty territory buckets from the pinned GOOD source`, async t => {
    const directory = await mkdtemp(join(tmpdir(), "state-retirement-empty-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "3".repeat(64);
    t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
    const profile = packageFor({ [KAREN]: card("Captured candidate biography.") }, T1);
    const corpusText = "Captured candidate publication.", contentHash = createHash("sha256").update(corpusText).digest("hex");
    const source = family === "ballot-contests" ? manualProjectionCandidate(ballotPackage(["Current"], T1))
      : family === "candidate-profiles" ? manualProjectionCandidate(profile)
      : family === "candidate-corpus" ? manualProjectionCandidate({ ...profile, contractId: "candidate-corpus:NH",
        sourceReceipt: { ...profile.sourceReceipt, sources: profile.sourceReceipt.sources.map(row => ({ ...row, rawHash: contentHash })) },
        payload: { formatVersion: 1, fetchedAt: T1, attempted: 1, documents: [{ id: `${KAREN}@${contentHash}`, candidateKey: KAREN,
          documentUrl: URL, contentHash, retrievedAt: T1, contentType: "text/html", text: corpusText, extraction: "html",
          extractionNote: null, metaDescription: null, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED" }], failures: [] } })
      : family === "voting-sites" ? voting(["held"], T1) : derived(["held"], T1);
    const originScope = family === "ballot-contests" ? "US:state-election-ballots"
      : family === "candidate-profiles" ? "US-AZ+US-NH+US-NJ:2026-supported-candidates"
      : family === "candidate-corpus" ? "US-AZ+US-NH+US-NJ:2026-supported-candidates"
      : family === "voting-sites" ? "US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions" : "US:candidate-campaign-sites-derived";
    const store = new MemoryRoutineDataStore(), origin = await seedHeld(store, source, T1, originScope);
    const payload = family === "ballot-contests" ? { kind: "ballot-contests", ballots: {} }
      : family === "candidate-profiles" ? { cards: { curatedAt: T1, cards: {}, hunts: [] }, links: { curatedAt: T1, links: {}, hunts: [] } }
      : family === "candidate-corpus" ? { formatVersion: 1, fetchedAt: T1, attempted: 0, documents: [], failures: [] }
      : family === "voting-sites" ? { generatedAt: T1.slice(0, 10), jurisdictions: [] }
      : { kind: family, formatVersion: 1, records: [] };
    for (const state of ["PR", "VI", "AS", "GU", "MP"]) {
      const contractId = `${family}:${state}`, unit = { family, state, originId: origin.candidate.id, originRecordClass: source.recordClass,
        originScope, originReadModelHash: source.normalization.normalizedHash!, promotedAt: T1, ...origin,
        normalizedMetadata: {}, payload, members: [] };
      const file = join(directory, `${state}.json`), bytes = JSON.stringify(unit), sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(file, bytes);
      const seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId, originRecordClass: unit.originRecordClass,
        originScope, originReadModelHash: unit.originReadModelHash, state, contractId });
      assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId, store, now: NOW })).status, "PUBLISHED");
      const scope = `US-${state}:${family === "ballot-contests" ? "state-election-ballots" : family === "candidate-corpus" ? "candidate-publications" : family}`;
      const read = await readPromotedCivicData(source.recordClass, scope, { store, now: NOW, bypassCache: true });
      assert.equal(read.kind, "PROMOTED");
      if (read.kind !== "PROMOTED") throw new Error("The initialized state must be readable.");
      assert.deepEqual(read.value, payload);
      const saved = (await store.readCandidate(read.projection.versionId))!.candidate;
      assert.equal(saved.stateRetirement!.priorVersionId, null);
      assert.equal((saved.normalizedPayload as { retainedState: unknown }).retainedState, null);
      assert.deepEqual(saved.retrieval, JSON.parse(JSON.stringify(origin.candidate.retrieval)));
      assert.deepEqual(saved.temporal, JSON.parse(JSON.stringify(origin.candidate.temporal)));
      assert.equal(saved.absence.claimsAbsence, false);
      assert.ok(read.projection.receipt.checks.some(check => check.code === "STATE_RETIREMENT_INHERITED_GOOD_PROVENANCE_VALID"));
      assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId, store, now: NOW })).status, "CURRENT");
    }
    assert.deepEqual(genericBallotProblems({ kind: "ballot-contests", ballots: {} }, "PR"), []);
  });

test("initial terminal publication preserves incoming facts and rejects a bad seal or concurrently created pointer", async t => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-first-race-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "2".repeat(64);
  t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
  const competing = manualProjectionCandidate(ballotPackage(["Concurrent"], T2));
  class RacingStore extends MemoryRoutineDataStore {
    race = false;
    override async readPromotionIdentity(recordClass: RoutineCandidate["recordClass"], scope: string) {
      if (this.race && scope === competing.scope) { this.race = false; await seedHeld(this, competing, T2); }
      return super.readPromotionIdentity(recordClass, scope);
    }
  }
  const store = new RacingStore(), source = manualProjectionCandidate(ballotPackage(["Original"], T1));
  const originScope = "US:state-election-ballots", origin = await seedHeld(store, source, T1, originScope);
  const ballot = (source.readModel as GenericBallotProjection).ballots["NH:2026-general"];
  const unit = { family: "ballot-contests", state: "NH", originId: origin.candidate.id, originRecordClass: source.recordClass,
    originScope, originReadModelHash: source.normalization.normalizedHash!, promotedAt: T1, ...origin, normalizedMetadata: {},
    payload: { kind: "ballot-contests", ballots: { "NH:2026-general": { ...ballot, contests: [], candidacies: [] } } },
    members: [...ballot.contests.map(row => ({ path: ["ballots", "NH:2026-general", "contests"], key: row.id, value: row })),
      ...ballot.candidacies.map(row => ({ path: ["ballots", "NH:2026-general", "candidacies"], key: row.id, value: row }))] };
  const file = join(directory, "unit.json"), bytes = JSON.stringify(unit), sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(file, bytes);
  const contractId = "ballot-contests:NH", seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId,
    originRecordClass: unit.originRecordClass, originScope, originReadModelHash: unit.originReadModelHash, state: "NH", contractId });
  await assert.rejects(reconcileRetirementStateInput({ file, sha256, seal: "0".repeat(64), contractId, store, now: NOW }), /UNIT_SEAL_INVALID/);
  assert.equal(await store.readPromotion("BALLOT_CANDIDACY", competing.scope), null);
  store.race = true;
  await assert.rejects(reconcileRetirementStateInput({ file, sha256, seal, contractId, store, now: NOW }), /STATE_RETIREMENT_CURRENT_CHANGED/);
  const current = await store.readPromotion<GenericBallotProjection>("BALLOT_CANDIDACY", competing.scope);
  assert.equal(current!.versionId, competing.id);
  assert.deepEqual(current!.payload, competing.readModel);
  assert.equal((await store.readPromotion("BALLOT_CANDIDACY", originScope))!.versionId, origin.candidate.id);
  const firstStore = new MemoryRoutineDataStore();
  await seedHeld(firstStore, source, T1, originScope);
  assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId, store: firstStore, now: NOW })).status, "PUBLISHED");
  const first = await firstStore.readPromotion("BALLOT_CANDIDACY", competing.scope);
  assert.deepEqual(first!.payload, source.readModel);
  assert.equal((await firstStore.readCandidate(first!.versionId))!.candidate.stateRetirement!.priorVersionId, null);
});

for (const olderHeld of [false, true]) test(`terminal ballot replay keeps newer complete lists and earlier candidates (${olderHeld ? "held" : "published"})`, async t => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-ballot-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "8".repeat(64);
  t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
  const store = new MemoryRoutineDataStore(), newer = manualProjectionCandidate(ballotPackage(["Current"], T2));
  assert.ok((await processRegisteredManualCandidate(store, "ballot-contests:NH", newer, T2)).promoted);
  const sourcePackage = ballotPackage(["Current", "Earlier", "Partial"], T1);
  const sourceBallot = (sourcePackage.payload as import("../lib/ballot/generic-projection.ts").GenericBallotProjection).ballots["NH:2026-general"];
  const certified = { contestId: sourceBallot.contests[0].id, nominees: [{ name: "Candidate Earlier", partyLabel: "Independent", note: null }] };
  const sourceUrl = sourceBallot.contests[0].provenance.sourceUrl;
  assert.ok(sourceUrl, "the fixture contest has its official source URL");
  sourceBallot.generalLineup = { curatedAt: T1, canvass: { title: "Official fixture canvass", url: sourceUrl,
    issuedBy: "Fixture election office", reportDate: T1.slice(0, 10), readAt: T1, readNote: "Official fixture source read." },
    note: "Certified nominees remain separate from the complete contest.", contests: [certified] };
  sourceBallot.contests.push({ ...sourceBallot.contests[0], id: "ballot-nh:state-senate", title: "State Senate", candidateListComplete: false });
  sourceBallot.candidacies[2].contestId = "ballot-nh:state-senate";
  const earlier = sourceBallot.candidacies[1], partial = sourceBallot.candidacies[2];
  if (olderHeld) {
    sourceBallot.heldContests = [{ ...sourceBallot.contests.shift()!, reason: "The older source had not checked the full list." }];
    sourceBallot.filingCandidacies = sourceBallot.candidacies.splice(0, 2);
  }
  const incoming = manualProjectionCandidate(sourcePackage);
  const originScope = "US:state-election-ballots", origin = await seedHeld(store, incoming, T1, originScope);
  const payload = incoming.readModel as import("../lib/ballot/generic-projection.ts").GenericBallotProjection;
  const ballot = payload.ballots["NH:2026-general"];
  const unit = { family: "ballot-contests", state: "NH", originId: origin.candidate.id, originRecordClass: "BALLOT_CANDIDACY",
    originScope, originReadModelHash: incoming.normalization.normalizedHash!, promotedAt: T1, ...origin, normalizedMetadata: {},
    payload: { kind: "ballot-contests", ballots: { "NH:2026-general": { ...ballot, contests: [], candidacies: [], heldContests: [], filingCandidacies: [], generalLineup: { ...ballot.generalLineup, contests: [] } } } },
    members: [...ballot.contests.map(row => ({ path: ["ballots", "NH:2026-general", "contests"], key: row.id, value: row })),
      ...(ballot.heldContests ?? []).map(row => ({ path: ["ballots", "NH:2026-general", "heldContests"], key: row.id, value: row })),
      ...ballot.candidacies.map(row => ({ path: ["ballots", "NH:2026-general", "candidacies"], key: row.id, value: row })),
      ...(ballot.filingCandidacies ?? []).map(row => ({ path: ["ballots", "NH:2026-general", "filingCandidacies"], key: row.id, value: row })),
      { path: ["ballots", "NH:2026-general", "generalLineup", "contests"], key: certified.contestId, value: certified }] };
  const file = join(directory, "unit.json"), bytes = JSON.stringify(unit), sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(file, bytes);
  const seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId, originRecordClass: unit.originRecordClass,
    originScope, originReadModelHash: unit.originReadModelHash, state: "NH", contractId: "ballot-contests:NH" });
  assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId: "ballot-contests:NH", store, now: NOW })).status, "PUBLISHED");
  const read = await readPromotedCivicData<import("../lib/ballot/generic-projection.ts").GenericBallotProjection>("BALLOT_CANDIDACY", newer.scope, { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const result = read.value.ballots["NH:2026-general"];
  assert.equal(result.contests[0].candidateListComplete, true);
  assert.equal(Object.hasOwn(result.contests[0], "reason"), false);
  assert.deepEqual(result.contests[0], (newer.readModel as typeof payload).ballots["NH:2026-general"].contests[0]);
  assert.deepEqual((result as unknown as { generalLineup: { contests: unknown[] } }).generalLineup.contests, [certified]);
  assert.deepEqual(result.candidacies, (newer.readModel as typeof payload).ballots["NH:2026-general"].candidacies);
  assert.deepEqual(result.filingCandidacies?.slice().sort((a, b) => a.id.localeCompare(b.id)), [earlier, partial].sort((a, b) => a.id.localeCompare(b.id)));
  assert.equal(result.heldContests?.[0].id, "ballot-nh:state-senate");
  assert.match(result.heldContests![0].reason, /not been fully checked/);
  assert.equal(result.contests.length, 1);
  assert.ok(result.filingCandidacies);
  assert.equal(result.filingCandidacies[0].filing, undefined, "earlier source evidence does not invent a filing number");
  const completedPackage = ballotPackage(["Current", "Partial"], NOW);
  const completed = (completedPackage.payload as typeof payload).ballots["NH:2026-general"];
  completed.contests.push({ ...completed.contests[0], id: "ballot-nh:state-senate", title: "State Senate" });
  completed.candidacies[1].contestId = "ballot-nh:state-senate";
  const latest = await seedHeld(store, manualProjectionCandidate(completedPackage), NOW, originScope);
  const nextUnit = { ...unit, ...latest, originId: latest.candidate.id, originReadModelHash: latest.candidate.normalization.normalizedHash!,
    members: [...completed.contests.map(row => ({ path: ["ballots", "NH:2026-general", "contests"], key: row.id, value: row })),
      ...completed.candidacies.map(row => ({ path: ["ballots", "NH:2026-general", "candidacies"], key: row.id, value: row }))] };
  const nextBytes = JSON.stringify(nextUnit), nextHash = createHash("sha256").update(nextBytes).digest("hex");
  await writeFile(file, nextBytes);
  const nextSeal = sealStateRetirementUnit({ fileSha256: nextHash, originId: nextUnit.originId, originRecordClass: nextUnit.originRecordClass,
    originScope, originReadModelHash: nextUnit.originReadModelHash, state: "NH", contractId: "ballot-contests:NH" });
  assert.equal((await reconcileRetirementStateInput({ file, sha256: nextHash, seal: nextSeal, contractId: "ballot-contests:NH", store, now: NOW })).status, "PUBLISHED");
  const released = (await store.readPromotion<typeof payload>("BALLOT_CANDIDACY", newer.scope))!.payload.ballots["NH:2026-general"];
  assert.equal(released.heldContests?.length, 0);
  assert.equal(released.contests.length, 2);
  assert.deepEqual(released.candidacies.map(row => row.id).sort(), completed.candidacies.map(row => row.id).sort());
  assert.deepEqual(released.filingCandidacies?.map(row => row.id), [earlier.id]);
});

test("terminal Arizona contest aliases retain the complete race and bind earlier candidates to its canonical ID", async t => {
  const directory = await mkdtemp(join(tmpdir(), "state-retirement-az-alias-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const oldKey = process.env[STATE_RETIREMENT_KEY_ENV]; process.env[STATE_RETIREMENT_KEY_ENV] = "6".repeat(64);
  t.after(() => { if (oldKey === undefined) delete process.env[STATE_RETIREMENT_KEY_ENV]; else process.env[STATE_RETIREMENT_KEY_ENV] = oldKey; });
  const canonicalId = "az-2026-general-state-house-1", filingId = "az-sos-2026:state-house-1";
  const districtPackage = (at: string, complete: boolean): ManualProjectionPackage => {
    const input = ballotPackage(complete ? ["Current"] : ["Current", "Earlier", "Filed"], at, complete);
    const ballot = (input.payload as GenericBallotProjection).ballots["NH:2026-general"];
    ballot.election.state = "AZ";
    const contest = ballot.contests[0];
    contest.id = complete ? canonicalId : filingId;
    contest.ocdId = "ocd-division/country:us/state:az/sldl:1";
    contest.title = "State Representative — District 1";
    contest.voteFor = 2;
    contest.identity = { identityId: "az-2026:contest:state-house-1", level: "STATE", financeFilingAuthority: "Arizona Secretary of State" };
    contest.filing = { id: filingId, publishedTitle: contest.title, provenance: { ...contest.provenance, collectedAt: T0, verifiedAt: T0 } };
    for (const candidate of ballot.candidacies) {
      const oldId = `${filingId}:${candidate.familyName.toLowerCase()}`;
      candidate.id = complete ? `${canonicalId}:${candidate.familyName.toLowerCase()}` : oldId;
      candidate.contestId = contest.id;
      candidate.filing = { id: oldId, publishedName: `${candidate.givenName} ${candidate.familyName}`, provenance: contest.filing.provenance };
    }
    if (!complete) ballot.filingCandidacies = [ballot.candidacies.pop()!];
    return { ...input, contractId: "ballot-contests:AZ", payload: { kind: "ballot-contests", ballots: { "AZ:2026-general": ballot } } };
  };
  const store = new MemoryRoutineDataStore(), newer = manualProjectionCandidate(districtPackage(T2, true));
  assert.ok((await processRegisteredManualCandidate(store, "ballot-contests:AZ", newer, T2)).promoted);
  const incoming = manualProjectionCandidate(districtPackage(T1, false));
  const originScope = "US:state-election-ballots", origin = await seedHeld(store, incoming, T1, originScope);
  const ballot = (incoming.readModel as GenericBallotProjection).ballots["AZ:2026-general"];
  const unit = { family: "ballot-contests", state: "AZ", originId: origin.candidate.id, originRecordClass: "BALLOT_CANDIDACY",
    originScope, originReadModelHash: incoming.normalization.normalizedHash!, promotedAt: T1, ...origin, normalizedMetadata: {},
    payload: { kind: "ballot-contests", ballots: { "AZ:2026-general": { ...ballot, contests: [], candidacies: [], heldContests: [], filingCandidacies: [] } } },
    members: [...ballot.contests.map(row => ({ path: ["ballots", "AZ:2026-general", "contests"], key: row.id, value: row })),
      ...ballot.candidacies.map(row => ({ path: ["ballots", "AZ:2026-general", "candidacies"], key: row.id, value: row })),
      ...ballot.filingCandidacies!.map(row => ({ path: ["ballots", "AZ:2026-general", "filingCandidacies"], key: row.id, value: row }))] };
  const file = join(directory, "unit.json"), bytes = JSON.stringify(unit), sha256 = createHash("sha256").update(bytes).digest("hex");
  await writeFile(file, bytes);
  const seal = sealStateRetirementUnit({ fileSha256: sha256, originId: unit.originId, originRecordClass: unit.originRecordClass,
    originScope, originReadModelHash: unit.originReadModelHash, state: "AZ", contractId: "ballot-contests:AZ" });
  assert.equal((await reconcileRetirementStateInput({ file, sha256, seal, contractId: "ballot-contests:AZ", store, now: NOW })).status, "PUBLISHED");
  const read = await readPromotedCivicData<GenericBallotProjection>("BALLOT_CANDIDACY", newer.scope, { store, now: NOW, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const result = read.value.ballots["AZ:2026-general"], before = (newer.readModel as GenericBallotProjection).ballots["AZ:2026-general"];
  assert.deepEqual(result.contests, before.contests);
  assert.deepEqual(result.candidacies, before.candidacies);
  assert.deepEqual(result.heldContests, []);
  assert.deepEqual(result.filingCandidacies, [ballot.candidacies[1], ballot.filingCandidacies![0]].map(row => ({ ...row, contestId: canonicalId })));
  assert.ok([...result.candidacies, ...result.filingCandidacies!].every(row => row.contestId === canonicalId));
  const published = (await store.readCandidate(read.projection.versionId))!.candidate;
  assert.deepEqual((published.normalizedPayload as { inherited: { retrieval: unknown } }).inherited.retrieval, JSON.parse(JSON.stringify(incoming.retrieval)));
  assert.deepEqual((await store.readCandidate(origin.candidate.id))!.candidate.readModel, incoming.readModel);
});
