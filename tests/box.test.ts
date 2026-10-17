import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { backfillBox, boxCounts, boxCountsByWorkItem, boxFindingId, finishBoxFinding, indexBoxFinding, indexScoutFindings, takeBoxFinding, type BoxInput } from "../lib/control-plane/box.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";

const NOW = "2026-10-04T08:00:00Z", LATER = "2026-10-04T08:01:00Z", END = "2026-10-04T08:02:00Z";
const input: BoxInput = { subjectId: "person:alice", exactQuote: "Alice Adams is Clerk", sourceUrl: "https://example.gov/roster",
  origin: { kind: "SCOUT", resultId: "attempt-1", workItemId: "send-1", findingIndex: 0, artifactIds: ["artifact-1"], recordedAt: NOW } };

test("Box deduplicates quote/page/subject and retains every source result without reopening built work", async () => {
  const repo = createMemoryRepositories().boxFindings;
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
  const repo = createMemoryRepositories().boxFindings;
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
  const open = async () => (await createFileRepositories(root)).boxFindings;
  const first = await indexBoxFinding(await open(), input, NOW);
  const claim = (await takeBoxFinding(await open(), first.id, "builder", NOW, END))!;
  assert.equal(await takeBoxFinding(await open(), first.id, "another", LATER, END), null);
  assert.equal(await finishBoxFinding(await open(), first.id, claim.token, { state: "built", publicationId: first.id }, LATER), true);
  await indexBoxFinding(await open(), input, END);
  assert.equal((await (await open()).list()).length, 1);
  assert.equal((await (await open()).mustRead(first.id)).value.publicationId, first.id);
});

test("legacy findings without a quote stay distinct, and a broken read never reports zero", async () => {
  const repo = createMemoryRepositories().boxFindings;
  await indexBoxFinding(repo, { ...input, exactQuote: null }, NOW);
  await indexBoxFinding(repo, { ...input, exactQuote: null, origin: { ...input.origin, findingIndex: 1 } }, NOW);
  assert.equal((await boxCounts(repo)).waiting, 2);
  await assert.rejects(() => boxCounts({ ...repo, list: async () => { throw new Error("store unavailable"); } }), /store unavailable/);
});

const scoutResult = (findings: readonly Record<string, unknown>[], recordClass?: string) => ({ subjectId: "place:start", attemptId: "scout-1", workItemId: "send-1",
  obligationId: "ob-1", recordedAt: NOW, ...(recordClass ? { recordClass } : {}), findings }) as unknown as ScoutResult;

/** A Detective result as completion commits it: its Attempt closed COMPLETED and the record carrying that same Attempt. */
async function committedDetective(repos: ReturnType<typeof createMemoryRepositories>, committed: boolean) {
  const attempt = { id: "detective-attempt", outcome: "COMPLETED" } as unknown as Attempt;
  if (committed) await repos.attempts.put(attempt.id, attempt, NOW);
  const result = { role: "DETECTIVE", attemptId: attempt.id, verdict: "UNRESOLVED", question: { text: "Who is Clerk?", subjectId: "person:alice", alternatives: [] },
    artifactIds: ["artifact-1"], spans: [{ artifactId: "artifact-1", contentHash: "held-hash", quote: input.exactQuote!, start: 0, end: input.exactQuote!.length, offsetUnit: "UTF16_CODE_UNITS" }],
    alternativesTested: [], findings: [{ code: "EXPLANATION", severity: "INFO", detail: "Inspect the existing result." }], blockers: [], walk: [],
    walkState: { state: "OPEN", nextRouteIds: [] }, falsificationCondition: "Another roster", nextAction: "Ask the clerk", burden: "UNRESOLVED", denominator: { state: "UNKNOWN", populationDefinition: null } };
  const record = { id: "detective-1", workItemId: "send-2", attemptId: attempt.id, endedAt: NOW, result,
    completion: { closedAttempt: attempt, completedTask: { workerTask: { role: "DETECTIVE" } } } } as unknown as WorkerResultRecord;
  await repos.workerResults.append(record.workItemId, record.id, record, NOW);
}

