import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ERROR_DIAGNOSTIC_MAX_CHARS,
  redactDiagnosticText,
  sanitizedErrorDiagnostic,
} from "../lib/ops/error-diagnostic.ts";
import { runBoundedWorkPool } from "../lib/ops/bounded-work-pool.ts";
import { durableRoutineRunnerReceiptIssue, type DurableReceiptStore } from "../lib/civic-data/runner-receipt.ts";
import { ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import { ZERO_RELEASE_EVENTS } from "../lib/civic-data/release.ts";

/*
 * Outcomes record each error in the cause chain, because the database wrapper's own message is only its statement
 * text. The diagnostic is sanitized by construction. Every value below is synthetic.
 */
const USER = "neondb_owner";
const PASSWORD = "npg_Zq7xR3kLm9TwYv2P";
const HOST = "ep-dry-river-axwtolzc-pooler.c-2.us-east-2.aws.neon.tech";
const CONNECTION = `postgresql://${USER}:${PASSWORD}@${HOST}/neondb?sslmode=require&channel_binding=require`;

function neonFailure(): Error {
  const socket = Object.assign(new Error(`connect ETIMEDOUT 3.130.21.7:443 via ${HOST}`), { code: "ETIMEDOUT", errno: -4039 });
  const aggregate = Object.assign(new AggregateError([socket, socket], `connect failed for ${CONNECTION}`), { code: "ETIMEDOUT" });
  const fetchFailed = new TypeError("fetch failed", { cause: aggregate });
  const neon = Object.assign(new Error(`Error connecting to database: ${fetchFailed}`), {
    name: "NeonDbError",
    sourceError: fetchFailed,
  });
  return new Error(
    `Failed query: select "key" from "civic_data_promotions" where "record_class" = $1\nparams: STATE_ROLL_CALL host=${HOST} password=${PASSWORD} user=${USER} ${USER}@${HOST}`,
    { cause: neon },
  );
}

test("the cause chain survives with its codes; no credential or endpoint does", () => {
  const diagnostic = sanitizedErrorDiagnostic(neonFailure());
  assert.match(diagnostic, /^Failed query: select "key" from "civic_data_promotions"/);
  assert.match(diagnostic, /NeonDbError: Error connecting to database/);
  assert.match(diagnostic, /TypeError: fetch failed/);
  assert.match(diagnostic, /AggregateError\(ETIMEDOUT\)/);
  assert.match(diagnostic, /Error\(ETIMEDOUT, -4039\): connect ETIMEDOUT/);
  for (const secret of [PASSWORD, USER, HOST, "postgresql://", "postgres://", "neon.tech", "sslmode", "channel_binding"]) {
    assert.equal(diagnostic.includes(secret), false, `${secret} survived: ${diagnostic}`);
  }
  assert.doesNotMatch(diagnostic, /\n/, "one line");
  assert.ok(diagnostic.length <= ERROR_DIAGNOSTIC_MAX_CHARS);
});

test("every credential-shaped span is redacted in isolation", () => {
  for (const [input, forbidden] of [
    [`see ${CONNECTION} now`, [PASSWORD, HOST, USER]],
    [`postgres:${USER}:${PASSWORD}@${HOST}`, [PASSWORD, HOST]],
    [`https://api.census.gov/data?key=${PASSWORD}`, [PASSWORD, "api.census.gov"]],
    [`host=${HOST} hostaddr=10.0.0.1 password=${PASSWORD} user=${USER}`, [HOST, "10.0.0.1", PASSWORD, USER]],
    [`${USER}@${HOST}`, [USER, HOST]],
  ] as const) {
    const redacted = redactDiagnosticText(input);
    for (const secret of forbidden) assert.equal(redacted.includes(secret), false, `${secret} survived ${redacted}`);
  }
  assert.equal(redactDiagnosticText("Expected promoted cv-1; typed Reader returned STORE_UNREACHABLE:none."), "Expected promoted cv-1; typed Reader returned STORE_UNREACHABLE:none.");
});

test("a plain message stays exactly itself, and a long chain is capped", () => {
  assert.equal(sanitizedErrorDiagnostic(new Error("typed Reader unavailable")), "typed Reader unavailable");
  assert.equal(sanitizedErrorDiagnostic("a thrown string"), "a thrown string");
  const long = new Error("x".repeat(5_000));
  const capped = sanitizedErrorDiagnostic(long, 200);
  assert.equal(capped.length, 200);
  assert.ok(capped.endsWith("..."));
  const cyclic = new Error("outer") as Error & { cause?: unknown };
  cyclic.cause = cyclic;
  assert.equal(sanitizedErrorDiagnostic(cyclic), "outer");
});

test("repair and supervisor outcomes carry the sanitized cause", async () => {
  const [pool] = await runBoundedWorkPool([1], 1, async () => { throw neonFailure(); });
  assert.equal(pool?.ok, false);
  assert.match(pool?.error ?? "", /TypeError: fetch failed/);
  assert.equal((pool?.error ?? "").includes(PASSWORD), false);

  const failingStore: DurableReceiptStore = {
    readCandidate: async () => { throw neonFailure(); },
    readCandidateSummary: async () => { throw neonFailure(); },
    readPromotion: async () => { throw neonFailure(); },
    readPromotionIdentity: async () => { throw neonFailure(); },
  };
  const task = ROUTINE_SOURCE_TASKS[0]!;
  const issue = await durableRoutineRunnerReceiptIssue({
    source: task.id,
    candidateId: "cv-unreadable",
    acquisitionSucceeded: true,
    state: "PROMOTED",
    decision: "GOOD",
    promotedVersion: "cv-unreadable",
    lastKnownGoodVersion: "cv-unreadable",
    structuralReleaseContract: ZERO_RELEASE_EVENTS,
  }, task, failingStore, "SUCCESS");
  assert.match(issue ?? "", /^durable receipt readback failed: Failed query: .*NeonDbError.*AggregateError\(ETIMEDOUT\)/);
  for (const secret of [PASSWORD, USER, HOST]) assert.equal((issue ?? "").includes(secret), false, secret);

  for (const path of ["scripts/routine-civic-data-reader-repair.mts", "scripts/routine-civic-data-runner.mts"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /safeFailure\(error instanceof Error \? error\.message/, `${path} records a bare message`);
    if (path.endsWith("reader-repair.mts")) {
      assert.match(source, /safeFailure\(result\.error\)/, `${path} preserves the repair's sanitized cause`);
      assert.match(readFileSync("lib/civic-data/reader-verification.ts", "utf8"), /error: sanitizedErrorDiagnostic\(error\)/);
    } else assert.match(source, /safeFailure\(sanitizedErrorDiagnostic\(error\)\)/, `${path} records the sanitized cause`);
  }
});
