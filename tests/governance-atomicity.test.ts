import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { withTreeLock } from "./tree-lock.ts";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadIndex } from "../lib/governance/ledger.ts";
import { CURRENT_STATUSES } from "../lib/governance/schema.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The atomicity guard.
 *
 * **The mismatch this was built for is RESOLVED at the HEAD it was written
 * against** — `CLAUDE.md` and `docs/rulings.md` both carried RULING 169, 170 and
 * 171, measured rather than assumed. The guard exists anyway, because the
 * mismatch was never the defect: the hand-maintained dual write that PERMITTED
 * it was, and fixing the named instance while leaving the mechanism standing is
 * what the named-instance rule forbids everywhere else in this repository.
 *
 * What replaces the dual write is a single canonical ledger and generated
 * views. These guards assert that the replacement actually holds — that no
 * generated view can drift, and that the constitution cannot claim a rule the
 * ledger does not contain.
 */

function tsx(script: string, cwd: string): string {
  return execFileSync(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), script],
    { cwd, stdio: "pipe", encoding: "utf8" },
  );
}

function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "wtp-atomic-"));
  /* Under the working-tree lock: this recursive copy holds every file under
     docs/ open while it runs, and on Windows that refuses the in-place write
     the RULING 92 test makes to the same governance views at the same moment.
     See tests/tree-lock.ts. */
  withTreeLock("snapshot the tree for an out-of-place governance compile", () => {
    for (const p of ["lib", "scripts", "docs", "data/state-holdings", "package.json", "tsconfig.json"]) {
      const src = join(ROOT, p);
      if (existsSync(src)) cpSync(src, join(dir, p), { recursive: true });
    }
    cpSync(join(ROOT, "CLAUDE.md"), join(dir, "CLAUDE.md"));
  });
  return dir;
}

test("the constitution cannot claim a ruling the canonical ledger does not contain", () => {
  // This is the RULING 169 / RULING 170 shape, made into a build failure.
  const index = loadIndex();
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const dangling: string[] = [];
  for (const m of claude.matchAll(/RULING\s+(\d+)/gi)) {
    if (!index.resolve(`RULING ${m[1]}`)) dangling.push(`RULING ${m[1]}`);
  }
  assert.deepEqual(dangling, []);
});

