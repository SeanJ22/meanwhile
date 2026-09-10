/**
 * **WHICH CODE IS THE RUNNER ACTUALLY RUNNING — THREE SHAS, NOT ONE.**
 * (Fleet Promotion Readiness, PRDY-1, 2026-09-06.)
 *
 * ## The defect this answers (ACT-1)
 *
 * The Fleet Promotion Activation Audit compared the runner heartbeat's
 * `testedSha` with the raw tip of `main` and read the runner as STALE. The tip
 * was `54d4d946`, a then-Git-backed post-deploy integrity reading that changed
 * `data/ops/production-integrity.json` and `docs/status-ledger.md` and nothing
 * else; the runner had tested `972d1a60`, its parent, which was the newest
 * commit whose tree changes anything the runner executes. The runner was
 * current. The EVIDENCE MODEL was wrong: one SHA cannot say both "what main
 * points at" and "what code is current" when a non-shipping commit follows an
 * application-bearing one. The observer Git writer that exposed this defect is
 * now retired; the distinction remains valid for human-authored non-shipping
 * evidence commits.
 *
 * ## Three identities, one classification
 *
 * ```
 *   rawMainSha               what the integration ref pointed at when this was read
 *   effectiveExecutableSha   the newest first-parent commit on main whose landing
 *                            changed a path the canonical deploy classification
 *                            calls production-bearing — SHIPPING or UNKNOWN,
 *                            never a positively proven NON_SHIPPING commit
 *   runnerTestedSha          what the runner's own process reports it executed
 * ```
 *
 * The classification is `classifyDeploy` from `lib/ops/deploy-paths.ts` — the
 * existing answer to "can these changed paths affect what production serves".
 * CI has no path-cost exception. There is no second path table here: a
 * docs/evidence commit is one the deploy rule
 * already cancels, and a
 * commit that rule cannot classify (a merge with no first-parent diff, a root
 * commit, an unreadable diff) counts as EXECUTABLE. Unknown never weakens the
 * stale reading; it can only make the runner look behind, never current.
 *
 * ## The verdict, and the direction of every unanswerable question
 *
 * ```
 *   CONSISTENT                 the runner tested the executable head, or a
 *                              commit above it on main that differs from it only
 *                              by non-shipping commits
 *   RUNNER_BEHIND_EXECUTABLE   executable code landed on main after the SHA the
 *                              runner tested — the REAL stale case, undiminished
 *   RUNNER_AHEAD_OF_MAIN       the runner tested a commit that contains raw main
 *                              but is not raw main — our view of main is behind
 *                              the runner, not the other way round
 *   RUNNER_NOT_ON_MAIN         no ancestry either way — a branch or a worktree
 *   CANNOT_TELL                a SHA is missing, git could not answer, or the
 *                              walk hit its bound without finding an executable
 *                              commit
 * ```
 *
 * `CANNOT_TELL` is never rendered as current. A future audit reads the record
 * this module writes into the heartbeat and can re-derive every field from the
 * repository alone (`pnpm code-identity:readback`).
 *
 * PURE where it can be: `deriveEffectiveExecutable` and `judgeCodeIdentity`
 * take commits and an ancestry oracle; only `readCodeIdentity` talks to git.
 */
import { execFileSync } from "node:child_process";

import { classifyDeploy } from "../ops/deploy-paths.ts";

export const CODE_IDENTITY_FORMAT_VERSION = 1;

/** How far down main's first-parent line the walk may go before refusing. */
export const CODE_IDENTITY_WALK_BOUND = 64;

/** The bound on the remote fetch that refreshes the integration ref. */
export const CODE_IDENTITY_FETCH_TIMEOUT_MS = 20_000;

export const CODE_IDENTITY_VERDICTS = [
  "CONSISTENT",
  "RUNNER_BEHIND_EXECUTABLE",
  "RUNNER_AHEAD_OF_MAIN",
  "RUNNER_NOT_ON_MAIN",
  "CANNOT_TELL",
] as const;
export type CodeIdentityVerdict = (typeof CODE_IDENTITY_VERDICTS)[number];
export type DeployCommitClass = "NON_SHIPPING" | "SHIPPING" | "UNKNOWN";

