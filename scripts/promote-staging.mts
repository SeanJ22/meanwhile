/**
 * `pnpm promote:staging` — the gate that stands between the staging head and
 * `main`. (Session C final, LANE 5. The executable half of RULING 233 — the
 * brief called it `R-0232`/`R-C10`; RULING 233 is the adopted number.)
 *
 * ============================================================================
 * RULING 233 IS NOT YET OPERATIVE, AND THIS SCRIPT MOVES NOTHING TODAY.
 * ============================================================================
 *
 * Staging-first begins the session AFTER Session C closes. Session C itself
 * ships through its one planned RULING 1 merge — verify locally, accumulate,
 * ship once at the real end — and changing the shipping route underneath a
 * session that is mid-flight would mean this session's own merge became the
 * first untested case of the mechanism meant to test merges. So:
 *
 *   - `--dry-run` IS THE DEFAULT. Running this with no flags evaluates and
 *     prints. It cannot move a ref.
 *   - `--execute` alone is NOT enough. It additionally requires
 *     `WTP_PROMOTION_ARMED=1` in the environment, which is not set anywhere in
 *     this repository, in CI, or in any workflow. Both are deliberate and the
 *     second exists so that a stray `--execute` in a script, a copied command
 *     line, or an agent's transcript cannot move `main`.
 *   - Even fully armed, it refuses unless `evaluatePromotion` returns eligible.
 *     The arming flags are a SAFETY, never a permission: nothing in this file
 *     lets a refused promotion through, and there is no skip flag.
 *
 * When RULING 233 becomes operative, the arming requirement is what gets
 * removed — by an author decision, in a later dated ruling that names this
 * file. Until that happens, an `--execute` run prints exactly why it did
 * nothing.
 *
 * ============================================================================
 * WHY `--execute` OPENS A PULL REQUEST AND DOES NOT FAST-FORWARD `main`.
 * ============================================================================
 *
 * MEASURED, not assumed: `main` is protected by a GitHub RULESET — id
 * 21572280, name `main`, enforcement active, targeting `~DEFAULT_BRANCH` — and
 * NOT by classic branch protection. `GET repos/.../branches/main/protection`
 * returns 404 "Branch not protected", and that 404 is a fact about which API
 * holds the rule, never an absence of protection. Reading it as an absence is
 * how a session concludes it may push.
 *
 * The ruleset's rules are `deletion`, `non_fast_forward`, `pull_request`, and
 * `required_status_checks` with `strict: true` over the three contexts in
 * `lib/ops/required-checks.ts`. So:
 *
 *   - **`git push origin staging:main` IS REFUSED by the `pull_request` rule.**
 *     A direct fast-forward is not an available mechanism from a session,
 *     however verified the head is. This script therefore proposes the merge —
 *     it opens (or identifies) a pull request from the staging branch to
 *     `main` and reports what must go green — and the platform merges it.
 *   - **The one bypass actor is a DeployKey in `exempt` mode**, and it exists
 *     for the scheduled data pushers. It is NOT used here and must never be:
 *     routing a code merge around the checks the ruleset requires would defeat
 *     the whole gate, and would do it by way of a credential granted for
 *     something else entirely.
 *   - `strict: true` means the head must be up to date with `main` before the
 *     checks count. That is a real-world counterpart to this gate's
 *     `NOT_FAST_FORWARD` refusal and is NOT a reason to drop it: a gate whose
 *     only refusal is the platform's has not been shown to work.
 *   - **No new required check is invented here.** A context the ruleset does
 *     not name is a gate nobody has to pass. If staging wants one registered,
 *     that is an author action on the ruleset, not a string added to a script.
 *
 * ## What it measures, and what it refuses to state
 *
 * Four measurements, all taken here because `lib/ops/staging-promotion.ts` is
 * pure and stays pure:
 *
 *   1. the staging branch head        `git rev-parse <staging ref>`
 *   2. `main`                         `git rev-parse <main ref>`
 *   3. whether main is an ancestor    `git merge-base --is-ancestor`
 *   4. the staging gate record        read from `data/ops/staging-gate.json`
 *
 * `--staging-ref=` and `--main-ref=` name WHICH REF to measure. They cannot
 * state what the answer is — there is no flag that supplies a sha, a green, a
 * deploy state or a database role, and there must never be one. The freeze
 * gate settled this shape already: `--base-url` picks what to ask, and nothing
 * anywhere states the reply.
 *
 * ## Exit codes
 *
 *   0  eligible (including a dry run that found it eligible)
 *   1  REFUSED — a real measurement says no
 *   2  COULD NOT TELL — a measurement failed, so nothing was established
 *
 * 1 and 2 are kept apart for the reason the whole ops vocabulary keeps them
 * apart: "the answer is no" and "there was no answer" are different facts, and
 * a gate that reports them identically teaches its reader to ignore both.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STAGING_RENDER_ORIGIN } from "../lib/ops/origins.ts";
// The required contexts are imported from the one place that transcribes them
// (RULING 103/156). A context this script invented would be a gate nobody has
// to pass, because the ruleset matches these as literal strings.
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";
import {
  STAGING_BRANCH,
  evaluatePromotion,
  explainPromotion,
  type AncestryVerdict,
  type GateRecordSource,
  type PromotionVerdict,
  type UnverifiedGateRecord,
} from "../lib/ops/staging-promotion.ts";
// One git reader (RULING 103). The integrity script's copy is the copy, and
// importing it here rather than writing a third one keeps "non-zero exit means
// null" defined in exactly one place.
import { git } from "./production-integrity.mts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Where the staging gate writes its record, and where this reads it. */
export const GATE_RECORD_PATH = join(ROOT, "data", "ops", "staging-gate.json");

