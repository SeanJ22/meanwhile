import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backfillBox, boxCounts, boxCountsBySend, boxFindingId, finishBoxFinding, indexBoxFinding, takeBoxFinding, type BoxFinding, type BoxInput } from "../lib/control-plane/box.ts";
import { memoryAggregateRepository } from "../lib/control-plane/repository/memory.ts";
import { fileAggregateRepository } from "../lib/control-plane/repository/file-store.ts";

const NOW = "2026-10-04T08:00:00Z", LATER = "2026-10-04T08:01:00Z", END = "2026-10-04T08:02:00Z";
const input: BoxInput = { subjectId: "person:alice", exactQuote: "Alice Adams is Clerk", sourceUrl: "https://example.gov/roster",
  origin: { kind: "SCOUT", resultId: "attempt-1", workItemId: "send-1", findingIndex: 0, artifactIds: ["artifact-1"], recordedAt: NOW } };

test("Box deduplicates quote/page/subject and retains every source result without reopening built work", async () => {
  const repo = memoryAggregateRepository<BoxFinding>("box_findings");
  const [a, b] = await Promise.all([indexBoxFinding(repo, input, NOW), indexBoxFinding(repo, { ...input, origin: { ...input.origin, resultId: "attempt-2" } }, NOW)]);
  assert.equal(a.id, b.id);
  assert.equal((await repo.mustRead(a.id)).value.origins.length, 2);
  const claim = (await takeBoxFinding(repo, a.id, "builder-a", NOW, END))!;
  assert.equal(await finishBoxFinding(repo, a.id, claim.token, { state: "built", publicationId: "publication-1" }, LATER), true);
  await indexBoxFinding(repo, input, END);
  assert.equal(await takeBoxFinding(repo, a.id, "builder-b", END, "2026-10-04T08:03:00Z"), null);
  assert.deepEqual(await boxCounts(repo), { waiting: 0, taken: 0, built: 1, refused: 0 });
  assert.notEqual(boxFindingId(input), boxFindingId({ ...input, subjectId: "person:bob" }));
});

test("only one concurrent builder wins; expired and failed claims retry with stale completion fenced out", async () => {
  const repo = memoryAggregateRepository<BoxFinding>("box_findings");
  const finding = await indexBoxFinding(repo, input, NOW);
  const claims = await Promise.all([takeBoxFinding(repo, finding.id, "a", NOW, LATER), takeBoxFinding(repo, finding.id, "b", NOW, LATER)]);
  assert.equal(claims.filter(Boolean).length, 1);
  const first = claims.find(Boolean)!;
  const second = (await takeBoxFinding(repo, finding.id, "c", LATER, END))!;
  assert.equal(second.generation, 2);
  assert.equal(await finishBoxFinding(repo, finding.id, first.token, { state: "built", publicationId: "stale" }, LATER), false);
  assert.equal(await finishBoxFinding(repo, finding.id, second.token, { state: "failed", reason: "Builder process failed" }, LATER), true);
  assert.equal((await repo.mustRead(finding.id)).value.state, "waiting");
  assert.deepEqual((await repo.mustRead(finding.id)).value.attempts.map(a => a.outcome), ["expired", "failed"]);
});

test("a restarted file store keeps claims and built receipts; replayed history cannot duplicate a finding", async t => {
  const root = await mkdtemp(join(tmpdir(), "box-restart-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const open = () => fileAggregateRepository<BoxFinding>(root, "box_findings", "box-findings");
  const first = await indexBoxFinding(open(), input, NOW);
  const claim = (await takeBoxFinding(open(), first.id, "builder", NOW, END))!;
  assert.equal(await takeBoxFinding(open(), first.id, "another", LATER, END), null);
  assert.equal(await finishBoxFinding(open(), first.id, claim.token, { state: "built", publicationId: first.id }, LATER), true);
  await indexBoxFinding(open(), input, END);
  assert.equal((await open().list()).length, 1);
  assert.equal((await open().mustRead(first.id)).value.publicationId, first.id);
});

test("legacy findings without a quote stay distinct, and a broken read never reports zero", async () => {
  const repo = memoryAggregateRepository<BoxFinding>("box_findings");
  await indexBoxFinding(repo, { ...input, exactQuote: null }, NOW);
  await indexBoxFinding(repo, { ...input, exactQuote: null, origin: { ...input.origin, findingIndex: 1 } }, NOW);
  assert.equal((await boxCounts(repo)).waiting, 2);
  await assert.rejects(() => boxCounts({ ...repo, list: async () => { throw new Error("store unavailable"); } }), /store unavailable/);
});

test("historical Scout and detective findings share the index, including missing old quotes and another target", async () => {
  const repo = memoryAggregateRepository<BoxFinding>("box_findings");
  const history = {
    scouts: [{ subjectId: "place:start", attemptId: "scout-1", workItemId: "send-1", recordedAt: NOW, findings: [
      { subjectId: "person:alice", missionPart: "roster", kind: "RECORD" as const, summary: "Clerk", exactQuote: input.exactQuote!, sourceUrl: input.sourceUrl!, artifactIds: ["artifact-1"] },
      { kind: "POINTER" as const, summary: "Older result without a copied quote", artifactIds: ["artifact-2"] },
    ] }],
    detectives: [{ id: "detective-1", workItemId: "send-2", endedAt: NOW, result: { role: "DETECTIVE" as const, question: { subjectId: "person:alice" },
      spans: [{ artifactId: "artifact-1", contentHash: "held-hash", quote: input.exactQuote!, start: 0, end: input.exactQuote!.length, offsetUnit: "UTF16_CODE_UNITS" as const }],
      artifactIds: ["artifact-1"], findings: [{ code: "EXPLANATION", severity: "INFO" as const, detail: "Inspect the existing result." }],
    } }],
    artifacts: new Map([["artifact-1", { canonicalUrl: input.sourceUrl! }]]),
  };
  await backfillBox(repo, history, NOW);
  await backfillBox(repo, history, LATER);
  assert.equal((await repo.list()).length, 3, "shared quote deduplicates; old pointer and detective finding are both retained");
  const shared = (await repo.mustRead(boxFindingId(input))).value;
  assert.equal(shared.origins.length, 2);
  assert.equal(shared.subjectId, "person:alice", "the target overrides the starting subject");
  assert.equal(shared.origins.find(o => o.kind === "SCOUT")?.missionPart, "roster");
  const counts = await boxCountsBySend(repo);
  assert.equal(counts["send-1"].waiting, 2);
  assert.equal(counts["send-2"].waiting, 2);
});