/** One commit on main's first-parent line, with the canonical classification it received. */
export interface ClassifiedCommit {
  readonly sha: string;
  readonly klass: DeployCommitClass;
  /** The classification's own sentence, quoted rather than paraphrased. */
  readonly reason: string;
  /** How many paths the commit changed against its first parent; null when the diff could not be read. */
  readonly changedPathCount: number | null;
}

/** A commit as the walk sees it: its SHA and its first-parent changed paths (null = unreadable). */
export interface WalkedCommit {
  readonly sha: string;
  readonly changed: readonly string[] | null;
}

export interface EffectiveExecutable {
  readonly effectiveExecutableSha: string | null;
  /** The positively non-shipping commits between the executable head and raw main, newest first. */
  readonly nonShippingAbove: readonly ClassifiedCommit[];
  /** The commit that stopped the walk, when one did. */
  readonly executable: ClassifiedCommit | null;
  readonly walkExhausted: boolean;
}

export interface CodeIdentity {
  readonly formatVersion: number;
  readonly readAt: string;
  readonly rawMainSha: string | null;
  /** Which ref answered for main: `origin/main`, `main`, or null when neither resolved. */
  readonly rawMainRef: string | null;
  /** Whether the remote was fetched before the ref was read; false means the remote-tracking ref as last seen. */
  readonly rawMainFetched: boolean;
  readonly effectiveExecutableSha: string | null;
  readonly nonShippingAbove: readonly ClassifiedCommit[];
  readonly executable: ClassifiedCommit | null;
  readonly runnerTestedSha: string | null;
  readonly verdict: CodeIdentityVerdict;
  /** One plain sentence with the facts, quoted by the admin page and the readback. */
  readonly detail: string;
  readonly walkBound: number;
  readonly walkExhausted: boolean;
}

/**
 * Walk main's first-parent line from the raw tip downward and stop at the first
 * commit the canonical rule does not positively call NON_SHIPPING.
 *
 * `commits` is newest first, starting at raw main. A commit whose changed-path
 * list is null or empty is UNKNOWN under `classifyDeploy` and therefore
 * EXECUTABLE here — the same fail-closed direction the deploy rule takes.
 */
export function deriveEffectiveExecutable(
  commits: readonly WalkedCommit[],
  bound: number = CODE_IDENTITY_WALK_BOUND,
): EffectiveExecutable {
  const nonShippingAbove: ClassifiedCommit[] = [];
  let inspected = 0;
  for (const commit of commits) {
    if (inspected >= bound) break;
    inspected += 1;
    const deploy = classifyDeploy(commit.changed);
    const klass: DeployCommitClass =
      deploy.verdict === "cancel"
        ? "NON_SHIPPING"
        : deploy.verdict === "build"
          ? "SHIPPING"
          : "UNKNOWN";
    const classified: ClassifiedCommit = {
      sha: commit.sha,
      klass,
      reason: deploy.reason,
      changedPathCount: commit.changed === null ? null : commit.changed.length,
    };
    if (klass === "NON_SHIPPING") {
      nonShippingAbove.push(classified);
      continue;
    }
    return { effectiveExecutableSha: commit.sha, nonShippingAbove, executable: classified, walkExhausted: false };
  }
  return { effectiveExecutableSha: null, nonShippingAbove, executable: null, walkExhausted: true };
}

/** Does `descendant` contain `ancestor`? `null` when the question could not be answered. */
export type AncestryOracle = (ancestor: string, descendant: string) => boolean | null;

