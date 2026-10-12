/**
 * Cheap deterministic checks that run before the expensive CI tier.
 *
 * Everything this file reaches imports only `node:` builtins and type-strippable
 * local modules, so it runs on a bare checkout before `pnpm install`. Checks here
 * must need no network, credential, database or clock.
 *
 *   node scripts/preflight.mjs          # every check, named, non-zero on any finding
 *   node scripts/preflight.mjs --list   # the check ids
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { firewallRoutineContracts } from "../lib/civic-data/meeting-route-kinds.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { civicDataFirewall } from "../lib/civic-data/firewall.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Each check's `run` returns `{ ok, says, detail? }` and never throws for a finding. */
export const PREFLIGHT_CHECKS = [
  {
    id: "visible-tree",
    what: "every non-ignored file is one the sweeps can actually see",
    run: visibleTree,
  },
  {
    id: "civic-data-release-firewall",
    what: "routine civic data cannot enter Git, Actions, build, browser, or deploy machinery",
    run: civicDataReleaseFirewall,
  },
];

export function civicDataReleaseFirewall({ cwd = ROOT } = {}) {
  try {
    const paths = filesThatWouldBeCommitted({ cwd });
    const files = Object.fromEntries(paths.map((path) => [path, readFileSync(join(cwd, path), "utf8")]));
    const routineContracts = firewallRoutineContracts();
    const findings = civicDataFirewall({
      files,
      contracts: routineContracts,
      manualContracts: MANUAL_PRODUCTION_SOURCE_CONTRACTS,
    });
    return findings.length === 0
      ? {
          ok: true,
          says:
            `0 findings across ${routineContracts.length} routine and ` +
            `${MANUAL_PRODUCTION_SOURCE_CONTRACTS.length} explicit-owner source contract(s).`,
        }
      : { ok: false, says: `${findings.length} release-coupling finding(s).`, detail: findings.map((finding) => `    ${finding.code} · ${finding.path} · ${finding.detail}`).join("\n") };
  } catch (error) {
    return { ok: false, says: `the civic-data firewall could not read its denominator (${error?.message ?? "error"}).` };
  }
}

/* ------------------------------------------------------------ visible tree */

/** Never stages anything: what ships is a decision, so it names the files and stops. */
export function visibleTree({ cwd = ROOT } = {}) {
  let tracked;
  let wouldCommit;
  try {
    tracked = new Set(
      execFileSync("git", ["ls-files", "-z", "--cached"], { cwd, encoding: "utf8", maxBuffer: 1e9 })
        .split("\0")
        .filter(Boolean)
        .map((p) => p.replace(/\\/g, "/")),
    );
    wouldCommit = filesThatWouldBeCommitted({ cwd });
  } catch (error) {
    return { ok: false, says: `git could not be asked what this tree holds (${error?.message ?? "error"}).` };
  }
  const untracked = wouldCommit.filter((f) => !tracked.has(f));
  const seen = floored(
    "files a sweep of the committed tree can see",
    "git",
    wouldCommit.length,
    wouldCommit.length - untracked.length,
    wouldCommit.length === 0 ? "git reports no file here that a commit would carry, so there is no tree to judge" : undefined,
  );
  if (seen.outcome === "COULD_NOT_ASSERT") {
    return { ok: false, says: `${seen.reason}.` };
  }
  if (untracked.length === 0) {
    return { ok: true, says: `${floorLine(seen)}.` };
  }
  const shown = untracked.slice(0, 20);
  return {
    ok: false,
    says:
      `${untracked.length} file(s) are present, not ignored, and not tracked. A sweep that reads the ` +
      "committed tree cannot see them, so a green result here would be a green result about a different tree.",
    detail:
      shown.map((f) => `    ${f}`).join("\n") +
      (untracked.length > shown.length ? `\n    …and ${untracked.length - shown.length} more` : "") +
      "\n\n    Stage them (`git add`) if they ship, or ignore them if they do not." +
      "\n    This check will not stage anything for you: what ships is a decision, not a repair.",
  };
}

/* ------------------------------------------------------------------ the run */
export function runPreflight({ cwd = ROOT, log = console.log } = {}) {
  const results = [];
  for (const check of PREFLIGHT_CHECKS) {
    let outcome;
    try {
      outcome = check.run({ cwd });
    } catch (error) {
      outcome = { ok: false, says: `the check itself could not run (${error?.message ?? "error"}).` };
    }
    results.push({ id: check.id, what: check.what, ...outcome });
    log(`  ${check.id} … ${outcome.ok ? "PASS" : "FAIL"} — ${outcome.says}`);
    if (!outcome.ok && outcome.detail) log(outcome.detail);
  }
  return results;
}

if (process.argv[1] && process.argv[1].endsWith("preflight.mjs")) {
  if (process.argv.includes("--list")) {
    for (const c of PREFLIGHT_CHECKS) console.log(`${c.id}\t${c.what}`);
    process.exit(0);
  }
  console.log("\npreflight — the cheap deterministic checks\n");
  const results = runPreflight();
  const bad = results.filter((r) => !r.ok);
  console.log(
    `\n  ${results.length - bad.length} of ${results.length} preflight check(s) clean` +
      (bad.length === 0
        ? ". The expensive tier may run on this head.\n"
        : ` — FAILING: ${bad.map((r) => r.id).join(", ")}.\n` +
          "  The expensive tier is NOT run on this head. Fix these and push again; the\n" +
          "  corrected head runs the full verification before anything may ship.\n"),
  );
  process.exitCode = bad.length ? 1 : 0;
}
