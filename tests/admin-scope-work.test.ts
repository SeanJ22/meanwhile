import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncObligations } from "../lib/control-plane/scheduler/durable.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";

const NOW = "2026-09-26T19:00:00Z";
const AZ = "ocd-division/country:us/state:az";
function obligation(subjectId: string, scopeDivisions?: readonly string[]): FreshnessObligation {
  return { id: `work:${subjectId}`, subjectId, ...(scopeDivisions ? { scopeDivisions } : {}), recordClass: "candidate-enrichment", routeId: "route", active: true, lastWorkedAt: null, readerImpactAt: null, observedChangeRateHours: null };
}

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
