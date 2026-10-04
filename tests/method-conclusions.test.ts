/**
 * **THE REOPENING LOOP, CLOSED, END TO END.** (2026-08-29.)
 *
 * `findReopenings()` and `applyReopenings()` have been correct since the method
 * store was built, and until now they ran over an empty array on every single
 * session — because nothing in this repository ever persisted a
 * `PriorConclusion`. `pnpm method:check` read `data/method/conclusions.json`,
 * the file did not exist, and the sweep reported zero awaiting reopening. Zero
 * was true the way a selector that matches nothing reports zero offenders: the
 * instrument was never pointed at a population.
 *
 * The five steps of the loop, each asserted, and none of them faked:
 *
 *   1. a conclusion is EARNED under method version N and persisted, stamped
 *      with N;
 *   2. a genuinely new applicable route is ADMITTED at N+1 through the
 *      candidate -> validation -> admission path, not by editing the store;
 *   3. `findReopenings()` identifies the prior conclusion;
 *   4. the WorkItem re-enters `REOPENED` — the REAL state from
 *      `lib/control-plane/work-item.ts`, imported rather than re-spelled;
 *   5. route existence SURVIVES a withdrawn or invalidated conclusion.
 *
 * **NO HISTORIC CONCLUSION IS MANUFACTURED HERE.** Every conclusion in this file
 * is earned inside the test, against a throwaway copy of the store, and carries
 * `fixture: true` IN ITS OWN DATA — which `validateConclusions` refuses in the
 * canonical corpus by name. A comment saying "this is only a fixture" is
 * invisible to the corpus a later session reads.
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  WORK_ITEM_STATES,
  createWorkItem,
  isTerminalState,
  type WorkItemState,
} from "../lib/control-plane/work-item.ts";
import {
  emptyConclusionStore,
  openConclusions,
  readConclusionStore,
  recordConclusion,
  validateConclusions,
  withdrawConclusion,
  workItemStateAfterReopening,
  writeConclusionStore,
  type ConclusionStore,
} from "../lib/method/conclusions.ts";
import { applyReopenings, findReopenings, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { emptyCandidateStore } from "../lib/method/candidate.ts";
import { admitLearnedRoutes, type LearnedRoute } from "../lib/method/learn-batch.ts";
import { methodFixture } from "./method-store-fixture.ts";
import { projectionHasRoute, projectMethodFor } from "../lib/method/projection.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ON = "2026-08-29";

/** The sweep the retired `reopenConclusions` wrapped: find what the new route reopens, record it on the conclusions. */
function runReopenings(store: ConclusionStore, k: MethodKnowledge, on: string) {
  const reopenings = findReopenings(k, store);
  const applied = applyReopenings(store, reopenings, on) as ConclusionStore;
  return { store: applied, reopenings, reopened: reopenings.map((r) => r.conclusion.id) };
}
const AZ = { state: "az", governmentType: "county" };

function scratch(name: string): { dir: string; conclusionPath: string } {
  const dir = join(ROOT, ".scratch", `method-conclusions-${name}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, "data", "method"), { recursive: true });
  return { dir, conclusionPath: join(dir, "data", "method", "conclusions.json") };
}

/** Admit one new route through the real gate, in memory, and return the grown knowledge. */
function admit(k: MethodKnowledge, route: LearnedRoute, attemptId: string): MethodKnowledge {
  const out = admitLearnedRoutes(k, emptyCandidateStore(), [route], { stamp: ON, attemptId });
  assert.equal(out.admitted, true, `the avenue was refused: ${out.refusal}`);
  return out.knowledge;
}

/** The new avenue. A real `LearnedRoute`, admitted through the real gate. */
function newAvenue(id: string): LearnedRoute {
  return {
    id,
    title: `${id} — a synthetic route used only to prove the reopening loop`,
    tier: "A1",
    fields: ["meeting"],
    note: "a test route; portability is UNKNOWN, so it inherits everywhere and claims nothing",
    origin: "tests/method-conclusions.test.ts",
    outcome: { jurisdiction: "az", rows: 2, outcome: "YIELDED", note: "synthetic" },
    claims: [
      { id: `${id}#exists`, class: "ROUTE_EXISTENCE", statement: "this synthetic route exists", restsOn: [] },
    ],
  };
}

/**
 * Earn a conclusion against a store, honestly: it is stamped with the version
 * that store is actually at, and it names the routes that were walked.
 */
