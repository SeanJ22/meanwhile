import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, rmSync } from "node:fs";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgArtifactsForPromotion, pgAcquisitionAttemptsForArtifacts, PROMOTION_READ_PAGE, type PromotionPageReader } from "../lib/control-plane/promotion/postgres-evidence.ts";
import { readPromotionArtifacts, type PromotionEvidenceRepositories } from "../lib/control-plane/promotion/evidence-reads.ts";
import { contextFromRepositories } from "../lib/control-plane/promotion/pipeline.ts";
import { collectFactChains } from "../lib/control-plane/promotion/fact-chain.ts";
import { mapEvidenceIntoPipeline } from "../lib/control-plane/promotion/mapping.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import { factChainHarness } from "./fact-chain-harness.ts";

const failBroad = async (): Promise<never> => { throw new Error("whole-table read forbidden"); };
const artifact = (id: string, url = "https://example.gov/meetings"): ArtifactRecord => ({
  artifactId: id, canonicalUrl: url, attemptId: `attempt-${id}`, workItemId: "work", routeTaskId: null,
  tier: "RAW", contentHash: id, byteLength: 10, contentType: "text/html", partial: false, recordedAt: "2026-10-06T00:00:00Z",
});

test("indexed artifact selection retains every observation and crosses page boundaries", async () => {
  const calls: { query: string; params: readonly unknown[] }[] = [];
  const rows = Array.from({ length: PROMOTION_READ_PAGE + 1 }, (_, i) => ({
    log_key: "one-item", position: i, record: artifact("same-content"),
  }));
  const sql: PromotionPageReader = async (_operation, query, params = []) => {
    calls.push({ query, params });
    return calls.length === 1 ? rows.slice(0, PROMOTION_READ_PAGE) : rows.slice(PROMOTION_READ_PAGE);
  };
  const held = await pgArtifactsForPromotion(sql, ["same-content"], ["https://example.gov/meetings"]);
  assert.equal(held.length, rows.length, "history is not truncated or deduplicated by artifact id");
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /record #>> '\{artifactId\}'/);
  assert.match(calls[0].query, /md5\(record->>'canonicalUrl'\)/);
  assert.match(calls[0].query, /record->>'canonicalUrl' = ANY/);
  assert.match(calls[1].query, /\(log_key, position\) > \(\$3, \$4::bigint\)/);
  assert.deepEqual(calls[1].params.slice(2), ["one-item", PROMOTION_READ_PAGE - 1]);
  assert.deepEqual(await pgArtifactsForPromotion(sql, [], []), []);
  assert.equal(calls.length, 2, "empty scope makes no query");
  await assert.rejects(pgArtifactsForPromotion(failBroad, ["a"], []), /whole-table/);
});

test("URL selection closes over content ids so a later observation at another URL is retained", async () => {
  const repos = createMemoryRepositories();
  const first = artifact("shared");
  const later = { ...artifact("shared", "https://other.gov/page"), attemptId: "other-attempt" };
  const unrelated = artifact("unrelated", "https://unrelated.gov/page");
  const all = [first, later, unrelated];
  const scoped: PromotionEvidenceRepositories = { ...repos, artifacts: { ...repos.artifacts, readAll: failBroad },
    artifactsForPromotion: async (ids, urls) => all.filter(row => ids.includes(row.artifactId) || urls.includes(row.canonicalUrl)) };
  assert.deepEqual(await readPromotionArtifacts(scoped, [], [first.canonicalUrl]), [first, later]);
  const ctx = await contextFromRepositories(scoped, { artifacts: [first, later], results: [] });
  assert.deepEqual(ctx.artifactById("shared"), later);
});

test("reobservation SQL scopes by artifact membership without a work-item boundary", async () => {
  const queries: string[] = [];
  const sql: PromotionPageReader = async (_operation, query) => { queries.push(query); return []; };
  assert.deepEqual(await pgAcquisitionAttemptsForArtifacts(sql, []), []);
  assert.equal(queries.length, 0);
  await pgAcquisitionAttemptsForArtifacts(sql, ["held"]);
  assert.match(queries[0], /'ACQUIRER'/);
  assert.match(queries[0], /'COMPLETED'/);
  assert.match(queries[0], /\?\| \$1::text\[\]/);
  assert.doesNotMatch(queries[0], /workItemId/);
  await assert.rejects(pgAcquisitionAttemptsForArtifacts(failBroad, ["held"]), /whole-table/);
});

