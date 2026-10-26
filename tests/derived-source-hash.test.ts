import assert from "node:assert/strict";
import test from "node:test";
import { derivedSourceContentHash, externalDerivedSourceInputs, withDerivedSourceContent, confirmDerivedSourceUnchanged } from "../lib/civic-data/derived-source-hash.ts";
import { derivedAuthorityFor } from "../lib/civic-data/derived-door.ts";
import { derivedCampaignSitesCandidate, DERIVED_CAMPAIGN_SITES_PARSER } from "../lib/civic-data/derived-campaign-site-writer.ts";
import type { DerivedInputRef } from "../lib/civic-data/derived-authority.ts";
import type { SourceHead } from "../lib/civic-data/store.ts";

const at = "2026-10-01T00:00:00.000Z", later = "2026-10-02T00:00:00.000Z";
const scope = "US-AZ:candidate-campaign-sites-derived";
const upstream: DerivedInputRef = { kind: "PROMOTED_VERSION", recordClass: "CANDIDATE_PROFILE", scope: "US-AZ:candidate-profiles",
  versionId: "profiles:one", readModelSha256: "a".repeat(64), promotedAt: at };
const approval: DerivedInputRef = { kind: "PIPELINE_APPROVAL", itemId: "item:one", recordId: "approval:one", approvedAt: at };
const evidence: DerivedInputRef = { kind: "VAULTED_EVIDENCE", artifactId: "artifact:one", contentHash: `sha256-${"b".repeat(64)}`, tier: "RAW", retrievedAt: at };
const inputs = [upstream, approval, evidence];

test("derived source hashes keep external content, approval and attempt revisions while excluding checks and the prior output", () => {
  const own = { ...upstream, recordClass: "CURATED_READER_RECORD", scope, versionId: "prior:one" } as DerivedInputRef;
  const first = externalDerivedSourceInputs([...inputs, own], { recordClass: "CURATED_READER_RECORD", scope });
  const checked = inputs.map(input => ({ ...input, promotedAt: later, retrievedAt: later, approvedAt: later }));
  assert.equal(derivedSourceContentHash(first), derivedSourceContentHash(checked));
  assert.deepEqual(first, externalDerivedSourceInputs([...inputs, { ...own, versionId: "prior:two" }], { recordClass: "CURATED_READER_RECORD", scope }));
  for (const changed of [[{ ...upstream, versionId: "profiles:two" }, approval, evidence],
    [upstream, { ...approval, recordId: "approval:two" }, evidence],
    [upstream, approval, { ...evidence, contentHash: `sha256-${"c".repeat(64)}` }]])
    assert.notEqual(derivedSourceContentHash(first), derivedSourceContentHash(changed as DerivedInputRef[]));
  const attempt = { kind: "DISCOVERY_ATTEMPT" as const, attemptId: "attempt:one", recordId: "artifact:one", revision: 1, workItemRevision: 1, recordedAt: at };
  assert.notEqual(derivedSourceContentHash([attempt]), derivedSourceContentHash([{ ...attempt, revision: 2 }]));
});

test("the derived authority binds SOURCE_CONTENT_V1 to its explicitly named authority inputs", () => {
  const base = derivedCampaignSitesCandidate("AZ", { records: [], inputs, held: [], published: [] }, at);
  const candidate = withDerivedSourceContent(base, inputs);
  assert.equal(candidate.retrieval.rawHashBasis, "SOURCE_CONTENT_V1");
  assert.equal(derivedAuthorityFor(candidate).ok, true);
  const forged = { ...candidate,
    retrieval: { ...candidate.retrieval, derived: { inputs, sourceContentInputs: [{ ...upstream, versionId: "unvalidated" } as DerivedInputRef] } } };
  assert.equal(derivedAuthorityFor(forged).ok, false);
  assert.equal(derivedAuthorityFor({ ...candidate, retrieval: { ...candidate.retrieval, rawHash: "f".repeat(64) } }).ok, false);
});

test("an unchanged complete derivation confirms through a scalar head without loading profiles, prior output or events", async () => {
  const head: SourceHead = { sourceId: "candidate-campaign-site-chain", recordClass: "CURATED_READER_RECORD", scope,
    versionId: "derived:one", lastKnownGoodVersionId: "derived:one", rawHash: derivedSourceContentHash(inputs), rawHashBasis: "SOURCE_CONTENT_V1",
    normalizedHash: "d".repeat(64), parserVersion: DERIVED_CAMPAIGN_SITES_PARSER, promotedAt: at, candidateState: "PROMOTED", acquisitionSucceeded: true, imported: false };
  let confirmations = 0;
  const store = { async readSourceHead() { return head; }, async confirmUnchanged(input: { pointerVersionId: string }, now: string) {
    confirmations++; assert.equal(input.pointerVersionId, head.versionId); return { kind: "CONFIRMED" as const, versionId: head.versionId, at: now };
  } };
  const input = { store, sourceId: head.sourceId, recordClass: head.recordClass, scope, parserVersion: head.parserVersion,
    sourceContentInputs: inputs, now: later, complete: true };
  assert.ok(await confirmDerivedSourceUnchanged(input));
  assert.equal(confirmations, 1);
  assert.equal(await confirmDerivedSourceUnchanged({ ...input, complete: false }), null, "unfinished work resumes even when its input hash holds");
  assert.equal(confirmations, 1);
});
