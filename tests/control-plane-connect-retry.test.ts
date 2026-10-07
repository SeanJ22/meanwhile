import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { neonConfig } from "@neondatabase/serverless";

import {
  CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS,
  CONTROL_PLANE_CONNECT_MAX_ATTEMPTS,
  isTransientControlPlaneConnectError,
  withControlPlaneConnectRetry,
} from "../lib/control-plane/repository/connect-retry.ts";
import { createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";

class NeonDbErrorLike extends Error {
  code: string | undefined;
  sourceError: Error | undefined;
  constructor(message: string, extra: { code?: string; sourceError?: Error } = {}) {
    super(message);
    this.name = "NeonDbError";
    this.code = extra.code;
    this.sourceError = extra.sourceError;
  }
}

function connectFetchFailed(): NeonDbErrorLike {
  return new NeonDbErrorLike("Error connecting to database: TypeError: fetch failed", {
    sourceError: new TypeError("fetch failed"),
  });
}

test("classifies the driver's connect-transport failure as transient", () => {
  assert.equal(isTransientControlPlaneConnectError(connectFetchFailed()), true);
});

test("classifies raw transport errors (and the deadline abort) as transient", () => {
  assert.equal(isTransientControlPlaneConnectError(new TypeError("fetch failed")), true);
  assert.equal(isTransientControlPlaneConnectError(new Error("read ECONNRESET")), true);
  assert.equal(isTransientControlPlaneConnectError(new Error("getaddrinfo EAI_AGAIN db.neon.tech")), true);
  // The request-deadline aborts a hung connect; that abort is one more retryable transient.
  assert.equal(isTransientControlPlaneConnectError({ name: "TimeoutError", message: "The operation timed out" }), true);
});

test("follows the sourceError / cause chain", () => {
  const wrapped = new Error("cycle bootstrap failed", { cause: connectFetchFailed() });
  assert.equal(isTransientControlPlaneConnectError(wrapped), true);
});

test("a latched circuit is a HARD refusal and is never transient", () => {
  const latched = new Error(
    "PROVIDER_CIRCUIT_BROKEN: neon hard-refused the control plane; no automated retry before 2026-09-19T05:00:00.000Z: payment required",
  );
  assert.equal(isTransientControlPlaneConnectError(latched), false);
  // Even if a circuit message happened to contain a transport word, the circuit wins.
  assert.equal(
    isTransientControlPlaneConnectError(new Error("PROVIDER_CIRCUIT_BROKEN: neon latched: network billing restriction")),
    false,
  );
});

test("a real SQL / status error is not a connect transient", () => {
  assert.equal(
    isTransientControlPlaneConnectError(
      new NeonDbErrorLike("duplicate key value violates unique constraint", { code: "23505" }),
    ),
    false,
  );
  // The 64 MiB over-cap read is a server response, not a failed connect.
  assert.equal(
    isTransientControlPlaneConnectError(new NeonDbErrorLike("Server error (HTTP status 507): response is too large")),
    false,
  );
  assert.equal(isTransientControlPlaneConnectError(new Error("IdentityCollision on cp_work_items")), false);
});

test("returns the value on the first try without sleeping or retrying", async () => {
  const delays: number[] = [];
  let calls = 0;
  let retries = 0;
  const value = await withControlPlaneConnectRetry(
    async () => {
      calls += 1;
      return "ok";
    },
    { sleep: async (ms) => void delays.push(ms), onRetry: () => void (retries += 1) },
  );
  assert.equal(value, "ok");
  assert.equal(calls, 1);
  assert.equal(retries, 0);
  assert.deepEqual(delays, []);
});

test("a run of transient connect failures then a success returns the value", async () => {
  const delays: number[] = [];
  let calls = 0;
  const value = await withControlPlaneConnectRetry(
    async () => {
      calls += 1;
      if (calls <= 2) throw connectFetchFailed();
      return "cycle-connected";
    },
    { sleep: async (ms) => void delays.push(ms), random: () => 1 },
  );
  assert.equal(value, "cycle-connected");
  assert.equal(calls, 3);
  // random()=1 => full ceiling: base, then base*2 (both under the cap).
  assert.deepEqual(delays, [CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS, CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS * 2]);
});

test("exhausts a bounded number of attempts then rethrows the transient error", async () => {
  const delays: number[] = [];
  let calls = 0;
  const retries: number[] = [];
  await assert.rejects(
    withControlPlaneConnectRetry(
      async () => {
        calls += 1;
        throw connectFetchFailed();
      },
      {
        maxAttempts: 3,
        sleep: async (ms) => void delays.push(ms),
        random: () => 1,
        onRetry: ({ attempt }) => void retries.push(attempt),
      },
    ),
    /Error connecting to database/,
  );
  assert.equal(calls, 3); // one try plus two retries
  assert.deepEqual(retries, [1, 2]); // onRetry never fires on the final, failed attempt
  assert.equal(delays.length, 2);
});

test("a non-transient error throws immediately with no retry", async () => {
  let calls = 0;
  await assert.rejects(
    withControlPlaneConnectRetry(async () => {
      calls += 1;
      throw new NeonDbErrorLike("syntax error at or near", { code: "42601" });
    }),
    /syntax error/,
  );
  assert.equal(calls, 1);
});

test("a latched circuit throws immediately with no retry", async () => {
  let calls = 0;
  await assert.rejects(
    withControlPlaneConnectRetry(async () => {
      calls += 1;
      throw new Error("PROVIDER_CIRCUIT_BROKEN: neon is latched until 2026-09-19T05:00:00.000Z: quota exhausted");
    }),
    /PROVIDER_CIRCUIT_BROKEN/,
  );
  assert.equal(calls, 1);
});

test("backoff is capped and jittered by the injected random", async () => {
  const delays: number[] = [];
  let calls = 0;
  await withControlPlaneConnectRetry(
    async () => {
      calls += 1;
      if (calls <= 3) throw connectFetchFailed();
      return "ok";
    },
    {
      baseBackoffMs: 1_000,
      maxBackoffMs: 1_500,
      random: () => 0.5, // half of each ceiling
      sleep: async (ms) => void delays.push(ms),
    },
  );
  // ceilings: 1000, 2000->cap 1500, 4000->cap 1500; halved: 500, 750, 750.
  assert.deepEqual(delays, [500, 750, 750]);
});

test("a caller's own classifier replaces the transport classifier; the bound and backoff are unchanged", async () => {
  const delays: number[] = [];
  let calls = 0;
  const storeReadFailed = () => new Error("Reading canonical pointer X failed (Error). We could not ask the store.");
  const value = await withControlPlaneConnectRetry(
    async () => {
      calls += 1;
      if (calls <= 2) throw storeReadFailed();
      return "read";
    },
    {
      isRetryable: (error) => error instanceof Error && /could not ask the store/.test(error.message),
      sleep: async (ms) => void delays.push(ms),
      random: () => 1,
    },
  );
  assert.equal(value, "read");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS, CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS * 2]);
  assert.equal(isTransientControlPlaneConnectError(storeReadFailed()), false);
  let bounded = 0;
  await assert.rejects(
    withControlPlaneConnectRetry(
      async () => {
        bounded += 1;
        throw storeReadFailed();
      },
      { maxAttempts: 2, isRetryable: () => true, sleep: async () => {} },
    ),
    /could not ask the store/,
  );
  assert.equal(bounded, 2);
});

