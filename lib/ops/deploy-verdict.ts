/** Did the deploy for this commit succeed? A filter cancel is not a failure, and an unanswerable question is never a pass. */

/** The fields of a Netlify deploy record this decision reads. */
export interface DeployRecord {
  id: string;
  state: string;
  context: string;
  commit_ref?: string | null;
  error_message?: string | null;
}

export type DeployVerdictKind =
  /** A deploy carrying this commit reached `ready`. */
  | "SUCCESS"
  /** A deploy carrying this commit is in `error` and was not a filter cancel. */
  | "FAILED"
  /** The deploy filter stopped it before it built; not a failure. */
  | "CANCELLED-BY-FILTER"
  /** It exists and is still building, or has not appeared yet. */
  | "PENDING"
  /** Nothing could be asked. NEVER a pass. */
  | "CANNOT-TELL";

export interface DeployVerdict {
  kind: DeployVerdictKind;
  why: string;
  deploy?: DeployRecord;
}

/** Exit codes, kept beside the verdicts so the two cannot drift. */
export const DEPLOY_EXIT: Record<DeployVerdictKind, number> = {
  SUCCESS: 0,
  "CANCELLED-BY-FILTER": 0,
  FAILED: 1,
  PENDING: 2,
  "CANNOT-TELL": 3,
};

/** Netlify's wording for a build its ignore command stopped, matched as a shape since the stage name varies. */
const FILTER_CANCEL = /cancel(?:l)?ed build|no content change/i;

/** Prefix-tolerant: a caller may pass an abbreviated SHA. */
function refMatches(ref: string | null | undefined, sha: string): boolean {
  if (typeof ref !== "string" || ref.length === 0 || sha.length === 0) return false;
  return ref === sha || ref.startsWith(sha) || sha.startsWith(ref);
}

export function verdictForDeploys(deploys: readonly DeployRecord[], sha: string): DeployVerdict {
  const mine = deploys.filter((d) => refMatches(d.commit_ref, sha) && d.context === "production");
  if (mine.length === 0) {
    return {
      kind: "PENDING",
      why: `no production deploy carrying ${sha.slice(0, 7)} has appeared in the last ${deploys.length} deploy(s)`,
    };
  }
  // A commit can have several deploys; `ready` anywhere in the set means it shipped.
  const ready = mine.find((d) => d.state === "ready");
  if (ready) return { kind: "SUCCESS", why: `deploy ${ready.id} is ready`, deploy: ready };

  const errored = mine.find((d) => d.state === "error");
  if (errored) {
    const msg = String(errored.error_message ?? "");
    if (FILTER_CANCEL.test(msg)) {
      return {
        kind: "CANCELLED-BY-FILTER",
        why:
          `deploy ${errored.id} was cancelled before it built — "${msg}". That is RULING 124's deploy ` +
          "filter doing its job on a commit that cannot change what a reader sees, and it is not a failure.",
        deploy: errored,
      };
    }
    return {
      kind: "FAILED",
      why: `deploy ${errored.id} is in state 'error' — ${msg || "no message recorded"}`,
      deploy: errored,
    };
  }
  const building = mine[0];
  return {
    kind: "PENDING",
    why: `deploy ${building.id} is in state '${building.state}'`,
    deploy: building,
  };
}
