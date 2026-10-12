/**
 * The first open of an Admin page waits only for what it must:
 *
 * ```
 *   bodies      the watched-body read leaves out the change history; only an opened routine read
 *               asks for its own body's history
 *   drilldown   an opened piece of standing work is read in as few dependent round trips as its
 *               keys allow, returning the same records in the same order
 *   page        Work reads it beside its other reads and reads the newest digest alone
 * ```
 *
 * Round trips are counted with gated repositories: every read waits until the test releases the
 * reads in flight, so one release is one dependent round trip.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { readLatestDigest } from "../lib/control-plane/admin-data.ts";
import { buildBodyViews, type BodyStoreFacts, type BodyView, type VersionFacts, type WatchedContract } from "../lib/control-plane/admin-view/bodies.ts";
import { readAssignmentSourcesById } from "../lib/control-plane/assignment-read.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { AggregateRepository, AppendOnlyRepository, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { occurrenceId } from "../lib/control-plane/scheduler/durable.ts";

const NOW = "2026-09-25T20:00:00.000Z";
const OB = "freshness:campaign-finance:ballot-az-pima:prop-423#AZ_PIMA_COUNTY_CAMPAIGN_FINANCE_PAGE";
const BASE = { nowIso: NOW, activation: null, pilotZips: [] as string[] };

/* ------------------------------------------------------------------ gated repositories */

interface Gated {
  readonly repos: ControlPlaneRepositories;
  /** Runs the read, releasing the reads in flight one round at a time; each round lists the reads it held. */
  run<T>(read: () => Promise<T>): Promise<{ readonly value: T; readonly rounds: readonly (readonly string[])[] }>;
}

function gated(repos: ControlPlaneRepositories): Gated {
  const held: { readonly label: string; readonly go: () => void }[] = [];
  const hold = <T>(label: string, read: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      held.push({ label, go: () => void read().then(resolve, reject) });
    });
  const agg = <T>(name: string, r: AggregateRepository<T>): AggregateRepository<T> => ({ ...r, read: (id) => hold(`${name}:${id}`, () => r.read(id)) });
  const log = <T>(name: string, r: AppendOnlyRepository<T>): AppendOnlyRepository<T> => ({
    ...r,
    read: (key) => hold(`${name}:${key}`, () => r.read(key)),
    readAll: () => hold(`${name}:*`, () => r.readAll()),
    readRecent: (key, limit) => hold(`${name}:recent(${limit})`, () => r.readRecent(key, limit)),
  });
  const wrapped: ControlPlaneRepositories = {
    ...repos,
    obligations: agg("obligations", repos.obligations),
    debts: agg("debts", repos.debts),
    occurrences: agg("occurrences", repos.occurrences),
    workItems: agg("workItems", repos.workItems),
    routeTasks: agg("routeTasks", repos.routeTasks),
    attempts: agg("attempts", repos.attempts),
    leases: agg("leases", repos.leases),
    scoutResults: log("scoutResults", repos.scoutResults),
    artifacts: log("artifacts", repos.artifacts),
    costs: log("costs", repos.costs),
    workerResults: log("workerResults", repos.workerResults),
    dispositions: log("dispositions", repos.dispositions),
    promotionPipeline: log("promotionPipeline", repos.promotionPipeline),
    ownerDigests: log("ownerDigests", repos.ownerDigests),
  };
  return {
    repos: wrapped,
    async run(read) {
      let settled = false;
      const out = read().finally(() => {
        settled = true;
      });
      const rounds: string[][] = [];
      for (let idle = 0; !settled; ) {
        await new Promise((r) => setImmediate(r));
        if (held.length === 0) {
          if (++idle > 20) throw new Error("the read is waiting on something that is not a store read");
          continue;
        }
        idle = 0;
        const round = held.splice(0);
        rounds.push(round.map((h) => h.label).sort());
        for (const h of round) h.go();
      }
      return { value: await out, rounds };
    },
  };
}

/* ------------------------------------------------------------------ fixtures */

const any = <T>(value: unknown): T => value as T;

