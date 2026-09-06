/**
 * **THE PROVIDER CONFORMANCE SUITE.** (Session B, W3.1. RULING 220 step 2.)
 *
 * One set of assertions, run against EVERY provider, because the point of a
 * provider-neutral interface is that a caller cannot tell which one it has —
 * and the only way to know that is true is to run the same sequence through
 * each and require identical answers.
 *
 * ```
 *   memory      the in-process double, which pins the semantics
 *   file        the durable filesystem store
 *   postgres    ONLY against an isolated test database (WTP_CONTROL_PLANE_TEST_DATABASE_URL)
 * ```
 *
 * ## The Postgres lane runs against an ISOLATED TEST DATABASE, or NOT AT ALL
 *
 * This lane MUTATES: it puts, appends and compare-and-sets. `createWorkItem`
 * ids are derived, and the store is append-only by design, so those writes
 * persist. Run them against the LIVE control plane and every suite run leaves
 * fixtures in the production append-only store — which is exactly how an
 * overnight Neon transfer quota was burned.
 *
 * So the lane is gated on a SEPARATE variable, `WTP_CONTROL_PLANE_TEST_DATABASE_URL`,
 * that names a database designated for destructive test writes. The production
 * variable `WTP_CONTROL_PLANE_DATABASE_URL` — which a normal `.env.local`
 * carries, and which a local gate or handoff loads — is NEVER interpreted as a
 * test database: its presence alone leaves this lane NOT RUN. And if the test
 * variable is set to the same connection as the production one, the suite
 * REFUSES rather than write test fixtures into production.
 *
 * NOT RUN is not a pass. The requirement that RULING 220's cutover eventually be
 * proved against Postgres is unchanged; what changed is that the proof must use
 * a database that is safe to mutate. The skip is a printed sentence naming the
 * variable, because *we did not run this* and *this passed* are different
 * sentences, and a suite that cannot say the first will eventually say the second.
 *
 * ## What is asserted, and why each one is a defect somebody has paid for
 *
 * The four properties from `types.ts`: idempotent derived-identity puts,
 * append-only history, honest compare-and-set, and a failed read that is not
 * an empty one. Each is checked identically on each provider.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  CONTROL_PLANE_TEST_URL_VAR,
  CONTROL_PLANE_URL_VAR,
  advisoryLockKey,
  controlPlaneTestUrlFromEnv,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import {
  ConcurrentModification,
  IdentityCollision,
  UnknownAggregate,
  type ControlPlaneRepositories,
} from "../lib/control-plane/repository/types.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";

const NOW = "2026-08-30T12:00:00.000Z";
const LATER = "2026-08-30T12:05:00.000Z";

interface Provider {
  readonly name: string;
  readonly open: () => Promise<ControlPlaneRepositories>;
}

const providers: Provider[] = [
  { name: "memory", open: async () => createMemoryRepositories() },
  {
    name: "file",
    open: () => createFileRepositories(mkdtempSync(join(tmpdir(), "wtp-conf-"))),
  },
];

/**
 * The Postgres lane, and the honest reason it is or is not here.
 *
 * The lane runs ONLY against an isolated test database. Three states, kept
 * apart:
 *   READY           an isolated test database is named and differs from prod.
 *   NOT_CONFIGURED  no test database is named — the lane is NOT RUN (not a pass).
 *   REFUSED_AS_PROD the test variable points at the production control plane;
 *                   the suite refuses rather than mutate production.
 *
 * The production variable's presence NEVER promotes the lane: a machine with a
 * live control plane and no designated test database still runs only memory and
 * file, and says so.
 */
const prodControlPlaneUrl = controlPlaneUrlFromEnv();
const testControlPlaneUrl = controlPlaneTestUrlFromEnv();
type PgLane =
  | { readonly kind: "READY"; readonly url: string }
  | { readonly kind: "NOT_CONFIGURED" }
  | { readonly kind: "REFUSED_AS_PROD" };
const pgLane: PgLane =
  testControlPlaneUrl === null
    ? { kind: "NOT_CONFIGURED" }
    : prodControlPlaneUrl !== null && testControlPlaneUrl === prodControlPlaneUrl
      ? { kind: "REFUSED_AS_PROD" }
      : { kind: "READY", url: testControlPlaneUrl };

if (pgLane.kind === "READY") {
  const readyUrl = pgLane.url;
  providers.push({ name: "postgres", open: () => createPgRepositories(readyUrl, NOW) });
}

