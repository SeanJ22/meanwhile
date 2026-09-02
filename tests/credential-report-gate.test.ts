import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  CREDENTIAL_REPORT_FIELDS,
  SESSION_REPORT_GATE_REFUSED,
  checkCredentialReport,
  checkCredentialReports,
  loadCredentialReports,
  sessionReportGateLines,
} from "../lib/ops/credential-report.ts";

/**
 * The credential report gate: a credential created, rotated or re-scoped
 * during a session is reported by name, provider, context, scope, actor and
 * owner-copy location, or the session report is refused.
 *
 * The gate is `scripts/workstream-close.mts` (both `--status` and close), so
 * the spawn tests at the bottom prove the EXIT CODE, not only the function.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function complete(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "CREATED",
    reportedAt: "2026-09-01",
    name: "NETLIFY_AUTH_TOKEN",
    provider: "Netlify",
    context: "deploy verification from GitHub Actions",
    scope: "site read, deploy list",
    actor: "session claude/autonomy-recovery-efficiency",
    ownerCopyLocation: ".env.local (NETLIFY_AUTH_TOKEN)",
    ...over,
  };
}

function refusedOf(report: unknown): { missing: string[]; refused: string[] } {
  const c = checkCredentialReport(report);
  assert.equal(c.ok, false, "expected the report to be refused");
  if (c.ok) throw new Error("unreachable");
  return { missing: c.missing, refused: c.refused };
}

/* ---------------------------------------------------------- SEEDED FAILURE */

test("SEEDED FAILURE — a report with every field but ownerCopyLocation is refused, naming exactly that field", () => {
  const { ownerCopyLocation: _dropped, ...withoutCopy } = complete();
  const c = refusedOf(withoutCopy);
  assert.deepEqual(c.missing, ["ownerCopyLocation"]);
  assert.deepEqual(c.refused, []);
});

test("each of the six fields, omitted on its own, is refused naming exactly that field", () => {
  assert.equal(CREDENTIAL_REPORT_FIELDS.length, 6);
  for (const field of CREDENTIAL_REPORT_FIELDS) {
    const report = complete();
    delete report[field];
    const c = refusedOf(report);
    assert.deepEqual(c.missing, [field], `omitting ${field}`);
    assert.deepEqual(c.refused, []);
  }
});

test("a blank or whitespace-only field counts as missing", () => {
  for (const field of CREDENTIAL_REPORT_FIELDS) {
    assert.deepEqual(refusedOf(complete({ [field]: "" })).missing, [field], `empty ${field}`);
    assert.deepEqual(refusedOf(complete({ [field]: "   \t" })).missing, [field], `whitespace ${field}`);
  }
});

test("kind and reportedAt are required and validated, not merely present", () => {
  assert.deepEqual(refusedOf(complete({ kind: "MADE" })).missing, ["kind"]);
  const { kind: _k, ...noKind } = complete();
  assert.deepEqual(refusedOf(noKind).missing, ["kind"]);
  assert.deepEqual(refusedOf(complete({ reportedAt: "yesterday" })).missing, ["reportedAt"]);
  assert.deepEqual(refusedOf(complete({ reportedAt: "2026-13-45" })).missing, ["reportedAt"]);
  // A non-object is refused naming everything, never thrown on.
  const c = refusedOf("not a report");
  assert.deepEqual(c.missing, ["kind", "reportedAt", ...CREDENTIAL_REPORT_FIELDS]);
});

test("a complete report passes, with a date-time stamp and an optional note", () => {
  assert.deepEqual(checkCredentialReport(complete()), { ok: true });
  assert.deepEqual(
    checkCredentialReport(complete({ reportedAt: "2026-09-01T14:02:00Z", note: "rotated after the transcript sweep" })),
    { ok: true },
  );
  for (const kind of ["CREATED", "ROTATED", "SCOPE_CHANGED"]) {
    assert.deepEqual(checkCredentialReport(complete({ kind })), { ok: true }, kind);
  }
});

/* -------------------------------------------------------- THE VALUE GUARD */

// Thirty bytes -> forty base64 characters: the shape of a token, not one.
const TOKEN = Buffer.from("synthetic-shape-only-thirty-by").toString("base64");