/** The pure consistency judgement over the three SHAs and an ancestry oracle. */
export function judgeCodeIdentity(input: {
  readonly rawMainSha: string | null;
  readonly effectiveExecutableSha: string | null;
  readonly runnerTestedSha: string | null;
  readonly walkExhausted: boolean;
  readonly contains: AncestryOracle;
}): { verdict: CodeIdentityVerdict; detail: string } {
  const { rawMainSha, effectiveExecutableSha, runnerTestedSha } = input;
  const short = (sha: string | null): string => (sha === null ? "unrecorded" : sha.slice(0, 8));
  if (rawMainSha === null) {
    return { verdict: "CANNOT_TELL", detail: "No integration ref for main resolved, so raw main is unknown and consistency cannot be judged." };
  }
  if (runnerTestedSha === null) {
    return { verdict: "CANNOT_TELL", detail: `The runner recorded no tested SHA; raw main is ${short(rawMainSha)}.` };
  }
  if (effectiveExecutableSha === null) {
    return {
      verdict: "CANNOT_TELL",
      detail: input.walkExhausted
        ? `The walk down from raw main ${short(rawMainSha)} found only non-shipping commits within its bound, so the executable head is unknown.`
        : `The executable head below raw main ${short(rawMainSha)} could not be derived.`,
    };
  }
  if (runnerTestedSha === effectiveExecutableSha) {
    return {
      verdict: "CONSISTENT",
      detail: rawMainSha === effectiveExecutableSha
        ? `The runner tested ${short(runnerTestedSha)}, which is both raw main and the executable head.`
        : `The runner tested ${short(runnerTestedSha)}, the executable head; raw main ${short(rawMainSha)} is above it by non-shipping commits only.`,
    };
  }
  const executableInRunner = input.contains(effectiveExecutableSha, runnerTestedSha);
  const runnerInMain = input.contains(runnerTestedSha, rawMainSha);
  if (executableInRunner === null || runnerInMain === null) {
    return { verdict: "CANNOT_TELL", detail: `Git could not answer whether ${short(runnerTestedSha)} contains ${short(effectiveExecutableSha)} or is contained by raw main ${short(rawMainSha)}.` };
  }
  if (executableInRunner && runnerInMain) {
    return {
      verdict: "CONSISTENT",
      detail: `The runner tested ${short(runnerTestedSha)}, which contains the executable head ${short(effectiveExecutableSha)} and sits on main at or below ${short(rawMainSha)}; the difference is non-shipping commits only.`,
    };
  }
  const runnerInExecutable = input.contains(runnerTestedSha, effectiveExecutableSha);
  if (runnerInExecutable === null) {
    return { verdict: "CANNOT_TELL", detail: `Git could not answer whether the executable head ${short(effectiveExecutableSha)} contains ${short(runnerTestedSha)}.` };
  }
  if (runnerInExecutable) {
    return {
      verdict: "RUNNER_BEHIND_EXECUTABLE",
      detail: `Executable code landed on main after the runner's ${short(runnerTestedSha)}: the executable head is ${short(effectiveExecutableSha)} (raw main ${short(rawMainSha)}). The runner is running stale code.`,
    };
  }
  const mainInRunner = input.contains(rawMainSha, runnerTestedSha);
  if (mainInRunner === null) {
    return { verdict: "CANNOT_TELL", detail: `Git could not answer whether ${short(runnerTestedSha)} contains raw main ${short(rawMainSha)}.` };
  }
  if (mainInRunner) {
    return {
      verdict: "RUNNER_AHEAD_OF_MAIN",
      detail: `The runner tested ${short(runnerTestedSha)}, which contains raw main ${short(rawMainSha)} but is not it: this reading of main is behind the runner, or the runner is on unmerged work.`,
    };
  }
  return {
    verdict: "RUNNER_NOT_ON_MAIN",
    detail: `The runner tested ${short(runnerTestedSha)}, which is neither above nor below raw main ${short(rawMainSha)}; it is on a branch or a worktree.`,
  };
}

/* ------------------------------------------------------------------ git --- */

interface GitAnswer { readonly ok: boolean; readonly out: string; readonly status: number | null }

function gitAnswer(args: readonly string[], cwd: string, timeoutMs?: number): GitAnswer {
  try {
    const out = execFileSync("git", [...args], {
      cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"],
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    });
    return { ok: true, out: out.trim(), status: 0 };
  } catch (error) {
    const status = error !== null && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : null;
    return { ok: false, out: "", status };
  }
}

/** `git merge-base --is-ancestor` distinguishes "no" (exit 1) from "could not answer" (anything else). */
export function gitAncestry(cwd: string): AncestryOracle {
  return (ancestor, descendant) => {
    if (ancestor === descendant) return true;
    const answer = gitAnswer(["merge-base", "--is-ancestor", ancestor, descendant], cwd);
    if (answer.ok) return true;
    return answer.status === 1 ? false : null;
  };
}

