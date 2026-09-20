/**
 * The control-plane cycle-start connect must survive a transient Neon blip.
 *
 * The standing runner's per-cycle child opens the control plane as its first
 * act; the Neon serverless driver connects on that first query. Under host load
 * the connect can throw `NeonDbError: Error connecting to database: fetch
 * failed` — and before connect-retry.ts that single throw aborted the whole
 * cycle ~2s in, so most cycles dispatched nothing while the endpoint itself was
 * healthy (ten manual reads of the same URL all succeeded).
 *
 * These tests are deterministic and provider-independent: a fake operation
 * throws the driver's exact transport error a bounded number of times and then
 * succeeds, and the retry is asserted to (a) recognise ONLY that establishment
 * class, (b) never retry a latched circuit or a real SQL/status error, and
 * (c) turn a run of transient throws into a success — the cycle-success-rate
 * claim, proven without a live database.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTROL_PLANE_CONNECT_BASE_BACKOFF_MS,
  CONTROL_PLANE_CONNECT_MAX_ATTEMPTS,
  isTransientControlPlaneConnectError,
  withControlPlaneConnectRetry,
} from "../lib/control-plane/repository/connect-retry.ts";

/** The shape @neondatabase/serverless throws: name "NeonDbError", a message,
    an optional SQLSTATE `code`, and a `sourceError` for a transport failure. */
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

/** The exact error observed at bootstrap in the production run records. */
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
  // This is the reproduction: the operation crashes exactly as bootstrap did,
  // twice, then connects. Without the retry this is a dead cycle; with it, a
  // success.
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

test("the default attempt budget is a small, bounded number", () => {
  assert.ok(CONTROL_PLANE_CONNECT_MAX_ATTEMPTS >= 2 && CONTROL_PLANE_CONNECT_MAX_ATTEMPTS <= 8);
});
