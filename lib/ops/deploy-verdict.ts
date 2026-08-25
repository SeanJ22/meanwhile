/**
 * **DID THE DEPLOY FOR THIS COMMIT SUCCEED?** — `NJ25`, closed 2026-08-25.
 *
 * ## The gap, and why the existing check could not close it
 *
 * `NJ25`: a session's deploy errored and nothing in the close-out path noticed.
 * `pnpm deploy:live` looks for the newest deploy whose state is `ready` and
 * compares its commit to the last deploy-eligible one. When the deploy for the
 * shipped commit has ERRORED there is no ready deploy carrying it, so the newest
 * ready deploy is an older commit and the verdict reads **BEHIND by 1**.
 *
 * That is not wrong and it is not the sentence a reader needs. *Behind by one*
 * is what a deploy still building looks like — so the one state that demands
 * action reads exactly like the one state that demands patience, and a session
 * that waits is doing the right thing for a build and the wrong thing for a
 * failure.
 *
 * RULING 113: observe the step's product AT THE STEP. The product of a ship is a
 * DEPLOY, and the question is whether the deploy carrying this commit reached
 * `ready`.
 *
 * ## A CANCEL IS NOT A FAILURE — RULING 115
 *
 * RULING 124 made the deploy filter cancel the build for a commit that cannot
 * change what a reader sees. **Netlify records a cancel with state `error`**, so
 * every paperwork commit the filter is SUPPOSED to stop looks identical to a
 * build that broke. Measured 2026-08-25: `2f86b57`, a `context.md` rewrite,
 * carries `state: "error"` and *Canceled build due to no content change*.
 *
 * An alarm that cannot tell an exercise from an event will cry wolf, and the
 * cost is never the false alarm — it is the real one nobody reads. Netlify's own
 * message is the honest discriminator.
 *
 * ## Why this is a pure function and not four lines inside the script
 *
 * There was no failed deploy in the last forty to prove the FAILED verdict
 * against, so the only way to show the instrument catching the thing it was
 * written for (RULING 110) is to plant one. A decision reachable only through a
 * live API call is a decision nothing can test, which is the shape RULING 130
 * names: a production path nothing could observe.
 */

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
  /** The filter stopped it before it built. RULING 124 working, not a failure. */
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

/**
 * Netlify's wording for a build its own ignore command stopped.
 *
 * A SHAPE rather than a string (RULING 110) — the wording carries a stage name
 * that varies, and the two halves that do not are *canceled build* and *no
 * content change*.
 */
const FILTER_CANCEL = /cancel(?:l)?ed build|no content change/i;

/**
 * Prefix-tolerant, because a caller passes what git gave it.
 *
 * Netlify records the full 40-character ref; a session naming its shipped SHA
 * has whatever `git log --format=%h` printed. An equality test would answer
 * PENDING forever for a deploy that shipped — the failure this exists to
 * prevent, arriving from the other side.
 */
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
  /*
   * A commit can have several deploys — a retry after a failure is ordinary.
   * `ready` ANYWHERE in that set means it eventually shipped, and that is the
   * honest answer: the question is whether production serves this commit, not
   * whether every attempt at it succeeded.
   */
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