test("the default attempt budget is a small, bounded number", () => {
  assert.ok(CONTROL_PLANE_CONNECT_MAX_ATTEMPTS >= 2 && CONTROL_PLANE_CONNECT_MAX_ATTEMPTS <= 8);
});

test("createPgRepositories survives a transient connect fault at the real bootstrap (wiring)", async () => {
  const originalFetch = neonConfig.fetchFunction;
  let fetchCalls = 0;
  let transientThrows = 0;
  try {
    neonConfig.fetchFunction = (async (_input: unknown, init?: { body?: string }) => {
      fetchCalls += 1;
      if (fetchCalls <= 2) {
        transientThrows += 1;
        const err = new Error("Error connecting to database: TypeError: fetch failed");
        err.name = "NeonDbError";
        (err as { sourceError?: Error }).sourceError = new TypeError("fetch failed");
        throw err;
      }
      const query = JSON.parse(init?.body ?? "{}").query as string | undefined;
      // The mocked database has a valid source index; only ordinary DDL and
      // version writes return no rows. A retry test never opens a real socket.
      const result = query?.includes("FROM pg_index i")
        ? { command: "SELECT", fields: [{ name: "valid", dataTypeID: 16 }, { name: "building", dataTypeID: 16 }], rows: [["t", "f"]], rowCount: 1, rowAsArray: false }
        : { command: "CREATE", fields: [], rows: [], rowCount: 0, rowAsArray: false };
      return new Response(
        JSON.stringify(result),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof neonConfig.fetchFunction;

    const repos = await createPgRepositories(
      "postgresql://user:pass@ep-connect-retry-proof.us-east-2.aws.neon.tech/neondb",
      "2026-09-19T00:00:00.000Z",
    );

    assert.ok(repos, "createPgRepositories returned a repository set despite the transient connect");
    assert.equal(transientThrows, 2, "the first two connect attempts threw the driver's transport error");
    assert.ok(
      fetchCalls > 2,
      `bootstrap ran after the retries (saw ${fetchCalls} fetches — 2 failed connects then the DDL)`,
    );
  } finally {
    neonConfig.fetchFunction = originalFetch;
  }
});

test("every standing-runner cycle child that bootstraps the control plane also installs the per-attempt Neon deadline", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  for (const child of ["scripts/freshness-shadow.mts", "scripts/routine-civic-data-runner.mts", "scripts/publish-owner-snapshot.mts"]) {
    const src = readFileSync(join(root, child), "utf8");
    assert.match(src, /createPgRepositories\s*\(/, `${child} is expected to open the control plane at cycle start`);
    assert.match(
      src,
      /installNeonRequestDeadline\s*\(\s*\)/,
      `${child} must installNeonRequestDeadline() to bound each connect attempt — without it the bootstrap connect-retry re-establishes an unbounded faulting TLS handshake (Node 24 native OpenSSL crash)`,
    );
  }
});
