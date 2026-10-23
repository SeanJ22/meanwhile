import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { publishCandidateFindings, type CandidateFindingSubject } from "../lib/civic-data/candidate-profile-findings.ts";
import { runCandidateProfileFindingsJob } from "../lib/civic-data/candidate-profile-findings-job.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { manualProjectionCandidate, type CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore, PostgresRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { admittedRuntimeChildEnvironment, RUNTIME_AUTHORITY_ENV } from "../lib/civic-data/runtime-authority.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { holdBoxFinding, indexReportedFinding, indexScoutFindings } from "../lib/control-plane/box.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { CANDIDATE_PROFILE_LEAD, slotVersion } from "../lib/facts/finding-slots.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";

const NOW = "2026-10-01T00:00:00.000Z", SAVED = "2026-09-29T00:00:00.000Z";
const SITE = "https://janedoeforcouncil.com/";
const IMAGE = "https://janedoeforcouncil.com/img/jane-doe.jpg";
const JANE: CandidateFindingSubject = { candidacyId: "ballot-oh-2026:columbus-council:doe-jane", givenName: "Jane", familyName: "Doe",
  officeTitle: "City Council", ocdId: "ocd-division/country:us/state:oh/place:columbus", stateCode: "OH", cycle: 2026,
  readerKeys: ["ballot-oh-2026:columbus-council:doe-jane"] };
const PROFILES = requiredManualProductionContract("candidate-profiles:OH");
const png = () => sharp({ create: { width: 200, height: 240, channels: 3, background: "#335577" } }).png().toBuffer();

/** A vault of the pages hunters cited, a Box holding their findings as the Box pass hands them on, and the store readers read. */
async function setup(pages: Readonly<Record<string, string>>) {
  const root = await mkdtemp(join(tmpdir(), "candidate-findings-"));
  const artifacts = new Map<string, HeldVaultArtifact>();
  for (const [url, html] of Object.entries(pages)) {
    const sha = createHash("sha256").update(html).digest("hex"), bodyPath = join(root, `${sha}.html`);
    await writeFile(bodyPath, html);
    artifacts.set(url, { id: `ar-${sha.slice(0, 24)}`, tier: "RAW", contentHash: `sha256-${sha}`, contentType: "text/html", canonicalUrl: url,
      retrievalUrl: url, retrievedAt: SAVED, httpStatus: 200, sourceId: new URL(url).hostname, workItemId: "wi-packet", attemptId: "at-packet",
      methodRouteId: "scout:fetch_public", permission: "ALLOWED", bodyPath, bodySha256: `sha256-${sha}` });
  }
  const repos = createMemoryRepositories();
  let index = 0;
  const report = async (subjectId: string, field: string, value: string, sentence: string, sourceUrl: string) => {
    const row = await indexReportedFinding(repos.boxFindings, { workItemId: "wi-packet", attemptId: "at-packet", obligationId: "hunt:packet:ocd-division/country:us/state:oh/place:columbus",
      missionPart: null, finding: { subjectId, field, value, exactQuote: sentence, sourceUrl, artifactIds: [artifacts.get(sourceUrl)!.id], subjectHint: null, index: index++ } }, NOW);
    await holdBoxFinding(repos.boxFindings, row.id, { class: "candidates", reason: CANDIDATE_PROFILE_LEAD, slots: slotVersion("candidates") }, NOW);
  };
  const stored = new Map<string, Uint8Array>();
  const portrait = { read: async () => png(), put: async (key: string, bytes: Uint8Array) => { stored.set(key, bytes); } };
  const store = new MemoryRoutineDataStore();
  const run = (extra: Partial<Parameters<typeof publishCandidateFindings>[0]> = {}) => publishCandidateFindings({ boxFindings: repos.boxFindings,
    held: async id => [...artifacts.values()].find(row => row.id === id) ?? null, store, subjects: [JANE],
    campaignHosts: new Map([[JANE.candidacyId, ["janedoeforcouncil.com"]]]), clocks: factClocks(null), now: NOW, portrait, ...extra });
  const card = async () => {
    const read = await readPromotedCivicData<CandidateProfilesProjection>(PROFILES.recordClass, PROFILES.scope, { store, now: NOW, bypassCache: true });
    return read.kind === "PROMOTED" ? read.value.cards.cards[JANE.candidacyId] : undefined;
  };
  return { repos, report, run, card, stored, artifacts, store };
}

