/**
 * `pnpm integrity:observe` — the automatic post-deploy reading.
 *
 * Triggered by the push to `main` that causes the deploy (Netlify creates no
 * GitHub Deployment object, so `deployment_status` never fires here). It polls
 * `GET /api/build`, which writes nothing, until production serves the expected
 * commit, then spawns `scripts/production-integrity.mts --sha=<served> --write`,
 * which runs the existing schema shipping gate. It never rolls anything back and
 * creates no Git commit.
 *
 * A timeout while production serves another commit is PRODUCTION_BEHIND (a fact
 * about the deploy pipeline), never DEGRADED (a fact about production's schema).
 * If production cannot be asked at all, the outcome is COULD_NOT_TELL.
 *
 *   --expect=<sha>       the commit that should become the served one. Defaults to HEAD.
 *   --base-url=<url>     which origin to ask. Defaults to production.
 *   --write              persist the reading. Without it nothing is recorded.
 *   --attempts=<n>       tighten the poll below the bound; it may never loosen it.
 *
 * Exit codes:
 *   0  the served commit is the expected one and integrity HELD (or the commit
 *      is not production-changing, so no reading is owed)
 *   1  integrity REFUSED — production and the committed migrations disagree
 *   2  COULD NOT TELL — production could not be asked, or the gate could not
 *   3  PRODUCTION_BEHIND — the bound elapsed and production serves something else
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SYNTHETIC_RUN_HEADER } from "../lib/db/run-marker.ts";
import { classifyDeploy } from "../lib/ops/deploy-paths.ts";
import { sameCommit } from "../lib/ops/production-integrity.ts";
import { git } from "./production-integrity.mts";
import { isDocumentaryAdvance, observationScope } from "./deploy-observation-scope.mjs";

import { PUBLIC_SITE_ORIGIN } from "../lib/ops/origins.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The origin this repository deploys to. `scripts/deploy-live.mjs` names the same host. */
export const PRODUCTION_BASE_URL = PUBLIC_SITE_ORIGIN;

/** The hard bound: a ceiling `--attempts` may tighten and nothing may loosen. */
export const POLL_BOUND = {
  maxAttempts: 30,
  intervalSeconds: 20,
  maxTotalWaitSeconds: 600,
} as const;

/** What production answered when asked which commit it serves. */
export interface ServedCommit {
  /** The served commit, or `null` when production could not be ASKED. Never a guess. */
  readonly sha: string | null;
  /** How it was established, or why it could not be. Printed either way. */
  readonly how: string;
  readonly httpStatus: number | null;
}

/** The four things the observation can find. None of them is "the deploy failed", which needs the build log. */
export const OBSERVER_OUTCOMES = [
  "SERVING_EXPECTED",
  "PRODUCTION_BEHIND",
  "COULD_NOT_TELL",
  "NOT_A_RELEASE",
] as const;
export type ObserverOutcome = (typeof OBSERVER_OUTCOMES)[number];

export interface PollResult {
  readonly outcome: ObserverOutcome;
  readonly servedSha: string | null;
  readonly attempts: number;
  readonly waitedSeconds: number;
  readonly detail: string;
}

