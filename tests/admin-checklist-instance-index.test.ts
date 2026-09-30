import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/admin/checklist-instances/route.ts";
import { CHECKLIST_SCOPE_HEAD_SQL, CHECKLIST_INSTANCE_PAGE_SQL, ChecklistInstanceIndexError,
  readIndexedChecklistInstances } from "../lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { CHECKLIST_PROFILE, checklistObligationKey, type ChecklistInstance } from "../lib/control-plane/readiness/checklist-score.ts";
import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION, DECLARED_TABLES } from "../lib/control-plane/repository/pg-schema.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const scopeId = "zcta:2020/85635";
const instructionReceipt = "expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const definitionId = "OFF-01";
const query = { scopeId, instructionReceipt, definitionId, limit: 1, cursor: null };
const projectionId = `cpidx-${"a".repeat(64)}`;
const head = { projection_id: projectionId, source_snapshot_revision: 5, current_snapshot_revision: 5,
  snapshot_published_at: "2026-09-28T12:00:00.000Z", scope_revision: "census:one",
  observed_at: "2026-09-28T11:59:00.000Z", profile: CHECKLIST_PROFILE.version,
  inventory_complete: false, reads_complete: false, captured_counts: { [definitionId]: 2 } };
const instance = (objectId: string) => ({ obligationKey: checklistObligationKey("OFF-01", objectId, scopeId, "effective-period-unresolved"),
  definitionIds: [definitionId], predicateKey: "OFF-01", objectId, jurisdictionId: scopeId,
  period: "effective-period-unresolved", scopeRevision: "census:one",
  applicability: { state: "UNRESOLVED" as const, evidenceIds: [instructionReceipt], reason: "Officeholder period unresolved." },
  due: { state: "UNRESOLVED" as const, evidenceIds: [instructionReceipt], at: null },
  predicate: { kind: "POSSESSION" as const, requiredClauses: [`${CHECKLIST_PROFILE.version}:OFF-01`], contractVersion: "checklist-field-contract/1" },
  workIds: [], requiredSurfaces: [], requiresFreshness: true, owner: "Lead",
  blocker: "Effective period unresolved.", nextAction: "Obtain exact period evidence.",
  failureKind: "DISCONNECTED_CAPABILITY" as const }) satisfies ChecklistInstance;

test("schema reserves two indexed projection tables without making snapshot JSON a page source", () => {
  assert.ok(BOOTSTRAP_VERSION >= 15);
  assert.ok(DECLARED_TABLES.includes("cp_checklist_scope_heads"));
  assert.ok(DECLARED_TABLES.includes("cp_checklist_instance_projections"));
  assert.ok(BOOTSTRAP_DDL.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS cp_checklist_scope_heads") &&
    sql.includes("PRIMARY KEY (scope_id, instruction_receipt)")));
  assert.ok(BOOTSTRAP_DDL.some(sql => sql.includes("CREATE TABLE IF NOT EXISTS cp_checklist_instance_projections") &&
    sql.includes("PRIMARY KEY (projection_id, definition_id, obligation_key, ordinal)")));
  assert.doesNotMatch(CHECKLIST_SCOPE_HEAD_SQL, /jsonb_array_elements/);
  assert.doesNotMatch(CHECKLIST_INSTANCE_PAGE_SQL, /cp_owner_snapshots|jsonb_array_elements/);
});

test("no promoted head or a head behind the saved snapshot is unavailable, not zero", async () => {
  let calls = 0;
  const noHead = await readIndexedChecklistInstances({ query: async () => { calls++; return []; } }, query);
  assert.equal(noHead.state, "INDEX_NOT_POPULATED");
  assert.equal(noHead.matchedCapturedCount, null);
  assert.equal(calls, 1);
  const stale = await readIndexedChecklistInstances({ query: async () => { calls++; return [{ ...head, current_snapshot_revision: 6 }]; } }, query);
  assert.equal(stale.state, "INDEX_STALE");
  assert.equal(stale.rows, null);
  assert.equal(calls, 2);
  await assert.rejects(readIndexedChecklistInstances({ query: async (text: string) =>
    text === CHECKLIST_SCOPE_HEAD_SQL ? [{ ...head, captured_counts: { [definitionId]: 0 } }] :
      [{ obligation_key: instance("unexpected").obligationKey, ordinal: 1, instance: instance("unexpected") }] }, query),
  (error: unknown) => error instanceof ChecklistInstanceIndexError && error.code === "CORRUPT_INDEX");
});