test("a hunter's bio, campaign phone and campaign-site portrait publish on the candidate's card once each holds on its saved page", async () => {
  const s = await setup({
    [SITE]: `<html><body><h1>Jane Doe for City Council 2026</h1><p>Jane Doe is a nurse who has lived in Columbus for twenty years.</p>
      <p>Call the campaign at (614) 555-0100.</p><img alt="Jane Doe" src="${IMAGE}"></body></html>`,
    "https://www.ohiosos.gov/candidates/doe": "<html><body><h1>Candidate filing: Jane Doe</h1><p>Contact: jane.doe@example.com</p></body></html>",
  });
  await s.report(JANE.candidacyId, "CAN-16", "Jane Doe is a nurse who has lived in Columbus for twenty years.", "Jane Doe is a nurse who has lived in Columbus for twenty years.", SITE);
  await s.report(JANE.candidacyId, "CAN-06", "(614) 555-0100", "Call the campaign at (614) 555-0100.", SITE);
  await s.report(JANE.candidacyId, "CAN-17", IMAGE, "Jane Doe for City Council 2026", SITE);
  await s.report(JANE.candidacyId, "CAN-06", "jane.doe@example.com", "Contact: jane.doe@example.com", "https://www.ohiosos.gov/candidates/doe");
  await s.report("ballot-oh-2026:columbus-council:roe-richard", "CAN-16", "x", "x", SITE);

  const report = await s.run();
  assert.deepEqual(report, { published: { "CAN-16": 1, "CAN-06": 1, "CAN-17": 1 }, refused: { CONTACT_NOT_ON_THE_CAMPAIGN_SITE: 1 }, waiting: 0 }, JSON.stringify(report));
  const card = (await s.card())!;
  assert.equal(card.bio, "Jane Doe is a nurse who has lived in Columbus for twenty years.");
  assert.equal(card.bioSourceUrl, SITE);
  assert.match(card.bioSourceLabel!, /janedoeforcouncil\.com, read 2026-09-29/);
  assert.equal(card.phone, "(614) 555-0100");
  assert.equal(card.email, null, "a filing office's page never stands in for a campaign contact");
  assert.equal(card.photoVerification?.basis, "OWN_PAGE");
  assert.ok(portraitBindingMatches(JANE.candidacyId, { url: card.photoUrl!, sourceUrl: card.photoVerification!.imageUrl, verification: card.photoVerification }, "candidates"));
  assert.equal(s.stored.size, 1, "the portrait's bytes are saved");
  const states = (await s.repos.boxFindings.list()).map(row => row.value.state).sort();
  assert.deepEqual(states, ["built", "built", "built", "refused", "waiting"]);
});

