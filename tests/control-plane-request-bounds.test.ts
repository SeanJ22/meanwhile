import assert from "node:assert/strict";
import test from "node:test";

import { neon, neonConfig } from "@neondatabase/serverless";
import { createLedger } from "../lib/control-plane/budget.ts";

import {
  isTransientControlPlaneConnectError,
  withControlPlaneConnectRetry,
} from "../lib/control-plane/repository/connect-retry.ts";
import { CONTROL_PLANE_QUERY_CONCURRENCY, createPgRepositories, pgAggregateRepository } from "../lib/control-plane/repository/pg-store.ts";
import { ConcurrentModification } from "../lib/control-plane/repository/types.ts";
import {
  CONTROL_PLANE_REQUEST_BOUNDS_MS,
  ControlPlaneRequestTimeout,
  boundedQuery,
  currentStoreBudget,
  isControlPlaneRequestTimeout,
  observeControlPlaneTimeouts,
  withStoreBudget,
  type BoundableSql,
} from "../lib/control-plane/repository/request-bounds.ts";
import { retryStartupRead } from "../lib/control-plane/startup-read-retry.ts";
import { STANDING_NEON_REQUEST_DEADLINE_MS } from "../lib/ops/neon-request-deadline.ts";

const URL = "postgresql://user:pass@ep-request-bounds-proof.us-east-2.aws.neon.tech/neondb";
const TINY = { POINT: 60, DOCUMENT: 90, PAGE: 120 } as const;

test("dispatch-sized POINT bursts share transport admission across repository clients", async () => {
  const original = neonConfig.fetchFunction;
  let active = 0, peak = 0, calls = 0;
  const starts: number[] = [];
  try {
    neonConfig.fetchFunction = (async (_input: unknown, init?: { body?: string }) => {
      const request = JSON.parse(init?.body ?? "{}");
      // The supplied reader database enables the byte counter's background transaction.
      // Answer that fixture write separately; it is not one of the civic POINT reads.
      if (Array.isArray(request.queries)) return Response.json(request.queries.map(() => ({ fields: [], rows: [], rowCount: 0, command: "INSERT" })));
      active++; peak = Math.max(peak, active); calls++;
      starts.push(Number(request.params[0]));
      try {
        await new Promise(resolve => setTimeout(resolve, 8));
        return answer([]);
      } finally { active--; }
    }) as typeof neonConfig.fetchFunction;
    // The measured bounds: this test is about admission, and a 60 ms bound would also be measuring the host's CPU load.
    const first = await createPgRepositories(URL, undefined, { skipBootstrap: true });
    const second = await createPgRepositories(URL, undefined, { skipBootstrap: true });
    const result = await Promise.all(Array.from({ length: 3300 }, (_, index) =>
      (index % 2 ? first.occurrences : second.obligations).read(String(index))));
    assert.equal(calls, 3300, "every due row is read exactly once");
    assert.equal(peak, CONTROL_PLANE_QUERY_CONCURRENCY);
    assert.deepEqual(starts, Array.from({ length: 3300 }, (_, index) => index), "queued rows start in order");
    assert.ok(result.every(row => row === null));
  } finally { neonConfig.fetchFunction = original; }
});

test("queued calls retain enclosing deadlines and release admission after transport errors", async () => {
  const original = neonConfig.fetchFunction;
  let calls = 0;
  const releases: Array<() => void> = [];
  try {
    neonConfig.fetchFunction = (() => {
      calls++;
      return new Promise<Response>((_resolve, reject) => releases.push(() => reject(new Error("provider rejected"))));
    }) as typeof neonConfig.fetchFunction;
    const repos = await createPgRepositories(URL, undefined, { skipBootstrap: true });
    const occupying = Array.from({ length: CONTROL_PLANE_QUERY_CONCURRENCY }, (_, index) =>
      repos.occurrences.read(String(index)).catch(error => error));
    await new Promise(resolve => setImmediate(resolve));
    let expired = false;
    const queued = withStoreBudget("dispatch-finalization", 5, () => repos.adminConfig.read("live")).catch(error => { expired = true; return error; });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(expired, true, "a queued deadline settles while every transport slot is still occupied");
    releases.forEach(release => release());
    await Promise.all(occupying);
    const error = await queued;
    assert.ok(isControlPlaneRequestTimeout(error));
    assert.equal(error.kind, "DEADLINE");
    assert.equal(error.budget, "dispatch-finalization");
    assert.equal(calls, CONTROL_PLANE_QUERY_CONCURRENCY, "an expired queued call is never sent");
    neonConfig.fetchFunction = (async () => answer([])) as typeof neonConfig.fetchFunction;
    assert.equal(await repos.adminConfig.read("live"), null, "failed calls release capacity");
  } finally { neonConfig.fetchFunction = original; }
});

