import assert from "node:assert/strict";
import test from "node:test";
import { CHECKLIST_PROFILE, checklistObligationKey, type ChecklistInstance } from "../lib/control-plane/readiness/checklist-score.ts";
import type { ChecklistCensus } from "../lib/control-plane/readiness/checklist-census.ts";
import { CHECKLIST_SCOPE_HEAD_SQL } from "../lib/control-plane/admin-view/checklist-instance-index-read.ts";
import { COUNT_CHECKLIST_INSTANCE_ROWS_SQL, INSERT_CHECKLIST_INSTANCE_ROWS_SQL,
  PROMOTE_CHECKLIST_SCOPE_HEAD_SQL, VERIFY_CHECKLIST_INSTANCE_ROWS_SQL,
  ChecklistIndexWriteError, planChecklistIndex, publishChecklistIndexForSnapshot } from "../lib/control-plane/admin-view/checklist-instance-index-write.ts";

const scopeId = "zcta:2020/85635";
const receipt = "expansion.scope.set:scope:85635:1yfuc2c:pgfomast";
const publishedAt = "2026-09-28T12:00:00.000Z";
const definitionId = "OFF-01";
const instance = (index: number) => ({ obligationKey: checklistObligationKey("OFF-01", `person-${index}`, scopeId, "effective-period-unresolved"),
  definitionIds: [definitionId], predicateKey: "OFF-01", objectId: `person-${index}`, jurisdictionId: scopeId,
  period: "effective-period-unresolved", scopeRevision: "census:one",
  applicability: { state: "UNRESOLVED" as const, evidenceIds: [receipt], reason: "Term unknown." },
  due: { state: "UNRESOLVED" as const, evidenceIds: [receipt], at: null },
  predicate: { kind: "POSSESSION" as const, requiredClauses: [`${CHECKLIST_PROFILE.version}:OFF-01`], contractVersion: "checklist-field-contract/1" },
  workIds: [], requiredSurfaces: [], requiresFreshness: true, owner: "Lead",
  blocker: "Term unknown.", nextAction: "Obtain term evidence." }) satisfies ChecklistInstance;
const census = (n: number): ChecklistCensus => ({ profile: CHECKLIST_PROFILE.version, scopeId,
  scopeRevision: "census:one", observedAt: publishedAt, censusVersion: "checklist-census/1",
  instructionReceipt: receipt, population: { knownSubjects: 1, knownRecords: n, expectedObjects: null }, gaps: [],
  inventory: { complete: false, evidenceIds: [receipt], unresolvedObjects: 0 }, readsComplete: false,
  instances: Array.from({ length: n }, (_, i) => instance(i)), witnesses: [] });

class IndexedSqlDouble {
  readonly rows = new Map<string, unknown>();
  head: Record<string, unknown> | null = null;
  currentSnapshotRevision: number;
  failInsertNumber: number | null = null;
  private inserts = 0;
  promotions = 0;
  constructor(revision: number) { this.currentSnapshotRevision = revision; }
  async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
    if (text === INSERT_CHECKLIST_INSTANCE_ROWS_SQL) {
      this.inserts++;
      if (this.failInsertNumber === this.inserts) throw Error("SIMULATED_INTERRUPTION");
      for (const row of JSON.parse(String(params[1])) as Record<string, unknown>[]) {
        const key = JSON.stringify([params[0], row.definition_id, row.obligation_key, row.ordinal]);
        if (!this.rows.has(key)) this.rows.set(key, row.instance);
      }
      return [];
    }
    if (text === VERIFY_CHECKLIST_INSTANCE_ROWS_SQL) {
      const rows = JSON.parse(String(params[1])) as Record<string, unknown>[];
      let found = 0, equal = 0;
      for (const row of rows) {
        const key = JSON.stringify([params[0], row.definition_id, row.obligation_key, row.ordinal]);
        if (this.rows.has(key)) { found++; if (JSON.stringify(this.rows.get(key)) === JSON.stringify(row.instance)) equal++; }
      }
      return [{ expected_count: rows.length, found_count: found, equal_count: equal }];
    }
    if (text === COUNT_CHECKLIST_INSTANCE_ROWS_SQL)
      return [{ row_count: [...this.rows.keys()].filter(key => JSON.parse(key)[0] === params[0]).length }];
    if (text === PROMOTE_CHECKLIST_SCOPE_HEAD_SQL) {
      this.promotions++;
      const proposedRevision = Number(params[3]);
      if (this.currentSnapshotRevision !== proposedRevision ||
        this.head && Number(this.head.source_snapshot_revision) >= proposedRevision) return [];
      this.head = { projection_id: params[2], source_snapshot_revision: proposedRevision };
      return [this.head];
    }
    if (text === CHECKLIST_SCOPE_HEAD_SQL) return this.head ? [{ ...this.head,
      current_snapshot_revision: this.currentSnapshotRevision }] : [];
    throw Error(`UNEXPECTED_SQL:${text.slice(0, 60)}`);
  }
}
const headOf = (sql: IndexedSqlDouble) => sql.head;

