/**
 * The research round is the research state's only writer. It writes on the revision it last read or wrote and
 * learns the current one only from a lost compare-and-set, so the 1.1 MB row is never read before a write.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { SOLE_WRITER_LOST_RACES, soleWriter } from "../lib/control-plane/repository/shared.ts";
import { ConcurrentModification, type AggregateRepository } from "../lib/control-plane/repository/types.ts";

const NOW = "2026-10-07T12:00:00.000Z";
type State = { readonly n: number };

function watched(repo: AggregateRepository<State>) {
  const calls: string[] = [];
  const spy: AggregateRepository<State> = {
    ...repo,
    read: async id => { calls.push("read"); return repo.read(id); },
    readNarrowed: async (id, projection) => { calls.push(`readNarrowed:${JSON.stringify(projection)}`); return repo.readNarrowed(id, projection); },
    put: async (id, value, now) => { calls.push("put"); return repo.put(id, value, now); },
    compareAndSet: async (id, revision, next, now) => { calls.push(`cas@${revision}`); return repo.compareAndSet(id, revision, next, now); },
  };
  return { calls, spy };
}

test("writes go on the revision last written, with no read before any of them", async () => {
  const repos = createMemoryRepositories();
  const base = repos.researchState as unknown as AggregateRepository<State>;
  await base.put("level-1", { n: 0 }, NOW);
  const { calls, spy } = watched(base);
  const write = soleWriter(spy, "level-1", 1);
  for (let n = 1; n <= 3; n++) assert.equal((await write({ n }, NOW)).revision, n + 1);
  assert.deepEqual(calls, ["cas@1", "cas@2", "cas@3"]);
  assert.deepEqual((await base.read("level-1"))!.value, { n: 3 });
});

test("a lost compare-and-set goes again on the revision it names; only then is anything learned from the store", async () => {
  const repos = createMemoryRepositories();
  const base = repos.researchState as unknown as AggregateRepository<State>;
  await base.put("level-1", { n: 0 }, NOW);
  const { calls, spy } = watched(base);
  const write = soleWriter(spy, "level-1", 1);
  await write({ n: 1 }, NOW);
  await base.compareAndSet("level-1", 2, { n: 99 }, NOW);
  assert.equal((await write({ n: 2 }, NOW)).revision, 4);
  assert.deepEqual(calls, ["cas@1", "cas@2", "cas@3"], "the lost write's refusal named revision 3; the row was not read");
  assert.deepEqual((await base.read("level-1"))!.value, { n: 2 });
});

test("an absent row is created; a row never read is asked for its revision only; a store that keeps losing is refused by name", async () => {
  const repos = createMemoryRepositories();
  const base = repos.researchState as unknown as AggregateRepository<State>;
  const created = watched(base);
  await soleWriter(created.spy, "level-1", null)({ n: 1 }, NOW);
  assert.deepEqual(created.calls, ["put"]);

  const unknown = watched(base);
  await soleWriter(unknown.spy, "level-1", undefined)({ n: 2 }, NOW);
  assert.deepEqual(unknown.calls, ["readNarrowed:{}", "cas@1"], "only the revision crosses the wire, never the value");

  const raced = watched(base);
  const someoneElse = await base.read("level-1");
  await soleWriter(raced.spy, "level-1", null)({ n: 3 }, NOW).then(row => assert.equal(row.revision, someoneElse!.revision + 1));
  assert.deepEqual(raced.calls, ["put", "readNarrowed:{}", "cas@2"], "a create that finds a different row learns its revision and writes on it");

  let tries = 0;
  const losing: AggregateRepository<State> = { ...base, compareAndSet: async (id, revision) => { tries += 1; throw new ConcurrentModification("ResearchState", id, revision, revision + 1); } };
  await assert.rejects(soleWriter(losing, "level-1", 1)({ n: 4 }, NOW), ConcurrentModification);
  assert.equal(tries, SOLE_WRITER_LOST_RACES + 1);
});

test("the research round writes its state through the sole writer and reads the row once, at the start", async () => {
  const round = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /researchStateRevision = previous\?\.revision \?\? null;/);
  assert.match(round, /const putResearchState = soleWriter\(repos\.researchState, RESEARCH_STATE_ID, researchStateRevision\);/);
  assert.match(round, /await putResearchState\(researchState\(cycleFinishedAt\), nowIso\(\)\);/);
  assert.equal(round.split("repos.researchState.read(").length - 1, 1, "one read of the 1.1 MB row per round");
  assert.doesNotMatch(round, /researchState\.compareAndSet\(|researchState\.put\(/);
});
