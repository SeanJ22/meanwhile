import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readDecisionCards, readSnapshot, SNAPSHOT_ID } from "../lib/control-plane/admin-data.ts";
import { ADMIN_V6_CAPABILITY_REVISION } from "../lib/control-plane/admin-view/v6-capabilities.ts";
import { PULSE_CONFIG_REVISION_FIELDS, PULSE_RESEARCH_FIELDS, PULSE_SNAPSHOT_FIELDS, readPulse } from "../lib/control-plane/gateway/pulse-read.ts";
import type { OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import type { AggregateRepository, ControlPlaneRepositories, RecordProjection } from "../lib/control-plane/repository/types.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";

const NOW = "2026-09-25T22:00:00.000Z";
const LATER = "2026-09-25T22:05:00.000Z";
const any = <T>(value: unknown): T => value as T;

/* ------------------------------------------------------------------ readNarrowed, every provider */

async function narrowsAlike(repo: AggregateRepository<Record<string, unknown>>) {
  assert.deepEqual(await repo.listNarrowed({ kept: true }), []);
  const whole = { kept: 1, nested: { x: 1, y: 2 }, dropped: "a large document", list: [1, 2] };
  await repo.put("row", whole, NOW);
  const moved = await repo.compareAndSet("row", 1, { ...whole, kept: 2 }, LATER);
  const read = await repo.read("row");

  const narrowed = await repo.readNarrowed("row", { kept: true, nested: ["x"], list: true, absent: true });
  assert.deepEqual(narrowed?.value, { kept: 2, nested: { x: 1 }, list: [1, 2] }, "kept whole, kept narrowed, and an absent key stays absent");
  assert.equal(narrowed?.revision, moved.revision);
  assert.equal(narrowed?.revision, read?.revision);
  assert.equal(narrowed?.updatedAt, read?.updatedAt);

  const revisionOnly = await repo.readNarrowed("row", {});
  assert.deepEqual(revisionOnly?.value, {}, "an empty projection is the revision alone");
  assert.equal(revisionOnly?.revision, 2);
  assert.equal(await repo.readNarrowed("absent", { kept: true }), null, "absent is null, never an empty row");
  await repo.put("before", { kept: 3, nested: null, dropped: "unused" }, NOW);
  const listed = await repo.listNarrowed({ kept: true, nested: ["x"] });
  assert.deepEqual(listed.map(row => ({ id: row.id, value: row.value })), [
    { id: "before", value: { kept: 3, nested: null } },
    { id: "row", value: { kept: 2, nested: { x: 1 } } },
  ]);
  assert.equal(listed[1].revision, 2);
  assert.equal(listed[1].updatedAt, LATER);
  assert.deepEqual((await repo.listNarrowed({})).map(row => row.value), [{}, {}]);
  assert.deepEqual((await repo.read("row"))?.value, { ...whole, kept: 2 }, "narrowing never changes held records");
}

test("readNarrowed narrows alike in the memory provider", async () => {
  await narrowsAlike(any(createMemoryRepositories().ownerSnapshots));
});

test("readNarrowed narrows alike in the file provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "wtp-narrow-"));
  try {
    await narrowsAlike(any((await createFileRepositories(root)).ownerSnapshots));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readNarrowed in Postgres narrows in the database, reads no value for a revision, and refuses an unsafe key", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push({ text, params });
      return [{ id: params[0], revision: 7, updated_at: NOW, value: { decisionCards: [] } }];
    },
  };
  const snapshots = pgAggregateRepository<OwnerSnapshot>(sql, "OwnerSnapshot", "cp_owner_snapshots");
  const row = await snapshots.readNarrowed(SNAPSHOT_ID, { decisionCards: true });
  assert.deepEqual(row, { id: SNAPSHOT_ID, revision: 7, updatedAt: NOW, value: { decisionCards: [] } });
  const [narrow] = calls;
  assert.match(narrow.text, /^SELECT id, revision, updated_at, CASE WHEN jsonb_typeof\(cp_owner_snapshots\.value\) = 'object' THEN /);
  assert.match(narrow.text, /FROM jsonb_each\(cp_owner_snapshots\.value\) AS t WHERE t\.key IN \('decisionCards'\)\) ELSE cp_owner_snapshots\.value END AS value FROM cp_owner_snapshots WHERE id = \$1$/);
  assert.deepEqual(narrow.params, [SNAPSHOT_ID]);

  const research = pgAggregateRepository(sql, "ResearchState", "cp_research_state");
  await research.readNarrowed(RESEARCH_STATE_ID, {});
  assert.equal(calls[1].text, "SELECT id, revision, updated_at, '{}'::jsonb AS value FROM cp_research_state WHERE id = $1");

  await assert.rejects(() => snapshots.readNarrowed(SNAPSHOT_ID, { "decisionCards') --": true }), /unsafe projection key/);
});

