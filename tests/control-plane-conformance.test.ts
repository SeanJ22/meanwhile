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
 *   postgres    when WTP_CONTROL_PLANE_DATABASE_URL is present
 * ```
 *
 * ## The Postgres lane is SKIPPED WITH A REASON, never silently
 *
 * That variable is not provisioned on the machine this was written on. A suite
 * that quietly ran two providers and reported green would be a suite claiming
 * three-provider conformance on two — so the skip is a printed sentence naming
 * the variable, and `providersUnderTest` reports the denominator.
 *
 * This is the difference the repository keeps insisting on: *we did not run
 * this* and *this passed* are different sentences, and a suite that cannot say
 * the first will eventually say the second instead.
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
  CONTROL_PLANE_URL_VAR,
  advisoryLockKey,
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
 * A control plane that is not configured on this machine is a legitimate
 * state, not a broken one. What is NOT legitimate is a suite that runs two
 * providers and reports as if it ran three.
 */
const pgUrl = controlPlaneUrlFromEnv();
if (pgUrl !== null) {
  providers.push({ name: "postgres", open: () => createPgRepositories(pgUrl, NOW) });
}

test("the conformance suite states WHICH providers it ran, and which it did not", () => {
  const names = providers.map((p) => p.name);
  assert.ok(names.includes("memory") && names.includes("file"));
  if (pgUrl === null) {
    /*
     * Printed rather than skipped silently. RULING 220 step 2 requires both
     * providers to pass identically; this run covered the two that exist here.
     * The Postgres lane's absence is a fact about this machine and is recorded
     * as one — tracker NH300 carries the escalation.
     */
    console.log(
      `      conformance: ${names.length} of 3 provider(s) — the postgres lane is NOT RUN ` +
        `because ${CONTROL_PLANE_URL_VAR} is not set on this machine. That is a fact about ` +
        "this machine, not a pass: RULING 220's cutover proof has not been performed.",
    );
  }
  assert.ok(names.length >= 2, "at least the double and the durable store always run");
});

/**
 * **THE POSTGRES LANE SHARES ONE DATABASE WITH EVERY PREVIOUS RUN, AND THESE
 * FIXTURES ARE DERIVED-ID.** (2026-09-01.)
 *
 * `memory` gets a fresh map and `file` gets a fresh `mkdtemp`. Postgres gets the
 * live control plane, and the store is APPEND-ONLY BY DESIGN — `types.ts` says
 * *"nothing is ever removed"* — so there is no teardown to write.
 *
 * With a constant `project`, `workItemId(project, subject, obligation)` is the
 * same id on every run, so the Postgres lane could pass exactly ONCE and failed
 * on every run afterwards: `first.created` came back `false` because the record
 * from the previous run was still there. Three tests went red on the close-out
 * ship for that reason and for no other.
 *
 * **It hid for as long as it did because the lane usually does not run.** The
 * Postgres arm is skipped unless `WTP_CONTROL_PLANE_DATABASE_URL` is set, and a
 * bare shell does not load `.env.local` — so running this file directly SKIPS
 * the lane and prints a green 18 of 18, while `pnpm gates` under `handoff` loads
 * the environment and runs it. A session re-running "isolated" to check would
 * have been told everything was fine by a lane that never executed.
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
       live Postgres control plane and an identical id next run is not a retry,
       it is last run's row. */
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

test("createPgRepositories refuses an empty connection string", async () => {
  /* A default here could point at the SERVING database, which RULING 220
     separates on purpose. */
  await assert.rejects(
    () => createPgRepositories(""),
    /requires an explicit connection string/,
  );
});