test("the conformance suite states WHICH providers it ran, and which it did not", () => {
  const names = providers.map((p) => p.name);
  assert.ok(names.includes("memory") && names.includes("file"));
  /*
   * The Postgres lane is mutable, so it runs only against a designated test
   * database. A production connection is not one, and pointing the test
   * variable at production is refused outright — either way the lane is NOT RUN
   * and that is recorded here, never mistaken for a pass. RULING 220's cutover
   * proof must be performed against a safe-to-mutate database; tracker NH300
   * carries the escalation.
   */
  if (pgLane.kind === "REFUSED_AS_PROD") {
    assert.fail(
      `${CONTROL_PLANE_TEST_URL_VAR} is set to the SAME connection as ` +
        `${CONTROL_PLANE_URL_VAR} (the production control plane). The mutable conformance ` +
        "lane will not write test fixtures into production. Point it at an isolated test " +
        "database, or unset it to leave the lane honestly NOT RUN.",
    );
  }
  if (pgLane.kind === "NOT_CONFIGURED") {
    console.log(
      `      POSTGRES CONFORMANCE — NOT RUN / SAFE TEST DATABASE NOT CONFIGURED: ` +
        `${names.length} of 3 provider(s). Set ${CONTROL_PLANE_TEST_URL_VAR} to an ISOLATED ` +
        `test database to run it. ${CONTROL_PLANE_URL_VAR}` +
        `${prodControlPlaneUrl !== null ? " IS set, but it names the LIVE production control plane and is never used as a test database." : " is not set."} ` +
        "RULING 220's cutover proof has not been performed.",
    );
  }
  assert.ok(names.length >= 2, "at least the double and the durable store always run");
});

/**
 * **THE POSTGRES LANE SHARES ONE DATABASE WITH EVERY PREVIOUS RUN, AND THESE
 * FIXTURES ARE DERIVED-ID.** (2026-09-01.)
 *
 * `memory` gets a fresh map and `file` gets a fresh `mkdtemp`. Postgres gets the
 * isolated TEST database, and the store is APPEND-ONLY BY DESIGN — `types.ts`
 * says *"nothing is ever removed"* — so there is no teardown to write, and even
 * the safe-to-mutate test database accumulates these rows across runs.
 *
 * With a constant `project`, `workItemId(project, subject, obligation)` is the
 * same id on every run, so the Postgres lane could pass exactly ONCE and failed
 * on every run afterwards: `first.created` came back `false` because the record
 * from the previous run was still there. Three tests went red on the close-out
 * ship for that reason and for no other.
 *
 * **It hid for as long as it did because the lane usually does not run.** The
 * Postgres arm runs only when `WTP_CONTROL_PLANE_TEST_DATABASE_URL` names an
 * isolated test database — which is unset on this machine, and unset in a normal
 * `.env.local` (that file carries the PRODUCTION control-plane variable, which
 * this lane deliberately ignores). So running this file, or `pnpm gates` under
 * `handoff`, SKIPS the lane and prints NOT RUN. A session re-running "isolated"
 * to check would have been told everything was fine by a lane that never
 * executed — and, before the isolation fix, the same load of `.env.local` that
 * a gate performs would have pointed those mutating writes at production.
 *
 * The namespace is per RUN rather than per test, so the ids inside one run still
 * collide exactly the way the assertions require — two `put`s of `item("a")`
 * must still be the same record. It is only the NEXT run that gets out of the
 * way of this one.
 */
const RUN_NAMESPACE = `conformance-${randomUUID().slice(0, 8)}`;

function item(subject: string, now = NOW) {
  return createWorkItem({
    project: RUN_NAMESPACE,
    subject,
    obligation: "prove:the-interface",
    why: "one sequence, every provider, identical answers",
    priority: "P2",
    now,
  });
}