interface HungFetch {
  readonly calls: { readonly signal: AbortSignal | null }[];
}

/**
 * A driver fetch that never answers. `honorAbort` makes it reject with the
 * signal's reason when aborted; without it only the call's own timer can settle it.
 */
async function withHungFetch<T>(honorAbort: boolean, fn: (hung: HungFetch) => Promise<T>): Promise<T> {
  const original = neonConfig.fetchFunction;
  const hung: HungFetch = { calls: [] };
  neonConfig.fetchFunction = ((_input: unknown, init?: { signal?: AbortSignal }) => {
    const signal = init?.signal ?? null;
    hung.calls.push({ signal });
    return new Promise<Response>((_resolve, reject) => {
      if (honorAbort && signal) signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof neonConfig.fetchFunction;
  try {
    return await fn(hung);
  } finally {
    neonConfig.fetchFunction = original;
  }
}

/** Resolve an answered query: the driver's JSON shape for one text column. */
function answer(rows: readonly Record<string, string>[]): Response {
  const names = rows.length > 0 ? Object.keys(rows[0]!) : ["id"];
  return new Response(
    JSON.stringify({
      command: "SELECT",
      fields: names.map((name) => ({ name, dataTypeID: 25 })),
      rows: rows.map((row) => names.map((name) => row[name] ?? null)),
      rowCount: rows.length,
      rowAsArray: true,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

async function elapsed<T>(fn: () => Promise<T>): Promise<{ readonly ms: number; readonly outcome: T | unknown }> {
  const started = performance.now();
  try {
    const value = await fn();
    return { ms: performance.now() - started, outcome: value };
  } catch (error) {
    return { ms: performance.now() - started, outcome: error };
  }
}

test("a store whose fetch never answers fails a POINT read by name inside its bound, and the request is cancelled", async () => {
  await withHungFetch(true, async (hung) => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: TINY });
    const { ms, outcome } = await elapsed(() => repos.runnerHeartbeat.read("pilot-runner"));
    assert.ok(isControlPlaneRequestTimeout(outcome), `a named timeout, not ${String(outcome)}`);
    const timeout = outcome as ControlPlaneRequestTimeout;
    assert.equal(timeout.name, "ControlPlaneRequestTimeout");
    assert.equal(timeout.code, "CONTROL_PLANE_REQUEST_TIMEOUT");
    assert.equal(timeout.operation, "cp_runner_heartbeat.read");
    assert.equal(timeout.callClass, "POINT");
    assert.equal(timeout.kind, "REQUEST");
    assert.equal(timeout.timeoutMs, TINY.POINT);
    assert.equal(timeout.retryable, true);
    assert.match(timeout.message, /cp_runner_heartbeat\.read \(POINT\) did not settle within its 60 ms request bound/);
    assert.ok(ms >= TINY.POINT - 5 && ms < TINY.POINT + 1_000, `settled in ${Math.round(ms)} ms`);
    assert.equal(hung.calls.length, 1);
    assert.equal(hung.calls[0]!.signal?.aborted, true, "the driver's request was aborted, not abandoned");
    assert.equal(hung.calls[0]!.signal?.reason, timeout, "and aborted with the named reason");
  });
});

test("a fetch that ignores the abort still cannot hold the call past its bound", async () => {
  await withHungFetch(false, async () => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: TINY });
    const { ms, outcome } = await elapsed(() => repos.leases.read("nightly-window"));
    assert.ok(isControlPlaneRequestTimeout(outcome));
    assert.equal((outcome as ControlPlaneRequestTimeout).operation, "cp_leases.read");
    assert.ok(ms < TINY.POINT + 1_000, `settled in ${Math.round(ms)} ms`);
  });
});

test("each call class takes its own bound: a large document row is DOCUMENT, a page is PAGE, an append names its step", async () => {
  await withHungFetch(true, async () => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: TINY });
    const budgetAggregate = pgAggregateRepository(neon(URL), "BudgetLedger", "cp_budget", { bounds: TINY });
    const cases: [() => Promise<unknown>, string, string, number][] = [
      [() => repos.budget.read(), "cp_budget.read", "DOCUMENT", TINY.DOCUMENT],
      [() => repos.budget.install(createLedger({ hosts: [] }), "2026-09-23T00:00:00.000Z"), "cp_budget.put", "DOCUMENT", TINY.DOCUMENT],
      [() => repos.budget.compareAndSet(1, createLedger({ hosts: [] }), "2026-09-23T00:00:00.000Z"), "cp_budget.compareAndSet", "DOCUMENT", TINY.DOCUMENT],
      [() => budgetAggregate.readNarrowed("shared-budget-ledger", {}), "cp_budget.readNarrowed", "POINT", TINY.POINT],
      [() => repos.researchState.read("level-1"), "cp_research_state.read", "DOCUMENT", TINY.DOCUMENT],
      [() => repos.fieldManual.read("fm-x"), "cp_field_manual_entries.read", "POINT", TINY.POINT],
      [() => repos.fieldManual.slice({ role: "SCOUT" }), "cp_field_manual_entries.slice", "PAGE", TINY.PAGE],
      [() => repos.costs.readAll(), "cp_log_costs.readChangedSince:clock", "POINT", TINY.POINT],
      [() => repos.costs.readSince("2026-09-22T00:00:00.000Z"), "cp_log_costs.readSince", "PAGE", TINY.PAGE],
      [() => repos.occurrences.list(), "cp_occurrences.listChangedSince:clock", "POINT", TINY.POINT],
      [() => repos.ownerDigests.readWhere("owner-digest", ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE"), "cp_log_owner_digests.readWhere", "PAGE", TINY.PAGE],
      [() => repos.ownerDigests.readRecentWhere("owner-digest", ["runtimeOutcome", "kind"], "ROUTINE_CIVIC_DATA_SUPERVISOR", 288, { digestId: true }), "cp_log_owner_digests.readRecentWhere", "PAGE", TINY.PAGE],
      [() => repos.ownerDigests.append("owner-digest", "id", { x: 1 } as never, "2026-09-23T00:00:00.000Z"), "cp_log_owner_digests.append:probe", "DOCUMENT", TINY.DOCUMENT],
      [() => repos.costs.append("k", "id", { x: 1 } as never, "2026-09-23T00:00:00.000Z"), "cp_log_costs.append:probe", "POINT", TINY.POINT],
    ];
    for (const [call, operation, callClass, bound] of cases) {
      const { outcome } = await elapsed(call);
      assert.ok(isControlPlaneRequestTimeout(outcome), `${operation}: ${String(outcome)}`);
      const timeout = outcome as ControlPlaneRequestTimeout;
      assert.equal(timeout.operation, operation);
      assert.equal(timeout.callClass, callClass, operation);
      assert.equal(timeout.timeoutMs, bound, operation);
    }
  });
});

test("a large budget CAS returns metadata and the exact submitted JSON without downloading the ledger again", async () => {
  const original = neonConfig.fetchFunction;
  const now = "2026-10-02T18:00:00.000Z";
  const next = { ...createLedger({ hosts: [] }), nested: { value: "submitted" },
    omitted: undefined, normalizedNumber: NaN, date: new Date(now), payload: "x".repeat(3_370_000) };
  const expected = JSON.parse(JSON.stringify(next));
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const requests: { query: string; params: unknown[] }[] = [];
  let responseBytes = 0;
  try {
    neonConfig.fetchFunction = (async (_input: unknown, init?: { body?: string }) => {
      const request = JSON.parse(init?.body ?? "{}") as { query: string; params: unknown[] };
      requests.push(request);
      assert.match(request.query, /WHERE id = \$3 AND revision = \$4\s+RETURNING id, revision, updated_at$/);
      assert.deepEqual([request.params[0], request.params[2], request.params[3]], [now, "shared-budget-ledger", "7"]);
      assert.equal(request.params[1], JSON.stringify(expected));
      started();
      await held;
      const response = answer([{ id: "shared-budget-ledger", revision: "8", updated_at: now }]);
      responseBytes = Buffer.byteLength(await response.clone().text());
      return response;
    }) as typeof neonConfig.fetchFunction;
    const repos = await createPgRepositories(URL, now, { skipBootstrap: true });
    const writing = repos.budget.compareAndSet(7, next, now);
    await entered;
    next.nested.value = "mutated while pending";
    next.payload = "changed";
    release();
    const result = await writing;
    assert.deepEqual(result, { id: "shared-budget-ledger", revision: 8, updatedAt: now, value: expected });
    assert.ok(responseBytes < 1024, `revision metadata response was ${responseBytes} bytes`);
    assert.equal(requests.length, 1, "one fenced write, with no ledger readback or retry");
    next.nested.value = "mutated after completion";
    assert.deepEqual(result.value, expected, "the returned persisted value is detached from caller-owned objects");
  } finally { release(); neonConfig.fetchFunction = original; }
});

test("a lost CAS reads only current revision metadata and preserves conflict or missing-row refusal", async () => {
  const original = neonConfig.fetchFunction;
  const now = "2026-10-02T18:00:00.000Z";
  try {
    for (const foundRevision of [9, null]) {
      const requests: { query: string; params: unknown[] }[] = [];
      neonConfig.fetchFunction = (async (_input: unknown, init?: { body?: string }) => {
        const request = JSON.parse(init?.body ?? "{}") as { query: string; params: unknown[] };
        requests.push(request);
        if (requests.length === 1) return answer([]);
        assert.equal(request.query, "SELECT revision FROM cp_budget WHERE id = $1");
        assert.deepEqual(request.params, ["shared-budget-ledger"]);
        return answer(foundRevision === null ? [] : [{ revision: String(foundRevision) }]);
      }) as typeof neonConfig.fetchFunction;
      const repos = await createPgRepositories(URL, now, { skipBootstrap: true });
      await assert.rejects(repos.budget.compareAndSet(7, createLedger({ hosts: [] }), now), error => {
        assert.ok(error instanceof ConcurrentModification);
        assert.equal(error.expectedRevision, 7);
        assert.equal(error.foundRevision, foundRevision);
        return true;
      });
      assert.equal(requests.length, 2, "one write and one revision lookup; an uncertain or refused write is not replayed");
    }
  } finally { neonConfig.fetchFunction = original; }
});

test("the measured defaults: POINT < DOCUMENT < PAGE, each inside the 30 s transport backstop so the named bound fires first", () => {
  const { POINT, DOCUMENT, PAGE } = CONTROL_PLANE_REQUEST_BOUNDS_MS;
  assert.ok(POINT > 0 && POINT < DOCUMENT && DOCUMENT < PAGE, JSON.stringify(CONTROL_PLANE_REQUEST_BOUNDS_MS));
  assert.ok(PAGE < STANDING_NEON_REQUEST_DEADLINE_MS, "a page bound at or over the backstop would surface as the driver's unnamed TimeoutError");
  /* At least 20x the slowest request measured in each class (324 ms, 615 ms, 950 ms). */
  assert.ok(POINT >= 324 * 20 && DOCUMENT >= 615 * 20 && PAGE >= 950 * 20);
});

test("a budget cuts a call short as a DEADLINE, which is not retryable, and a spent budget sends nothing", async () => {
  await withHungFetch(true, async (hung) => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true });
    const { ms, outcome } = await elapsed(() => withStoreBudget("digest:append", 40, () => repos.researchState.read("level-1")));
    assert.ok(isControlPlaneRequestTimeout(outcome));
    const timeout = outcome as ControlPlaneRequestTimeout;
    assert.equal(timeout.kind, "DEADLINE");
    assert.equal(timeout.budget, "digest:append");
    assert.equal(timeout.retryable, false);
    assert.match(timeout.message, /left in the budget of digest:append/);
    assert.ok(ms < CONTROL_PLANE_REQUEST_BOUNDS_MS.DOCUMENT, `the budget, not the 20 s class bound, ended it (${Math.round(ms)} ms)`);

    const before = hung.calls.length;
    const spent = await elapsed(() => withStoreBudget("heartbeat", 0, () => repos.runnerHeartbeat.read("pilot-runner")));
    assert.ok(isControlPlaneRequestTimeout(spent.outcome));
    assert.equal((spent.outcome as ControlPlaneRequestTimeout).timeoutMs, 0);
    assert.match((spent.outcome as Error).message, /was not sent; the budget of heartbeat was already spent/);
    assert.equal(hung.calls.length, before, "no request was issued");
  });
});