test("a Commons file publishes on its own when its description names the candidate and its author and free license are on record", async () => {
  const FILE = "https://commons.wikimedia.org/wiki/File:Jane_Doe.jpg";
  const COMMONS_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/a/ab/Jane_Doe.jpg";
  const commons = (described: string) => ({ portrait: { read: async () => png(), put: async () => {} }, capture: async (url: string): Promise<KnownRelease> => {
    const bytes = new TextEncoder().encode(JSON.stringify({ query: { pages: { 1: { title: "File:Jane Doe.jpg", imageinfo: [{ url: COMMONS_IMAGE,
      extmetadata: { LicenseShortName: { value: "CC BY-SA 4.0" }, Artist: { value: "<a>Photo Author</a>" }, ImageDescription: { value: described } } }] } } } }));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { sourceId: "candidate-wikimedia-portrait", releaseId: url, bytes, sha256, requestedUrl: url, finalUrl: url, httpStatus: 200, retrievedAt: NOW,
      sourceObservedAt: NOW, checkedAt: NOW, lastCheckStatus: 200, etag: null, lastModified: null, contentType: "application/json", reused: false,
      vaultKey: `project/freshness/source/commons/${sha256}.json` };
  } });

  const page = { [FILE]: `<html><body><h1>File:Jane Doe.jpg</h1><p>Jane Doe, candidate for Columbus City Council, 2026.</p><a href="${COMMONS_IMAGE}">Original file</a></body></html>` };
  const unnamed = await setup(page);
  await unnamed.report(JANE.candidacyId, "CAN-17", FILE, "Jane Doe, candidate for Columbus City Council, 2026.", FILE);
  assert.deepEqual((await unnamed.run({ commons: commons("A city council meeting") })).refused, { PORTRAIT_SECOND_SOURCE_MISSING: 1 },
    "a file that does not name the candidate does not identify them");

  const s = await setup(page);
  await s.report(JANE.candidacyId, "CAN-17", FILE, "Jane Doe, candidate for Columbus City Council, 2026.", FILE);
  const named = await s.run({ commons: commons("Jane Doe, candidate for Columbus City Council") });
  assert.deepEqual(named.published, { "CAN-17": 1 }, JSON.stringify(named));
  const card = (await s.card())!;
  assert.equal(card.photoSource, "Wikimedia Commons: Photo Author, CC BY-SA 4.0");
  assert.equal(card.photoVerification?.basis, "COMMONS");
  assert.ok(portraitBindingMatches(JANE.candidacyId, { url: card.photoUrl!, sourceUrl: card.photoVerification!.imageUrl, verification: card.photoVerification }, "candidates"));
});

test("a Scout's saved candidate finding, named in its own words, publishes the same way once checked", async () => {
  const s = await setup({ [SITE]: "<html><body><h1>Jane Doe for City Council 2026</h1><p>Jane Doe has taught in Columbus schools since 2004.</p></body></html>" });
  const result: ScoutResult = { formatVersion: 1, attemptId: "at-enrich", obligationId: `freshness:candidate-enrichment:${JANE.candidacyId}`, routeTaskId: "rt",
    workItemId: "wi-packet", subjectId: JANE.candidacyId, routeId: "candidate-site", recordClass: "candidate-enrichment", providerId: "fixture",
    reason: "Recorded candidate findings", outcome: "EVIDENCE_FOUND", stoppedBy: "MODEL", rungs: [], distinctEvidenceRungs: 1, candidates: [], nextRungs: [],
    unverified: [], narrative: "Saved fields", findings: [{ field: "candidate.bio", value: "Jane Doe has taught in Columbus schools since 2004.",
      exactQuote: "Jane Doe has taught in Columbus schools since 2004.", sourceUrl: SITE, artifactIds: [s.artifacts.get(SITE)!.id], kind: "RECORD", summary: "bio" }],
    worker: { provider: "fixture", model: "fixture", modelReported: "fixture" }, usage: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0, turns: 1, toolCalls: 1 }, usd: 0, elapsedMs: 1, artifactIds: [], methodCandidateIds: [], refusal: null, startedAt: NOW, recordedAt: NOW };
  await s.repos.scoutResults.append(result.obligationId, result.attemptId, result, NOW);
  const [row] = await indexScoutFindings(s.repos.boxFindings, result, NOW);
  await holdBoxFinding(s.repos.boxFindings, row!.id, { class: "candidates", reason: CANDIDATE_PROFILE_LEAD, slots: slotVersion("candidates") }, NOW);
  assert.deepEqual((await s.run()).published, { "CAN-16": 1 });
  assert.equal((await s.card())!.bio, "Jane Doe has taught in Columbus schools since 2004.");
});