for (const provider of providers) {
  test(`${provider.name}: an identical re-put is a NO-OP SUCCESS, not a second record`, async () => {
    const repos = await provider.open();
    const value = item("a");
    const first = await repos.workItems.put(value.id, value, NOW);
    const second = await repos.workItems.put(value.id, value, LATER);
    assert.equal(first.created, true);
    assert.equal(
      second.created,
      false,
      "created distinguishes 'this write made the record' from 'it was already exactly here'",
    );
    assert.equal(second.persisted.revision, first.persisted.revision, "and nothing churned");
  });

  test(`${provider.name}: a DIFFERENT value under a derived id REFUSES`, async () => {
    /* Two different obligations wearing one name. Keeping either is a wrong
       answer, so neither is kept. */
    const repos = await provider.open();
    const value = item("b");
    await repos.workItems.put(value.id, value, NOW);
    await assert.rejects(
      () => repos.workItems.put(value.id, { ...value, priority: "P0" }, LATER),
      (error: unknown) => error instanceof IdentityCollision,
    );
  });

  test(`${provider.name}: compare-and-set refuses a STALE revision and says how far behind`, async () => {
    const repos = await provider.open();
    const value = item("c");
    const put = await repos.workItems.put(value.id, value, NOW);
    await repos.workItems.compareAndSet(
      value.id,
      put.persisted.revision,
      { ...value, priority: "P1" },
      LATER,
    );
    await assert.rejects(
      () =>
        repos.workItems.compareAndSet(
          value.id,
          put.persisted.revision,
          { ...value, priority: "P3" },
          LATER,
        ),
      (error: unknown) => {
        assert.ok(error instanceof ConcurrentModification);
        assert.equal(error.expectedRevision, put.persisted.revision);
        assert.equal(
          error.foundRevision,
          put.persisted.revision + 1,
          "the only useful thing to tell a losing writer is how far behind it is",
        );
        return true;
      },
    );
  });

  test(`${provider.name}: mustRead on an absent aggregate REFUSES rather than defaulting`, async () => {
    /* An aggregate that did not load is not an aggregate that is empty. */
    const repos = await provider.open();
    assert.equal(await repos.workItems.read("wi-absent"), null);
    await assert.rejects(
      () => repos.workItems.mustRead("wi-absent"),
      (error: unknown) => error instanceof UnknownAggregate,
    );
  });

  test(`${provider.name}: an append-only log refuses a rewrite and accepts a retry`, async () => {
    const repos = await provider.open();
    /* Namespaced for the same reason `item()` is: this log row persists in the
       isolated Postgres test database and an identical id next run is not a
       retry, it is last run's row. */
    const workItemId = `wi-${RUN_NAMESPACE}`;
    const transitionId = `t-${RUN_NAMESPACE}`;
    const record = {
      transitionId,
      workItemId,
      transition: { from: null, to: "OPEN", at: NOW, by: "test", why: "first" },
    };
    const first = await repos.transitions.append(workItemId, transitionId, record as never, NOW);
    assert.equal(first.appended, true);
    assert.equal(first.position, 0, "order is the history");

    /* The identical record again: a retried append after a partial failure. */
    const retried = await repos.transitions.append(workItemId, transitionId, record as never, LATER);
    assert.equal(retried.appended, false, "a no-op success, never a duplicate entry");
    assert.equal(retried.position, 0);

    /* A DIFFERENT record under the same id: history is never rewritten. */
    const { AppendOnlyViolation } = await import("../lib/control-plane/repository/types.ts");
    await assert.rejects(
      () =>
        repos.transitions.append(
          workItemId,
          transitionId,
          { ...record, transition: { ...record.transition, why: "rewritten" } } as never,
          LATER,
        ),
      (error: unknown) => error instanceof AppendOnlyViolation,
    );
  });

  test(`${provider.name}: list is ordered by id, so a report is diffable`, async () => {
    const repos = await provider.open();
    for (const subject of ["z", "m", "a"]) {
      const value = item(subject);
      await repos.workItems.put(value.id, value, NOW);
    }
    const listed = await repos.workItems.list();
    assert.deepEqual(
      [...listed].map((r) => r.id).sort(),
      listed.map((r) => r.id),
      "already sorted",
    );
  });

  test(`${provider.name}: the nightly door's four logs exist and keep history (schema v5)`, async () => {
    /*
     * RULING 242. A log that is declared in `APPEND_ONLY_LOGS` but absent from
     * a provider would let the window write into nothing on that provider and
     * report a clean night. Every provider is asked to append to each of the
     * four and to refuse a rewrite, under this run's namespace.
     */
    const repos = await provider.open();
    const { AppendOnlyViolation } = await import("../lib/control-plane/repository/types.ts");
    const logs = [
      ["promotionPipeline", repos.promotionPipeline],
      ["windowRuns", repos.windowRuns],
      ["windowIncidents", repos.windowIncidents],
      ["windowIntents", repos.windowIntents],
    ] as const;
    for (const [name, log] of logs) {
      const key = `${name}-${RUN_NAMESPACE}`;
      const recordId = `r-${RUN_NAMESPACE}`;
      const record = { formatVersion: 1, note: name, at: NOW } as never;
      const first = await log.append(key, recordId, record, NOW);
      assert.equal(first.appended, true, `${name} did not append`);
      const retried = await log.append(key, recordId, record, LATER);
      assert.equal(retried.appended, false, `${name} duplicated a retried append`);
      await assert.rejects(
        () => log.append(key, recordId, { formatVersion: 1, note: "rewritten", at: NOW } as never, LATER),
        (error: unknown) => error instanceof AppendOnlyViolation,
        `${name} accepted a rewrite`,
      );
      assert.deepEqual(await log.read(key), [record], `${name} did not read back what it holds`);
    }
  });

  test(`${provider.name}: durable says what it means`, async () => {
    const repos = await provider.open();
    assert.equal(
      repos.durable,
      provider.name !== "memory",
      "only a store whose contents survive this process may claim durability",
    );
    assert.ok(repos.describe().length > 0, "and it says where the state lives");
  });
}

/* ==========================================================================
 * THE POSTGRES PROVIDER'S OWN PURE PARTS, TESTABLE WITHOUT A DATABASE
 * ======================================================================= */

