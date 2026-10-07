/** Who ran this, and was the work already in: the provenance that decides a passing run's proof class. */

import { execFileSync } from "node:child_process";

/** Who invoked the run. `LOCAL_SESSION` can never earn the stronger class. */
export const RUN_CLASSES = ["LOCAL_SESSION", "CI", "SCHEDULED"] as const;
export type RunClass = (typeof RUN_CLASSES)[number];

export interface RunProvenance {
  readonly runClass: RunClass;
  /** Was every tracked file committed when the run started? */
  readonly workingTreeClean: boolean;
  /** Whether the tested SHA was already in the integration branch at run time; null (unknown) never earns the stronger class. */
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

/** Read the provenance of the current run; every unanswerable question resolves to the value that weakens the claim. */
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
 * The proof class of a passing run: `INDEPENDENTLY_REPRODUCED` only with a clean tree, integrated at run time, and not
 * `LOCAL_SESSION`. A record with no provenance is `SESSION_MEASURED`.
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