/** Ask one origin which commit it serves. `scripts/release-freeze-gate.mts` imports this same reader. */
export async function fetchServedCommit(
  baseUrl: string,
  options: {
    runId?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<ServedCommit> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/build`;
  const doFetch = options.fetchImpl ?? fetch;
  const runId = options.runId ?? process.env.WTP_RUN_ID ?? "post-deploy-observer";
  const timeoutMs = options.timeoutMs ?? 15_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, {
      headers: {
        [SYNTHETIC_RUN_HEADER]: runId,
        "cache-control": "no-cache",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { sha: null, how: `${url} answered HTTP ${res.status}`, httpStatus: res.status };
    }
    const body = (await res.json()) as { commit?: unknown };
    const commit = typeof body.commit === "string" ? body.commit : null;
    // `"unknown"` is the route's honest answer when the build carried no COMMIT_REF.
    // Shape-checked because the value is later passed as a command argument; anything else is "no commit".
    if (commit === null || !/^[0-9a-f]{7,40}$/.test(commit)) {
      return {
        sha: null,
        how: `${url} answered 200 but named no commit (commit=${String(body.commit)})`,
        httpStatus: res.status,
      };
    }
    return { sha: commit, how: `GET ${url}`, httpStatus: res.status };
  } catch (err) {
    return { sha: null, how: `${url} could not be reached: ${(err as Error).message}`, httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}


/** Poll until production serves the expected commit, or until the bound. `probe` and `sleep` are injected for tests. */
export async function pollUntilServed(input: {
  expectedSha: string;
  probe: (attempt: number) => Promise<ServedCommit>;
  sleep: (ms: number) => Promise<void>;
  attempts?: number;
  intervalSeconds?: number;
  maxTotalWaitSeconds?: number;
  /** Production-only, bounded by the previously proved documentary range. */
  documentaryRange?: { root: string; originallyServedSha: string; candidateSha: string };
}): Promise<PollResult> {
  const maxAttempts = Math.max(1, Math.min(input.attempts ?? POLL_BOUND.maxAttempts, POLL_BOUND.maxAttempts));
  const interval = Math.min(input.intervalSeconds ?? POLL_BOUND.intervalSeconds, POLL_BOUND.intervalSeconds);
  const maxWait = Math.min(
    input.maxTotalWaitSeconds ?? POLL_BOUND.maxTotalWaitSeconds,
    POLL_BOUND.maxTotalWaitSeconds,
  );

  let waited = 0;
  let attempts = 0;
  let last: ServedCommit = { sha: null, how: "no probe was made", httpStatus: null };

  for (let i = 0; i < maxAttempts; i += 1) {
    attempts += 1;
    last = await input.probe(attempts);
    const exact = sameCommit(last.sha, input.expectedSha);
    const range = input.documentaryRange;
    const documentaryAdvance = !exact && last.sha !== null && range !== undefined &&
      isDocumentaryAdvance(range.root, range.originallyServedSha, range.candidateSha, last.sha);
    if (exact || documentaryAdvance) {
      return {
        outcome: "SERVING_EXPECTED",
        servedSha: last.sha,
        attempts,
        waitedSeconds: waited,
        detail: `production serves ${last.sha} on attempt ${attempts} (${last.how})` +
          (documentaryAdvance ? "; fresh Git proof places the served commit inside the scoped non-shipping range" : ""),
      };
    }
    if (i === maxAttempts - 1 || waited + interval > maxWait) break;
    await input.sleep(interval * 1000);
    waited += interval;
  }

  // Production answered with another commit -> PRODUCTION_BEHIND (a deploy fact, never a schema claim).
  // Production did not answer -> COULD_NOT_TELL.
  if (last.sha === null) {
    return {
      outcome: "COULD_NOT_TELL",
      servedSha: null,
      attempts,
      waitedSeconds: waited,
      detail:
        `production could not be asked which commit it serves after ${attempts} attempt(s) over ` +
        `${waited}s: ${last.how}. This is COULD NOT TELL, not a pass and not a failed deploy.`,
    };
  }
  return {
    outcome: "PRODUCTION_BEHIND",
    servedSha: last.sha,
    attempts,
    waitedSeconds: waited,
    detail:
      `after ${attempts} attempt(s) over ${waited}s production still serves ${last.sha}, not ` +
      `${input.expectedSha}. THE DEPLOY HAS NOT ARRIVED. That is a fact about the build pipeline ` +
      "(NH281 is open on exactly this), never a fact about production's schema, and no integrity " +
      "reading is recorded for a commit production does not serve.",
  };
}

/**
 * Is this commit one that could change what production serves? `classifyDeploy`
 * is the same predicate `scripts/netlify-ignore.mjs` gives Netlify.
 */
export function isRelease(sha: string): { release: boolean; reason: string } {
  const files = git("show", "--name-only", "--format=", sha);
  if (files === null) {
    // The changed-path list could not be read; `classifyDeploy(null)` builds, so observe rather than skip.
    const d = classifyDeploy(null);
    return { release: d.verdict !== "cancel", reason: `${d.reason} (the changed-path list could not be read)` };
  }
  const d = classifyDeploy(files.split("\n").filter(Boolean));
  return { release: d.verdict !== "cancel", reason: d.reason };
}

/* ------------------------------------------------------------------ main */

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main(): Promise<void> {
  const expected = arg("expect") ?? git("rev-parse", "HEAD");
  const baseUrl = arg("base-url") ?? PRODUCTION_BASE_URL;
  const write = process.argv.includes("--write");
  const attempts = arg("attempts") ? Number(arg("attempts")) : undefined;

  console.log("POST-DEPLOY OBSERVER (NH273)");
  console.log(`  expecting      ${expected ?? "UNKNOWN"}`);
  console.log(`  asking         ${baseUrl}/api/build`);
  console.log(
    `  bound          at most ${POLL_BOUND.maxAttempts} probes, ${POLL_BOUND.intervalSeconds}s apart, ` +
      `${POLL_BOUND.maxTotalWaitSeconds}s total`,
  );
  console.log("  rollback       NONE. This never rolls production back; the database may have advanced.");
  console.log("");

  if (expected === null) {
    console.error("COULD NOT TELL — this checkout could not name HEAD, so there is nothing to expect.");
    process.exitCode = 2;
    return;
  }

  const scope = await observationScope(ROOT, expected, {
    observe: () => fetchServedCommit(baseUrl),
    // Load the production-only reader only when a documentary range needs it.
    readAuthority: async () => (await import("./production-integrity-authority.mts")).readIntegrityAuthority(),
    // A manual invocation is an explicit request for a new reading, even for documentary commits.
    force: process.env.GITHUB_EVENT_NAME !== "push",
  });
  console.log(`  observation scope: ${scope.reason}`);
  if (scope.action === "skip") {
    console.log(`NOT_A_RELEASE — ${scope.reason}`);
    console.log("No deploy is owed for this commit, so no post-deploy reading is owed either.");
    console.log("Nothing was recorded, and the previous reading stands unchanged.");
    process.exitCode = 0;
    return;
  }

  const result = await pollUntilServed({
    expectedSha: scope.sha,
    ...(scope.action === "observe-served" ? {
      documentaryRange: { root: ROOT, originallyServedSha: scope.sha, candidateSha: expected },
    } : {}),
    attempts,
    probe: async (attempt) => {
      const seen = await fetchServedCommit(baseUrl, { runId: process.env.WTP_RUN_ID ?? "post-deploy-observer" });
      console.log(`  probe ${String(attempt).padStart(2)}  ${seen.sha ?? "NO ANSWER"}  ${seen.how}`);
      return seen;
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });

  console.log("");
  console.log(`OUTCOME: ${result.outcome}`);
  console.log(`  ${result.detail}`);

  if (result.outcome === "COULD_NOT_TELL") {
    console.log("");
    console.log("Nothing was recorded. An unreachable production is not a reading, and writing one");
    console.log("would put a fact we do not have into the record the release gate trusts.");
    process.exitCode = 2;
    return;
  }

  if (result.outcome === "PRODUCTION_BEHIND") {
    console.log("");
    console.log("Nothing was recorded, and NOTHING IS DEGRADED. The last reading stands, and the");
    console.log("release-freeze gate will refuse the next production-changing release on its own");
    console.log("terms (PRODUCTION_MOVED or READING_EXPIRED) if it no longer covers what is served.");
    console.log("The deploy itself is the thing to chase: the Netlify build log is behind the");
    console.log("author's login, which is why NH281 is a Needs Sean row rather than a session task.");
    process.exitCode = 3;
    return;
  }

  // The reading is taken against the SERVED sha, which the receipt names.
  const sha = result.servedSha as string;
  console.log("");
  console.log(`Taking the post-deploy reading against ${sha} through the EXISTING gate.`);
  // Spawned through node and tsx's CLI with no shell: one argument arrived over the network.
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(ROOT, "scripts", "production-integrity.mts"),
      `--sha=${sha}`,
      ...(write ? ["--write"] : []),
    ],
    { cwd: ROOT, encoding: "utf8", stdio: "inherit" },
  );
  const exit = run.status ?? 2;
  if (!write) {
    console.log("\n(--write not given; the reading above was taken and nothing was recorded)");
  }
  process.exitCode = exit === 0 || exit === 1 || exit === 2 ? exit : 2;
}

/* Uses `process.exitCode`, never `process.exit()`: exiting with undici's socket open aborts on Windows and destroys the exit code. Nothing above runs on import. */
if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/post-deploy-observer.mts")) {
  await main();
}