test("exact indexed scope pages by obligation and ordinal, with saved-only counts and stale cursor refusal", async () => {
  const repeated = instance("same-person");
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const sql = { query: async (text: string, params?: readonly unknown[]) => {
    calls.push({ text, params: params ?? [] });
    return text === CHECKLIST_SCOPE_HEAD_SQL ? [{ ...head, snapshot_published_at: new Date(head.snapshot_published_at) }] :
      params?.[3] === null ? [{ obligation_key: repeated.obligationKey, ordinal: 3, instance: repeated },
        { obligation_key: repeated.obligationKey, ordinal: 9, instance: repeated }] :
        [{ obligation_key: repeated.obligationKey, ordinal: 9, instance: repeated }];
  } };
  const first = await readIndexedChecklistInstances(sql, query);
  assert.equal(first.state, "CURRENT_SNAPSHOT_CAPTURED_INSTANCES");
  if (first.state !== "CURRENT_SNAPSHOT_CAPTURED_INSTANCES") return;
  assert.equal(first.matchedCapturedCount, 2);
  assert.equal(first.snapshotPublishedAt, head.snapshot_published_at);
  assert.deepEqual(first.completeness, { inventoryComplete: false, readsComplete: false,
    expectedObjects: null, nationalTotal: null, historicalTotal: null });
  assert.equal(first.rows.length, 1);
  assert.ok(first.nextCursor);
  const second = await readIndexedChecklistInstances(sql, { ...query, cursor: first.nextCursor });
  assert.equal(second.state, "CURRENT_SNAPSHOT_CAPTURED_INSTANCES");
  if (second.state !== "CURRENT_SNAPSHOT_CAPTURED_INSTANCES") return;
  assert.equal(second.rows.length, 1);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(calls[0]?.params, [scopeId, instructionReceipt]);
  assert.deepEqual(calls[1]?.params, [projectionId, definitionId, null, null, 2]);
  assert.deepEqual(calls[3]?.params, [projectionId, definitionId, repeated.obligationKey, 3, 2]);
  await assert.rejects(readIndexedChecklistInstances({ query: async (text: string) =>
    text === CHECKLIST_SCOPE_HEAD_SQL ? [{ ...head, projection_id: `cpidx-${"b".repeat(64)}` }] : [] },
    { ...query, cursor: first.nextCursor }),
  (error: unknown) => error instanceof ChecklistInstanceIndexError && error.code === "STALE_CURSOR");
});

test("auth and query limits refuse public, unscoped and ambiguous access before opening the store", async () => {
  const url = `/api/admin/checklist-instances?scopeId=${encodeURIComponent(scopeId)}&instructionReceipt=${encodeURIComponent(instructionReceipt)}&definitionId=${definitionId}`;
  assert.equal((await GET(new NextRequest(`https://${PUBLIC_HOST}${url}`, { headers: { host: PUBLIC_HOST } }))).status, 404);
  assert.equal((await GET(new NextRequest(`https://${ADMIN_HOST}${url}`, { headers: { host: ADMIN_HOST } }))).status, 401);
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const req = (suffix: string) => new NextRequest(`https://${ADMIN_HOST}${suffix}`, { headers: { host: ADMIN_HOST, cookie } });
    assert.equal((await GET(req("/api/admin/checklist-instances?definitionId=OFF-01"))).status, 400);
    assert.equal((await GET(req(`${url}&scopeId=other`))).status, 400);
    assert.equal((await GET(req(`${url}&limit=999`))).status, 400);
    assert.equal((await GET(req(`${url}&cursor=bad***`))).status, 400);
    assert.equal((await GET(req(`${url}&national=true`))).status, 400);
  });
});
