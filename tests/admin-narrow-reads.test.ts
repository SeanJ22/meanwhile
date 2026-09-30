/**
 * **FLEET · NOW AND READINESS READ THE FIELDS THEY DRAW, NOT THE WHOLE ROWS.**
 * (Sean, 2026-09-24: every Admin page loads under three seconds, cold starts
 * included. Measured after batch C on 2026-09-25: Fleet · Now 3.03 s on a cold
 * instance, Readiness 2.00 s.)
 *
 * ```
 *   readNarrowed   an aggregate narrowed by the store, with its revision; an
 *                  empty projection is the revision alone. Every provider
 *                  answers alike.
 *   the pulse      the snapshot's four counted fields and the research state's
 *                  lane queue, never the whole rows (1.37 MB -> 0.15 MB on
 *                  production), and the same pulse, field for field
 *   Fleet · Now    its decision cards alone (418 KB -> 83 KB)
 *   Readiness      each state's grid, without the ZIP rows it never draws
 *                  (907 KB -> 111 KB for the three states), beside its counties,
 *                  every read started before the policy row
 *   the body read  the day tally beside the snapshot, not after it in it
 * ```
 */
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
import { READINESS_DERIVATION_CONTRACT, type ReadinessStateSnapshot } from "../lib/control-plane/readiness/model.ts";
import { READINESS_GRID_FIELDS, readReadinessGridFrom, readinessRowOutcome } from "../lib/control-plane/readiness/read.ts";
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
  assert.match(ADMIN_V6_CAPABILITY_REVISION, /:workers\/1$/, "Workers has its own v6 capability revision");
  assert.ok(narrowed.revision.includes(`|${ADMIN_V6_CAPABILITY_REVISION}|-`),
    "the pulse revision names the current Admin v6 contracts, including Workers");
});

test("a saved owner policy and snapshot announce Money and Hunts on the existing pulse", async () => {
  const repos = await publishedWorld();
  const before = await readPulse(repos, NOW);
  assert.deepEqual(before.v6?.sections, {}, "an unread owner policy cannot claim a hunt list");
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
    researchState: watch("the research state", repos.researchState), adminConfig: watch("the hunt policy", repos.adminConfig) }, NOW);
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

/* ------------------------------------------------------------------ Readiness's grids */

const snapshotOf = (contract: string): ReadinessStateSnapshot =>
  any({
    formatVersion: 1,
    derivationContract: contract,
    state: "az",
    stateName: "Arizona",
    publishedAt: NOW,
    publishedFromSha: "abc1234",
    publisher: "the test",
    summary: { band: "PARTIAL" },
    capabilities: [{ capabilityId: "c-1", domain: "Meetings and agendas", gates: [{ state: "CURRENT" }, { state: "NOT_WALKED" }] }],
    zips: Array.from({ length: 300 }, (_, i) => ({ zip: String(85000 + i) })),
    evidenceWalks: [],
    delivery: [],
    monotonicityViolations: [],
  });

test("a state's grid is its snapshot without the ZIP rows, with the same outcome in every case", async () => {
  for (const contract of [READINESS_DERIVATION_CONTRACT, "readiness/hand-authored@0"]) {
    const repos = createMemoryRepositories();
    await repos.readinessSnapshots.put("az", snapshotOf(contract), NOW);
    const row = await repos.readinessSnapshots.read("az");
    const whole = readinessRowOutcome(row?.value ?? null, "pg", "Arizona", row ? { revision: row.revision, updatedAt: row.updatedAt } : null);
    const grid = await readReadinessGridFrom(repos.readinessSnapshots, "az", "Arizona", "pg");
    if (whole.kind === "HELD") {
      const { zips: _zips, ...rest } = whole.snapshot;
      assert.deepEqual(grid, { ...whole, snapshot: rest });
    } else {
      assert.equal(whole.kind, "REQUIRES_REPUBLISH");
      assert.deepEqual(grid, whole, "a superseded snapshot is quarantined in the same words, with the same record facts");
    }
  }
  const empty = createMemoryRepositories();
  assert.deepEqual(
    await readReadinessGridFrom(empty.readinessSnapshots, "az", "Arizona", "pg"),
    readinessRowOutcome(null, "pg", "Arizona"),
  );
  assert.ok(!(READINESS_GRID_FIELDS as readonly string[]).includes("zips"));
});

test("Readiness and Done read the grids; Readiness starts every read before the policy row and each grid beside its counties", () => {
  const page = readFileSync("app/(admin)/readiness/page.tsx", "utf8");
  assert.doesNotMatch(page, /readReadinessSnapshot/);
  assert.match(page, /Promise\.all\(\[readReadinessGrid\(code\), loadReadinessContainersWithCodes\(code\.toUpperCase\(\), "county", districtEdge\)\]\)/);
  assert.ok(page.indexOf("const districtEdge = readReadinessDistrictEdge()") < page.indexOf('await openPage("/readiness", sp, nowIso)'), "the verified district edge starts before openPage");
  const counties = readFileSync("app/(admin)/_mw/data/readiness-counties.ts", "utf8");
  assert.match(counties, /ensureReaderAuthorityEdge\(manifest, undefined, \["census-districts"\]\)/);
  assert.match(counties, /withReaderAuthorityEdge\(edge, \(\) => loadContainersWithCodes\(state, type\)\)/);
  assert.ok(page.indexOf("const reads = Promise.all([") < page.indexOf('await openPage("/readiness", sp, nowIso)'), "the reads start before openPage");
  assert.match(page, /reads\.catch\(\(\) => undefined\);/, "an early stop leaves no rejection unobserved");
  const done = readFileSync("app/(admin)/_mw/screens/done.tsx", "utf8");
  assert.match(done, /readReadinessGrid\(code\)/);
  assert.doesNotMatch(done, /readReadinessSnapshot/);
  // The state's own page draws the ZIP rows, so it still reads the whole snapshot.
  assert.match(readFileSync("app/(admin)/readiness/[state]/page.tsx", "utf8"), /readReadinessSnapshot\(code\)/);
});

/* ------------------------------------------------------------------ the body read */

test("the day tally runs beside the body snapshot, and the snapshot keeps the figures that must agree", () => {
  const store = readFileSync("app/(admin)/_mw/data/body-store.ts", "utf8");
  const read = store.slice(store.indexOf("export async function readBodyStore("), store.indexOf("export async function readBodyStanding("));
  const snapshot = read.slice(read.indexOf("const snapshot = sql.transaction("), read.indexOf("const day = "));
  for (const kept of ["VERSIONS_WITH_CLOCK", "ATTEMPTS", "VERSION_READBACKS"]) assert.match(snapshot, new RegExp(`\\b${kept}\\b`));
  assert.doesNotMatch(snapshot, /\bDAY\b/);
  assert.match(snapshot, /isolationLevel: "RepeatableRead"/);
  assert.match(read, /const day = sql\.transaction\(\[sql\.query\(limit\), statement\(DAY, \[nowIso\]\)\], \{ readOnly: true \}\)/);
  assert.match(read, /await Promise\.all\(\[snapshot, day, history\]\)/, "a failed day tally still fails the body read, as before");
});
