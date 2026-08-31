/**
 * **WHO RAN THIS, AND WAS THE WORK ALREADY IN.** (Session B WI1.8, 2026-08-30.)
 *
 * ## The hole this closes
 *
 * `status-result.ts` labelled EVERY successful canonical gate, suite or walk
 * result `INDEPENDENTLY_REPRODUCED`. It reached that label honestly from what
 * it could see — the record named a canonical command, a committed SHA and a
 * PASS — but what it could see did not include the one thing the class is
 * about. RULING 216 defines INDEPENDENTLY_REPRODUCED as reproduction
 *
 * > by a canonical suite/audit execution SEPARATE FROM the implementation's
 * > one-off proving observation, against a committed integration head or later
 * > head.
 *
 * The implementing session running `pnpm gates` on its own unmerged branch tip
 * satisfies "canonical command" and "committed SHA" and is precisely the
 * observation the ruling excludes. So the strongest proof class in the
 * repository was being awarded to the weakest evidence for it, and a status
 * ledger that says INDEPENDENTLY_REPRODUCED where it means "I just ran it" is
 * a ledger that has stopped distinguishing the two.
 *
 * ## What is recorded, and why each field is derivable rather than typed
 *
 * ```
 *   workingTreeClean   nothing uncommitted was measured
 *   integratedAtRunTime  the tested SHA was ALREADY in the integration branch
 *                        when the run started — so the run is not the change
 *                        proving itself
 *   runClass           who invoked it: this session, CI, or the scheduler
 * ```
 *
 * All three come from the environment at run time, not from a model's opinion
 * about its own independence. `runClass` reads the CI environment and an
 * explicit `WTP_RUN_CLASS`, and falls back to `LOCAL_SESSION` — the class that
 * cannot earn the stronger label. A missing provenance block is read the same
 * way. **The absent case is the weak case, always.**
 *
 * ## What this deliberately does NOT do
 *
 * It does not try to identify WHICH session ran. There is no durable session
 * identity to compare against, and inventing one would be a field a model
 * fills in about itself — the exact shape RULING 216 retired. Integration is
 * used as the proxy because it is a fact about the repository: work that is
 * already merged is work a later run did not author.
 */

import { execFileSync } from "node:child_process";

/** Who invoked the run. `LOCAL_SESSION` can never earn the stronger class. */
export const RUN_CLASSES = ["LOCAL_SESSION", "CI", "SCHEDULED"] as const;
export type RunClass = (typeof RUN_CLASSES)[number];

export interface RunProvenance {
  readonly runClass: RunClass;
  /** Was every tracked file committed when the run started? */
  readonly workingTreeClean: boolean;
  /**
   * Was the tested SHA already contained by the integration branch at run
   * time? Null when there is no integration ref to compare against — unknown,
   * and unknown never earns the stronger class.
   */
  readonly integratedAtRunTime: boolean | null;
  /** The ref the integration question was asked against, for the record. */
  readonly integrationRef: string | null;
}

/** The CI environment, read rather than asserted. */
function detectRunClass(env: NodeJS.ProcessEnv): RunClass {
  const declared = (env.WTP_RUN_CLASS ?? "").trim().toUpperCase();
  if ((RUN_CLASSES as readonly string[]).includes(declared)) return declared as RunClass;
  if (env.GITHUB_ACTIONS === "true" || env.CI === "true") return "CI";
  return "LOCAL_SESSION";
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  } catch {
    return null;
  }
}

/**
 * Read the provenance of the run happening now.
 *
 * Every unanswerable question resolves to the value that WEAKENS the claim:
 * an unreadable status is a dirty tree, an unresolvable integration ref is
 * `null`. A provenance reader that guesses optimistically would hand out the
 * activation-gating proof class on a failed git call.
 */
export function readRunProvenance(
  testedSha: string | null,
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): RunProvenance {
  const status = git(["status", "--porcelain"], cwd);
  const workingTreeClean = status !== null && status.length === 0;

  let integrationRef: string | null = null;
  let integratedAtRunTime: boolean | null = null;
  if (testedSha !== null) {
    for (const ref of ["origin/main", "main"]) {
      if (git(["rev-parse", "--verify", "--quiet", ref], cwd) === null) continue;
      integrationRef = ref;
      integratedAtRunTime =
        git(["merge-base", "--is-ancestor", testedSha, ref], cwd) !== null ? true : false;
      break;
    }
  }
  return {
    runClass: detectRunClass(env),
    workingTreeClean,
    integratedAtRunTime,
    integrationRef,
  };
}

/** The two proof classes, one vocabulary, so nothing re-derives the strings. */
export type ProofClass = "SESSION_MEASURED" | "INDEPENDENTLY_REPRODUCED";

/**
 * Derive the proof class of a PASSING run from its recorded provenance.
 *
 * Three clauses, all required, and the reason each is required is that
 * dropping it readmits exactly the case A.1 mislabelled:
 *
 * - **clean tree** — an uncommitted tree is not reproducible by anyone.
 * - **integrated at run time** — the run did not author the code it measured.
 * - **not `LOCAL_SESSION`** — a run this session invoked is this session's own
 *   observation, however green, and however canonical the command was.
 *
 * A record with no provenance block is `SESSION_MEASURED`. That covers every
 * record written before this module existed, and it is the right reading of
 * them: nothing in those records says the run was independent, so nothing in
 * this function may say it either.
 */
export function proofClassOf(provenance: RunProvenance | null | undefined): ProofClass {
  if (!provenance) return "SESSION_MEASURED";
  if (!provenance.workingTreeClean) return "SESSION_MEASURED";
  if (provenance.integratedAtRunTime !== true) return "SESSION_MEASURED";
  if (provenance.runClass === "LOCAL_SESSION") return "SESSION_MEASURED";
  return "INDEPENDENTLY_REPRODUCED";
}

/** One sentence naming why the class is what it is. Quoted, never asserted. */
export function proofClassReason(provenance: RunProvenance | null | undefined): string {
  if (!provenance) {
    return "the run record carries no provenance block, so nothing in it establishes that the " +
      "run was separate from the implementing session's own observation";
  }
  const missing: string[] = [];
  if (!provenance.workingTreeClean) missing.push("the working tree was not clean");
  if (provenance.integratedAtRunTime === null) {
    missing.push("no integration ref was resolvable, so integration could not be established");
  } else if (!provenance.integratedAtRunTime) {
    missing.push("the tested SHA was not yet in " + (provenance.integrationRef ?? "the integration branch"));
  }
  if (provenance.runClass === "LOCAL_SESSION") {
    missing.push("the run was invoked by a local session, which is its own observation");
  }
  return missing.length === 0
    ? `a clean tree already contained by ${provenance.integrationRef}, run as ${provenance.runClass}`
    : missing.join("; ");
}