test("projection is deterministic, covers all 325 definition counts, and never derives a universe", () => {
  const source = { revision: 4, publishedAt, checklists: [census(2)] };
  const first = planChecklistIndex(source, source.checklists[0]);
  const again = planChecklistIndex(source, source.checklists[0]);
  assert.deepEqual(first, again);
  assert.match(first.projectionId, /^cpidx-[a-f0-9]{64}$/);
  assert.equal(Object.keys(first.counts).length, 325);
  assert.equal(first.counts[definitionId], 2);
  assert.equal(first.counts["CAN-01"], 0);
  assert.equal(first.rows.length, 2);
  assert.notEqual(first.projectionId, planChecklistIndex({ ...source, revision: 5 }, source.checklists[0]).projectionId);
});

test("partial insert retries with the same immutable identity before advancing the head", async () => {
  const source = { revision: 5, publishedAt, checklists: [census(251)] };
  const sql = new IndexedSqlDouble(5);
  sql.failInsertNumber = 2;
  await assert.rejects(publishChecklistIndexForSnapshot(sql, source), /SIMULATED_INTERRUPTION/);
  assert.equal(sql.rows.size, 250);
  assert.equal(sql.head, null);
  sql.failInsertNumber = null;
  await publishChecklistIndexForSnapshot(sql, source);
  assert.equal(sql.rows.size, 251);
  assert.equal(headOf(sql)?.source_snapshot_revision, 5);
  await publishChecklistIndexForSnapshot(sql, source);
  assert.equal(sql.rows.size, 251);
  assert.equal(headOf(sql)?.projection_id, planChecklistIndex(source, source.checklists[0]).projectionId);
});

test("conflicting prior row and incomplete projection cannot promote a false count", async () => {
  const source = { revision: 3, publishedAt, checklists: [census(1)] };
  const sql = new IndexedSqlDouble(3);
  const plan = planChecklistIndex(source, source.checklists[0]);
  sql.rows.set(JSON.stringify([plan.projectionId, definitionId, plan.rows[0].obligation_key, 1]), { forged: true });
  await assert.rejects(publishChecklistIndexForSnapshot(sql, source),
    (error: unknown) => error instanceof ChecklistIndexWriteError && error.code === "IMMUTABLE_ROW_CONFLICT");
  assert.equal(sql.head, null);
  assert.equal(sql.promotions, 0);
});

test("a concurrent newer snapshot prevents the old publisher from regressing the head", async () => {
  const earlier = { revision: 7, publishedAt, checklists: [census(1)] };
  const newer = { revision: 8, publishedAt: "2026-09-28T12:01:00.000Z", checklists: [census(2)] };
  const sql = new IndexedSqlDouble(7);
  await publishChecklistIndexForSnapshot(sql, earlier);
  const oldId = sql.head?.projection_id;
  sql.currentSnapshotRevision = 8;
  await publishChecklistIndexForSnapshot(sql, newer);
  const newId = sql.head?.projection_id;
  assert.notEqual(oldId, newId);
  await assert.rejects(publishChecklistIndexForSnapshot(sql, earlier),
    (error: unknown) => error instanceof ChecklistIndexWriteError && error.code === "SNAPSHOT_SUPERSEDED");
  assert.equal(sql.head?.projection_id, newId);
  assert.equal(sql.head?.source_snapshot_revision, 8);
});
