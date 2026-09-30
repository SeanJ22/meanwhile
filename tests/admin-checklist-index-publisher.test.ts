import test from "node:test";
import assert from "node:assert/strict";
import { BOOTSTRAP_VERSION } from "../lib/control-plane/repository/pg-schema.ts";
import { publishChecklistIndexAfterSnapshot } from "../lib/control-plane/admin-view/checklist-index-publisher.ts";
import type { OwnerSnapshot } from "../lib/control-plane/owner-surface.ts";
import type { Persisted } from "../lib/control-plane/repository/types.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";

const persisted = { id: "current", revision: 12, updatedAt: "2026-09-28T20:00:00Z",
  value: { publishedAt: "2026-09-28T20:00:00Z", checklists: [{}] } as unknown as OwnerSnapshot,
} satisfies Persisted<OwnerSnapshot>;

test("optional post-CAS index stays disabled and refuses a schema behind v15", async () => {
  let calls = 0;
  const sql: Sql = { async query() { calls++; return [{ version: BOOTSTRAP_VERSION - 1 }]; } };
  assert.deepEqual(await publishChecklistIndexAfterSnapshot({ enabled: false, persisted, sql }), { state: "DISABLED" });
  assert.equal(calls, 0);
  assert.deepEqual(await publishChecklistIndexAfterSnapshot({ enabled: true, persisted, sql }),
    { state: "SCHEMA_NOT_READY" });
  assert.equal(calls, 1);
});

test("a failed index write is a named nonthrowing outcome after the authoritative snapshot", async () => {
  const sql: Sql = { async query() { return [{ version: BOOTSTRAP_VERSION }]; } };
  assert.deepEqual(await publishChecklistIndexAfterSnapshot({ enabled: true, persisted, sql }),
    { state: "FAILED", code: "INVALID_SOURCE" });
  const unavailable: Sql = { async query() { throw new Error("connection failed"); } };
  assert.deepEqual(await publishChecklistIndexAfterSnapshot({ enabled: true, persisted, sql: unavailable }),
    { state: "FAILED", code: "INDEX_WRITE_UNAVAILABLE" });
  assert.equal(persisted.revision, 12);
});