function earn(
  store: ConclusionStore,
  k: MethodKnowledge,
  routeIds: readonly string[],
): ReturnType<typeof recordConclusion> {
  return recordConclusion(
    store,
    k,
    {
      kind: "ABSENCE",
      field: "meeting",
      jurisdiction: AZ,
      why: "a synthetic conclusion earned inside a test, so the reopening loop has an input",
      earnedBy: { routeIds: [...routeIds], attemptId: "at-test-earned", workItemId: "wi-test" },
      fixture: true,
    },
    ON,
  );
}

/* ------------------------------------------------------------ (1) (2) (3) (4) */

test("THE LOOP — a conclusion earned at vN is reopened by a route admitted at vN+1", () => {
  const { dir, conclusionPath } = scratch("loop");

  /* (1) EARNED AND PERSISTED, STAMPED WITH THE VERSION IT WAS EARNED UNDER. */
  const before = methodFixture();
  const earned = earn(emptyConclusionStore(), before, [before.routes[0].id]);
  assert.equal(earned.record.earnedAtVersion, before.version);
  assert.equal(earned.record.status, "EARNED");
  writeConclusionStore(conclusionPath, earned.store);

  // It survives a round trip to disk, which is the whole point of a corpus.
  const reloaded = readConclusionStore(conclusionPath);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].id, earned.record.id);
  assert.equal(reloaded[0].earnedAtVersion, before.version);

  // Nothing reopens it yet: every route in the store predates it.
  assert.deepEqual(findReopenings(before, reloaded), []);

  /* (2) A NEW APPLICABLE ROUTE, ADMITTED THROUGH THE REAL PATH. */
  const after = admit(before, newAvenue("reopening-loop-avenue"), "at-test-avenue");
  assert.equal(after.version, before.version + 1);

  /* (3) FINDREOPENINGS IDENTIFIES IT. */
  const run = runReopenings(reloaded, after, ON);
  assert.equal(run.reopenings.length, 1, "knowledge grew past a closed conclusion and nothing noticed");
  assert.equal(run.reopenings[0].conclusion.id, earned.record.id);
  assert.equal(run.reopenings[0].route.id, "reopening-loop-avenue");
  assert.match(run.reopenings[0].why, /after this ABSENCE was earned at v/);

  // The record now says it was reopened, and PRESERVES what it was earned under.
  const [record] = run.store;
  assert.equal(record.status, "REOPENED");
  assert.equal(record.reopenedBy, "reopening-loop-avenue");
  assert.equal(record.reopenedOn, ON);
  assert.equal(record.earnedAtVersion, before.version, "the old measurement was overwritten");
  assert.equal(record.earnedOn, ON);

  /* (4) THE WORKITEM RE-ENTERS A GOVERNED OPEN STATE — the REAL vocabulary. */
  const item = createWorkItem({
    project: "wtp",
    subject: "ocd-division/country:us/state:az/county:pima",
    obligation: "meetings for the county board",
    why: "a synthetic obligation for the reopening control",
    now: ON,
  });
  const terminal: WorkItemState = "VERIFIED_COMPLETE";
  const moved = workItemStateAfterReopening(terminal, run.reopenings[0]);

  assert.ok(WORK_ITEM_STATES.includes(moved.to), "the state must come from the real union");
  assert.equal(moved.to, "REOPENED");
  assert.equal(moved.wasTerminal, true);
  assert.equal(
    isTerminalState(moved.to),
    false,
    "a reopened obligation that is still terminal has not been reopened",
  );
  assert.match(moved.why, /RULING 179/);

  // And an item that was merely OPEN re-enters the same state, with a different
  // reason — the distinction is reported rather than flattened.
  const stillOpen = workItemStateAfterReopening(item.state, run.reopenings[0]);
  assert.equal(stillOpen.to, "REOPENED");
  assert.equal(stillOpen.wasTerminal, false);
  assert.notEqual(stillOpen.why, moved.why);

  /* AND THE LOOP TERMINATES: a reopened conclusion is not reopened again. */
  const second = runReopenings(run.store, after, ON);
  assert.deepEqual(second.reopened, [], "a reopened conclusion was reopened a second time");

  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------------ (5) */

