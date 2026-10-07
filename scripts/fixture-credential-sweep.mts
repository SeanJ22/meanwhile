#!/usr/bin/env tsx
/**
 * `pnpm fixtures:credentials` — finds third-party credentials that rode in on a
 * captured page. Unlike `pnpm secrets:sweep`, which looks for our own values,
 * this looks for a publisher's values (see `lib/ops/fixture-credentials.ts`).
 *
 * ```
 * pnpm fixtures:credentials              scan every committed text file, report, exit 1 on a finding
 * pnpm fixtures:credentials --sanitize   repair the captured-fixture tree and record provenance
 * pnpm fixtures:credentials --all        make confirmed findings outside the fixture tree fail too
 * ```
 *
 * The scan is always repo-wide; `--all` changes the verdict, not what is read.
 * Zero files read is CANNOT RUN and exits 2.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { captureFor, writeCapturedFixture } from "../lib/ops/fixture-captures.ts";
import {
  credentials,
  isCapturedFixturePath,
  PATTERN_BEARING_PATHS,
  SANITIZER_VERSION,
  scanText,
  type CredentialFinding,
} from "../lib/ops/fixture-credentials.ts";
import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RECORD = join(ROOT, "data/fixtures/sanitization.json");

const sanitize = process.argv.includes("--sanitize");
const failEverywhere = process.argv.includes("--all");

const sha256 = (input: string | Buffer): string => createHash("sha256").update(input).digest("hex");

/** Text, or `null` for a binary or over-sized file, which is skipped and counted, never folded into the clean total. */
function readText(abs: string): string | null {
  try {
    if (statSync(abs).size > 64 * 1024 * 1024) return null;
    const buf = readFileSync(abs);
    // A NUL byte means binary. Reading the first 8 KB is enough and does not
    // cost a full pass over a megabyte-scale fixture.
    if (buf.subarray(0, 8192).includes(0)) return null;
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

const files = filesThatWouldBeCommitted({ cwd: ROOT });
if (files.length === 0) {
  console.error("fixtures:credentials · CANNOT RUN — git listed no files, so nothing could be read.");
  process.exit(2);
}

interface FileReport {
  path: string;
  findings: CredentialFinding[];
}

let read = 0;
const skippedByReason: string[] = [];
const reports: FileReport[] = [];

for (const path of files) {
  const text = readText(join(ROOT, path));
  if (text === null) {
    skippedByReason.push(path);
    continue;
  }
  read += 1;
  const findings = scanText(text, sha256);
  if (findings.length > 0) reports.push({ path, findings });
}

console.log(
  `fixtures:credentials · ${SANITIZER_VERSION} · class-aware scan of every committed text file\n`,
);
console.log(`  files listed   ${files.length}`);
console.log(`  files read     ${read}`);
console.log(
  `  files skipped  ${skippedByReason.length} (binary or over the size cap — NOT counted clean)`,
);

if (read === 0) {
  console.error(
    "\nfixtures:credentials · CANNOT RUN — zero files were read. This is not a clean result.",
  );
  process.exit(2);
}

/* ------------------------------------------------------------ the findings */

/** A file that carries the PATTERNS rather than a value. See `PATTERN_BEARING_PATHS`. */
const isPatternBearing = (path: string): boolean => PATTERN_BEARING_PATHS.includes(path);

const withConfirmed = reports.filter((r) => credentials(r.findings).length > 0);
const inFixtures = withConfirmed.filter((r) => isCapturedFixturePath(r.path));
const elsewhere = withConfirmed.filter(
  (r) => !isCapturedFixturePath(r.path) && !isPatternBearing(r.path),
);
const patternOnly = withConfirmed.filter(
  (r) => !isCapturedFixturePath(r.path) && isPatternBearing(r.path),
);
const preservedOnly = reports.filter((r) => credentials(r.findings).length === 0);

function line(f: CredentialFinding): string {
  // The class, the fingerprint, the length, the line. Never the value.
  return (
    `      line ${String(f.line).padEnd(6)} ${f.classId.padEnd(26)} ` +
    `fp=${f.fingerprint} len=${f.length} n=${f.occurrences}` +
    (f.note ? `\n        NOT A CREDENTIAL: ${f.note}` : "")
  );
}

function print(label: string, group: FileReport[], only: "confirmed" | "all") {
  console.log(`\n  ${label} — ${group.length} file(s)`);
  if (group.length === 0) {
    console.log("    none");
    return;
  }
  for (const r of group) {
    console.log(`    ${r.path}`);
    for (const f of r.findings) {
      if (only === "confirmed" && !f.confirmed) continue;
      console.log(line(f));
    }
  }
}

print("CONFIRMED — CAPTURED FIXTURE TREE (tests/fixtures/)", inFixtures, "confirmed");
print("CONFIRMED — ELSEWHERE IN THE REPOSITORY", elsewhere, "confirmed");
if (patternOnly.length > 0) {
  print("CONFIRMED — PATTERN-BEARING FILES (the scanner's own sources)", patternOnly, "confirmed");
}

/*
 * Unconfirmed matches (credential-shaped strings stage two showed are not
 * credentials) are printed with their reason, never dropped.
 */
console.log(
  `\n  SHAPE-MATCHED AND EXCLUDED ON THE EVIDENCE — ${preservedOnly.length} file(s)`,
);
if (preservedOnly.length === 0) console.log("    none");
for (const r of preservedOnly) {
  console.log(`    ${r.path}`);
  for (const f of r.findings) console.log(line(f));
}

/* ------------------------------------------------------------- the repair */

if (sanitize) {
  console.log("\n  --sanitize · repairing the captured-fixture tree\n");

  const existing: Record<string, unknown> = existsSync(RECORD)
    ? ((JSON.parse(readFileSync(RECORD, "utf8")) as { fixtures?: Record<string, unknown> })
        .fixtures ?? {})
    : {};

  if (inFixtures.length === 0) console.log("    nothing to repair");

  /*
   * Every declaration is checked before any file is written, so a refusal never
   * leaves the tree half-repaired.
   */
  const undeclared = inFixtures.filter((r) => captureFor(r.path) === null);
  if (undeclared.length > 0) {
    console.error(
      `\n    REFUSED — ${undeclared.length} capture(s) have no declaration in ` +
        "lib/ops/fixture-captures.ts:\n" +
        undeclared.map((r) => `      ${r.path}`).join("\n") +
        "\n\n    Add sourceUrl, capturedOn and capturedBy for each, then re-run. Sanitizing a\n" +
        "    capture whose origin nobody wrote down would make it impossible to re-derive.\n" +
        "    Nothing was written.",
    );
    process.exit(2);
  }

  for (const report of inFixtures) {
    const abs = join(ROOT, report.path);
    const raw = readFileSync(abs);

    /*
     * The same sanitizing path a recorder uses; tests/fixture-credentials.test.ts
     * refuses a second implementation.
     */
    const result = writeCapturedFixture(abs, raw.toString("utf8"));

    const byClass: Record<string, number> = {};
    for (const f of result.redactions)
      byClass[f.classId] = (byClass[f.classId] ?? 0) + f.occurrences;

    /*
     * `rawSha256` is the hash of the bytes as captured, so the sanitization is
     * auditable without storing the page. It is written once and carried
     * forward; a re-run must not overwrite it with the sanitized file's hash.
     */
    const prior = existing[report.path] as { rawSha256?: string } | undefined;

    /*
     * Where and when the page was read is declared in `lib/ops/fixture-captures.ts`
     * and projected here; a missing declaration refuses.
     */
    const capture = captureFor(report.path)!;

    existing[report.path] = {
      ...(existing[report.path] as Record<string, unknown> | undefined),
      sourceUrl: capture.sourceUrl,
      capturedOn: capture.capturedOn,
      capturedBy: capture.capturedBy,
      rawSha256: prior?.rawSha256 ?? sha256(raw),
      sanitizedSha256: result.sha256,
      sanitizerVersion: SANITIZER_VERSION,
      redactionsByClass: byClass,
      distinctValuesRedacted: result.redactions.length,
      substringsReplaced: result.replaced,
      fingerprints: result.redactions.map((f) => ({
        classId: f.classId,
        fingerprint: f.fingerprint,
        length: f.length,
        occurrences: f.occurrences,
      })),
    };

    console.log(
      `    ${report.path}\n      ${result.redactions.length} distinct value(s), ` +
        `${result.replaced} substring(s) replaced, classes: ${Object.keys(byClass).join(", ")}`,
    );
  }

  mkdirSync(dirname(RECORD), { recursive: true });
  writeFileSync(
    RECORD,
    `${JSON.stringify({ sanitizerVersion: SANITIZER_VERSION, fixtures: existing }, null, 2)}\n`,
  );
  console.log("\n    recorded provenance in data/fixtures/sanitization.json");
  console.log("\n  re-run without --sanitize to verify.");
  process.exit(0);
}

/* ------------------------------------------------------------- the verdict */

const blocking = failEverywhere ? [...inFixtures, ...elsewhere] : inFixtures;

console.log(
  `\nfixtures:credentials · ${inFixtures.length} captured-fixture file(s) carrying a confirmed ` +
    `credential · ${elsewhere.length} elsewhere · ${patternOnly.length} pattern-bearing · ` +
    `${preservedOnly.length} shape-matched and excluded`,
);

if (blocking.length > 0) {
  console.error(
    `\nFAIL — ${blocking.length} file(s) carry a known credential class.\n` +
      "Run `pnpm fixtures:credentials --sanitize` to redact them, then re-run.\n" +
      "Nothing above prints a value; the fingerprints are how you confirm the same one is gone.",
  );
  process.exit(1);
}

if (elsewhere.length > 0) {
  console.log(
    `\nNOTE — ${elsewhere.length} confirmed finding(s) outside the captured-fixture tree are ` +
      "reported and not failing here. `--all` makes them fail.",
  );
}

console.log("\nPASS — no known credential class survives in the captured-fixture tree.");
