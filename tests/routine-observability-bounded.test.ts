/**
 * The unbounded routine observability read (2026-09-23): every candidate
 * version with its full payload, 3.8 GB, after minutes of correlated scans.
 * - The research cycle no longer makes it. It exhausted the cycle's 4 GB heap,
 *   and the meetings receipt it fed now stands UNAVAILABLE by name, which
 *   holds fact approval fail-closed.
 * - Admin's request-scoped read is bounded server-side and names the timeout;
 *   it never reports an empty or zero outcome.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectRoutineDataObservabilityRead } from "../lib/civic-data/observability.ts";
import {
  RoutineObservabilityReadTimedOut,
  readRoutineDataObservabilityFromConnection,
} from "../lib/civic-data/observability-store.ts";
import {
  RESEARCH_CYCLE_MEETINGS_RECEIPT,
  factFreshnessFromPermanentMeetings,
} from "../lib/control-plane/promotion/fact-freshness.ts";

test("the research cycle never makes the unbounded observability read", () => {
  const src = readFileSync("scripts/freshness-shadow.mts", "utf8");
  assert.doesNotMatch(src, /readRoutineDataObservability/, "the research child must not read the full canonical projection");
  assert.doesNotMatch(src, /observability-store/, "nor import its store");
  assert.match(src, /const meetingsReceipt: PermanentMeetingsReceipt = RESEARCH_CYCLE_MEETINGS_RECEIPT;/);
});

test("the research cycle's meetings receipt is UNAVAILABLE by name, and it holds approval fail-closed", () => {
  assert.equal(RESEARCH_CYCLE_MEETINGS_RECEIPT.kind, "UNAVAILABLE");
  assert.match(RESEARCH_CYCLE_MEETINGS_RECEIPT.kind === "UNAVAILABLE" ? RESEARCH_CYCLE_MEETINGS_RECEIPT.detail : "", /3\.8 GB[\s\S]*heap[\s\S]*held/);
  const reading = factFreshnessFromPermanentMeetings(RESEARCH_CYCLE_MEETINGS_RECEIPT, {
    recordClass: "meeting-times",
    subjectId: "ocd-division/country:us/state:nh/county:merrimack/place:new_london_town#budget-committee",
    meetingSource: "schedulepage",
  });
  assert.equal(reading.hold, true, "no fact is approved on a missing receipt");
  assert.equal(reading.state, "UNKNOWN");
  assert.match(reading.reason, /permanent meetings receipt unavailable: not read by the research cycle/);
});

test("a read that runs past its statement limit is a named store failure, never an empty or zero outcome", async () => {
  const read = await projectRoutineDataObservabilityRead({
    now: "2026-09-23T02:40:00.000Z",
    connected: true,
    readRows: async () => { throw new RoutineObservabilityReadTimedOut(1_500, Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })); },
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  assert.match(read.kind === "STORE_UNREACHABLE" ? read.detail : "", /RoutineObservabilityReadTimedOut[\s\S]*no empty or zero outcome/);
});

test("the statement limit is validated before any connection is opened", async () => {
  for (const bad of [0, -1, 1.5, Number.NaN]) {
    await assert.rejects(
      () => readRoutineDataObservabilityFromConnection("postgresql://never-connected.invalid/db", { statementTimeoutMs: bad }),
      /ROUTINE_OBSERVABILITY_STATEMENT_TIMEOUT_INVALID/,
    );
  }
});

test("Admin's request-scoped read carries a server-side statement limit that binds the whole snapshot", () => {
  const store = readFileSync("lib/civic-data/observability-store.ts", "utf8");
  const server = readFileSync("lib/civic-data/observability-server.ts", "utf8");
  assert.match(store, /SET LOCAL statement_timeout = \$\{statementTimeoutMs\}/);
  const setAt = store.indexOf("SET LOCAL statement_timeout");
  const firstSelect = store.indexOf("await db.select(");
  assert.ok(setAt > 0 && firstSelect > setAt, "the limit is set before the first statement of the snapshot");
  assert.match(store, /code === "57014"/, "Postgres query_canceled is the statement-timeout signal");
  assert.match(server, /statementTimeoutMs: ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS/);
  const limit = Number(/ADMIN_ROUTINE_READ_STATEMENT_TIMEOUT_MS = ([\d_]+);/.exec(server)?.[1]?.replace(/_/g, ""));
  assert.ok(limit > 0 && limit <= 2_000, "a per-statement limit that leaves the page inside its function budget");
});
