import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ZERO_COST } from "../lib/control-plane/attempt.ts";
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
  // The mutable Postgres lane runs only against a designated test database; otherwise it is NOT RUN, never a pass.
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
        "The control-plane cutover proof has not been performed.",
    );
  }
  assert.ok(names.length >= 2, "at least the double and the durable store always run");
});

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
    /* Namespaced: this row persists in the isolated Postgres test database across runs. */
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

  test(`${provider.name}: readSince includes the boundary across keys and retries never renew an old charge`, async () => {
    const repos = await provider.open();
    const a = `since-a-${RUN_NAMESPACE}`, b = `since-b-${RUN_NAMESPACE}`;
    const row = (id: string, workItemId: string, recordedAt: string) => ({ attemptId: `${id}-${RUN_NAMESPACE}`,
      workItemId, routeTaskId: null, routeId: null, source: "official.example", jurisdiction: null,
      project: "conformance", role: "ACQUIRER" as const, model: null, cost: { ...ZERO_COST }, recordedAt });
    const old = row("old", b, "2026-08-29T11:59:59.999Z");
    const boundary = row("boundary", a, "2026-08-29T12:00:00.000Z");
    const recent = row("recent", b, NOW);
    await repos.costs.append(b, old.attemptId, old, old.recordedAt);
    await repos.costs.append(b, old.attemptId, old, LATER);
    await repos.costs.append(a, boundary.attemptId, boundary, boundary.recordedAt);
    await repos.costs.append(b, recent.attemptId, recent, NOW);
    const read = await repos.costs.readSince("2026-08-29T12:00:00.000Z");
    assert.deepEqual(read.filter(row => [old.attemptId, boundary.attemptId, recent.attemptId].includes(row.attemptId)), [boundary, recent]);
  });

  test(`${provider.name}: readLatest answers each key's newest record, cut to the named fields, and nothing for a key with none`, async () => {
    const repos = await provider.open();
    /* Namespaced: these rows persist in the isolated Postgres test database. */
    const key = (s: string) => `j-${RUN_NAMESPACE}-${s}`;
    const walk = (id: string, outcome: string, at: string, leads?: readonly unknown[]) =>
      ({ attemptId: id, outcome, finishedAt: at, ...(leads === undefined ? {} : { leads }), steps: [{ note: "x".repeat(64) }] }) as never;
    await repos.discoveryAttempts.append(key("a"), "a1", walk("a1", "LEAD", NOW, [{ vendor: "v", url: "https://a.example/1" }]), NOW);
    await repos.discoveryAttempts.append(key("a"), "a2", walk("a2", "FOUND", LATER, []), LATER);
    await repos.discoveryAttempts.append(key("b"), "b1", walk("b1", "BLOCKED", NOW), NOW);
    const latest = await repos.discoveryAttempts.readLatest([key("a"), key("b"), key("none"), key("a")], { outcome: true, finishedAt: true, leads: true });
    assert.deepEqual([...latest.keys()].sort(), [key("a"), key("b")].sort(), "a key with no record is absent, and a repeated key is read once");
    assert.deepEqual(latest.get(key("a")), { outcome: "FOUND", finishedAt: LATER, leads: [] }, "the newest record, and only the kept fields");
    assert.deepEqual(latest.get(key("b")), { outcome: "BLOCKED", finishedAt: NOW }, "a kept field the record lacks stays absent, as readRecentWhere keeps it");
    assert.equal((await repos.discoveryAttempts.readLatest([], { outcome: true })).size, 0);
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

  test(`${provider.name}: listWhere is exactly list() filtered — same rows, same id order`, async () => {
    const repos = await provider.open();
    const wanted = `rt-${RUN_NAMESPACE}-wanted`;
    const placed = [
      ["z", wanted],
      ["m", `rt-${RUN_NAMESPACE}-other`],
      ["a", wanted],
      ["q", wanted],
    ] as const;
    for (const [suffix, routeTaskId] of placed) {
      const id = `at-${RUN_NAMESPACE}-${suffix}`;
      await repos.attempts.put(
        id,
        {
          id,
          routeTaskId,
          workItemId: `wi-${RUN_NAMESPACE}`,
          worker: { role: "ACQUIRER", provider: "test", version: "1", instance: "conformance" },
          leaseId: `ls-${id}`,
          startedAt: NOW,
          endedAt: null,
          outcome: null,
          abortReason: null,
          artifactIds: [],
          cost: ZERO_COST,
          methodVersion: 1,
          policyVersion: "conformance",
        },
        NOW,
      );
    }
    const filtered = await repos.attempts.listWhere(["routeTaskId"], wanted);
    assert.deepEqual(
      filtered,
      (await repos.attempts.list()).filter((row) => row.value.routeTaskId === wanted),
      "the filtered read and the filtered listing are the same answer",
    );
    assert.deepEqual(
      filtered.map((row) => row.id),
      ["a", "q", "z"].map((suffix) => `at-${RUN_NAMESPACE}-${suffix}`),
      "in id order, and not vacuous",
    );
    assert.deepEqual(await repos.attempts.listWhere(["routeTaskId"], `rt-${RUN_NAMESPACE}-absent`), []);
  });

  test(`${provider.name}: readRecentWhere is readWhere's newest matches, newest first, each narrowed`, async () => {
    const repos = await provider.open();
    const key = `digest-${RUN_NAMESPACE}`;
    const records = [0, 1, 2, 3, 4].map((index) => ({
      digestId: `d-${RUN_NAMESPACE}-${index}`,
      headline: `outcome ${index}`,
      runtimeOutcome: {
        kind: index === 2 ? "OTHER" : "WANTED",
        finishedAt: `2026-09-24T00:0${index}:00.000Z`,
        failures: [{ taskId: `t${index}`, code: "C", detail: null }],
        readerReadbacks: [{ contractId: `c${index}`, large: "x".repeat(64) }],
      },
    }));
    for (const record of records) {
      await repos.ownerDigests.append(key, record.digestId, record as never, NOW);
    }
    const projection = { digestId: true, runtimeOutcome: ["kind", "finishedAt", "failures", "absentField"] } as const;
    const narrowed = await repos.ownerDigests.readRecentWhere(key, ["runtimeOutcome", "kind"], "WANTED", 2, projection);
    assert.deepEqual(narrowed, [4, 3].map((index) => ({
      digestId: records[index]!.digestId,
      runtimeOutcome: {
        kind: "WANTED",
        finishedAt: records[index]!.runtimeOutcome.finishedAt,
        failures: records[index]!.runtimeOutcome.failures,
      },
    })), "the newest two matches, newest first, without the dropped fields; a null inside a kept field stays null");
    assert.deepEqual(
      (await repos.ownerDigests.readRecentWhere(key, ["runtimeOutcome", "kind"], "WANTED", 50, projection))
        .map((record) => (record as { digestId: string }).digestId),
      (await repos.ownerDigests.readWhere(key, ["runtimeOutcome", "kind"], "WANTED"))
        .map((record) => (record as unknown as { digestId: string }).digestId)
        .reverse(),
      "an unconstraining limit is readWhere reversed: the same matches, no more, no fewer",
    );
    assert.deepEqual(await repos.ownerDigests.readRecentWhere(key, ["runtimeOutcome", "kind"], "ABSENT", 5, projection), []);
    assert.deepEqual(await repos.ownerDigests.readRecentWhere(key, ["runtimeOutcome", "kind"], "WANTED", 0, projection), []);
    const windowKey = `${key}-window`;
    for (const [index, at] of [NOW, LATER, NOW, LATER].entries()) {
      await repos.ownerDigests.append(windowKey, `window-${index}`, {
        digestId: `window-${index}`, runtimeOutcome: { kind: "WANTED", startedAt: index === 3 ? NOW : at },
      } as never, at);
    }
    assert.deepEqual(await repos.ownerDigests.readRecentWhere(windowKey, ["runtimeOutcome", "kind"], "WANTED",
      50, { digestId: true, runtimeOutcome: ["kind", "startedAt"] }, LATER), [3, 1].map(index => ({
      digestId: `window-${index}`, runtimeOutcome: { kind: "WANTED", startedAt: index === 3 ? NOW : LATER },
    })), "filter the saved append time, including its boundary and late-finished old cycles, before limiting");
    assert.deepEqual(await repos.ownerDigests.readRecentWhere(windowKey, ["runtimeOutcome", "kind"], "WANTED",
      1, { digestId: true }, LATER), [{ digestId: "window-3" }]);
  });

  test(`${provider.name}: the nightly door's four logs exist and keep history (schema v5)`, async () => {
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

test("the advisory lock key is STABLE — two machines computing it must agree", () => {
  // Two processes must derive the same lock key from the same name, so FNV-1a is written out rather than imported.
  const a = advisoryLockKey("budget");
  assert.equal(advisoryLockKey("budget"), a, "same name, same key");
  assert.notEqual(advisoryLockKey("budgets"), a, "different name, different key");
  assert.ok(a >= BigInt(0), "folded to positive: a negative would read as a different key");
  assert.ok(
    a <= BigInt("0x7fffffffffffffff"),
    "and inside the signed 64-bit range Postgres accepts",
  );
});

test("schema v5 declares the four nightly-door logs, and every provider bundle carries them", async () => {
  const { APPEND_ONLY_LOGS, BOOTSTRAP_VERSION, DECLARED_TABLES } = await import(
    "../lib/control-plane/repository/pg-schema.ts"
  );
  assert.ok(BOOTSTRAP_VERSION >= 14, "the Admin original-copy request aggregate follows Ask-gap observations");
  for (const log of ["promotion_pipeline", "window_runs", "window_incidents", "window_intents", "worker_results", "software_release_reviews", "live_audits"]) {
    assert.ok((APPEND_ONLY_LOGS as readonly string[]).includes(log), `${log} is not declared`);
    assert.ok(DECLARED_TABLES.includes(`cp_log_${log}`), `cp_log_${log} is not a declared table`);
  }
  for (const provider of providers) {
    const repos = await provider.open();
    for (const field of ["promotionPipeline", "windowRuns", "windowIncidents", "windowIntents", "workerResults", "softwareReleaseReviews", "liveAudits"] as const) {
      assert.equal(typeof repos[field]?.append, "function", `${provider.name} bundle lacks ${field}`);
    }
  }
});

test("schema v14 declares exact Admin original-copy requests in every repository provider", async () => {
  const { AGGREGATE_KINDS, DECLARED_TABLES } = await import("../lib/control-plane/repository/pg-schema.ts");
  assert.ok((AGGREGATE_KINDS as readonly string[]).includes("admin_evidence_copy_requests"));
  assert.ok(DECLARED_TABLES.includes("cp_admin_evidence_copy_requests"));
  for (const provider of providers) {
    const repos = await provider.open();
    assert.equal(typeof repos.adminEvidenceCopyRequests?.compareAndSet, "function", `${provider.name} bundle lacks copy requests`);
  }
});

test("schema v12 declares the meetings-discovery attempt log, and every provider bundle carries it", async () => {
  const { APPEND_ONLY_LOGS, DECLARED_TABLES } = await import("../lib/control-plane/repository/pg-schema.ts");
  assert.ok((APPEND_ONLY_LOGS as readonly string[]).includes("discovery_attempts"), "discovery_attempts is not declared");
  assert.ok(DECLARED_TABLES.includes("cp_log_discovery_attempts"), "cp_log_discovery_attempts is not a declared table");
  for (const provider of providers) {
    const repos = await provider.open();
    assert.equal(typeof repos.discoveryAttempts?.append, "function", `${provider.name} bundle lacks discoveryAttempts`);
    assert.deepEqual(await repos.discoveryAttempts.readRecent("a-jurisdiction-nothing-walked", 1), [], `${provider.name} answers a walk nobody made`);
  }
});

test("schema v13 declares the Ask-gap observations aggregate; every provider bundle adds a count, and Postgres's atomic add agrees with the repository's", async () => {
  const { AGGREGATE_KINDS, DECLARED_TABLES } = await import("../lib/control-plane/repository/pg-schema.ts");
  const observations = await import("../lib/control-plane/ask-gap-observations.ts");
  assert.ok((AGGREGATE_KINDS as readonly string[]).includes("ask_gap_observations"), "ask_gap_observations is not declared");
  assert.ok(DECLARED_TABLES.includes(observations.ASK_GAP_OBSERVATIONS_TABLE), `${observations.ASK_GAP_OBSERVATIONS_TABLE} is not a declared table`);
  /* A per-run body, so the append-only Postgres test database never meets an earlier run's row. */
  const body = `curated:conformance/${RUN_NAMESPACE}#governing`;
  const one = observations.askGapObservation({ bodyId: body, code: "AGENDA_NOT_HELD" }, NOW);
  const id = observations.askGapObservationId(body, "AGENDA_NOT_HELD", one.day);
  for (const provider of providers) {
    const repos = await provider.open();
    assert.equal(typeof repos.askGapObservations?.compareAndSet, "function", `${provider.name} bundle lacks askGapObservations`);
    const sink = provider.name === "postgres" && pgLane.kind === "READY"
      ? observations.pgAskGapObservationSink(pgLane.url)
      : observations.repositoryAskGapObservationSink(repos.askGapObservations);
    assert.equal(await sink.record([one]), 1);
    assert.equal(await sink.record([one]), 1);
    const row = await repos.askGapObservations.read(id);
    assert.deepEqual(row?.value, { ...one, count: 2 }, `${provider.name}: a second ask the same day is a count, never a second row`);
    assert.equal(row?.revision, 2);
    assert.equal(Date.parse(row!.updatedAt), Date.parse(observations.observationDayStart(one.day)), `${provider.name}: the row holds the day, never the instant`);
  }
});

test("schema v10 places live method candidates in every canonical provider", async () => {
  const { AGGREGATE_KINDS, DECLARED_TABLES } = await import(
    "../lib/control-plane/repository/pg-schema.ts"
  );
  assert.ok((AGGREGATE_KINDS as readonly string[]).includes("method_candidates"));
  assert.ok(DECLARED_TABLES.includes("cp_method_candidates"));
  for (const provider of providers) {
    const repos = await provider.open();
    assert.equal(typeof repos.methodCandidates?.compareAndSet, "function", `${provider.name} bundle lacks methodCandidates`);
    assert.equal(await repos.methodCandidates.read("live"), null);
    assert.equal(typeof repos.fieldManual?.compareAndSet, "function", `${provider.name} bundle lacks fieldManual`);
    assert.equal(await repos.fieldManual.read("live"), null);
  }
});

test("schema v9 declares the Action Gateway's three tables, and every provider bundle carries them", async () => {
  const { AGGREGATE_KINDS, APPEND_ONLY_LOGS, DECLARED_TABLES } = await import(
    "../lib/control-plane/repository/pg-schema.ts"
  );
  for (const log of ["admin_receipts", "agent_jobs"]) {
    assert.ok((APPEND_ONLY_LOGS as readonly string[]).includes(log), `${log} is not declared`);
    assert.ok(DECLARED_TABLES.includes(`cp_log_${log}`), `cp_log_${log} is not a declared table`);
  }
  assert.ok((AGGREGATE_KINDS as readonly string[]).includes("admin_config"), "admin_config is not declared");
  assert.ok(DECLARED_TABLES.includes("cp_admin_config"), "cp_admin_config is not a declared table");
  for (const provider of providers) {
    const repos = await provider.open();
    for (const field of ["adminReceipts", "agentJobs"] as const) {
      assert.equal(typeof repos[field]?.append, "function", `${provider.name} bundle lacks ${field}`);
    }
    assert.equal(typeof repos.adminConfig?.compareAndSet, "function", `${provider.name} bundle lacks adminConfig`);
    assert.equal(
      await repos.adminConfig.read("a-config-id-nothing-ever-wrote"),
      null,
      `${provider.name} answers something for a config id nothing wrote`,
    );
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
  /* A default here could point at the serving database. */
  await assert.rejects(
    () => createPgRepositories(""),
    /requires an explicit connection string/,
  );
});