/* ------------------------------------------------------------------ the pulse */

/** Repositories whose narrowed reads return the whole row: the pulse as it read before. */
function wholeRows(repos: ControlPlaneRepositories): ControlPlaneRepositories {
  const whole = <T>(r: AggregateRepository<T>): AggregateRepository<T> => ({ ...r, readNarrowed: async (id) => r.read(id) });
  return { ...repos, ownerSnapshots: whole(repos.ownerSnapshots), researchState: whole(repos.researchState) };
}

async function publishedWorld(): Promise<ControlPlaneRepositories> {
  const repos = createMemoryRepositories();
  await repos.runnerHeartbeat.put("pilot-runner", any({ beatAt: NOW, lastCycleFinishedAt: NOW, nextCycleDueAt: LATER, lastCycleOk: true, testedSha: null, host: "a runner" }), NOW);
  await repos.ownerSnapshots.put(
    SNAPSHOT_ID,
    any({
      formatVersion: 1,
      publishedAt: NOW,
      decisionCards: [{ rowId: "row-1" }, { rowId: "row-2" }],
      obligationsByState: [{ state: "AZ", count: { value: 3, denominator: 3, contract: "obligations", denominatorSource: "the test" } }],
      freshnessDebtRows: { held: true, value: { value: 2, denominator: 10, contract: "debt", denominatorSource: "the test" } },
      incidents: [{ cause: "x", target: "y", obligationsAffected: 1, oldestHours: 2 }],
      // What the pulse never reads, and must never need: the bulk of the row.
      assignments: { kind: "BUILT", view: { rows: Array.from({ length: 50 }, (_, i) => ({ id: `a-${i}` })) } },
      spendByPlace: [{ place: "Pima", usd: 1 }],
    }),
    NOW,
  );
  await repos.researchState.put(
    RESEARCH_STATE_ID,
    any({
      queue: {
        lanes: {
          at: NOW,
          final: true,
          deterministic: { due: 4, dispatched: 2, active: 0, waiting: 2, skippedBy: { NOT_DUE: 2 }, oldestWaitingDueAt: NOW },
          model: { due: 3, dispatched: 1, active: 1, waiting: 1, skippedBy: null, oldestWaitingDueAt: null },
        },
      },
      fleetSafety: { deferrals: Array.from({ length: 200 }, (_, i) => ({ id: `d-${i}` })) },
    }),
    NOW,
  );
  await repos.ownerDecisions.append("owner-decision", "dec-1", any({ intentId: "dec-1", subjectId: "row-1", decidedAt: NOW }), NOW);
  return repos;
}

test("the pulse from the narrowed rows is the pulse from the whole rows, field for field", async () => {
  const repos = await publishedWorld();
  const narrowed = await readPulse(repos, NOW);
  const whole = await readPulse(wholeRows(repos), NOW);
  assert.deepEqual(narrowed, whole);
  assert.equal(narrowed.counts.obligations, 3);
  assert.equal(narrowed.counts.freshnessDebtRows, 2);
  assert.equal(narrowed.counts.incidents, 1);
  assert.notEqual(narrowed.lanes, null, "the lane gauges ride on the narrowed queue");
  assert.ok(narrowed.revision.startsWith("2026-09-25T22:00:00.000Z|1|1|-|1|0|0|-|admin-capabilities/1:"), "the decision count is no longer part of the pulse revision");
  assert.match(ADMIN_V6_CAPABILITY_REVISION, /:results\/1:national\/1$/, "the last section announced has its own v6 capability revision");
  assert.ok(narrowed.revision.includes(`|${ADMIN_V6_CAPABILITY_REVISION}|-`),
    "the pulse revision names the current Admin v6 contracts, including Workers");
});

