import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
import { publishCandidateFindings, type CandidateFindingSubject } from "../lib/civic-data/candidate-profile-findings.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import type { CandidateProfilesProjection } from "../lib/civic-data/manual-projections.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { holdBoxFinding, indexReportedFinding, indexScoutFindings } from "../lib/control-plane/box.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { HeldVaultArtifact } from "../lib/control-plane/evidence/read-only-vault.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { CANDIDATE_PROFILE_LEAD, FINDING_SLOTS_VERSION } from "../lib/facts/finding-slots.ts";
import { portraitBindingMatches } from "../lib/photos/binding.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";

const NOW = "2026-10-01T00:00:00.000Z", SAVED = "2026-09-29T00:00:00.000Z";
const SITE = "https://janedoeforcouncil.com/";
const IMAGE = "https://janedoeforcouncil.com/img/jane-doe.jpg";
const JANE: CandidateFindingSubject = { candidacyId: "ballot-oh-2026:columbus-council:doe-jane", givenName: "Jane", familyName: "Doe",
  officeTitle: "City Council", ocdId: "ocd-division/country:us/state:oh/place:columbus", stateCode: "OH", cycle: 2026,
  readerKeys: ["ballot-oh-2026:columbus-council:doe-jane"] };
const PROFILES = requiredManualProductionContract("candidate-profiles");
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
    await holdBoxFinding(repos.boxFindings, row.id, { class: "candidates", reason: CANDIDATE_PROFILE_LEAD, slots: FINDING_SLOTS_VERSION }, NOW);
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
  return { repos, report, run, card, stored, artifacts };
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
  assert.deepEqual(report, { published: { "CAN-16": 1, "CAN-06": 1, "CAN-17": 1 }, refused: { CONTACT_NOT_ON_THE_CAMPAIGN_SITE: 1 }, waiting: 1 }, JSON.stringify(report));
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
  await holdBoxFinding(s.repos.boxFindings, row!.id, { class: "candidates", reason: CANDIDATE_PROFILE_LEAD, slots: FINDING_SLOTS_VERSION }, NOW);
  assert.deepEqual((await s.run()).published, { "CAN-16": 1 });
  assert.equal((await s.card())!.bio, "Jane Doe has taught in Columbus schools since 2004.");
});
