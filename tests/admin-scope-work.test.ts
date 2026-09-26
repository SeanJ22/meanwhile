import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { scopeWorkPreview } from "../lib/control-plane/admin-view/scope-work.ts";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-09-26T19:00:00Z";
const AZ = "ocd-division/country:us/state:az";
function obligation(subjectId: string, scopeDivisions?: readonly string[]): FreshnessObligation {
  return { id: `work:${subjectId}`, subjectId, ...(scopeDivisions ? { scopeDivisions } : {}), recordClass: "candidate-enrichment", routeId: "route", active: true, lastWorkedAt: null, readerImpactAt: null, observedChangeRateHours: null };
}

test("scope preview reuses shared records and retains unknowns without including another district or sibling body", () => {
  const rows = [obligation("az:finance", [AZ]), obligation("us:federal", ["ocd-division/country:us"]), obligation("az:cd6", [`${AZ}/cd:6`]), obligation("az:cd7", [`${AZ}/cd:7`]), obligation("nh:other", ["ocd-division/country:us/state:nh"]), obligation("exact#board"), obligation("exact#sibling"), obligation("unknown")];
  const result = scopeWorkPreview({ states: ["AZ"], bodyIds: ["exact#board"], codes: [{ zcta5: "85635", whole: true, fraction: 1, divisions: [`${AZ}/cd:6`], partial: [] }], obligations: [...rows, rows[0]], readAt: NOW });
  assert.deepEqual(result.rows.map(row => row.subjectId), ["az:cd6", "az:finance", "exact#board", "us:federal"]);
  assert.equal(result.unplaced, 2);
  const partial = scopeWorkPreview({ states: ["AZ"], bodyIds: [], codes: [{ zcta5: "85635", whole: false, fraction: 0.2, divisions: [`${AZ}/cd:6`], partial: [`${AZ}/cd:6`] }], obligations: [rows[2]], readAt: NOW });
  assert.equal(partial.rows[0].applicability, "PARTIAL_UNRESOLVED");
});

test("provider applicability survives restart, avoids rewrites and removes withdrawn declarations", async () => {
  const root = mkdtempSync(join(tmpdir(), "scope-work-"));
  try {
    const row = obligation("az:finance", [AZ]);
    await syncObligations(await createFileRepositories(root), [row], NOW);
    const restarted = await createFileRepositories(root);
    assert.deepEqual((await restarted.obligations.mustRead(row.id)).value.scopeDivisions, [AZ]);
    assert.equal((await syncObligations(restarted, [{ ...row, scopeDivisions: [AZ] }], NOW)).refreshed.length, 0);
    const withdrawn = obligation("az:finance");
    assert.deepEqual((await syncObligations(restarted, [withdrawn], NOW)).refreshed[0].changed, ["scopeDivisions"]);
    assert.equal((await (await createFileRepositories(root)).obligations.mustRead(row.id)).value.scopeDivisions, undefined);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
