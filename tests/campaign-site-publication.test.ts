/**
 * APPROVED campaign sites publish through the ONE civic-data door: the
 * candidate-profiles manual contract's source-scoped successor, its validator
 * and its typed Reader verification. The prior GOOD version is carried forward
 * byte-exactly except newer verified evidence for the same URL; an official link travels
 * with its prior receipted bytes; the Reader renders the new link.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { manualProjectionCandidate, type CandidateProfilesProjection, type ManualProjectionPackage } from "../lib/civic-data/manual-projections.ts";
import { prepareManualProjectionSuccessor } from "../lib/civic-data/manual-successor.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { readManualProjectionPrior } from "../lib/civic-data/manual-projections.ts";
import { refreshCandidateProfilesFromPromoted } from "../lib/civic-data/manual-read-models.ts";
import { linksForCandidacy } from "../lib/ballot/candidate-sites.ts";
import { planCampaignSitePublication, type EvidencedLink } from "../lib/civic-data/campaign-site-publication.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import type { CampaignSiteApprovedRecord } from "../lib/control-plane/promotion/campaign-site-chain.ts";
import { CHIPPERSON, DUARTE, MAYES, subject } from "./helpers/campaign-sites.ts";

const T0 = "2026-09-20T12:00:00.000Z";
const NOW = "2026-09-24T12:00:00.000Z";
const DUARTE_KEY = "ballot-nj-morris:mendham-township-member-of-the-township-committee-place-mendham-township:duarte-amalia";
const CHIPPERSON_KEY = "ballot-nj-morris:harding-township-member-of-the-township-committee-place-harding-township:chipperson-rita-c";
const MAYES_KEY = "ballot-az-pima:attorney-general:mayes-kris";
const HARDING = "https://www.hardingnj.org/township-committee";

function priorPackage(): ManualProjectionPackage {
  const payload: CandidateProfilesProjection = {
    cards: { curatedAt: "2026-09-08", note: "reviewed cards", cards: { [MAYES_KEY]: { bio: "Kris Mayes is the Attorney General.", bioSourceUrl: "https://www.krismayes.com" } as never }, hunts: [] },
    links: {
      curatedAt: "2026-09-08", note: "reviewed links",
      links: {
        [MAYES_KEY]: { official: null, campaign: { url: "https://www.krismayes.com", verification: "Fetched 2026-08-13: 'Kris Mayes for Arizona Attorney General'.", attemptedAt: "2026-08-13" } },
        [CHIPPERSON_KEY]: { official: { url: HARDING, verification: "Fetched 2026-08-13: the Harding Township Committee roster names Rita Chipperson.", attemptedAt: "2026-08-13" }, campaign: null },
      },
      hunts: [{ key: DUARTE_KEY, name: "Amalia Duarte", note: "MISS — searched 2026-08-13; no campaign site found", attemptedAt: "2026-08-13" }],
    },
  };
  const source = (url: string, sourceClass: "CANDIDATE_CONTROLLED" | "OFFICIAL_PUBLISHER", hash: string) => ({
    requestedUrl: url, finalUrl: url, publisher: new URL(url).hostname, sourceClass, retrievedAt: T0, httpStatus: 200, rawHash: hash.repeat(64),
    reviewedEvidence: "Exact response bytes reviewed by the owner.",
  });
  return {
    contractId: "candidate-profiles", version: T0, sourceThrough: T0,
    sourceReceipt: { contractVersion: 1, reviewedAt: T0, reviewedBy: "owner-test", sources: [source("https://www.krismayes.com", "CANDIDATE_CONTROLLED", "a"), source(HARDING, "OFFICIAL_PUBLISHER", "b")] },
    payload,
  };
}

function approval(candidacyId: string, url: string, sha: string): CampaignSiteApprovedRecord {
  const s = subject(candidacyId);
  const host = new URL(url).hostname.replace(/^www\./, "");
  return {
    formatVersion: 1, recordId: `pp-${sha.slice(0, 8)}:approved:x`, itemId: `pp-${sha.slice(0, 8)}`, at: NOW,
    actor: { role: "RELEASE_ORCHESTRATOR", lane: "DETERMINISTIC", instance: "campaign-site-approver/1@test" }, stage: "APPROVED_FOR_PROMOTION",
    chain: { scouted: "s", confirmed: "c", verified: "v", audited: "a" }, recordClass: "candidate-enrichment", field: "campaignSite",
    campaignSite: {
      field: "campaignSite", candidacyId, candidateName: `${s.givenName} ${s.familyName}`,
      identity: { candidacyId, givenName: s.givenName, familyName: s.familyName, officeTitle: s.officeTitle, ocdId: s.ocdId, stateCode: s.stateCode, cycle: s.cycle },
      readerKeys: s.readerKeys, url, host,
      verification: `Fetched 2026-09-24 (campaign-site-verifier/1): '${host}' — names ${s.givenName} ${s.familyName}, the office ("township committee"), and the 2026 election.`,
      evidence: { verifierId: "campaign-site-verifier/1", artifactId: `ar-${sha.slice(0, 8)}`, attemptId: "at-reader", sha256: sha.repeat(64).slice(0, 64), requestedUrl: url, finalUrl: url,
        httpStatus: 200, contentType: "text/html; charset=utf-8", readAt: "2026-09-24T11:00:05.000Z" },
      audit: { startedFrom: ["EVIDENCE_VAULT", "CANONICAL_SUBJECT_IDENTITY"], secondSignal: "SECOND_READ: test" },
      publicationDoor: "CANDIDATE_CAMPAIGN_SITES_DERIVED_CONTRACT",
    },
  };
}

async function seeded() {
  const store = new MemoryRoutineDataStore();
  const first = manualProjectionCandidate(priorPackage());
  const outcome = await processRegisteredManualCandidate(store, "candidate-profiles", first, T0, null);
  assert.equal(outcome.candidate.state, "PROMOTED");
  return { store, first };
}

test("approved sites publish a validated successor that carries the prior version forward, and the Reader renders them", async () => {
  const { store, first } = await seeded();
  const prior = await readManualProjectionPrior("candidate-profiles", store, NOW);
  assert.equal(prior?.versionId, first.id);
  const plan = planCampaignSitePublication({
    approved: [
      approval(DUARTE, "https://www.duarte4mendham.com/meet-amalia", "d"),
      approval(DUARTE, "https://www.duarte4mendham.com/copy-of-issues", "e"),
      approval(CHIPPERSON, "https://www.chippersonforharding.com/", "c"),
      approval(MAYES, "https://www.krismayes.com/", "f"),
    ],
    prior, gate: readActivationGate("."), reviewedAt: NOW,
  });
  assert.deepEqual(plan.published.map((p) => p.key).sort(), [CHIPPERSON_KEY, DUARTE_KEY, MAYES_KEY, "ballot-az-pima:attorney-general|Kris Mayes"].sort());
  assert.equal(plan.published.find((p) => p.key === DUARTE_KEY)?.url, "https://www.duarte4mendham.com/meet-amalia", "the shallowest verified page of one site");
  assert.deepEqual(plan.held, []);

  const { candidate, expectedBaseVersionId } = await prepareManualProjectionSuccessor(plan.package!, store, NOW);
  const outcome = await processRegisteredManualCandidate(store, "candidate-profiles", candidate, NOW, expectedBaseVersionId);
  assert.equal(outcome.candidate.state, "PROMOTED", JSON.stringify(outcome.candidate.receipt?.checks.filter((c) => c.verdict !== "PASS")));
  assert.equal(outcome.candidate.receipt?.decision, "GOOD");
  assert.equal(outcome.readerReadback?.status, "PASS");

  const payload = outcome.promoted!.payload as CandidateProfilesProjection;
  const before = priorPackage().payload as CandidateProfilesProjection;
  assert.equal(new URL(payload.links.links[MAYES_KEY]!.campaign!.url).href, new URL(before.links.links[MAYES_KEY]!.campaign!.url).href, "the same URL is retained");
  assert.equal(payload.links.links[MAYES_KEY]!.campaign!.attemptedAt, "2026-09-24", "newer fully verified evidence refreshes automatically");
  assert.deepEqual(payload.cards.cards, before.cards.cards, "every prior card is carried byte-exactly");
  assert.deepEqual(payload.links.links[CHIPPERSON_KEY]?.official, before.links.links[CHIPPERSON_KEY]?.official, "the official link travels with its prior receipted bytes");
  assert.equal(payload.links.links[CHIPPERSON_KEY]?.campaign?.url, "https://www.chippersonforharding.com/");
  const duarte = payload.links.links[DUARTE_KEY]!.campaign! as EvidencedLink;
  assert.equal(duarte.evidence.verifierId, "campaign-site-verifier/1");
  assert.equal(duarte.evidence.sha256, "d".repeat(64));
  assert.equal(duarte.attemptedAt, "2026-09-24");
  assert.ok(payload.links.hunts.some((h) => h.key === DUARTE_KEY), "the dated hunt record stays; the new link does not erase history");
  const receipt = outcome.candidate.candidate.retrieval.manualSourceReceipt!;
  assert.ok(receipt.sources.some((s) => s.finalUrl === HARDING && s.rawHash === "b".repeat(64)));
  assert.match(receipt.reviewedBy, /campaign-site-writer\/1/);

  await refreshCandidateProfilesFromPromoted({ store, bypassCache: true, now: NOW });
  assert.equal(linksForCandidacy(DUARTE_KEY)?.campaign?.url, "https://www.duarte4mendham.com/meet-amalia");
});

test("CP-14: a verified site publishes despite an obsolete gate reading; identity conflicts still stay open", async () => {
  const closed = planCampaignSitePublication({ approved: [approval(DUARTE, "https://www.duarte4mendham.com/meet-amalia", "d")], prior: null, gate: { promotionEnabled: false, openRecordClasses: [] }, reviewedAt: NOW });
  assert.ok(closed.package);
  assert.deepEqual(closed.held, []);
  const two = planCampaignSitePublication({
    approved: [approval(DUARTE, "https://www.duarte4mendham.com/meet-amalia", "d"), approval(DUARTE, "https://www.amaliaduarte.example/", "e")],
    prior: null, gate: readActivationGate("."), reviewedAt: NOW,
  });
  assert.equal(two.package, null);
  assert.deepEqual(two.held.map((h) => h.code), ["MULTIPLE_VERIFIED_SITES"]);
});

test("an official link with no receipted bytes holds its key rather than publish an unprovable member", async () => {
  const { store } = await seeded();
  const prior = await readManualProjectionPrior("candidate-profiles", store, NOW);
  const stripped = { ...prior!, sourceReceipt: { ...prior!.sourceReceipt, sources: prior!.sourceReceipt.sources.filter((s) => s.finalUrl !== HARDING) } };
  const plan = planCampaignSitePublication({ approved: [approval(CHIPPERSON, "https://www.chippersonforharding.com/", "c")], prior: stripped, gate: readActivationGate("."), reviewedAt: NOW });
  assert.equal(plan.package, null);
  assert.deepEqual(plan.held.map((h) => h.code), ["PRIOR_OFFICIAL_LINK_UNRECEIPTED"]);
});