test("a nested budget keeps the tighter deadline and its label", async () => {
  await withStoreBudget("outer", 50, async () => {
    await withStoreBudget("inner", 10_000, async () => {
      assert.equal(currentStoreBudget()?.label, "outer");
    });
    await withStoreBudget("inner", 5, async () => {
      assert.equal(currentStoreBudget()?.label, "inner");
    });
  });
  assert.equal(currentStoreBudget(), undefined, "no budget leaks out of its scope");
});

test("an answered call is returned untouched, and every timeout is told to the observer", async () => {
  const seen: string[] = [];
  const stop = observeControlPlaneTimeouts((timeout) => seen.push(timeout.operation));
  const original = neonConfig.fetchFunction;
  try {
    neonConfig.fetchFunction = (async () => answer([{ id: "pilot-runner", revision: "3", updated_at: "2026-09-23T00:00:00.000Z", value: "{\"beatAt\":\"x\"}" }])) as typeof neonConfig.fetchFunction;
    const answered = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: TINY });
    const row = await answered.runnerHeartbeat.read("pilot-runner");
    assert.equal(row?.revision, 3);
    assert.deepEqual(row?.value, { beatAt: "x" });
    assert.deepEqual(seen, []);
    let inFlight = 0, peak = 0;
    neonConfig.fetchFunction = (async () => {
      inFlight++; peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return answer([{ id: "shared-budget", revision: "3", updated_at: "2026-09-23T00:00:00.000Z",
        value: JSON.stringify(createLedger({ hosts: [] })) }]);
    }) as typeof neonConfig.fetchFunction;
    const writes = await Promise.all(Array.from({ length: 20 }, (_, result) =>
      answered.budget.mutate(ledger => ({ ledger, result }), "2026-09-23T00:00:00.000Z")));
    assert.equal(peak, 1, "One repository instance does not contend with itself on the shared budget aggregate.");
    assert.deepEqual(writes.map(write => write.result), Array.from({ length: 20 }, (_, index) => index));
    let calls = 0;
    neonConfig.fetchFunction = (async () => {
      if (++calls === 1) throw new Error("distinct accounting write failed");
      return answer([{ id: "shared-budget", revision: "3", updated_at: "2026-09-23T00:00:00.000Z",
        value: JSON.stringify(createLedger({ hosts: [] })) }]);
    }) as typeof neonConfig.fetchFunction;
    const recovered = await Promise.allSettled([
      answered.budget.mutate(ledger => ({ ledger, result: "failed-job" }), "2026-09-23T00:00:00.000Z"),
      answered.budget.mutate(ledger => ({ ledger, result: "next-job" }), "2026-09-23T00:00:00.000Z"),
    ]);
    assert.equal(recovered[0].status, "rejected");
    assert.equal(recovered[1].status, "fulfilled", "An earlier failed accounting write does not strand another job.");
  } finally {
    neonConfig.fetchFunction = original;
  }
  await withHungFetch(true, async () => {
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: TINY });
    await assert.rejects(repos.debts.list());
    assert.deepEqual(seen, ["cp_debts.listChangedSince:clock"]);
  });
  stop();
});