/**
 * The append-only record of promotions that were ACTUALLY PROPOSED.
 *
 * Append-only and JSONL because a promotion is an event, not a state: the
 * question it answers later is "what did we propose, when, and on what
 * evidence", and a file that is rewritten each time cannot answer it. It
 * records the PROPOSAL, which is the last act that is ours — whether the pull
 * request then merges is the ruleset's answer and is recorded on GitHub.
 */
export const PROMOTION_LEDGER_PATH = join(ROOT, "data", "ops", "staging-promotions.jsonl");

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Read the gate record, keeping ABSENT and UNREADABLE apart.
 *
 * A missing file is a true statement about the repository — nothing has run
 * the staging gate. A file that will not parse is a FAILED READ. They lead to
 * different repairs and to different exit codes, so they are never collapsed
 * into one null.
 */
function readGateRecord(path: string): GateRecordSource {
  if (!existsSync(path)) {
    return { kind: "MISSING", how: `no file at ${path}` };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as UnverifiedGateRecord;
    if (parsed === null || typeof parsed !== "object") {
      return { kind: "UNREADABLE", how: `${path} parsed to something that is not an object` };
    }
    return { kind: "RECORD", record: parsed };
  } catch (error) {
    return { kind: "UNREADABLE", how: `${path} could not be parsed — ${(error as Error).message}` };
  }
}

/**
 * Is `main` an ancestor of the staging head?
 *
 * `--is-ancestor` answers with its EXIT CODE — 0 yes, 1 no, anything else "git
 * could not say" — so it cannot go through the returns-null-on-non-zero helper
 * without collapsing "no" into "unknown". `release-freeze-gate.mts` learned
 * this first; the shape is deliberately identical.
 */
function ancestryOf(mainSha: string | null, headSha: string | null): AncestryVerdict {
  if (mainSha === null || headSha === null) return "unknown";
  const r = spawnSync("git", ["merge-base", "--is-ancestor", mainSha, headSha], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.status === 0) return "ancestor";
  if (r.status === 1) return "not-ancestor";
  return "unknown";
}

/**
 * Resolve a ref to a sha, trying the remote-tracking name first.
 *
 * `origin/<branch>` before the local ref because the remote is the shared truth and
 * a local branch can be behind it without saying so. A caller-supplied ref is
 * used exactly as given — it is naming what to measure, and second-guessing it
 * would make the flag mean something other than what it says.
 */
