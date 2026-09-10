import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { canonicalCivicDataJson } from "../lib/civic-data/changes.ts";
import { NON_ROUTINE_DISPOSITIONS } from "../lib/civic-data/non-routine-dispositions.ts";
import { PDC_V2_FROZEN_BASE_SHA } from "../lib/civic-data/trusted-lkg-import.ts";

interface FrozenBridgeRow {
  readonly holder: { readonly sourcePath: string };
  readonly status: "RESOLVED" | "NO_APPLICABLE_CANDIDACY" | "IDENTITY_UNRESOLVED";
}

interface FrozenBridgeFile {
  readonly rows: readonly FrozenBridgeRow[];
}

const RETAINED_AUTHORITIES = new Map<string, Readonly<Record<FrozenBridgeRow["status"], number>>>([
  ["lib/registry/officeholders-us.json", { RESOLVED: 9, NO_APPLICABLE_CANDIDACY: 530, IDENTITY_UNRESOLVED: 0 }],
  ["lib/registry/body-rosters.ts", { RESOLVED: 30, NO_APPLICABLE_CANDIDACY: 265, IDENTITY_UNRESOLVED: 0 }],
  ["lib/officials/statewide-executives.ts", { RESOLVED: 9, NO_APPLICABLE_CANDIDACY: 5, IDENTITY_UNRESOLVED: 0 }],
]);

const RETIRED_RESEARCH_INPUTS = new Map<string, Readonly<Record<FrozenBridgeRow["status"], number>>>([
  ["data/states/az/officials/officeholders-04.json", { RESOLVED: 9, NO_APPLICABLE_CANDIDACY: 81, IDENTITY_UNRESOLVED: 0 }],
  ["data/states/nh/officials/officeholders-33.json", { RESOLVED: 4, NO_APPLICABLE_CANDIDACY: 406, IDENTITY_UNRESOLVED: 0 }],
  ["data/states/nj/officials/officeholders-34.json", { RESOLVED: 0, NO_APPLICABLE_CANDIDACY: 120, IDENTITY_UNRESOLVED: 0 }],
]);

function frozenBridge(): FrozenBridgeFile {
  const json = execFileSync(
    "git",
    ["show", `${PDC_V2_FROZEN_BASE_SHA}:lib/funding/official-candidacies.json`],
    { encoding: "utf8", windowsHide: true },
  );
  return JSON.parse(json) as FrozenBridgeFile;
}

function assertPathPartition(
  rows: readonly FrozenBridgeRow[],
  expected: ReadonlyMap<string, Readonly<Record<FrozenBridgeRow["status"], number>>>,
): void {
  for (const [sourcePath, statusCounts] of expected) {
    const pathRows = rows.filter((row) => row.holder.sourcePath === sourcePath);
    assert.equal(pathRows.length, Object.values(statusCounts).reduce((sum, count) => sum + count, 0), sourcePath);
    for (const [status, count] of Object.entries(statusCounts)) {
      assert.equal(pathRows.filter((row) => row.status === status).length, count, `${sourcePath}:${status}`);
    }
  }
}

test("PDC trusted-LKG bridge explicitly accounts for all 1,468 frozen rows as 848 serving plus 620 retired research-only", () => {
  const rows = frozenBridge().rows;
  const retainedPaths = new Set(RETAINED_AUTHORITIES.keys());
  const retiredPaths = new Set(RETIRED_RESEARCH_INPUTS.keys());
  const retained = rows.filter((row) => retainedPaths.has(row.holder.sourcePath));
  const retired = rows.filter((row) => retiredPaths.has(row.holder.sourcePath));
  const knownPaths = new Set([...retainedPaths, ...retiredPaths]);

  assert.equal(rows.length, 1_468);
  assert.equal(retained.length, 848);
  assert.equal(retired.length, 620);
  assert.equal(retained.length + retired.length, rows.length);
  assert.equal(rows.filter((row) => !knownPaths.has(row.holder.sourcePath)).length, 0);
  assertPathPartition(rows, RETAINED_AUTHORITIES);
  assertPathPartition(rows, RETIRED_RESEARCH_INPUTS);

  const allFingerprints = rows.map(canonicalCivicDataJson);
  const retainedFingerprints = new Set(retained.map(canonicalCivicDataJson));
  const retiredFingerprints = new Set(retired.map(canonicalCivicDataJson));
  assert.equal(new Set(allFingerprints).size, rows.length, "every frozen bridge row has one exact identity");
  assert.equal(
    [...retainedFingerprints].filter((fingerprint) => retiredFingerprints.has(fingerprint)).length,
    0,
    "serving and retired partitions are disjoint",
  );
  assert.deepEqual(new Set([...retainedFingerprints, ...retiredFingerprints]), new Set(allFingerprints));

  assert.deepEqual(
    retained.reduce<Record<FrozenBridgeRow["status"], number>>((counts, row) => {
      counts[row.status] += 1;
      return counts;
    }, { RESOLVED: 0, NO_APPLICABLE_CANDIDACY: 0, IDENTITY_UNRESOLVED: 0 }),
    { RESOLVED: 48, NO_APPLICABLE_CANDIDACY: 800, IDENTITY_UNRESOLVED: 0 },
  );
  assert.deepEqual(
    retired.reduce<Record<FrozenBridgeRow["status"], number>>((counts, row) => {
      counts[row.status] += 1;
      return counts;
    }, { RESOLVED: 0, NO_APPLICABLE_CANDIDACY: 0, IDENTITY_UNRESOLVED: 0 }),
    { RESOLVED: 13, NO_APPLICABLE_CANDIDACY: 607, IDENTITY_UNRESOLVED: 0 },
  );

  const disposition = NON_ROUTINE_DISPOSITIONS.find(({ sourceId }) => sourceId === "plural-bulk-roster");
  assert.equal(disposition?.disposition, "RESEARCH_ONLY");
  assert.equal(disposition?.execution.readerUse, "FORBIDDEN");
  assert.ok(disposition?.execution.forbidden.includes("PRODUCTION_CANONICAL_USE"));
  assert.ok(disposition?.execution.forbidden.includes("READER_RUNTIME_FALLBACK"));
});