test("a secret-shaped scope is refused by FIELD NAME, and the value is never echoed", () => {
  assert.equal(TOKEN.length, 40);
  const report = complete({ scope: TOKEN });
  const c = refusedOf(report);
  assert.deepEqual(c.refused, ["scope"]);
  assert.deepEqual(c.missing, []);
  assert.ok(!JSON.stringify(c).includes(TOKEN), "the check echoed the value");

  const gate = sessionReportGateLines({ reports: [report], present: true });
  assert.equal(gate.refused, true);
  assert.ok(!gate.lines.join("\n").includes(TOKEN), "the gate output echoed the value");
  assert.ok(gate.lines.includes("credential report #1: REFUSED — refused: scope"));
  assert.ok(gate.lines.includes("credential reports: 0 of 1 complete"));
  assert.ok(gate.lines.at(-1)?.startsWith(SESSION_REPORT_GATE_REFUSED));
});

test("a credentialed URL, a private-key header, and a secret-shaped note are refused too", () => {
  assert.deepEqual(
    refusedOf(complete({ ownerCopyLocation: "postgres://owner:hunter2@db.example.invalid/wtp" })).refused,
    ["ownerCopyLocation"],
  );
  assert.deepEqual(
    refusedOf(complete({ context: "pasted: BEGIN OPENSSH PRIVATE KEY block" })).refused,
    ["context"],
  );
  assert.deepEqual(refusedOf(complete({ note: `backup ${TOKEN}` })).refused, ["note"]);
});

test("the value guard refuses every provider token shape and passes every name shape", () => {
  // Shapes a provider hands out (built here from repeated pieces; none is a value).
  const hex40 = "0123456789abcdef".repeat(2) + "fedcba98";
  const prefixed = `ghp_${"Ab1".repeat(12)}`;
  const uuid = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const productKey = "A1B2-C3D4-E5F6-G7H8-I9J0-K1L2-M3N4-O5P6";
  const urlSafe = `${"x9".repeat(10)}-${"Y8".repeat(10)}_${"z7".repeat(10)}`;
  for (const [label, value] of [
    ["40 hex", hex40],
    ["prefixed", prefixed],
    ["uuid", uuid],
    ["product key", productKey],
    ["url-safe base64", urlSafe],
  ] as const) {
    assert.deepEqual(refusedOf(complete({ scope: value })).refused, ["scope"], label);
    assert.deepEqual(refusedOf(complete({ scope: `granted: ${value} (read)` })).refused, ["scope"], `${label} embedded`);
  }

  // Shapes a description carries: a branch with a commit fragment, an env var
  // name, a dated slug, a path with punctuation.
  for (const [field, value] of [
    ["actor", "claude/autonomy-recovery-efficiency-616f07"],
    ["name", "GOOGLE_CIVIC_INFORMATION_API_KEY_PRODUCTION"],
    ["context", "refresh-legiscan-snapshot-workflow-2026-09-01"],
    ["ownerCopyLocation", ".env.local:GOOGLE_CIVIC_INFORMATION_API_KEY_PRODUCTION"],
  ] as const) {
    assert.deepEqual(checkCredentialReport(complete({ [field]: value })), { ok: true }, `${field}: ${value}`);
  }
});

/* ----------------------------------------------------------- THE JSONL READ */