test("every generated governance view reproduces byte-for-byte", () => {
  // RULING 102: fixing a generator is not finished until its output is
  // regenerated and diffed. Here the diff IS the test.
  const dir = scratchRepo();
  try {
    tsx(join(dir, "scripts", "governance-compile.mts"), dir);
    for (const p of [
      "docs/governance/index.json",
      "docs/governance/current-decisions.md",
      "docs/governance/history.md",
      "docs/governance/constitution.md",
      "docs/rulings.md",
      "docs/governance/policies/discovery.md",
      "docs/governance/policies/meta-governance.md",
    ]) {
      assert.equal(
        readFileSync(join(dir, p), "utf8"),
        readFileSync(join(ROOT, p), "utf8"),
        `${p} is stale — regenerate with \`pnpm governance:compile\``,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a hand-edited generated view is caught by governance:check", () => {
  // The guard is shown catching the real thing rather than asserted to work
  // (RULING 110). Somebody edits `docs/rulings.md` by hand, as they did for
  // months; the check must go red.
  const dir = scratchRepo();
  try {
    const p = join(dir, "docs", "rulings.md");
    writeFileSync(p, readFileSync(p, "utf8") + "\n\n## RULING 999 — smuggled in by hand\n", "utf8");
    let failed = false;
    try {
      tsx(join(dir, "scripts", "governance-check.mts"), dir);
    } catch {
      failed = true;
    }
    assert.ok(failed, "a hand-edited generated view must fail governance:check");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shortening the constitution cannot delete law from the ledger", () => {
  // The defect this session actually committed and fixed: the first compiler
  // re-derived the constitution's un-numbered law from the LIVE `CLAUDE.md`, so
  // rewriting that file deleted the transparency mandate and the fourteen-rung
  // ladder from the canonical store — silently, with every check green, because
  // deletion is not duplication.
  const dir = scratchRepo();
  try {
    writeFileSync(join(dir, "CLAUDE.md"), "# CLAUDE.md\n\nDeliberately emptied by this test.\n", "utf8");
    tsx(join(dir, "scripts", "governance-compile.mts"), dir);
    const ledger = readFileSync(join(dir, "docs", "governance", "ledger.jsonl"), "utf8");
    for (const phrase of ["Get out of my way", "PDFs ARE DATA", "Never generate a candidate position"]) {
      assert.ok(
        ledger.includes(phrase),
        `emptying the constitution must not remove "${phrase}" from the canonical ledger`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the legacy snapshots are preserved with their exact bytes", () => {
  // Preservation is mandatory. The manifest is the receipt.
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "docs", "governance", "migration-manifest.json"), "utf8"),
  ) as { legacy: Record<string, { bytes: number; sha256: string }> };

  assert.equal(manifest.legacy["CLAUDE.md"].bytes, 254943);
  assert.equal(manifest.legacy["docs/rulings.md"].bytes, 283312);

  for (const [name, file] of [
    ["CLAUDE.md", "docs/governance/legacy/CLAUDE.pre-remediation.md"],
    ["docs/rulings.md", "docs/governance/legacy/rulings.pre-remediation.md"],
  ] as const) {
    const text = readFileSync(join(ROOT, file), "utf8");
    assert.equal(
      Buffer.byteLength(text, "utf8"),
      manifest.legacy[name].bytes,
      `${file} must still be the exact pre-remediation bytes`,
    );
  }
});

test("the constitution stays a ROOT constitution, not a second copy of the policies", () => {
  const claude = readFileSync(join(ROOT, "CLAUDE.md"), "utf8");
  const words = claude.split(/\s+/).filter(Boolean).length;
  // A direction, not a frozen size (RULING 116). The legacy file was 41,699
  // words; this asserts the constitution has not grown back into one.
  assert.ok(words < 12_000, `the root constitution is ${words} words and should stay far below the 41,699 it replaced`);

  // And it must still index every policy, or a session opening on it cannot
  // find the domain law.
  for (const d of [
    "discovery",
    "rendering-neutrality",
    "data-privacy",
    "sources-licensing",
    "shipping-ci",
    "tracker-workflow",
    "visual-feedback",
    "business",
    "meta-governance",
  ]) {
    assert.ok(
      claude.includes(`docs/governance/policies/${d}.md`),
      `the constitution must index the ${d} policy`,
    );
  }
});

test("no superseded operative text sits in current authority", () => {
  const index = loadIndex();
  for (const p of [
    "docs/governance/policies/discovery.md",
    "docs/governance/policies/shipping-ci.md",
    "docs/governance/current-decisions.md",
  ]) {
    const text = readFileSync(join(ROOT, p), "utf8");
    for (const r of index.records) {
      if (CURRENT_STATUSES.includes(r.status)) continue;
      if (r.kind === "PENDING_INTERPRETATION" || r.kind === "TOMBSTONE") continue;
      // The test is whether the record has its own ENTRY here — the metadata
      // line the generator emits for a rule it is serving as current law.
      //
      // A bare MENTION is fine and must stay fine: RULING 61 explains itself by
      // naming the two-branch bar of RULING 58 that it replaced, and RULING 170
      // by naming what of RULING 94 still stands. Banning those citations would
      // strip amendments of the reasoning this repository requires them to ship
      // with, and would push a session back toward chronological archaeology to
      // find out what changed — the exact thing being fixed.
      const ownEntry = new RegExp(`^\\*\`${r.id}\` · `, "m");
      assert.ok(
        !ownEntry.test(text),
        `${p} serves ${r.status} record ${r.id} as current law — history explains, it does not govern`,
      );
    }
  }
});

test("the final governance acceptance gate passes", () => {
  // The whole remediation brief, checked against measured state rather than
  // asserted in a report. If a later change breaks any of the 27 criteria, the
  // suite says which one — the same reason every other gate here exists.
  const out = execFileSync(
    process.execPath,
    [join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"), join(ROOT, "scripts", "governance-accept.mts")],
    { cwd: ROOT, encoding: "utf8", stdio: "pipe" },
  );
  assert.match(out, /GOVERNANCE REMEDIATION: COMPLETE/);
  assert.ok(!out.includes("FAIL "), `a governance acceptance criterion is failing:\n${out}`);
});