test("a bound that is not a positive integer is refused, so no call is ever unbounded", async () => {
  await assert.rejects(
    createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { skipBootstrap: true, requestBounds: { POINT: 0 } }),
    /CONTROL_PLANE_REQUEST_BOUND_INVALID: POINT=0/,
  );
});

function hangThenAnswer(hangs: number): { readonly sql: BoundableSql; readonly calls: () => number } {
  let calls = 0;
  return {
    sql: {
      query: (_text, _params, options) => {
        calls += 1;
        if (calls <= hangs) {
          return new Promise((_resolve, reject) => {
            const signal = options?.fetchOptions?.signal;
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
        return Promise.resolve([{ ok: true }]);
      },
    },
    calls: () => calls,
  };
}

test("connect-retry: a REQUEST timeout is a transient it retries; a DEADLINE is not, even inside a wrapper", () => {
  const request = new ControlPlaneRequestTimeout({ operation: "cp_debts.list", callClass: "PAGE", timeoutMs: 25_000, kind: "REQUEST", budget: null });
  const deadline = new ControlPlaneRequestTimeout({ operation: "cp_debts.list", callClass: "PAGE", timeoutMs: 12, kind: "DEADLINE", budget: "metrics" });
  assert.equal(isTransientControlPlaneConnectError(request), true);
  assert.equal(isTransientControlPlaneConnectError(deadline), false, "its message says TIMEOUT, and it is still not retried");
  assert.equal(isTransientControlPlaneConnectError(Object.assign(new Error("read failed"), { cause: request })), true, "found down the cause chain");
  assert.equal(isTransientControlPlaneConnectError(Object.assign(new Error("read failed"), { cause: deadline })), false);
});

test("connect-retry: a hung idempotent read times out by name, is retried, and the retry's answer is returned", async () => {
  const { sql, calls } = hangThenAnswer(2);
  const retries: string[] = [];
  const rows = await withControlPlaneConnectRetry(
    () => boundedQuery(sql, { operation: "cp_method_candidates.read", callClass: "DOCUMENT" }, "SELECT 1", [], { bounds: TINY }),
    { sleep: async () => {}, onRetry: ({ error }) => retries.push((error as Error).name) },
  );
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(calls(), 3);
  assert.deepEqual(retries, ["ControlPlaneRequestTimeout", "ControlPlaneRequestTimeout"]);
});

test("connect-retry: a spent budget stops the retries at once rather than asking again", async () => {
  const { sql, calls } = hangThenAnswer(99);
  const retries: unknown[] = [];
  const { outcome } = await elapsed(() =>
    withStoreBudget("heartbeat", 30, () =>
      withControlPlaneConnectRetry(
        () => boundedQuery(sql, { operation: "cp_runner_heartbeat.read", callClass: "POINT" }, "SELECT 1", [], { bounds: { POINT: 5_000, DOCUMENT: 5_000, PAGE: 5_000 } }),
        { sleep: async () => {}, onRetry: (info) => retries.push(info) },
      )));
  assert.ok(isControlPlaneRequestTimeout(outcome));
  assert.equal((outcome as ControlPlaneRequestTimeout).kind, "DEADLINE");
  assert.equal(calls(), 1, "one request, then the budget named the end");
  assert.deepEqual(retries, []);
});

test("connect-retry: the real bootstrap survives a hung first connect, because the bound turns it into a retryable transient", async () => {
  const original = neonConfig.fetchFunction;
  let fetches = 0;
  const warnings: string[] = [];
  const warn = console.warn;
  try {
    console.warn = (line: string) => warnings.push(line);
    neonConfig.fetchFunction = ((_input: unknown, init?: { signal?: AbortSignal; body?: string }) => {
      fetches += 1;
      if (fetches === 1) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      const query = JSON.parse(init?.body ?? "{}").query as string | undefined;
      // This mocked database already has the valid index; online creation has
      // separate coverage and must not open a real socket in a retry test.
      const result = query?.includes("FROM pg_index i")
        ? { command: "SELECT", fields: [{ name: "valid", dataTypeID: 16 }, { name: "building", dataTypeID: 16 }], rows: [["t", "f"]], rowCount: 1, rowAsArray: false }
        : { command: "CREATE", fields: [], rows: [], rowCount: 0, rowAsArray: false };
      return Promise.resolve(
        new Response(JSON.stringify(result), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof neonConfig.fetchFunction;
    const repos = await createPgRepositories(URL, "2026-09-23T00:00:00.000Z", { requestBounds: TINY });
    assert.ok(repos.durable);
    assert.ok(fetches > 2, `the bootstrap ran again after the timed-out statement (${fetches} fetches)`);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /CONTROL_PLANE_REQUEST_TIMEOUT: cp_schema\.bootstrap \(POINT\)/);
  } finally {
    console.warn = warn;
    neonConfig.fetchFunction = original;
  }
});

test("the startup-read retry re-reads a hung authority read inside connect-retry's bounds", async () => {
  const { sql, calls } = hangThenAnswer(1);
  const rows = await retryStartupRead(
    () => boundedQuery(sql, { operation: "cp_method_candidates.read", callClass: "DOCUMENT" }, "SELECT 1", [], { bounds: TINY }),
    () => null,
    { circuitLatched: () => false, sleep: async () => {} },
  );
  assert.deepEqual(rows, [{ ok: true }]);
  assert.equal(calls(), 2);
});
