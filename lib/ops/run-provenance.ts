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
