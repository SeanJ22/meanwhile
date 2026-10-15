import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { projectRoutineDataObservabilityRead } from "../lib/civic-data/observability.ts";
import {
  RoutineObservabilityReadTimedOut,
  readRoutineDataObservabilityFromConnection,
} from "../lib/civic-data/observability-store.ts";

test("the research cycle never makes the unbounded observability read", () => {
  const src = readFileSync("scripts/freshness-shadow.mts", "utf8");
  assert.doesNotMatch(src, /readRoutineDataObservability/, "the research child must not read the full canonical projection");
  assert.doesNotMatch(src, /observability-store/, "nor import its store");
});

test("a read that runs past its statement limit is a named store failure, never an empty or zero outcome", async () => {
  const read = await projectRoutineDataObservabilityRead({
    now: "2026-09-23T02:40:00.000Z",
    connected: true,
    readRows: async () => { throw new RoutineObservabilityReadTimedOut(1_500, Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })); },
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  assert.equal(read.kind === "STORE_UNREACHABLE" ? read.cause : null, "READ_TIMED_OUT", "a timeout is typed, not a lost connection");
  assert.match(read.kind === "STORE_UNREACHABLE" ? read.detail : "", /RoutineObservabilityReadTimedOut[\s\S]*store itself answered[\s\S]*no empty or zero outcome/i);
});

test("any other read failure stays an untyped store failure", async () => {
  const read = await projectRoutineDataObservabilityRead({
    now: "2026-09-23T02:40:00.000Z",
    connected: true,
    readRows: async () => { throw Object.assign(new Error("fetch failed"), { name: "NeonDbError" }); },
  });
  assert.equal(read.kind, "STORE_UNREACHABLE");
  assert.equal(read.kind === "STORE_UNREACHABLE" ? read.cause : "x", undefined);
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