/** An ordinary piece of standing work: two rounds, each with its work item, route task and closed attempt. */
async function ordinary(): Promise<ControlPlaneRepositories> {
  const repos = createMemoryRepositories();
  await repos.obligations.put(OB, any({ id: OB, occurrenceCount: 2 }), NOW);
  await repos.debts.put(OB, any({ obligationId: OB, rows: 1 }), NOW);
  await repos.scoutResults.append(OB, "sr-1", any({ outcome: "ROUTE_CANDIDATE", attemptId: "at-scout", workItemId: "wi-1", candidates: [{ routeId: "route-1" }] }), NOW);
  for (const n of [1, 2]) {
    await repos.occurrences.put(occurrenceId(OB, n), any({ sequence: n, workItemId: `wi-${n}`, routeTaskId: `rt-${n}` }), NOW);
    await repos.workItems.put(`wi-${n}`, any({ id: `wi-${n}`, obligation: OB, routeTaskIds: [`rt-${n}`] }), NOW);
    await repos.routeTasks.put(`rt-${n}`, any({ id: `rt-${n}`, attemptIds: [`at-${n}`] }), NOW);
    await repos.attempts.put(`at-${n}`, any({ id: `at-${n}`, routeTaskId: `rt-${n}`, outcome: { kind: "SUCCEEDED" } }), NOW);
  }
  await repos.artifacts.append("wi-1", "art-1", any({ id: "art-1" }), NOW);
  await repos.costs.append("wi-2", "cost-1", any({ id: "cost-1", usd: 0.01 }), NOW);
  await repos.dispositions.append("rt-1", "dc-1", any({ id: "dc-1" }), NOW);
  return repos;
}

/* ------------------------------------------------------------------ the drilldown */

test("an ordinary drilldown is four dependent round trips, and the pipeline no longer waits behind the attempts", async () => {
  const g = gated(await ordinary());
  const { value, rounds } = await g.run(() => readAssignmentSourcesById(g.repos, OB, BASE));
  assert.equal(value.kind, "HELD");
  assert.equal(rounds.length, 4, `rounds: ${JSON.stringify(rounds)}`);
  // Everything keyed by the id itself goes first, together.
  assert.deepEqual(rounds[0], [`debts:${OB}`, `obligations:${OB}`, `scoutResults:${OB}`]);
  // The rounds and the pipeline items the Scout result names, together.
  assert.deepEqual(rounds[1].filter((l) => l.startsWith("occurrences:")).length, 2);
  assert.equal(rounds[1].filter((l) => l.startsWith("promotionPipeline:")).length, 1);
  // Everything keyed by the rounds' work items and route tasks, together.
  for (const kind of ["workItems", "routeTasks", "artifacts", "costs", "workerResults", "dispositions"]) {
    assert.equal(rounds[2].filter((l) => l.startsWith(`${kind}:`)).length, 2, `${kind} in the third round`);
  }
  assert.deepEqual(rounds[3], ["attempts:at-1", "attempts:at-2"]);
  // No record is read twice.
  const all = rounds.flat();
  assert.equal(new Set(all).size, all.length);
});

test("the drilldown returns the same records, in the same order, however its reads are scheduled", async () => {
  const repos = await ordinary();
  // A later route task a work item lists that no round names, with an open attempt holding a lease.
  const wi2 = await repos.workItems.mustRead("wi-2");
  await repos.workItems.compareAndSet("wi-2", wi2.revision, any({ ...(wi2.value as object), routeTaskIds: ["rt-2", "rt-9"] }), NOW);
  await repos.routeTasks.put("rt-9", any({ id: "rt-9", attemptIds: ["at-9"] }), NOW);
  await repos.attempts.put("at-9", any({ id: "at-9", routeTaskId: "rt-9", outcome: null }), NOW);
  await repos.leases.put("rt-9", any({ routeTaskId: "rt-9", holder: "runner" }), NOW);
  await repos.dispositions.append("rt-9", "dc-9", any({ id: "dc-9" }), NOW);

  const g = gated(repos);
  const { value, rounds } = await g.run(() => readAssignmentSourcesById(g.repos, OB, BASE));
  assert.equal(value.kind, "HELD");
  if (value.kind !== "HELD") return;
  const v = value.value;
  assert.deepEqual(
    v.occurrences.map((o) => (o as unknown as { workItemId: string }).workItemId),
    ["wi-1", "wi-2"],
  );
  assert.deepEqual(v.workItems.map((w) => w.id), ["wi-1", "wi-2"]);
  assert.deepEqual(v.routeTasks.map((t) => t.id), ["rt-1", "rt-2", "rt-9"]);
  assert.deepEqual(v.attempts.map((a) => a.id), ["at-1", "at-2", "at-9"]);
  assert.deepEqual((v.dispositions ?? []).map((d) => (d as unknown as { id: string }).id), ["dc-1", "dc-9"]);
  assert.deepEqual((v.leases ?? []).map((l) => (l as unknown as { routeTaskId: string }).routeTaskId), ["rt-9"]);
  assert.deepEqual(v.artifacts.map((a) => (a as unknown as { id: string }).id), ["art-1"]);
  assert.deepEqual(v.costs.map((c) => (c as unknown as { id: string }).id), ["cost-1"]);
  assert.equal(v.debts.length, 1);
  assert.equal(v.scoutResults.length, 1);
  assert.deepEqual(v.pipeline, []);
  // The later task costs one more round for its attempt and commits, and one for the lease: six, never a round per list.
  assert.equal(rounds.length, 6, `rounds: ${JSON.stringify(rounds)}`);
  assert.deepEqual(rounds[4], ["attempts:at-9", "dispositions:rt-9"]);
  assert.deepEqual(rounds[5], ["leases:rt-9"]);
});