test("the state profile job publishes waiting findings through its exact manual contract and keeps other states waiting", async () => {
  const bio = "Jane Doe has taught in Columbus schools since 2004.";
  const s = await setup({ [SITE]: `<html><body><h1>Jane Doe for City Council 2026</h1><p>${bio}</p></body></html>` });
  await s.report(JANE.candidacyId, "CAN-16", bio, bio, SITE);
  await s.report("ballot-il:another-candidate", "CAN-16", "Another biography.", "Another biography.", SITE);
  const official = "https://elections.ohio.gov/candidates", provenance = { sourceUrl: official, sourceOrg: "Ohio election office", collectedAt: SAVED, verifiedAt: SAVED };
  const ballot: BallotSet = { election: { id: "oh-general", state: "OH", date: "2026-11-03", name: "General election" },
    contests: [{ id: "oh-council", electionId: "oh-general", ocdId: JANE.ocdId, title: "City Council", type: "CANDIDACY", divisionVintage: "2026", voteFor: 1, termYears: 4, scopeNote: null, provenance }],
    candidacies: [{ id: JANE.candidacyId, contestId: "oh-council", givenName: "Jane", familyName: "Doe", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance }],
    measures: [], absences: [] };
  const candidate = manualProjectionCandidate({ contractId: "ballot-contests:OH", version: NOW, sourceThrough: SAVED,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "fixture", sources: [{ requestedUrl: official, finalUrl: official,
      httpStatus: 200, retrievedAt: SAVED, rawHash: "a".repeat(64), sourceClass: "ELECTION_AUTHORITY", publisher: "Ohio election office", reviewedEvidence: "Jane Doe is listed for City Council." }] },
    payload: { kind: "ballot-contests", ballots: { [ballotElectionKey(ballot)]: ballot } } });
  const published = await processRegisteredManualCandidate(s.store, "ballot-contests:OH", candidate, NOW);
  assert.ok(published.promoted, published.candidate.failureDetail ?? "fixture ballot must publish");
  const earlierUrl = "https://www.ohiosos.gov/previous-profiles";
  const earlierCards = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`ballot-oh-2026:earlier-${index}`, {
    photoUrl: null, photoSource: null, bio: `Earlier candidate ${index}.`, bioSourceUrl: earlierUrl, bioSourceLabel: "Earlier saved source",
    email: null, phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null,
  }]));
  const earlierLinks = { "ballot-oh-2026:earlier-0": { official: { url: earlierUrl, verification: "Named official page", attemptedAt: SAVED }, campaign: null } };
  const prior = manualProjectionCandidate({ contractId: "candidate-profiles:OH", version: SAVED, sourceThrough: SAVED,
    sourceReceipt: { contractVersion: 1, reviewedAt: SAVED, reviewedBy: "fixture", sources: [{ requestedUrl: earlierUrl, finalUrl: earlierUrl,
      httpStatus: 200, retrievedAt: SAVED, rawHash: "b".repeat(64), sourceClass: "OFFICIAL_PUBLISHER", publisher: "Ohio election office", reviewedEvidence: "Earlier candidates' saved official profiles." }] },
    payload: { cards: { curatedAt: SAVED, note: "", cards: earlierCards, hunts: [] }, links: { curatedAt: SAVED, note: "", links: earlierLinks, hunts: [] } } });
  const priorPublication = await processRegisteredManualCandidate(s.store, "candidate-profiles:OH", prior, SAVED);
  assert.ok(priorPublication.promoted, priorPublication.candidate.failureDetail ?? "fixture profiles must publish");
  const own = (await s.repos.boxFindings.list()).find(row => row.value.subjectId === JANE.candidacyId)!.value;
  const args = { state: "OH", store: s.store, repos: s.repos, now: NOW,
    query: async (sql: string) => sql.includes("FROM bound") ? [{ id: own.id, subject: own.subjectId }]
      : sql.includes("SELECT value") ? [{ value: own }]
        : [{ candidacy_id: "oh:2026:state-oh-place-columbus:city-council:doe-jane", host: "janedoeforcouncil.com" }],
    readHeld: async () => async (id: string) => [...s.artifacts.values()].find(row => row.id === id) ?? null };
  const result = await runCandidateProfileFindingsJob(args);
  assert.deepEqual(result.report.published, { "CAN-16": 1 });
  assert.equal(result.receipt?.source, "candidate-profiles:OH");
  assert.equal(result.receipt?.state, "PROMOTED");
  assert.equal((await s.card())?.bio, bio);
  const successor = (await s.store.readCandidate(result.receipt!.candidateId))!.candidate;
  const profiles = successor.readModel as CandidateProfilesProjection;
  assert.equal(profiles.cards.cards["oh:2026:state-oh-place-columbus:city-council:doe-jane"].bio, bio);
  for (const [key, card] of Object.entries(earlierCards)) assert.deepEqual(profiles.cards.cards[key], card);
  assert.deepEqual(profiles.links.links, earlierLinks);
  assert.deepEqual(successor.retrieval.manualSourceReceipt!.sources.find(source => source.finalUrl === earlierUrl), prior.retrieval.manualSourceReceipt!.sources[0]);
  assert.deepEqual(successor.excludedFacts, [], "unchanged cards and links are present, never repeated as rejected removals");
  assert.equal(successor.normalization.droppedRecords, 0, "canonical and ballot reader aliases both bind to their own state");
  assert.equal((await s.repos.boxFindings.list()).find(row => row.value.subjectId.startsWith("ballot-il"))?.value.state, "waiting");
});

