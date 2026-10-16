import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { promotedInputRef, type DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import { derivedAuthorityFor } from "../lib/civic-data/derived-door.ts";
import { derivedCampaignSitesCandidate, derivedCampaignSitesProjection, type DerivedCampaignSitesPlan } from "../lib/civic-data/derived-campaign-site-writer.ts";
import type { DerivedCampaignSiteRecord, DerivedCampaignSitesProjection } from "../lib/civic-data/derived-campaign-sites.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const canonicalHash = (value: unknown) => hash(canonicalCivicDataJson(value));

function plan(): DerivedCampaignSitesPlan {
  const records: DerivedCampaignSiteRecord[] = [], inputs: DerivedInputRef[] = [];
  for (let index = 0; index < 80; index++) {
    const id = `candidate:${index}`, url = `https://candidate-${index}.example/`;
    const text = `A source statement from José 李 ${index}. `.repeat(100);
    const evidence = { verifierId: "campaign-site-verifier/1", artifactId: `capture:${index}`, attemptId: `attempt:${index}`,
      sha256: hash(`raw:${text}`), requestedUrl: url, finalUrl: url, httpStatus: 200, readAt: NOW,
      approvalItemId: `item:${index}`, approvalRecordId: `approval:${index}`, approvedAt: NOW };
    records.push({ id, candidacyId: id, candidateName: `José 李 ${index}`, campaign: {
      url, attemptedAt: NOW.slice(0, 10), verification: `Fetched 2026-10-16 (campaign-site-verifier/1): 'José 李' — names José 李, the office ("State Senator"), and the 2026 election.`, evidence,
    }, publications: [{ evidence, document: {
      id: `${id}@${hash(text)}`, candidateKey: id, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED",
      metaDescription: null, documentUrl: url, contentHash: hash(text), sourceContentHash: evidence.sha256,
      retrievedAt: NOW, contentType: "text/html", text, extraction: "html", extractionNote: null, extractorVersion: undefined,
    } }] });
    inputs.push({ kind: "VAULTED_EVIDENCE", artifactId: evidence.artifactId, contentHash: `sha256-${evidence.sha256}`, tier: "RAW", retrievedAt: NOW },
      { kind: "PIPELINE_APPROVAL", itemId: evidence.approvalItemId, recordId: evidence.approvalRecordId, approvedAt: NOW });
  }
  return { records, inputs, published: records.map(record => ({ key: record.id, candidacyId: record.candidacyId,
    url: record.campaign.url, approvalRecordId: record.campaign.evidence.approvalRecordId })), held: [] };
}

test("derived state candidates retain hashes and evidence without serializing or copying their aggregate payload", t => {
  const input = plan(), projection = derivedCampaignSitesProjection(input);
  const normalizedHash = canonicalHash(projection);
  const payloadHash = canonicalHash({ readModel: projection, decisions: { published: input.published.map(row => row.key), held: [] } });
  const rawHash = canonicalHash(input.inputs.map(canonicalCivicDataJson).sort());
  const id = `cv-${hash(`candidate-campaign-sites-derived:IL\u001fUS-IL:candidate-campaign-sites-derived\u001f${rawHash}\u001f${NOW}\u001f${NOW}\u001f${normalizedHash}`).slice(0, 32)}`;
  const stringify = JSON.stringify;
  t.mock.method(JSON, "stringify", (value: unknown) => {
    assert.ok(value === null || typeof value !== "object", "only scalar JSON encoding is needed to build a candidate");
    return stringify(value);
  });
  t.mock.method(JSON, "parse", () => assert.fail("candidate construction must not clone a whole payload"));
  t.mock.method(globalThis, "structuredClone", () => assert.fail("candidate construction must share verified rows"));
  const candidate = derivedCampaignSitesCandidate("IL", input, NOW);
  assert.equal(candidate.id, id);
  assert.equal(candidate.retrieval.rawHash, rawHash);
  assert.equal(candidate.normalization.normalizedHash, normalizedHash);
  assert.equal(candidate.normalization.normalizedPayloadHash, payloadHash);
  assert.equal((candidate.readModel as DerivedCampaignSitesProjection).records, input.records);
  assert.equal((candidate.normalizedPayload as { readModel: unknown }).readModel, candidate.readModel);
  assert.equal(candidate.retrieval.derived?.inputs, input.inputs);
  assert.equal(candidate.identities.length, input.records.length);
  assert.ok(candidate.identities.every(row => row.jurisdiction === "US-IL"));
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal(derivedAuthorityFor(candidate).ok, true);
  const proof = promotedInputRef(candidate.recordClass, candidate.scope, candidate.id, candidate.readModel, NOW);
  assert.equal(proof?.kind === "PROMOTED_VERSION" ? proof.readModelSha256 : null, normalizedHash);
});

test("inherited campaign evidence keeps one payload and still rejects altered facts or a forged prior", () => {
  const original = plan(), projection = derivedCampaignSitesProjection(original);
  const input = promotedInputRef("CURATED_READER_RECORD", "US-IL:candidate-campaign-sites-derived", "prior-version", projection, NOW)!;
  assert.ok(input.kind === "PROMOTED_VERSION");
  const inherited: DerivedCampaignSitesPlan = { ...original, inputs: [input], published: [], prior: { input, projection } };
  const candidate = derivedCampaignSitesCandidate("IL", inherited, NOW);
  assert.deepEqual(candidate.semantics.violations, []);
  assert.equal((candidate.readModel as DerivedCampaignSitesProjection).records, projection.records);
  const copied: DerivedCampaignSitesPlan = { ...inherited, records: structuredClone(original.records) };
  assert.deepEqual(derivedCampaignSitesCandidate("IL", copied, NOW).semantics.violations, []);
  const changed = { ...inherited, records: original.records.map((row, index) => index ? row : {
    ...row, campaign: { ...row.campaign, evidence: { ...row.campaign.evidence, attemptId: "unproved-attempt" } },
    publications: row.publications!.map(publication => ({ ...publication, evidence: { ...publication.evidence, attemptId: "unproved-attempt" } })),
  }) };
  const violations = derivedCampaignSitesCandidate("IL", changed, NOW).semantics.violations;
  assert.ok(violations.some(row => row.includes("does not name as an input")));
  assert.ok(violations.some(row => row.includes("lack their exact approved capture input")));
  const forged = { ...inherited, prior: { input: { ...input, readModelSha256: "0".repeat(64) }, projection } };
  assert.ok(derivedCampaignSitesCandidate("IL", forged, NOW).semantics.violations.some(row => row.includes("referenced promoted version")));
});