test("a work item's drilldown reuses the item it read and reads its Scout results and the pipeline beside its tasks", async () => {
  const repos = createMemoryRepositories();
  await repos.workItems.put("wi-7", any({ id: "wi-7", obligation: OB, routeTaskIds: ["rt-7"] }), NOW);
  await repos.routeTasks.put("rt-7", any({ id: "rt-7", attemptIds: ["at-7"] }), NOW);
  await repos.attempts.put("at-7", any({ id: "at-7", routeTaskId: "rt-7", outcome: { kind: "SUCCEEDED" } }), NOW);
  await repos.scoutResults.append(OB, "sr-7", any({ outcome: "NO_ROUTE", attemptId: "at-s7", workItemId: "wi-7", candidates: [] }), NOW);
  await repos.scoutResults.append(OB, "sr-8", any({ outcome: "NO_ROUTE", attemptId: "at-s8", workItemId: "wi-other", candidates: [] }), NOW);

  const g = gated(repos);
  const { value, rounds } = await g.run(() => readAssignmentSourcesById(g.repos, "wi-7", BASE));
  assert.equal(value.kind, "HELD");
  if (value.kind !== "HELD") return;
  assert.deepEqual(value.value.workItems.map((w) => w.id), ["wi-7"]);
  assert.equal(value.value.scoutResults.length, 1, "only the Scout results this work item recorded");
  assert.equal(rounds.length, 4, `rounds: ${JSON.stringify(rounds)}`);
  assert.deepEqual(rounds[1], ["workItems:wi-7"]);
  assert.ok(rounds[2].includes(`scoutResults:${OB}`) && rounds[2].includes("promotionPipeline:*") && rounds[2].includes("routeTasks:rt-7"));
  assert.equal(rounds.flat().filter((l) => l === "workItems:wi-7").length, 1, "the work item is read once");
});

test("an id that names nothing is NOT_RECORDED after two round trips, never an empty assignment", async () => {
  const g = gated(createMemoryRepositories());
  const { value, rounds } = await g.run(() => readAssignmentSourcesById(g.repos, "no-such-id", BASE));
  assert.equal(value.kind, "NOT_RECORDED");
  assert.equal(rounds.length, 2);
});

/* ------------------------------------------------------------------ the newest digest */

test("the runner card's digest is one row from the tail of the log, the newest", async () => {
  const repos = createMemoryRepositories();
  const g = gated(repos);
  const empty = await g.run(() => readLatestDigest(g.repos));
  assert.equal(empty.value.kind, "NOT_RECORDED");
  for (const n of [1, 2, 3]) await repos.ownerDigests.append("owner-digest", `d-${n}`, any({ n }), NOW);
  const { value, rounds } = await g.run(() => readLatestDigest(g.repos));
  assert.deepEqual(rounds, [["ownerDigests:recent(1)"]]);
  assert.equal(value.kind, "HELD");
  assert.equal(value.kind === "HELD" ? (value.value as unknown as { n: number }).n : null, 3);
});

/* ------------------------------------------------------------------ the body read */

const AZ = "ocd-division/country:us/state:az";
const contract = (id: string, bodyId: string): WatchedContract => ({
  id: `meetings:test:${id}`,
  scope: `source:test:body:${id}`,
  bodyId,
  ocdId: `${AZ}/county:pima`,
  meetingSource: "test",
  jurisdiction: "Pima County",
  publishingOrg: "Pima County",
  sourceUrl: `https://example.gov/${id}`,
  verifiedAt: null,
  cadence: { description: "every hour", defaultEveryMs: 3_600_000 },
  retry: { afterMs: 900_000, description: "fifteen minutes later" },
});
// One body read through two sources, and another body.
const legistar = contract("pima-legistar", `${AZ}/county:pima#board`);
const insite = contract("pima-insite", `${AZ}/county:pima#board`);
const clerk = contract("pima-clerk", `${AZ}/county:pima#clerk`);
const CONTRACTS = [legistar, insite, clerk];
const version = (c: WatchedContract, id: string, meetings: number): VersionFacts => ({
  scope: c.scope, versionId: id, promotedAt: "2026-09-25T19:00:00.000Z", meetings, fresh: meetings, carried: 0, docs: 1, noAgendaLink: 0,
  noAgendaAhead: 0, upcoming: 2, furthestAhead: "2026-12-01T00:00:00.000Z", bodyName: "Board of Supervisors", jurisdiction: "Pima County",
  outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0, horizon: null,
});
const attempt = (c: WatchedContract, id: string, at: string) => ({ scope: c.scope, candidateId: id, state: "PROMOTED", failureCode: null, failureDetail: null, acquisitionSucceeded: true, attemptedAt: at });
const change = (c: WatchedContract, id: string) => ({
  scope: c.scope, versionId: id, retrievedAt: "2026-09-24T09:59:00.000Z", promotedAt: "2026-09-24T10:00:00.000Z", validatedAt: "2026-09-24T10:00:00.000Z",
  added: 2, changed: 1, removed: 0, held: 0, meetingsAdded: 2, named: [{ title: "Regular meeting", startsAt: "2026-10-07T17:00:00.000Z" }], meetingsChanged: 1, changedNamed: [],
});

