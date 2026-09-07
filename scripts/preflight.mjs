/**
 * **THE CHEAP DETERMINISTIC CHECKS, BEFORE ANYTHING EXPENSIVE IS BOUGHT.**
 * (CIE-2, CIE-3. RULING 279.)
 *
 * ## The run this exists because of
 *
 * Run 34097010100, 2026-09-07. A committed duplicate helper — the cheapest
 * class of defect this repository knows how to detect — was found by
 * `tests/duplicate-implementations.test.ts`, which runs inside `pnpm test`,
 * which is step fourteen of the `gates` job and takes 8m46s to get there. By
 * then the job had already installed a browser it never used. The job then ran
 * for another 3m6s AFTER the failure was known, and the two `build` jobs had
 * spent their own minutes in parallel. Seventeen billed runner-minutes to learn
 * something a two-second scan knows.
 *
 * Nothing was wrong with any of those gates. The order was wrong.
 *
 * ## What belongs in here, and what does not
 *
 * Two properties, and both are required of anything added:
 *
 *   **Cheap.** No dependency install, no browser, no build. This file and
 *   everything it reaches import only `node:` builtins and type-strippable
 *   local modules, so it runs on a bare checkout with a bare `node` before
 *   `pnpm install` has been called. That is what lets CI run it first.
 *
 *   **Deterministic.** It answers from the tree in front of it. A check that
 *   needs a network, a credential, a database or a clock is not a preflight
 *   check — it is a verification, and it belongs after this.
 *
 * ## Every check reports, and then the tier stops
 *
 * RULING 155's discipline is preserved WITHIN the tier: every check here runs
 * even after one fails, and each is reported by name, so one run gives every
 * cheap answer rather than one per push. What changes is what happens NEXT — a
 * red preflight does not buy the expensive tier on that same head. RULING 279.
 *
 * ## Usage
 *
 *   node scripts/preflight.mjs          # every check, named, non-zero on any finding
 *   node scripts/preflight.mjs --list   # the check ids, for the parity test
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { filesThatWouldBeCommitted } from "../lib/ops/repo-files.ts";
import { duplicates, groupId } from "../lib/ops/duplicate-implementations.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { BASELINE_FILE, census } from "./duplicate-implementations.mts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The checks, in order. Each is `{ id, what, run }` where `run` returns
 * `{ ok, says, detail? }` and never throws for a finding — a throw is an
 * instrument fault and is reported as one.
 */
export const PREFLIGHT_CHECKS = [
  {
    id: "visible-tree",
    what: "every non-ignored file is one the sweeps can actually see",
    run: visibleTree,
  },
  {
    id: "duplicate-implementations",
    what: "no duplicate implementation exists that the baseline does not record (RULING 103)",
    run: duplicateImplementations,
  },
];

/* ------------------------------------------------------------ visible tree */

/**
 * **A GATE READS WHAT WOULD BE COMMITTED, AND SO MUST THE SESSION.** (CIE-2.)
 *
 * The first PR #294 run reported 16 of 16 green locally and then failed CI on a
 * duplicate helper. Nothing was wrong with the gates: the new files were still
 * UNTRACKED, and the duplicate sweep asked `git ls-files`, which lists tracked
 * files. The sweep looked, saw a tree without them, and passed.
 *
 * `lib/ops/repo-files.ts` fixed that class for seven call sites in 2026-08 and
 * `tests/gate-ordering.test.ts` was written to stop an eighth. Both are real and
 * both missed this one, because the guard's pattern only recognised the
 * ARGV form (`["ls-files", …]`) and this call site uses the shell-string form
 * (`"git ls-files -z"`). So the instance is fixed at the call site, the guard is
 * widened to see both forms, and this check closes the remaining half: a
 * session cannot get a shipping-grade local answer about a tree that still has
 * files nothing has been shown.
 *
 * **It never stages anything.** A validator that fixed what it measures would
 * be measuring itself, and `git add` is a decision about what ships. It names
 * the files and stops.
 *
 * In CI the checkout is fresh, so this passes in milliseconds and costs nothing;
 * its value there is that the invariant is asserted in the same place rather
 * than being a rule only the local door knows.
 */
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
  /*
   * RULING 159 / RULING 116: a count carries its denominator. "5,971 files" is
   * not a reading; "5,971 of 5,971 tracked" is, and so is "5,970 of 5,971",
   * which is the answer this check exists to be able to give.
   *
   * An EMPTY population is not a clean tree. Git answering with nothing means
   * this directory carries nothing a commit would — which is true of a path
   * outside the working tree, and would otherwise read here as "everything is
   * visible". The floor refuses to let that default to a pass, so the reason is
   * stated and the outcome is COULD_NOT_ASSERT rather than a green.
   */
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

/* -------------------------------------------------- duplicate implementations */

/**
 * RULING 103's class sweep, run where it is cheap instead of where it was.
 *
 * The ALGORITHM is not reimplemented here — `census()` and `duplicates()` are
 * the same functions `tests/duplicate-implementations.test.ts` calls, so there
 * is one scanner with two callers and no way for them to disagree. What this
 * adds is only the timing.
 *
 * Both directions, exactly as the suite asserts them: a group the baseline does
 * not record is a new duplicate, and a group the baseline records that no
 * longer exists is a fixed defect whose record now misinforms the next reader.
 */
export function duplicateImplementations({ cwd = ROOT } = {}) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(join(cwd, BASELINE_FILE), "utf8"));
  } catch (error) {
    return { ok: false, says: `${BASELINE_FILE} could not be read (${error?.message ?? "error"}), so nothing can be judged against it.` };
  }
  const recorded = new Set((baseline.groups ?? []).map((g) => g.id));
  const live = duplicates(census()).map(groupId);
  const liveSet = new Set(live);
  const fresh = live.filter((id) => !recorded.has(id));
  const gone = [...recorded].filter((id) => !liveSet.has(id));
  const known = floored("duplicate groups the baseline records", "tests/duplicate-implementations.json", live.length, live.length - fresh.length);
  if (fresh.length === 0 && gone.length === 0) {
    return { ok: true, says: `${floorLine(known)}.` };
  }
  const lines = [];
  if (fresh.length > 0) {
    lines.push(`    ${fresh.length} implementation(s) now appear in more than one file and are not recorded:`);
    for (const id of fresh) lines.push(`      ${id}`);
    lines.push("      Fix at the shared code path, or record the group with a REASON it must stay separate.");
  }
  if (gone.length > 0) {
    lines.push(`    ${gone.length} recorded group(s) no longer exist — consolidated, or renamed:`);
    for (const id of gone) lines.push(`      ${id}`);
    lines.push(`      Remove them from ${BASELINE_FILE} in the same commit. The baseline only shrinks.`);
  }
  return {
    ok: false,
    says: `${fresh.length} unrecorded and ${gone.length} stale duplicate group(s) against ${BASELINE_FILE}.`,
    detail: lines.join("\n"),
  };
}

/* ------------------------------------------------------------------ the run */

/** Run every check, report each by name, and say whether the tier is clean. */
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
  console.log("\npreflight — the cheap deterministic checks (RULING 279)\n");
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