test("empty mapping reads no artifacts, attempts, work items or worker results", async () => {
  const repos = createMemoryRepositories();
  const scoped = { ...repos, artifacts: { ...repos.artifacts, readAll: failBroad },
    attempts: { ...repos.attempts, list: failBroad }, workItems: { ...repos.workItems, list: failBroad },
    workerResults: { ...repos.workerResults, readAll: failBroad } };
  const report = await mapEvidenceIntoPipeline(scoped, ".", "2026-10-06T00:00:00Z");
  assert.equal(report.scouted.offered, 0);
  assert.equal(report.confirmed.offered, 0);
});

test("scoped fact collection preserves cross-item byte-identical reacquisition and rejects newly broken audit", async t => {
  const h = await factChainHarness();
  t.after(() => rmSync(h.vaultRoot, { recursive: true, force: true, maxRetries: 3 }));
  const text = readFileSync(new URL("./fixtures/legistar-pima-events.json", import.meta.url), "utf8");
  const first = await h.hold(text);
  const second = await h.hold(text);
  await h.chain(first);
  const secondAttempt = await h.repos.attempts.mustRead(second.attemptId);
  await h.repos.attempts.compareAndSet(secondAttempt.id, secondAttempt.revision,
    { ...secondAttempt.value, workItemId: "another-item" }, h.now());
  const options = { now: h.now(), readArtifactText: h.readArtifactText };
  const repeated = await contextFromRepositories(h.repos, { artifacts: [first, { ...first, attemptId: second.attemptId }], results: [] });
  assert.equal(repeated.attemptRoleById(first.attemptId), "ACQUIRER", "an earlier observation's owner survives content-id deduplication");
  assert.equal(repeated.attemptRoleById(second.attemptId), "ACQUIRER");
  const baseline = await collectFactChains(h.repos, options);
  const allArtifacts = await h.repos.artifacts.readAll();
  const allAttempts = (await h.repos.attempts.list()).map(row => row.value);
  const scoped: PromotionEvidenceRepositories = { ...h.repos,
    artifacts: { ...h.repos.artifacts, readAll: failBroad },
    attempts: { ...h.repos.attempts, list: failBroad }, workItems: { ...h.repos.workItems, list: failBroad },
    artifactsForPromotion: async (ids, urls) => allArtifacts.filter(row => ids.includes(row.artifactId) || urls.includes(row.canonicalUrl)),
    acquisitionAttemptsForArtifacts: async ids => allAttempts.filter(row => row.outcome === "COMPLETED" &&
      row.worker.role === "ACQUIRER" && row.artifactIds.some(id => ids.includes(id))),
  };
  const actual = await collectFactChains(scoped, options);
  assert.deepEqual(actual, baseline);
  assert.ok(actual.items.length > 0);
  assert.ok(actual.items.every(item => item.confirmations.some(c => c.attemptId === second.attemptId && c.reobservation)));
  const results = await scoped.workerResults.readAll();
  const auditor = results.find(row => row.result.role === "ADVERSARIAL_AUDITOR")!;
  const before = await contextFromRepositories(scoped, { artifacts: allArtifacts, results });
  assert.equal(before.workerFactAuditBlocks!([first.artifactId], auditor.id), false);
  assert.equal(auditor.result.role, "ADVERSARIAL_AUDITOR");
  const broken = { ...auditor, id: "later-broken", endedAt: h.now(), result: { ...auditor.result, verdict: "BROKE" as const } } as typeof auditor;
  await scoped.workerResults.append(auditor.workItemId, broken.id, broken, broken.endedAt);
  const after = await contextFromRepositories(scoped, { artifacts: allArtifacts });
  assert.equal(after.workerFactAuditBlocks!([first.artifactId], auditor.id), true, "new job sees the break even if its producer commit is malformed");
});
