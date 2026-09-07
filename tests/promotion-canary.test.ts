import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * **PRDY-6 — THE SHADOW CANARY, RUN AS THE OWNER RUNS IT.** (2026-09-06.)
 *
 * `scripts/promotion-canary.mts` in fixture mode with the deterministic audit,
 * on a temp root, recording nothing under data/. The report it prints is the
 * evidence: a positive meeting-time and agenda candidate carried through the
 * REAL chain and promoter into an isolated snapshot, every named refusal, a
 * reversal that restored the before-state bytes, and the committed reader
 * snapshot and the live gate untouched.
 */

const ROOT = process.cwd();
const REAL_SNAPSHOT = join(ROOT, "data", "meetings-snapshot.json");
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

test("PRDY-6: the canary proves positive, refusal and rollback canaries on an isolated root and leaves reader truth and the gate untouched", (t) => {
  const before = sha(REAL_SNAPSHOT);
  const root = mkdtempSync(join(tmpdir(), "wtp-canary-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/promotion-canary.mts", "--source=fixture", "--audit=deterministic", "--no-record", "--json", `--root=${root}`],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, WTP_WORKERS_ANTHROPIC_API_KEY: "" } });
  assert.equal(run.status, 0, `${run.stdout.slice(-4000)}\n${run.stderr.slice(-4000)}`);
  const report = JSON.parse(run.stdout) as {
    gate: { promotionEnabled: boolean; openRecordClasses: string[]; constant: boolean };
    modelAudit: string;
    positive: { chain: { parser: string; validator: string; auditor: string } | null; pipeline: Record<string, { byStage: Record<string, number> }>; liveGate: { promoteWould: number; refuseWould: number; items: number }; shadowGate: { promoteWould: number }; promotedByClass: Record<string, number>; verification: { passed: boolean | null } | null; supersededHold: { refused: number } };
    refusals: { stale: { count: number; freshnessState: string }; conflict: { count: number }; malformed: { count: number }; excludedClass: { count: number; code: string }; promotionOff: { count: number; written: boolean; snapshotUnchanged: boolean } };
    rollback: { executed: boolean; matchesBefore: boolean; incident: string } | null;
    preservation: { realSnapshotUnchanged: boolean; promotionEnabled: boolean; openRecordClasses: number; readerVisiblePromotions: number };
    gaps: string[];
  };
  assert.deepEqual(report.gaps, []);
  assert.equal(report.gate.promotionEnabled, false);
  assert.equal(report.gate.constant, false);
  assert.deepEqual(report.gate.openRecordClasses, []);
  assert.match(report.modelAudit, /^NOT_RUN: --audit=deterministic/);
  assert.deepEqual(report.positive.chain, { parser: "EXTRACTED", validator: "PASS", auditor: "SURVIVED", auditorFindings: [], modelReview: null } as never);
  assert.equal(report.positive.pipeline["meeting-times"].byStage.APPROVED_FOR_PROMOTION, 18);
  assert.equal(report.positive.pipeline.agendas.byStage.APPROVED_FOR_PROMOTION, 18);
  assert.equal(report.positive.liveGate.promoteWould, 0, "the LIVE gate promotes nothing");
  assert.equal(report.positive.liveGate.refuseWould, report.positive.liveGate.items);
  assert.equal(report.positive.shadowGate.promoteWould, 36);
  assert.ok(report.positive.promotedByClass["meeting-times"] >= 1);
  assert.ok(report.positive.promotedByClass.agendas >= 1);
  assert.equal(report.positive.verification?.passed, true);
  assert.ok(report.positive.supersededHold.refused >= 1);
  assert.ok(report.refusals.stale.count >= 1);
  assert.equal(report.refusals.stale.freshnessState, "STALE");
  assert.ok(report.refusals.conflict.count >= 1);
  assert.ok(report.refusals.malformed.count >= 1);
  assert.equal(report.refusals.excludedClass.code, "RECORD_CLASS_CLOSED");
  assert.ok(report.refusals.promotionOff.count >= 36);
  assert.equal(report.refusals.promotionOff.written, false);
  assert.equal(report.refusals.promotionOff.snapshotUnchanged, true);
  assert.equal(report.rollback?.executed, true);
  assert.equal(report.rollback?.matchesBefore, true);
  assert.equal(report.rollback?.incident, "POST_PROMOTION_VERIFICATION_FAILED");
  assert.deepEqual(report.preservation, { realSnapshotUnchanged: true, promotionEnabled: false, openRecordClasses: 0, readerVisiblePromotions: 0 });
  assert.ok(existsSync(join(root, "canary-report.json")));
  assert.ok(existsSync(join(root, "positive", "data", "meetings-snapshot.json")));
  assert.equal(sha(REAL_SNAPSHOT), before, "the committed reader snapshot is byte-identical after the canary");
  assert.equal(existsSync(join(ROOT, "data", "health", "promotion-canary-runs", "never-written.json")), false);
});
