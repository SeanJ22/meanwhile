/**
 * **THE ONE PLACE A DELEGATED JOB ACTUALLY STARTS A PROGRAM.** (ACLOSE-1.)
 *
 * `host.ts` is the probe's machine — it asks whether a launcher exists and what
 * version it prints. This is the run's machine, and it is deliberately a second
 * file: a probe may run on any host that can see a PATH, and a RUN may only
 * happen on the standing runner. Keeping them apart means the module that can
 * start a fifteen-minute subscription job is one import nothing on the web side
 * has any reason to reach for.
 *
 * ## The PATH problem this exists to solve, and how it is solved
 *
 * ADM-C8 measured both subscription homes present and signed in, and BOTH
 * launchers unresolvable from the standing runner: the Scheduled Task starts
 * `node.exe` with the machine's service PATH, and neither Codex nor Claude Code
 * installs itself onto it. Codex ships its binary inside its own home
 * (`~/.codex/.sandbox-bin`), and Claude Code ships one per version under the
 * desktop app's data directory (`%APPDATA%/Claude/claude-code/<version>`).
 *
 * The fix is the narrowest of the two the brief allows: **a closed, declared set
 * of trusted user-local directories, added to the CHILD's PATH only.** Not the
 * machine's PATH, not the runner's own process PATH, and above all not a path
 * from configuration — `TRUSTED_LAUNCHER_ROOTS` is a frozen literal keyed by the
 * same closed provider union as everything else. There is no parameter here, and
 * no row in the control plane, through which an executable path could be
 * supplied. An Admin field that named a directory would be a remote shell with
 * an extra step.
 *
 * **That table lives in `host.ts`, not here, and is re-exported below.** The
 * probe and the run must resolve a launcher the same way: a probe that looked at
 * a narrower PATH would report "not installed" for a provider this machine can
 * start, `subscriptionCanTake` would refuse a working subscription, and — with
 * paid fallback on — the job would fall through to billing for work the
 * subscription would have done for nothing.
 *
 * ## What bounds a run
 *
 * Wall clock from the assignment (`AGENT_BOUNDS.maxJobWallMs` at the top),
 * output bytes from {@link MAX_OUTPUT_BYTES}, one job per provider from
 * {@link AGENT_BOUNDS.maxConcurrentJobsPerProvider}, an EMPTY working directory,
 * and an argv that must be one of the two in {@link RUN_ARGVS}. A child that
 * outlives its wall clock is killed, and a killed child is a FAILED job — never
 * an extended one.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { MAX_OUTPUT_BYTES, conclusionFrom, reviewPrompt, runArgvFor, runArgvIsPermitted } from "./executor.ts";
import { agentChildPath, resolveOnPath } from "./host.ts";
import { AGENT_BOUNDS, LAUNCHERS, type AgentProviderId } from "./provider.ts";
import type { ReviewerAssignment, ReviewerConclusion, ReviewerExecutor } from "./review.ts";

/*
 * The trusted-install discovery and the composed PATH live in `host.ts`, beside
 * the probe that must resolve a launcher the SAME way this runs it. They are
 * re-exported here so a caller reaching for the RUN side has one import, and so
 * the closed table has exactly one definition rather than two that can drift.
 */
export {
  TRUSTED_LAUNCHER_ROOTS,
  agentChildPath,
  baseDir,
  compareVersionNames,
  launcherIn,
  newestVersionDir,
  trustedLauncherDirs,
  type LauncherRoot,
  type RootBase,
} from "./host.ts";

/** Where a provider’s launcher resolves for a RUN on this host, or null. */
export function resolveRunLauncher(
  provider: AgentProviderId,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: string = process.platform,
): string | null {
  const launcher = LAUNCHERS[provider].launcher;
  return resolveOnPath(launcher, { ...env, PATH: agentChildPath(env, home, platform) }, platform);
}

/* ------------------------------------------------------------ the running */

/** One provider, one seat: the second job on the same subscription waits. */
const IN_FLIGHT = new Set<AgentProviderId>();

/** How many jobs this process currently has running on that provider. */
export function inFlightCount(provider: AgentProviderId): number {
  return IN_FLIGHT.has(provider) ? 1 : 0;
}

export interface BoundedRun {
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly status: number | null;
  readonly signal: string | null;
  readonly why: string | null;
  readonly launcherAt: string;
  readonly ranFor: number;
}

export interface BoundedRunInput {
  readonly provider: AgentProviderId;
  readonly stdin: string;
  readonly wallMs: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly home?: string;
  readonly platform?: string;
  readonly clock?: () => number;
}

