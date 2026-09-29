import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";
import { readerSuccessorPublicProbeBindsPointer,
  readerSuccessorPublicProbeKind } from "../lib/holdings/reader-execution-authority.ts";

const head = "a".repeat(40);
const sha = "b".repeat(64);

function evidence(recordClass: string, version: string, formatVersion: 1 | 2 = 2) {
  const scope = "US:test";
  const key = `${recordClass}:${scope}`;
  const pointerBindings = [{ key, sourceId: "official", recordClass, scope,
    currentVersionId: version, rowSha256: version === "old" ? sha : "c".repeat(64) }];
  const candidateBindings = [{ key, candidateId: version, rowSha256: sha, eventSha256: [sha] }];
  return { formatVersion, phase: "PRODUCTION", exactHead: head, store: {}, readOnly: {},
    import: { receiptSha256: sha, dispositionSetSha256: sha, canonicalPointerCount: 1,
      pointerBindings, candidateBindings, durableImport: { eventCount: 1, eventSetSha256: sha,
        candidateSetSha256: sha } }, clone: null };
}

function census() {
  return { holdingsDigest: sha, registrySha256: sha,
    records: [{ auditId: "held#one", eligibility: { state: "READER_ELIGIBLE" } }],
    rows: [{ id: "ballot:ballot:az", readerSurface: "ballot", datasetFamily: "ballot",
      state: "az", eligibleRecordIds: ["held#one"] }] };
}

function runPlan(before: unknown, after: unknown) {
  const directory = mkdtempSync(join(tmpdir(), "reader-successor-plan-"));
  try {
    const files = [before, after, census(), census()].map((value, index) => {
      const path = join(directory, `${index}.json`);
      writeFileSync(path, JSON.stringify(value));
      return path;
    });
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
      "./scripts/register-test-loader.mjs", "scripts/reader-last-mile-successor-readback.mts",
      "--certified-authority", files[0]!, "--current-authority", files[1]!,
      "--certified-census", files[2]!, "--current-census", files[3]!],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 });
    assert.equal(result.error, undefined);
    return { exitCode: result.status, report: JSON.parse(result.stdout) as Record<string, unknown> };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("V1 historical authority cannot become a successor plan without exact keys", () => {
  const result = runPlan(evidence("BALLOT_FILING", "old", 1), evidence("BALLOT_FILING", "new"));
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, "BLOCKED_BASELINE_OR_PROJECTION");
});

test("changed ballot, meeting, and vote pointers yield work, never public delivery credit", () => {
  for (const recordClass of ["BALLOT_FILING", "MEETING", "STATE_LEGISLATOR_VOTES"]) {
    const result = runPlan(evidence(recordClass, "old"), evidence(recordClass, "new"));
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.status, "BLOCKED_PENDING_HISTORICAL_CHAIN_AND_PUBLIC_READBACK");
    assert.deepEqual(result.report.execution, { publicRequests: 0, paidRequests: 0,
      publicReadbackComplete: false, historicalChainChecked: false,
      postReadbackAuthorityChecked: false });
    assert.equal((result.report.changedPointers as unknown[]).length, 1);
    assert.ok((result.report.affectedSurfaces as string[]).length > 0);
  }
});

test("an identical V2 authority needs no successor public probe", () => {
  const baseline = evidence("MEETING", "old");
  const result = runPlan(baseline, baseline);
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.status, "NO_CHANGED_POINTER_READBACK_REQUIRED");
  assert.deepEqual(result.report.requiredRows, []);
});

test("hosted successor probes admit only bounded GET routes without Ask or history expansion", () => {
  assert.equal(readerSuccessorPublicProbeKind("/api/votes?member=congress%3AC001133"), "votes");
  assert.equal(readerSuccessorPublicProbeKind("/api/agenda?meetingId=meeting%3Aone"), "agenda");
  assert.equal(readerSuccessorPublicProbeKind("/api/meetings?zip=85701&lat=32.2&lng=-110.9"), "meetings");
  for (const path of ["/api/ask/grounded", "/api/votes?member=congress%3AC001133&history=1",
    "https://example.org/api/votes?member=congress%3AC001133", "/api/meetings?zip=85701"])
    assert.equal(readerSuccessorPublicProbeKind(path), null, path);
});

test("a state vote probe joins the exact promoted member scope, never a sibling or session marker", () => {
  const path = "/api/votes?member=nh-general-court%3A77";
  assert.equal(readerSuccessorPublicProbeBindsPointer(
    { recordClass: "STATE_LEGISLATOR_VOTES", scope: "nh-general-court:77" }, path), true);
  assert.equal(readerSuccessorPublicProbeBindsPointer(
    { recordClass: "STATE_LEGISLATOR_VOTES", scope: "nh-general-court:78" }, path), false);
  assert.equal(readerSuccessorPublicProbeBindsPointer(
    { recordClass: "STATE_LEGISLATOR_VOTES", scope: "US-NH" }, path), false);
  assert.equal(readerSuccessorPublicProbeBindsPointer(
    { recordClass: "MEETING", scope: "nh-general-court:77" }, path), false);
});

test("hosted ballot mode rejects a wrong origin or unrelated canonical key before acquisition", () => {
  const base = {
    ...process.env,
    SHOOT_BASE_URL: PUBLIC_SITE_ORIGIN,
    READER_DEPLOYED_COMMIT: head,
    READER_SUCCESSOR_KEY: "BALLOT_FILING:US-NJ:county:morris:2026-general",
    READER_SUCCESSOR_VERSION_ID: "candidate-promoted",
    READER_BALLOT_STATES: "nj",
    READER_PROOF_OUTPUT: "docs/evidence/reader-last-mile-successor-ballot-test.json",
    READER_BALLOT_PLAN_OUTPUT: "docs/evidence/reader-last-mile-successor-ballot-plan-test.json",
  };
  for (const changed of [
    { SHOOT_BASE_URL: "https://example.org" },
    { READER_SUCCESSOR_KEY: "BALLOT_FILING:US-AZ:pima:2026" },
    { READER_SUCCESSOR_VERSION_ID: "bootstrap:unproved" },
    { READER_BALLOT_STATES: "az,nj" },
  ]) {
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import",
      "./scripts/register-test-loader.mjs", "scripts/reader-last-mile-ballot.mts", "--successor-public"],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000, env: { ...base, ...changed } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Successor ballot/);
  }
});