test("a saved owner policy and snapshot announce Money and Hunts on the existing pulse", async () => {
  const repos = await publishedWorld();
  const before = await readPulse(repos, NOW);
  assert.equal(before.v6?.sections.hunts, undefined, "an unread owner policy cannot claim a hunt list");
  assert.equal(before.v6?.sections.money, undefined, "an unread owner policy cannot claim the money read");
  assert.deepEqual(Object.keys(before.v6?.sections ?? {}).sort(), ["agents", "checklist", "fixes", "history", "publication", "reliability", "results", "sameCause", "scoreboard", "sends", "spend", "stuck"],
    "the place score, blockers, agents and spend need only the published snapshot; saved receipts can still claim History, and the weekly learning series needs neither");
  await repos.adminConfig.put("current", any({ expansionScopes: [], fleetSpendCeiling: null }), NOW);
  const after = await readPulse(repos, NOW);
  assert.equal(after.v6?.sections.hunts?.contract, "admin-v6/hunts@1");
  assert.equal(after.v6?.sections.money?.contract, "admin-v6/money@1");
  assert.notEqual(after.revision, before.revision, "the open page discovers the contracts on its next pulse");
  await repos.adminConfig.compareAndSet("current", 1, any({ expansionScopes: [], fleetSpendCeiling: { limitUsd: 100 } }), LATER);
  const changed = await readPulse(repos, LATER);
  assert.notEqual(changed.v6?.sections.hunts?.revision, after.v6?.sections.hunts?.revision,
    "a saved policy change invalidates the hunt section");
});

test("the pulse reads the snapshot and the research state only narrowed, and only the fields it declares", async () => {
  const repos = await publishedWorld();
  const asked: { which: string; projection: RecordProjection }[] = [];
  const refuse = (which: string) => async () => {
    throw new Error(`the pulse read ${which} whole`);
  };
  const watch = <T>(which: string, r: AggregateRepository<T>): AggregateRepository<T> => ({
    ...r,
    read: refuse(which),
    readNarrowed: async (id, projection) => {
      asked.push({ which, projection });
      return r.readNarrowed(id, projection);
    },
  });
  const pulse = await readPulse({ ...repos, ownerSnapshots: watch("the snapshot", repos.ownerSnapshots),
    researchState: watch("the research state", repos.researchState), adminConfig: { ...repos.adminConfig, ...watch("the hunt policy", repos.adminConfig) } }, NOW);
  assert.deepEqual(pulse.unread, [], "nothing it reads was refused");
  assert.deepEqual(asked, [
    { which: "the snapshot", projection: PULSE_SNAPSHOT_FIELDS },
    { which: "the research state", projection: PULSE_RESEARCH_FIELDS },
    { which: "the hunt policy", projection: PULSE_CONFIG_REVISION_FIELDS },
  ]);
  assert.deepEqual(Object.keys(PULSE_SNAPSHOT_FIELDS).sort(), ["freshnessDebtRows", "incidents", "obligationsByState"]);
  assert.deepEqual(Object.keys(PULSE_RESEARCH_FIELDS), ["queue"]);
  assert.deepEqual(Object.keys(PULSE_CONFIG_REVISION_FIELDS), [], "the pulse reads no saved hunt policy payload");
});

/* ------------------------------------------------------------------ Fleet · Now's cards */

test("Fleet · Now's decision cards are the snapshot's, in the snapshot read's words when there is none", async () => {
  const repos = await publishedWorld();
  const whole = await readSnapshot(repos);
  const cards = await readDecisionCards(repos);
  assert.equal(cards.kind, "HELD");
  assert.deepEqual(cards.kind === "HELD" ? cards.value : null, whole.kind === "HELD" ? { decisionCards: whole.value.decisionCards } : null);

  const empty = createMemoryRepositories();
  assert.deepEqual(await readDecisionCards(empty), await readSnapshot(empty), "NOT_RECORDED says the same thing either way");

  const src = readFileSync("app/(admin)/admin/page.tsx", "utf8");
  assert.doesNotMatch(src, /readDecisionCards\(/, "the home screen no longer reads the old tracker's decision cards");
  assert.doesNotMatch(src, /readSnapshot\(/, "the page never reads the whole snapshot");
});