test("the backfill indexes Scout and committed Detective findings recorded since its last pass, reading each span's page by its id", async () => {
  const repos = createMemoryRepositories();
  await repos.scoutResults.append("ob-1", "scout-1", scoutResult([
    { subjectId: "person:alice", missionPart: "roster", kind: "RECORD", summary: "Clerk", exactQuote: input.exactQuote!, sourceUrl: input.sourceUrl!, artifactIds: ["artifact-1"] },
    { kind: "POINTER", summary: "Older result without a copied quote", artifactIds: ["artifact-2"] }]), NOW);
  await repos.artifacts.append("send-0", "artifact-1", { artifactId: "artifact-1", workItemId: "send-0", canonicalUrl: input.sourceUrl! } as unknown as ArtifactRecord, NOW);
  await committedDetective(repos, true);
  await backfillBox(repos, NOW);
  const cursor = (await repos.passCursors.mustRead("box-backfill")).value.through;
  const asked: (string | null)[] = [];
  const watched = { ...repos, scoutResults: { ...repos.scoutResults, readChangedSince: (since: string | null) => { asked.push(since); return repos.scoutResults.readChangedSince(since); } } };
  await backfillBox(watched, LATER);
  assert.deepEqual(asked, [new Date(Date.parse(cursor) - 60_000).toISOString()], "the next pass reads only what changed since the last, a minute back");
  const rows = await repos.boxFindings.list();
  assert.equal(rows.length, 3, "shared quote deduplicates; old pointer and detective finding are both retained");
  const shared = (await repos.boxFindings.mustRead(boxFindingId(input))).value;
  assert.equal(shared.origins.length, 2, "the span's page was found under another item's log by its id");
  assert.equal(shared.subjectId, "person:alice", "the target overrides the starting subject");
  assert.equal(shared.origins.find(o => o.kind === "SCOUT")?.missionPart, "roster");
  const counts = await boxCountsByWorkItem(repos.boxFindings);
  assert.equal(counts["send-1"].waiting, 2);
  assert.equal(counts["send-2"].waiting, 2);
});

test("an uncommitted Detective result, or a malformed one, is never indexed", async () => {
  const repos = createMemoryRepositories();
  await committedDetective(repos, false);
  await repos.workerResults.append("send-3", "malformed", { id: "malformed" } as unknown as WorkerResultRecord, NOW);
  assert.equal(await backfillBox(repos, NOW), 0);
  assert.deepEqual(await repos.boxFindings.list(), []);
});

test("a Box row keeps its finding's field and value; a row from before that gains them on the first pass, and the queue hands builders only due rows", async () => {
  const repos = createMemoryRepositories();
  const scout = scoutResult([{ subjectId: "person:alice", field: "officeholder.name", value: "Alice Adams", kind: "RECORD", summary: "Clerk",
    exactQuote: input.exactQuote!, sourceUrl: input.sourceUrl!, artifactIds: ["artifact-1"] }], "roster");
  const id = boxFindingId(input);
  await indexScoutFindings(repos.boxFindings, scout, NOW);
  const held = await repos.boxFindings.mustRead(id);
  const { fact: _fact, lastRecordedAt: _at, ...older } = held.value;
  await repos.boxFindings.compareAndSet(id, held.revision, older, NOW);
  await repos.scoutResults.append("ob-1", "scout-1", scout, NOW);
  await backfillBox(repos, LATER);
  const row = (await repos.boxFindings.mustRead(id)).value;
  assert.deepEqual([row.fact, row.lastRecordedAt], [{ field: "officeholder.name", value: "Alice Adams", recordClass: "roster" }, NOW]);
  assert.deepEqual((await repos.boxFindings.due({ slots: "5", now: LATER, since: NOW, limit: 10 })).map(due => due.id), [id], "never looked at under this slot map");
  assert.deepEqual(await repos.boxFindings.due({ slots: "5", now: LATER, since: LATER, limit: 10 }), [], "recorded before the window");
  assert.deepEqual(await repos.boxFindings.waitingFor("ANY_REASON", 10), []);
});