test("the advisory lock key is STABLE — two machines computing it must agree", () => {
  /*
   * The whole point of the Postgres lock is that two processes on two machines
   * contend correctly, and that requires them to derive the same key from the
   * same name. A hash whose value could move under a dependency bump is a lock
   * that could silently stop being the same lock, which is why FNV-1a is
   * written out in the provider rather than imported.
   */
  const a = advisoryLockKey("budget");
  assert.equal(advisoryLockKey("budget"), a, "same name, same key");
  assert.notEqual(advisoryLockKey("budgets"), a, "different name, different key");
  assert.ok(a >= BigInt(0), "folded to positive: a negative would read as a different key");
  assert.ok(
    a <= BigInt("0x7fffffffffffffff"),
    "and inside the signed 64-bit range Postgres accepts",
  );
});

// Keep the recorded v5 guard identity: every nightly-door assertion still runs.
// Later additive migrations (v6 worker-result log, v7 readiness-snapshots aggregate)
// only move the exact version this pins; the nightly-door assertions are unchanged.
test("schema v5 declares the four nightly-door logs, and every provider bundle carries them", async () => {
  const { APPEND_ONLY_LOGS, BOOTSTRAP_VERSION, DECLARED_TABLES } = await import(
    "../lib/control-plane/repository/pg-schema.ts"
  );
  assert.equal(BOOTSTRAP_VERSION, 8, "the software-release-reviews log (Admin Pass B, 2026-09-06) is an additive schema move");
  for (const log of ["promotion_pipeline", "window_runs", "window_incidents", "window_intents", "worker_results", "software_release_reviews"]) {
    assert.ok((APPEND_ONLY_LOGS as readonly string[]).includes(log), `${log} is not declared`);
    assert.ok(DECLARED_TABLES.includes(`cp_log_${log}`), `cp_log_${log} is not a declared table`);
  }
  for (const provider of providers) {
    const repos = await provider.open();
    for (const field of ["promotionPipeline", "windowRuns", "windowIncidents", "windowIntents", "workerResults", "softwareReleaseReviews"] as const) {
      assert.equal(typeof repos[field]?.append, "function", `${provider.name} bundle lacks ${field}`);
    }
  }
});

test("controlPlaneUrlFromEnv refuses an empty value rather than defaulting", () => {
  assert.equal(controlPlaneUrlFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(
    controlPlaneUrlFromEnv({ [CONTROL_PLANE_URL_VAR]: "   " } as unknown as NodeJS.ProcessEnv),
    null,
  );
  assert.equal(
    controlPlaneUrlFromEnv({ [CONTROL_PLANE_URL_VAR]: "postgres://x" } as unknown as NodeJS.ProcessEnv),
    "postgres://x",
  );
});

test("controlPlaneTestUrlFromEnv reads its OWN variable, never the production one", () => {
  // Empty / absent is null: no test database configured, which reads NOT RUN.
  assert.equal(controlPlaneTestUrlFromEnv({} as unknown as NodeJS.ProcessEnv), null);
  assert.equal(
    controlPlaneTestUrlFromEnv({ [CONTROL_PLANE_TEST_URL_VAR]: "  " } as unknown as NodeJS.ProcessEnv),
    null,
  );
  // The PRODUCTION variable's presence never satisfies the test-database gate:
  // this is the whole point — a loaded `.env.local` must not enable mutation.
  assert.equal(
    controlPlaneTestUrlFromEnv({
      [CONTROL_PLANE_URL_VAR]: "postgres://prod",
    } as unknown as NodeJS.ProcessEnv),
    null,
  );
  assert.equal(
    controlPlaneTestUrlFromEnv({
      [CONTROL_PLANE_TEST_URL_VAR]: "postgres://test",
    } as unknown as NodeJS.ProcessEnv),
    "postgres://test",
  );
});

test("the two control-plane variables are DISTINCT names, so one can never stand in for the other", () => {
  assert.notEqual(CONTROL_PLANE_TEST_URL_VAR, CONTROL_PLANE_URL_VAR);
  // A machine carrying ONLY the production variable yields a production url and
  // NO test url — the exact state that must leave the mutable lane NOT RUN.
  const prodOnly = { [CONTROL_PLANE_URL_VAR]: "postgres://prod" } as unknown as NodeJS.ProcessEnv;
  assert.equal(controlPlaneUrlFromEnv(prodOnly), "postgres://prod");
  assert.equal(controlPlaneTestUrlFromEnv(prodOnly), null);
});

test("createPgRepositories refuses an empty connection string", async () => {
  /* A default here could point at the SERVING database, which RULING 220
     separates on purpose. */
  await assert.rejects(
    () => createPgRepositories(""),
    /requires an explicit connection string/,
  );
});