/**
 * Run one provider's declared argv, with the prompt on stdin, in an empty
 * directory, under a wall clock.
 *
 * `spawnSync` with `shell: false` and an argv ARRAY: there is no string for a
 * shell to interpret, so the prompt cannot become a command no matter what it
 * contains. The environment is this process's, plus the composed PATH — nothing
 * from Admin, nothing from the job, and no credential this module assembled.
 * The providers read their own homes for their own sign-ins, which is exactly
 * why this bridge never has to handle one.
 */
export function runBounded(input: BoundedRunInput): BoundedRun {
  const env = input.env ?? process.env;
  const home = input.home ?? homedir();
  const platform = input.platform ?? process.platform;
  const clock = input.clock ?? (() => Date.now());
  const argv = runArgvFor(input.provider);
  if (!runArgvIsPermitted(argv)) {
    throw new Error(
      "The agent bridge refused to run an argv that is not one of its two declared runs. The run table " +
        "is closed and this host runs nothing else — there is no path here for an arbitrary command.",
    );
  }
  const at = resolveRunLauncher(input.provider, env, home, platform);
  if (at === null) {
    return {
      ok: false,
      stdout: "",
      stderr: "",
      status: null,
      signal: null,
      why: `The ${argv[0]} program was not found on this machine or in any trusted install directory, so nothing was run.`,
      launcherAt: "",
      ranFor: 0,
    };
  }
  // An EMPTY working directory. The frozen bytes are in the prompt, so there is
  // nothing here a reviewer needs and nothing here it could damage.
  const cwd = mkdtempSync(join(tmpdir(), "wtp-agent-"));
  const started = clock();
  try {
    const run = spawnSync(at, argv.slice(1), {
      input: input.stdin,
      cwd,
      env: { ...env, PATH: agentChildPath(env, home, platform) },
      encoding: "utf8",
      shell: false,
      timeout: Math.min(input.wallMs, AGENT_BOUNDS.maxJobWallMs),
      maxBuffer: MAX_OUTPUT_BYTES,
      windowsHide: true,
    });
    const ranFor = clock() - started;
    const stdout = run.stdout ?? "";
    const stderr = run.stderr ?? "";
    if (run.error) {
      const name = (run.error as NodeJS.ErrnoException).code ?? run.error.name;
      return {
        ok: false,
        stdout,
        stderr,
        status: run.status,
        signal: run.signal ?? null,
        why:
          name === "ETIMEDOUT"
            ? `It did not finish inside its ${Math.round(input.wallMs / 1000)}-second bound and was stopped. A job that runs past its bound is abandoned, not extended.`
            : `It could not be run (${name}).`,
        launcherAt: at,
        ranFor,
      };
    }
    if (run.status !== 0) {
      return {
        ok: false,
        stdout,
        stderr,
        status: run.status,
        signal: run.signal ?? null,
        why: `It exited ${run.status === null ? `on signal ${run.signal ?? "unknown"}` : `with status ${run.status}`}.`,
        launcherAt: at,
        ranFor,
      };
    }
    return { ok: true, stdout, stderr, status: 0, signal: null, why: null, launcherAt: at, ranFor };
  } finally {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // A temp directory we could not remove is not a reason to fail a job that ran.
    }
  }
}

/**
 * A {@link ReviewerExecutor} for the machine this process is running on.
 *
 * This is the implementation `review.ts` declared and never had. It takes one
 * assignment, and an assignment carries no peer — so the isolation guarantee
 * `runIndependentReview` builds is preserved by this executor for the same
 * reason it was preserved by the type: there is nothing here to leak.
 */
export function nodeReviewerExecutor(now: () => string): ReviewerExecutor {
  return async (assignment: ReviewerAssignment): Promise<ReviewerConclusion> => {
    if (IN_FLIGHT.has(assignment.provider)) {
      throw new Error(
        `${assignment.provider} already has a job in flight on this host, and a subscription is one seat ` +
          `(maxConcurrentJobsPerProvider=${AGENT_BOUNDS.maxConcurrentJobsPerProvider}). The second job waits rather than racing the first.`,
      );
    }
    IN_FLIGHT.add(assignment.provider);
    const startedAt = now();
    try {
      const run = runBounded({
        provider: assignment.provider,
        stdin: reviewPrompt(assignment),
        wallMs: assignment.bounds.wallMs,
      });
      if (!run.ok) {
        const tail = (run.stderr || run.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400);
        throw new Error(`${assignment.provider} did not complete its review: ${run.why}${tail === "" ? "" : ` ${tail}`}`);
      }
      return conclusionFrom(assignment, run.stdout, startedAt, now());
    } finally {
      IN_FLIGHT.delete(assignment.provider);
    }
  };
}