test("loadCredentialReports — no file is present:false and passes the gate; a malformed line throws naming its number", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-cred-"));
  try {
    const absent = loadCredentialReports(dir);
    assert.equal(absent.present, false);
    assert.deepEqual(absent.reports, []);
    const gate = sessionReportGateLines(absent);
    assert.equal(gate.refused, false);
    assert.deepEqual(gate.lines, ["credential reports: none recorded (data/ops/credential-events.jsonl absent)"]);

    const good = join(dir, "good.jsonl");
    writeFileSync(good, `${JSON.stringify(complete())}\n\n${JSON.stringify(complete({ kind: "ROTATED" }))}\n`);
    const two = loadCredentialReports(dir, good);
    assert.equal(two.present, true);
    assert.equal(two.reports.length, 2, "blank lines are skipped, events are not");
    assert.equal(checkCredentialReports(two.reports).ok, true);

    const bad = join(dir, "bad.jsonl");
    writeFileSync(bad, `${JSON.stringify(complete())}\n{not json\n`);
    assert.throws(
      () => loadCredentialReports(dir, bad),
      (e: unknown) => {
        const msg = (e as Error).message;
        assert.match(msg, /line 2/);
        assert.ok(!msg.includes("not json"), "the error echoed the line");
        return true;
      },
    );

    // A present file with no events is named as such, not counted as zero of zero.
    const empty = join(dir, "empty.jsonl");
    writeFileSync(empty, "\n");
    const none = sessionReportGateLines(loadCredentialReports(dir, empty), empty);
    assert.equal(none.refused, false);
    assert.match(none.lines[0], /none recorded .*present but holds no events/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("checkCredentialReports reports per index with a denominator", () => {
  const { ok, results } = checkCredentialReports([complete(), complete({ actor: "" }), 42]);
  assert.equal(ok, false);
  assert.deepEqual(
    results.map((r) => [r.index, r.ok, r.missing.length]),
    [
      [0, true, 0],
      [1, false, 1],
      [2, false, 8],
    ],
  );
});

test("the committed credential event log, if present, passes; if absent, that is the named state", () => {
  const loaded = loadCredentialReports(ROOT);
  if (loaded.present) {
    const check = checkCredentialReports(loaded.reports);
    assert.equal(
      check.ok,
      true,
      `data/ops/credential-events.jsonl holds a deficient report: ${JSON.stringify(
        check.results.filter((r) => !r.ok).map((r) => ({ index: r.index, missing: r.missing, refused: r.refused })),
      )}`,
    );
  } else {
    assert.deepEqual(loaded.reports, []);
    assert.equal(sessionReportGateLines(loaded).refused, false);
  }
});

/* ------------------------------------------------------------- THE GATE */

function runStatus(eventsPath: string): { status: number | null; out: string } {
  const run = spawnSync(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "workstream-close.mts"), "--status"],
    {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, WTP_CREDENTIAL_EVENTS: eventsPath },
    },
  );
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

test("GATE — workstream-close --status exits 1 on a deficient report, 0 on a complete one, 0 with no log", () => {
  const dir = mkdtempSync(join(tmpdir(), "wtp-cred-gate-"));
  try {
    const deficient = join(dir, "deficient.jsonl");
    const { ownerCopyLocation: _dropped, ...withoutCopy } = complete();
    writeFileSync(deficient, `${JSON.stringify(withoutCopy)}\n`);
    const refused = runStatus(deficient);
    assert.equal(refused.status, 1, `expected exit 1:\n${refused.out}`);
    assert.ok(refused.out.includes(SESSION_REPORT_GATE_REFUSED), refused.out);
    assert.ok(refused.out.includes("credential report #1: REFUSED — missing: ownerCopyLocation"), refused.out);
    assert.ok(refused.out.includes("credential reports: 0 of 1 complete"), refused.out);
    assert.ok(!refused.out.includes("WORKSTREAM STATUS —"), "a refused report still printed the handoff");

    const ok = join(dir, "complete.jsonl");
    writeFileSync(ok, `${JSON.stringify(complete())}\n`);
    const passed = runStatus(ok);
    assert.equal(passed.status, 0, `expected exit 0:\n${passed.out}`);
    assert.ok(!passed.out.includes("SESSION REPORT GATE"), passed.out);
    assert.ok(passed.out.includes("credential report #1: OK"), passed.out);
    assert.ok(passed.out.includes("credential reports: 1 of 1 complete"), passed.out);
    assert.ok(passed.out.includes("WORKSTREAM STATUS —"), "the handoff was not printed after a passing gate");

    const absent = runStatus(join(dir, "never-written.jsonl"));
    assert.equal(absent.status, 0, `expected exit 0:\n${absent.out}`);
    assert.match(absent.out, /credential reports: none recorded \(.*never-written\.jsonl absent\)/);
    assert.ok(!absent.out.includes("SESSION REPORT GATE"), absent.out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