test("a WITHDRAWN conclusion does not delete the route that produced it", () => {
  const { dir, conclusionPath } = scratch("withdraw");
  const k = methodFixture();
  const producedBy = k.routes[0].id;
  const routesBefore = JSON.stringify(k.routes);

  const earned = earn(emptyConclusionStore(), k, [producedBy]);
  const w = withdrawConclusion(earned.store, earned.record.id, {
    kind: "INVALIDATED",
    on: ON,
    why: "stronger evidence contradicted it inside this control",
    survives: `route ${producedBy} and every observation recorded against it`,
  });
  assert.equal(w.withdrawn, true);
  assert.match(w.reason, /WHAT SURVIVES/);
  writeConclusionStore(conclusionPath, w.store);

  // THE ROUTE IS UNTOUCHED — by bytes, and through the consumer read path.
  assert.equal(JSON.stringify(k.routes), routesBefore, "withdrawing a conclusion changed the routes");
  assert.ok(projectionHasRoute(projectMethodFor(k, AZ), producedBy));

  // The record is KEPT, carrying why it went. Deleting it would let a later
  // session re-earn the same wrong conclusion having never been told.
  const reloaded = readConclusionStore(conclusionPath);
  assert.equal(reloaded.length, 1);
  assert.equal(reloaded[0].status, "INVALIDATED");
  assert.equal(reloaded[0].withdrawal?.kind, "INVALIDATED");

  // And it closes nothing any more, so nothing reopens it.
  assert.deepEqual(openConclusions(reloaded), []);
  const grown = admit(k, newAvenue("withdrawn-avenue"), "at-test-withdrawn");
  assert.deepEqual(findReopenings(grown, reloaded), []);

  // Re-withdrawing is refused rather than rewriting somebody's reasoning.
  const twice = withdrawConclusion(reloaded, earned.record.id, {
    kind: "WITHDRAWN",
    on: ON,
    why: "a second opinion",
    survives: "everything",
  });
  assert.equal(twice.withdrawn, false);
  assert.match(twice.reason, /already INVALIDATED/);

  rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ the corpus */

test("PLANTED: a FIXTURE conclusion is refused in the canonical corpus, by name", () => {
  const k = methodFixture();
  const fixture = earn(emptyConclusionStore(), k, [k.routes[0].id]);
  const issues = validateConclusions(fixture.store, k);
  assert.ok(
    issues.some((i) => i.rule === "fixture-conclusion-in-canonical-corpus"),
    "a manufactured conclusion propagates exactly like an earned one and must be refused",
  );
});

test("PLANTED: a conclusion that names no route it was earned by is refused", () => {
  const k = methodFixture();
  const belief = recordConclusion(
    emptyConclusionStore(),
    k,
    {
      kind: "CONVERGED",
      field: "meeting",
      jurisdiction: AZ,
      why: "nobody walked anything",
      earnedBy: { routeIds: [] },
    },
    ON,
  );
  const issues = validateConclusions(belief.store, k);
  assert.ok(issues.some((i) => i.rule === "conclusion-without-evidence"));

  // And one naming a route project knowledge does not hold.
  const invented = recordConclusion(
    belief.store,
    k,
    {
      kind: "ABSENCE",
      field: "candidacy",
      jurisdiction: AZ,
      why: "names a route that does not exist",
      earnedBy: { routeIds: ["a-route-nobody-learned"] },
    },
    ON,
  );
  assert.ok(
    validateConclusions(invented.store, k).some((i) => i.rule === "conclusion-route-unknown"),
    "a conclusion may not rest on a route project knowledge does not hold",
  );
});

test("the SHIPPED corpus is a PriorConclusion[] array, and it validates", () => {
  const path = join(ROOT, "data", "method", "conclusions.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assert.ok(
    Array.isArray(raw),
    "readConclusionStore parses this file as PriorConclusion[]; an envelope would break it",
  );

  const store = readConclusionStore(path);
  const k = methodFixture();
  assert.deepEqual(validateConclusions(store, k), []);
  assert.deepEqual(
    store.filter((c) => c.fixture),
    [],
    "a test fixture reached the canonical corpus",
  );
  // Empty today, and that is a fact about US — the corpus has just been created.
  // The assertion that matters is that the file is READ and VALID, not its size.
  assert.deepEqual(findReopenings(k, store), []);
});

test("a malformed corpus is a NAMED refusal, never an empty one", () => {
  const dir = join(ROOT, ".scratch", "method-conclusions-malformed");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "conclusions.json");

  // A missing file IS an empty corpus — that is honest, and it is what
  // method:check has always done.
  assert.deepEqual(readConclusionStore(path), []);

  // An envelope, though, is the shape somebody "tidied" it into, and silently
  // reading it as empty would report zero conclusions over a full corpus.
  writeFileSync(path, JSON.stringify({ conclusions: [] }), "utf8");
  assert.throws(() => readConclusionStore(path), /CONCLUSION CORPUS MALFORMED/);
  rmSync(dir, { recursive: true, force: true });
});