function resolveRef(stated: string | undefined, candidates: readonly string[]): {
  sha: string | null;
  ref: string | null;
  how: string;
} {
  const tried = stated ? [stated] : candidates;
  for (const ref of tried) {
    const sha = git("rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
    if (sha) return { sha, ref, how: `git rev-parse ${ref}` };
  }
  return { sha: null, ref: null, how: `none of ${tried.join(", ")} resolved in this checkout` };
}

/**
 * PROPOSE the promotion: find the open pull request from the staging branch to
 * `main`, or open one, and report what must go green.
 *
 * IT DOES NOT MERGE, AND IT DOES NOT PUSH. The `pull_request` rule on the
 * ruleset means a direct `git push origin staging:main` is refused however
 * verified the head is, and the one bypass actor is a deploy key granted for
 * scheduled data pushes. Using it here would route a code merge around the
 * three checks the ruleset requires — the gate would refuse nothing, by
 * design, with a credential issued for something else.
 *
 * So the last mile is deliberately the platform's: this establishes that the
 * head deserves to be proposed, and the ruleset decides whether it merges.
 *
 * NEVER REACHED IN THIS SESSION. See the header: `--execute` requires
 * `WTP_PROMOTION_ARMED=1`, which is set nowhere in this repository.
 */
function proposePromotion(
  stagingRef: string,
  stagingSha: string,
): { ok: boolean; how: string; url: string | null } {
  const branch = stagingRef.replace(/^origin\//, "");
  // An existing pull request is IDENTIFIED, never duplicated: opening a second
  // one for the same head splits the review and the checks across two places.
  const existing = spawnSync(
    "gh",
    ["pr", "list", "--base", "main", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (existing.status === 0) {
    try {
      const rows = JSON.parse(existing.stdout || "[]") as { url?: string }[];
      if (rows.length > 0 && rows[0]?.url) {
        return {
          ok: true,
          how: `an open pull request from ${branch} to main already carries ${stagingSha.slice(0, 7)}`,
          url: rows[0].url as string,
        };
      }
    } catch {
      // A body that will not parse is a failed read, not "no pull request".
      return { ok: false, how: "`gh pr list` returned a body that could not be parsed", url: null };
    }
  } else {
    return { ok: false, how: `\`gh pr list\` failed — ${(existing.stderr ?? "").trim()}`, url: null };
  }

  const created = spawnSync(
    "gh",
    [
      "pr",
      "create",
      "--base",
      "main",
      "--head",
      branch,
      "--title",
      `Promote ${branch} ${stagingSha.slice(0, 7)} to main`,
      "--body",
      "Opened by `pnpm promote:staging --execute` after the staging gate record for this exact " +
        "head passed every arm against the staging database.\n\nThe ruleset on `main` is the " +
        "second, independent gate: these required contexts must be green on this head before it " +
        `merges — ${REQUIRED_CONTEXTS.join(", ")}.`,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  if (created.status !== 0) {
    return { ok: false, how: `\`gh pr create\` failed — ${(created.stderr ?? "").trim()}`, url: null };
  }
  return {
    ok: true,
    how: `opened a pull request from ${branch} (${stagingSha.slice(0, 7)}) to main`,
    url: created.stdout.trim() || null,
  };
}

/** Append one promotion event. Called ONLY after a proposal actually happened. */
function recordPromotion(entry: Record<string, unknown>): void {
  mkdirSync(dirname(PROMOTION_LEDGER_PATH), { recursive: true });
  appendFileSync(PROMOTION_LEDGER_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

function main(): void {
  const gatePath = arg("gate") ? resolve(process.cwd(), arg("gate") as string) : GATE_RECORD_PATH;
  const gate = readGateRecord(gatePath);

  // DERIVED from the host, never typed. See STAGING_BRANCH in
  // lib/ops/staging-promotion.ts for the four measurements behind it.
  const staging = resolveRef(arg("staging-ref"), [
    `origin/${STAGING_BRANCH}`,
    STAGING_BRANCH,
  ]);
  const mainRef = resolveRef(arg("main-ref"), ["origin/main", "main"]);
  const ancestry = ancestryOf(mainRef.sha, staging.sha);

  const verdict: PromotionVerdict = evaluatePromotion({
    gate,
    stagingHeadSha: staging.sha,
    mainSha: mainRef.sha,
    ancestry,
  });

  console.log("STAGING PROMOTION GATE (RULING 233, NOT YET OPERATIVE)");
  console.log(`  staging ref    ${staging.ref ?? "UNRESOLVED"}  (${staging.how})`);
  console.log(`  main ref       ${mainRef.ref ?? "UNRESOLVED"}  (${mainRef.how})`);
  console.log(`  ancestry       ${ancestry}  (git merge-base --is-ancestor main staging-head)`);
  console.log(
    `  gate record    ${gate.kind}` +
      (gate.kind === "RECORD"
        ? `  (${gatePath})`
        : `  (${gate.how})`),
  );
  if (gate.kind === "RECORD") {
    const r = gate.record;
    console.log(`                 formatVersion ${String(r.formatVersion)}, observed ${r.observedAt ?? "never"}`);
    console.log(`                 about ${r.stagingSha ?? "no commit"}, host served ${r.deployedSha ?? "no commit"}`);
    console.log(
      `                 suite ${r.suite} | visual ${r.visual} | walk ${r.walk} | required checks ` +
        `${r.requiredChecks} | db ${r.databaseRole} | freeze ${
          r.freezeClear === null ? "UNESTABLISHED" : r.freezeClear ? "CLEAR" : "FROZEN"
        }`,
    );
    console.log(`                 ${r.detail}`);
  }
  console.log(`  staging host   ${STAGING_RENDER_ORIGIN}`);
  console.log("");
  console.log(explainPromotion(verdict));

  /*
   * COULD NOT TELL IS A THIRD ANSWER, and it is derived from the measurements
   * THIS script failed to take — never from the refusal list, which is a list
   * of conclusions. An unresolvable ref, an unknown ancestry or an unparseable
   * record all mean nothing was established; a red suite means something was.
   */
  const couldNotTell =
    staging.sha === null || mainRef.sha === null || ancestry === "unknown" || gate.kind === "UNREADABLE";

  const armed = process.env.WTP_PROMOTION_ARMED === "1";
  const wantsExecute = flag("execute");

  if (!wantsExecute) {
    console.log("");
    console.log("DRY RUN — the default. Nothing was proposed, and nothing can be without both");
    console.log("`--execute` and WTP_PROMOTION_ARMED=1. RULING 233 is not yet operative:");
    console.log("staging-first begins the session AFTER Session C closes, and Session C ships");
    console.log("through its one planned RULING 1 merge. Even armed, this opens a pull request —");
    console.log("the ruleset on `main` requires one, and the deploy-key bypass is never used here.");
    process.exitCode = verdict.eligible ? 0 : couldNotTell ? 2 : 1;
    return;
  }

  if (!verdict.eligible) {
    console.log("");
    console.log("--execute REFUSED: the promotion is not eligible. The arming flags are a safety,");
    console.log("never a permission — nothing here promotes a refused head, and there is no skip flag.");
    process.exitCode = couldNotTell ? 2 : 1;
    return;
  }

  if (!armed) {
    console.log("");
    console.log("--execute WITHHELD: WTP_PROMOTION_ARMED is not 1, so no pull request was opened.");
    console.log("This is not a misconfiguration. RULING 233 is not yet operative; the arming");
    console.log("requirement is what a later dated ruling removes, and until then a stray --execute");
    console.log("cannot propose a merge.");
    // Eligible is eligible — the evaluation succeeded and said yes. Withholding
    // the MOVE is not a refusal of the VERDICT, and reporting it as one would
    // make an unarmed dry-run-equivalent indistinguishable from a red gate.
    process.exitCode = 0;
    return;
  }

  const proposed = proposePromotion(staging.ref as string, verdict.stagingSha as string);
  console.log("");
  console.log(proposed.ok ? `PROPOSED — ${proposed.how}` : `PROPOSAL FAILED — ${proposed.how}`);
  if (proposed.ok) {
    console.log(`  ${proposed.url ?? "no url was returned"}`);
    console.log(`  the ruleset still requires: ${REQUIRED_CONTEXTS.join(", ")}`);
    recordPromotion({
      promotedSha: verdict.stagingSha,
      previousMainSha: verdict.mainSha,
      stagingRef: staging.ref,
      mainRef: mainRef.ref,
      pullRequestUrl: proposed.url,
      gateRecordPath: gatePath,
      gateRecord: gate.kind === "RECORD" ? gate.record : null,
      // The clock is read HERE, at the moment of the event, and nowhere in the
      // pure evaluator. An event's time is a measurement of the event.
      proposedAt: new Date().toISOString(),
      how: proposed.how,
    });
    console.log(`recorded: ${PROMOTION_LEDGER_PATH}`);
  }
  process.exitCode = proposed.ok ? 0 : 1;
}

/*
 * `process.exitCode` AND A NATURAL EXIT, NEVER `process.exit()`.
 * `release-freeze-gate.mts` measured what the alternative costs on Windows: an
 * abort with an open handle DESTROYS the exit code, and both of that gate's
 * verdicts came back as 127 — an instrument whose refusal and its permission
 * are indistinguishable.
 */
main();