/** The first-parent changed paths of one commit; null when the diff could not be read (a root commit reads that way). */
export function firstParentChangedPaths(sha: string, cwd: string): readonly string[] | null {
  const parents = gitAnswer(["rev-list", "--parents", "-n", "1", sha], cwd);
  if (!parents.ok) return null;
  const [, firstParent] = parents.out.split(/\s+/);
  if (!firstParent) return null;
  const diff = gitAnswer(["diff", "--name-only", firstParent, sha], cwd);
  if (!diff.ok) return null;
  return diff.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Main's first-parent line from `tip`, newest first, at most `bound` commits. */
export function walkFirstParent(tip: string, cwd: string, bound: number = CODE_IDENTITY_WALK_BOUND): readonly WalkedCommit[] {
  const list = gitAnswer(["rev-list", "--first-parent", `--max-count=${bound}`, tip], cwd);
  if (!list.ok) return [];
  return list.out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((sha) => ({ sha, changed: firstParentChangedPaths(sha, cwd) }));
}

/**
 * Read the three identities from a checkout.
 *
 * `origin/main` is refreshed with a bounded fetch when `fetch` is true; a fetch
 * that fails or times out leaves the remote-tracking ref as last seen and the
 * record says so (`rawMainFetched: false`). A checkout without an `origin`
 * answers from its local `main`.
 */
export function readCodeIdentity(input: {
  readonly cwd: string;
  readonly runnerTestedSha: string | null;
  readonly now: string;
  readonly fetch?: boolean;
  readonly bound?: number;
}): CodeIdentity {
  const bound = input.bound ?? CODE_IDENTITY_WALK_BOUND;
  const cwd = input.cwd;
  let rawMainFetched = false;
  if (input.fetch) {
    rawMainFetched = gitAnswer(["fetch", "--quiet", "origin", "main"], cwd, CODE_IDENTITY_FETCH_TIMEOUT_MS).ok;
  }
  let rawMainSha: string | null = null;
  let rawMainRef: string | null = null;
  for (const ref of ["origin/main", "main"]) {
    const answer = gitAnswer(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], cwd);
    if (!answer.ok || !answer.out) continue;
    rawMainSha = answer.out;
    rawMainRef = ref;
    break;
  }
  const walk = rawMainSha === null ? [] : walkFirstParent(rawMainSha, cwd, bound);
  const derived: EffectiveExecutable = rawMainSha === null
    ? { effectiveExecutableSha: null, nonShippingAbove: [], executable: null, walkExhausted: false }
    : deriveEffectiveExecutable(walk, bound);
  const judged = judgeCodeIdentity({
    rawMainSha,
    effectiveExecutableSha: derived.effectiveExecutableSha,
    runnerTestedSha: input.runnerTestedSha,
    walkExhausted: derived.walkExhausted,
    contains: gitAncestry(cwd),
  });
  return {
    formatVersion: CODE_IDENTITY_FORMAT_VERSION,
    readAt: input.now,
    rawMainSha,
    rawMainRef,
    rawMainFetched: rawMainRef === "origin/main" ? rawMainFetched : false,
    effectiveExecutableSha: derived.effectiveExecutableSha,
    nonShippingAbove: derived.nonShippingAbove,
    executable: derived.executable,
    runnerTestedSha: input.runnerTestedSha,
    verdict: judged.verdict,
    detail: judged.detail,
    walkBound: bound,
    walkExhausted: derived.walkExhausted,
  };
}

/** Whether a stored record is a code identity this module can read. */
export function isCodeIdentity(value: unknown): value is CodeIdentity {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.formatVersion === CODE_IDENTITY_FORMAT_VERSION &&
    typeof record.readAt === "string" &&
    (CODE_IDENTITY_VERDICTS as readonly string[]).includes(String(record.verdict)) &&
    typeof record.detail === "string" &&
    Array.isArray(record.nonShippingAbove);
}

/** The owner's one line: the three SHAs and the verdict, in the order an audit reads them. */
export function codeIdentityLine(identity: CodeIdentity): string {
  const short = (sha: string | null): string => (sha === null ? "unrecorded" : sha.slice(0, 8));
  const aboveCount = identity.nonShippingAbove.length;
  const above = aboveCount === 0 ? "" : ` (${aboveCount} non-shipping commit${aboveCount === 1 ? "" : "s"} above the executable head)`;
  const via = identity.rawMainRef ? ` via ${identity.rawMainRef}${identity.rawMainFetched ? ", fetched" : ", as last seen"}` : "";
  return `raw main ${short(identity.rawMainSha)}${via}; executable head ${short(identity.effectiveExecutableSha)}${above}; runner tested ${short(identity.runnerTestedSha)}; ${identity.verdict}`;
}
