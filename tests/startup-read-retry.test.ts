/**
 * A research cycle's startup authority reads must survive one transient store
 * blip.
 *
 * Deterministic and provider-independent: fake reads fail a bounded number of
 * times, then answer. The retry is asserted to re-read ONLY a failed read, to
 * never retry while the Neon circuit is latched, and to hand the last result or
 * error back unchanged so the cycle's own named failure still runs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CivicDataStoreUnavailableError } from "../lib/civic-data/read-model.ts";
import { CONTROL_PLANE_CONNECT_MAX_ATTEMPTS } from "../lib/control-plane/repository/connect-retry.ts";
import { isRetryableStartupReadError, retryStartupRead } from "../lib/control-plane/startup-read-retry.ts";

type UnavailableCode = CivicDataStoreUnavailableError["result"]["code"];

/** A transient store error, with a chosen code. */
function storeUnavailable(code: UnavailableCode = "STORE_READ_FAILED"): CivicDataStoreUnavailableError {
  return new CivicDataStoreUnavailableError({
    kind: "STORE_UNREACHABLE",
    value: null,
    metadata: {
      recordClass: "OPERATIONAL_REFERENCE",
      scope: "US:covered-jurisdiction-routing:v1",
      sourceId: null,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: null,
      retrievedAt: null,
      promotedAt: null,
      stale: "UNKNOWN",
      staleAt: null,
    },
    code,
    detail:
      "Reading canonical pointer OPERATIONAL_REFERENCE:US:covered-jurisdiction-routing:v1 failed (Error). We could not ask the store.",
  });
}

type Status = { readonly state: "ADOPTED" | "STORE_UNREACHABLE"; readonly detail: string };
const unreachableStatus = (status: Status): string | null =>
  status.state === "STORE_UNREACHABLE" ? status.detail : null;
const neverUnreachable = (): string | null => null;

function recorder() {
  const delays: number[] = [];
  const retries: string[] = [];
  return {
    delays,
    retries,
    options: {
      circuitLatched: () => false,
      sleep: async (ms: number) => void delays.push(ms),
      random: () => 1,
      onRetry: ({ error }: { readonly error: unknown }) =>
        void retries.push(error instanceof Error ? error.message : String(error)),
    },
  };
}

test("only a failed read is retryable; deterministic store refusals are not", () => {
  assert.equal(isRetryableStartupReadError(storeUnavailable("STORE_READ_FAILED")), true);
  assert.equal(isRetryableStartupReadError(storeUnavailable("PROMOTION_PROOF_INVALID")), false);
  assert.equal(isRetryableStartupReadError(storeUnavailable("PROMOTION_CANDIDATE_MISSING")), false);
  assert.equal(isRetryableStartupReadError(storeUnavailable("STORE_NOT_CONFIGURED")), false);
  assert.equal(isRetryableStartupReadError(new TypeError("fetch failed")), true);
  assert.equal(isRetryableStartupReadError(new Error("OPERATIONAL_REFERENCE_NOT_PROMOTED:NOT_RECORDED")), false);
});

test("the 21:34:53Z crash, reproduced: one failed store read, then the bundle loads", async () => {
  const r = recorder();
  let calls = 0;
  const value = await retryStartupRead(
    async () => {
      calls += 1;
      if (calls === 1) throw storeUnavailable();
      return "bundle";
    },
    neverUnreachable,
    r.options,
  );
  assert.equal(value, "bundle");
  assert.equal(calls, 2);
  assert.equal(r.retries.length, 1);
  assert.match(r.retries[0]!, /could not ask the store/);
});

test("an unreachable status is re-read and the recovered status returned", async () => {
  const r = recorder();
  let calls = 0;
  const status = await retryStartupRead<Status>(
    async () => {
      calls += 1;
      return calls <= 2
        ? { state: "STORE_UNREACHABLE", detail: "The canonical candidate aggregate could not be read (Error)" }
        : { state: "ADOPTED", detail: "adopted" };
    },
    unreachableStatus,
    r.options,
  );
  assert.equal(status.state, "ADOPTED");
  assert.equal(calls, 3);
  assert.deepEqual(r.retries, [
    "The canonical candidate aggregate could not be read (Error)",
    "The canonical candidate aggregate could not be read (Error)",
  ]);
});

test("a persistent unreachable status is returned unchanged after the bounded attempts", async () => {
  const r = recorder();
  let calls = 0;
  const status = await retryStartupRead<Status>(
    async () => {
      calls += 1;
      return { state: "STORE_UNREACHABLE", detail: `attempt ${calls}` };
    },
    unreachableStatus,
    r.options,
  );
  assert.equal(calls, CONTROL_PLANE_CONNECT_MAX_ATTEMPTS);
  assert.deepEqual(status, { state: "STORE_UNREACHABLE", detail: `attempt ${CONTROL_PLANE_CONNECT_MAX_ATTEMPTS}` });
  assert.equal(r.delays.length, CONTROL_PLANE_CONNECT_MAX_ATTEMPTS - 1);
});

test("a persistent failed read throws the last error unchanged", async () => {
  const r = recorder();
  let calls = 0;
  const last = storeUnavailable();
  await assert.rejects(
    retryStartupRead(
      async () => {
        calls += 1;
        throw calls === CONTROL_PLANE_CONNECT_MAX_ATTEMPTS ? last : storeUnavailable();
      },
      neverUnreachable,
      r.options,
    ),
    (error) => error === last,
  );
  assert.equal(calls, CONTROL_PLANE_CONNECT_MAX_ATTEMPTS);
});

test("a deterministic refusal fails on the first read", async () => {
  const r = recorder();
  let calls = 0;
  await assert.rejects(
    retryStartupRead(
      async () => {
        calls += 1;
        throw storeUnavailable("PROMOTION_PROOF_INVALID");
      },
      neverUnreachable,
      r.options,
    ),
    CivicDataStoreUnavailableError,
  );
  assert.equal(calls, 1);
  assert.deepEqual(r.delays, []);
});

test("nothing is retried while the Neon circuit is latched", async () => {
  const r = recorder();
  const latched = { ...r.options, circuitLatched: () => true };
  let thrown = 0;
  await assert.rejects(
    retryStartupRead(
      async () => {
        thrown += 1;
        throw storeUnavailable();
      },
      neverUnreachable,
      latched,
    ),
    CivicDataStoreUnavailableError,
  );
  assert.equal(thrown, 1);
  let read = 0;
  const status = await retryStartupRead<Status>(
    async () => {
      read += 1;
      return { state: "STORE_UNREACHABLE", detail: "latched" };
    },
    unreachableStatus,
    latched,
  );
  assert.equal(read, 1);
  assert.equal(status.state, "STORE_UNREACHABLE");
  assert.deepEqual(r.delays, []);
});

/*
 * WIRING TRIPWIRE, deliberately strict: the helper above only matters if the
 * research cycle actually routes its startup authority reads through it.
 */
test("freshness-shadow routes its startup reads through retryStartupRead", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const src = readFileSync(join(root, "scripts/freshness-shadow.mts"), "utf8");
  assert.match(src, /retryStartupRead\(\s*\(\)\s*=>\s*preloadOperationalReferenceBundle\(/);
  assert.doesNotMatch(src, /^await preloadOperationalReferenceBundle\(/m);
});