test("canonical profile identities must agree with the declared state and their OCD state", () => {
  const source = { requestedUrl: SITE, finalUrl: SITE, httpStatus: 200, retrievedAt: SAVED, rawHash: "a".repeat(64),
    sourceClass: "CANDIDATE_CONTROLLED" as const, publisher: "Jane Doe campaign", reviewedEvidence: "The saved page names Jane Doe." };
  const card = { photoUrl: null, photoSource: null, bio: "Jane Doe is a teacher.", bioSourceUrl: SITE, bioSourceLabel: "Campaign page",
    email: null, phone: null, phoneLabel: null, filedAddress: null, filedAddressSource: null };
  const keys = ["oh:2026:state-oh-place-columbus:city-council:doe-jane", "il:2026:state-il-place-chicago:city-council:doe-jane",
    "oh:2026:state-il-place-chicago:city-council:doe-jane"];
  const candidate = manualProjectionCandidate({ contractId: "candidate-profiles:OH", version: NOW, sourceThrough: SAVED,
    sourceReceipt: { contractVersion: 1, reviewedAt: NOW, reviewedBy: "fixture", sources: [source] },
    payload: { cards: { curatedAt: NOW, note: "", cards: Object.fromEntries(keys.map(key => [key, card])), hunts: [] },
      links: { curatedAt: NOW, note: "", links: {}, hunts: [] } } });
  assert.deepEqual(Object.keys((candidate.readModel as CandidateProfilesProjection).cards.cards), [keys[0]]);
  assert.equal(candidate.excludedFacts!.filter(fact => fact.code === "MANUAL_MEMBER_INVALID").length, 2);
});

test("a derived child cannot enter the profile job, and read failures never refuse waiting findings", async () => {
  const s = await setup({ [SITE]: "<html><body>Jane Doe is a teacher.</body></html>" });
  await s.report(JANE.candidacyId, "CAN-16", "Jane Doe is a teacher.", "Jane Doe is a teacher.", SITE);
  const base: NodeJS.ProcessEnv = { NODE_ENV: "test", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" };
  const env = admittedRuntimeChildEnvironment({ parentEnv: base, capability: "ROUTINE_CONTRACT", contract: "candidate-campaign-sites-derived:OH" });
  const keys = [...Object.keys(base), ...Object.values(RUNTIME_AUTHORITY_ENV)], before = keys.map(key => [key, process.env[key]] as const);
  try {
    for (const key of keys) if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
    let reads = 0;
    const args = { state: "OH", store: Object.create(PostgresRoutineDataStore.prototype) as PostgresRoutineDataStore, repos: s.repos, now: NOW,
      query: async () => { reads++; return []; }, readHeld: async () => async () => null };
    await assert.rejects(runCandidateProfileFindingsJob(args), /capability or contract does not match/);
    assert.equal(reads, 0);
    process.env.WTP_RUNTIME_AUTHORITY_CAPABILITY = "MANUAL_CONTRACT";
    process.env.WTP_RUNTIME_AUTHORITY_CONTRACT = "candidate-profiles:OH";
    assert.equal((await runCandidateProfileFindingsJob(args)).receipt, null);
    assert.equal(reads, 1);
    await assert.rejects(s.run({ store: new Proxy(s.store, { get(target, key) {
      if (key === "readPromotion") return async () => { throw new Error("profile database unavailable"); };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } }) }), /BASE_UNAVAILABLE/);
    assert.ok((await s.repos.boxFindings.list()).every(row => row.value.state === "waiting"));
  } finally { for (const [key, value] of before) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