/* The whole read, as the pages read it before: figures, the served versions' readbacks, the day, and every body's latest change with its readbacks. */
const WHOLE: BodyStoreFacts = {
  asOf: NOW,
  versions: [version(legistar, "cv-l", 15), version(insite, "cv-i", 12), version(clerk, "cv-k", 4)],
  attempts: [attempt(legistar, "cv-l", "2026-09-25T19:00:00.000Z"), attempt(insite, "cv-i", "2026-09-25T18:00:00.000Z"), attempt(clerk, "cv-k", "2026-09-25T19:30:00.000Z")],
  readbacks: [
    { candidateId: "cv-l", at: "2026-09-25T19:05:00.000Z", passed: true },
    { candidateId: "cv-i", at: "2026-09-25T18:05:00.000Z", passed: true },
    { candidateId: "cv-k", at: "2026-09-25T19:35:00.000Z", passed: false },
    // The latest changes' own readbacks: read with the history, and about versions no longer served.
    { candidateId: "cv-l-old", at: "2026-09-24T10:05:00.000Z", passed: true },
    { candidateId: "cv-k-old", at: "2026-09-24T10:05:00.000Z", passed: true },
  ],
  day: CONTRACTS.map((c) => ({ scope: c.scope, reads: 24, gotIn: 24, versions: 24, changedVersions: 0, cannotTell: 0, added: 0, changed: 0, removed: 0 })),
  changes: [change(legistar, "cv-l-old"), change(clerk, "cv-k-old")],
};
/* Every page's read now: the same statements without the history, so no change and none of its readbacks. */
const WITHOUT_HISTORY: BodyStoreFacts = { ...WHOLE, readbacks: WHOLE.readbacks.filter((r) => !r.candidateId.endsWith("-old")), changes: null };

test("the body read every page makes without the change history draws every figure the whole read drew, and marks each trail not read", () => {
  const whole = buildBodyViews({ contracts: CONTRACTS, store: WHOLE, nowIso: NOW });
  const light = buildBodyViews({ contracts: CONTRACTS, store: WITHOUT_HISTORY, nowIso: NOW });
  const strip = (views: readonly BodyView[]) => views.map(({ lastChange: _trail, changeRead: _read, ...rest }) => rest);
  assert.deepEqual(strip(light), strip(whole));
  assert.ok(whole.every((v) => v.changeRead && v.lastChange !== null), "the whole read holds a trail for each body");
  assert.ok(light.every((v) => !v.changeRead && v.lastChange === null), "without the history each trail is not read, never 'no change'");
});

test("one body read whole, narrowed to its own sources, is the view the whole read built for it", () => {
  const whole = buildBodyViews({ contracts: CONTRACTS, store: WHOLE, nowIso: NOW });
  const board = CONTRACTS.filter((c) => c.bodyId === legistar.bodyId);
  const scopes = new Set(board.map((c) => c.scope));
  // What the narrowed statements answer: the rows of this body's scopes, and the readbacks of its versions.
  const mine = new Set([...WHOLE.versions.filter((v) => scopes.has(v.scope)).map((v) => v.versionId), ...(WHOLE.changes ?? []).filter((c) => scopes.has(c.scope)).map((c) => c.versionId)]);
  const narrowed: BodyStoreFacts = {
    asOf: NOW,
    versions: WHOLE.versions.filter((v) => scopes.has(v.scope)),
    attempts: WHOLE.attempts.filter((a) => scopes.has(a.scope)),
    readbacks: WHOLE.readbacks.filter((r) => mine.has(r.candidateId)),
    day: WHOLE.day.filter((d) => scopes.has(d.scope)),
    changes: (WHOLE.changes ?? []).filter((c) => scopes.has(c.scope)),
  };
  const [one, ...none] = buildBodyViews({ contracts: board, store: narrowed, nowIso: NOW });
  assert.equal(none.length, 0);
  assert.deepEqual(one, whole.find((v) => v.id === legistar.bodyId));
  assert.equal(one.contractIds.length, 2, "both of the body's sources");
  assert.equal(one.lastChange?.versionId, "cv-l-old");
});
