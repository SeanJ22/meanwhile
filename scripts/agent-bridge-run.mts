/**
 * **THE STANDING RUNNER'S DOOR INTO THE AGENT BRIDGE.** (ACLOSE-1, ACLOSE-3, ACLOSE-4.)
 *
 * Everything the bridge needed in order to run existed except a caller on a
 * machine that can start a program: `ReviewerExecutor` was a type with no
 * implementation, `runIndependentReview` was called only from a test, and the
 * page rendered both provider cards as permanently unobservable because a
 * Netlify function has no PATH. This script is the missing caller, and it runs
 * where the work is: the runner host.
 *
 * It is deliberately a SCRIPT and not a route. A web function that could start
 * a fifteen-minute subscription job would be a remote shell with a nicer name;
 * the only thing that starts one is a process the owner's own machine runs.
 *
 * ```
 *   pnpm agent-bridge:probe                    what this machine can start, and how it knows
 *   pnpm agent-bridge:job --provider=codex     ONE bounded READ_ONLY job on one provider
 *   pnpm agent-bridge:review                   ONE independent review across BOTH providers
 * ```
 *
 * ## What it may run
 *
 * Nothing this file chooses. The provider comes from a closed union, the argv
 * from the closed table in `executor.ts`, the launcher from the closed install
 * list in `run-host.ts`, and the prompt from the frozen snapshot — on stdin,
 * never as an argument. There is no `--command`, no `--exec`, and no path
 * argument, because there is nothing here for one to reach.
 *
 * ## What it freezes
 *
 * {@link SNAPSHOT_FILES} — the bridge's own provider, job, review and execution
 * contract. A review of the thing that decides whether money is spent is the
 * most useful bounded question this repository has for it, and the brief asks
 * for a useful task rather than a manufactured one.
 *
 * ## Money
 *
 * The owner's paid-API setting is read from the control plane and obeyed. It
 * defaults OFF and this script never writes it. With it OFF and a subscription
 * unavailable, a job is REFUSED and the receipt says nothing was charged.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { nodeProbeHost } from "../lib/control-plane/agents/host.ts";
import { TRUSTED_LAUNCHER_ROOTS, nodeReviewerExecutor, resolveRunLauncher, runBounded, trustedLauncherDirs } from "../lib/control-plane/agents/run-host.ts";
import { liveExecutionChoice, runSingleJob, subscriptionCanTake } from "../lib/control-plane/agents/execution.ts";
import { AGENT_PROVIDERS, PROVIDER_WORDS, probeProvider, type AgentProviderId } from "../lib/control-plane/agents/provider.ts";
import { freezeContext } from "../lib/control-plane/agents/job.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { runIndependentReview } from "../lib/control-plane/agents/review.ts";
import { isAdminConfig, ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { CONTROL_PLANE_URL_VAR, controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import { RESEARCH_BOUNDS } from "../lib/control-plane/scheduler/research-policy.ts";

const ROOT = process.cwd();

/** The closed list of bytes a proof job reviews. Literal paths, never an argument. */
const SNAPSHOT_FILES: readonly string[] = [
  "lib/control-plane/agents/provider.ts",
  "lib/control-plane/agents/executor.ts",
  "lib/control-plane/agents/execution.ts",
];

/** The exact question each proof job is asked. Stated here so both seats get one. */
const QUESTION =
  "Does this frozen Agent Bridge preserve subscription-first execution, prevent arbitrary-shell delegation, " +
  "keep agents at READ_ONLY or PROPOSE_ONLY authority, and fail closed when execution cannot be safely " +
  "classified? Identify any concrete violation with exact evidence from these bytes; otherwise say the " +
  "reviewed invariants hold.";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function frozenBody(): string {
  return SNAPSHOT_FILES.map((f) => `----- ${f} -----\n${readFileSync(join(ROOT, f), "utf8")}`).join("\n\n");
}

async function openRepositories() {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    throw new Error(
      `agent-bridge:run requires ${CONTROL_PLANE_URL_VAR}. A delegated job whose record cannot be written is ` +
        "an unrecorded job, and this refuses to run one rather than produce work nobody can read back.",
    );
  }
  // The bridge does not own this schema; the runner's bootstrap does.
  return createPgRepositories(url, new Date().toISOString(), { skipBootstrap: true });
}

async function readConfig(repos: Awaited<ReturnType<typeof openRepositories>>): Promise<AdminConfig | null> {
  try {
    const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
    const value = row?.value ?? null;
    return value !== null && isAdminConfig(value) ? value : null;
  } catch {
    // Unreadable reads as OFF, exactly as `apiFallbackPolicy` does.
    return null;
  }
}

/** Presence only. The value never enters a policy, a record or this process's output. */
function credentialPresent(): boolean {
  const raw = process.env.WTP_WORKERS_ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
  return raw.trim() !== "";
}

function probeAll(now: string) {
  const host = nodeProbeHost(now);
  return AGENT_PROVIDERS.map((provider) => probeProvider(host, provider));
}

function reportProbe(): void {
  const now = new Date().toISOString();
  console.log("agent-bridge:probe — what this machine can actually start\n");
  const dirs = trustedLauncherDirs(process.env, homedir(), process.platform);
  /*
   * RULING 159 / RULING 116: a count carries its denominator. "2 trusted
   * directories" is not a reading; "2 of the 2 declared" is, and so is "0 of 2",
   * which is the answer this instrument exists to be able to give honestly.
   */
  const declaredRoots = Object.values(TRUSTED_LAUNCHER_ROOTS).reduce((n, roots) => n + roots.length, 0);
  const found = floored("trusted install directories present on this machine", "TRUSTED_LAUNCHER_ROOTS", declaredRoots, dirs.length);
  console.log(`  ${floorLine(found)}`);
  for (const dir of dirs) console.log(`    ${dir}`);
  console.log(`  the child's PATH is this host's PATH plus those entries.\n`);
  const probes = probeAll(now);
  const runnable = floored(
    "providers this machine can start on their subscription",
    "AGENT_PROVIDERS",
    AGENT_PROVIDERS.length,
    probes.filter((p) => subscriptionCanTake(p).can).length,
  );
  console.log(`  ${floorLine(runnable)}\n`);
  for (const probe of probes) {
    const words = PROVIDER_WORDS[probe.provider];
    const runAt = resolveRunLauncher(probe.provider);
    console.log(`  ${words.name} (${probe.provider})`);
    console.log(`    launcher on PATH:      ${probe.launcher.found ? probe.launcher.at : "NOT FOUND"}`);
    console.log(`    launcher for a run:    ${runAt ?? "NOT FOUND"}`);
    console.log(`    home present:          ${probe.home.present}`);
    console.log(`    saved sign-in present: ${probe.home.savedSignIn}   (presence only; the file is never opened)`);
    console.log(`    version printed:       ${probe.version.printed ?? `not read — ${probe.version.why ?? "unknown"}`}`);
    console.log("");
  }
}

async function runOneJob(which: string): Promise<void> {
  const provider: AgentProviderId = which === "codex" ? "CODEX_SUBSCRIPTION" : "CLAUDE_CODE_SUBSCRIPTION";
  const repos = await openRepositories();
  const config = await readConfig(repos);
  const now = new Date().toISOString();
  const probe = probeAll(now).find((p) => p.provider === provider)!;
  const body = frozenBody();
  const context = freezeContext(body, `the Agent Bridge execution contract (${SNAPSHOT_FILES.length} files)`, now);

  const live = liveExecutionChoice({
    provider,
    probe,
    config,
    credentialPresent: credentialPresent(),
    // A paid run would be metered against the same rolling ceiling the research
    // lane uses. Nothing here measures a window, so a paid path is refused as
    // UNMEASURED rather than run against a cap nobody read.
    ceiling: { permits: false, why: `no rolling spend window was measured for this job, and the ceiling is $${RESEARCH_BOUNDS.dailyCeilingUsd}` },
  });

  console.log(`agent-bridge:job — ${PROVIDER_WORDS[provider].name}`);
  console.log(`  frozen context   ${context.hash} (${context.bytes} bytes, ${SNAPSHOT_FILES.length} files)`);
  console.log(`  subscription     ${live.subscription.why}`);
  console.log(`  paid setting     ${live.fallback.enabled ? "ON" : "OFF"} (${live.fallback.source})`);
  console.log(`  path             ${live.choice.path} — ${live.choice.says}`);

  const startedAt = Date.now();
  const outcome = await runSingleJob(
    {
      log: repos.agentJobs,
      now: () => new Date().toISOString(),
      pathFor: () => live.choice,
      runSubscription: async (input) => {
        const run = runBounded({ provider: input.provider, stdin: input.prompt, wallMs: input.wallMs });
        if (!run.ok) throw new Error(run.why ?? "it did not finish");
        console.log(`  launcher used    ${run.launcherAt}`);
        console.log(`  wall time        ${Math.round(run.ranFor / 1000)}s`);
        console.log(`  output bytes     ${Buffer.byteLength(run.stdout, "utf8")}`);
        return run.stdout;
      },
      // No paid runner is supplied, on purpose: with the owner's setting OFF a
      // paid path is unreachable, and supplying one anyway would be the seam
      // through which an OFF setting could still spend.
    },
    {
      mode: provider === "CODEX_SUBSCRIPTION" ? "GPT" : "CLAUDE",
      provider,
      context,
      scope: "ACLOSE-3 — a bounded read-only review of the Agent Bridge execution contract",
      allowed: { files: [...SNAPSHOT_FILES], systems: [] },
      requestedOutput: "findings grounded only in the frozen snapshot, in the declared reply shape",
      idempotencyKey: `aclose3:${provider}:${context.hash.slice(-16)}`,
      prompt: `${QUESTION}\n\nAnswer ONLY from the bytes below.\n\n${body}`,
      wallMs: 10 * 60_000,
    },
  );

  console.log(`\n  job id           ${outcome.job.jobId}`);
  console.log(`  receipt id       ${outcome.job.receiptId}`);
  console.log(`  state            ${outcome.job.state}`);
  console.log(`  started          ${outcome.job.startedAt}`);
  console.log(`  completed        ${outcome.job.completedAt ?? "—"}`);
  console.log(`  elapsed          ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(`  charged          $${outcome.usd.toFixed(2)} (path ${outcome.path})`);
  if (outcome.job.refusal) console.log(`  refusal          ${outcome.job.refusal.code} — ${outcome.job.refusal.says}`);
  if (outcome.raw) console.log(`\n----- what it answered -----\n${outcome.raw.slice(0, 4000)}`);
}

async function runReview(): Promise<void> {
  const repos = await openRepositories();
  const config = await readConfig(repos);
  const now = new Date().toISOString();
  const probes = probeAll(now);
  const body = frozenBody();

  const choiceFor = (provider: AgentProviderId) =>
    liveExecutionChoice({
      provider,
      probe: probes.find((p) => p.provider === provider)!,
      config,
      credentialPresent: credentialPresent(),
      ceiling: { permits: false, why: "no rolling spend window was measured for this review" },
    }).choice;

  console.log("agent-bridge:review — INDEPENDENT_REVIEW across both providers");
  for (const provider of AGENT_PROVIDERS) console.log(`  ${provider}: ${choiceFor(provider).path}`);

  const outcome = await runIndependentReview(
    {
      execute: nodeReviewerExecutor(() => new Date().toISOString()),
      log: repos.agentJobs,
      now: () => new Date().toISOString(),
      pathFor: choiceFor,
    },
    {
      body,
      describes: `the Agent Bridge execution contract (${SNAPSHOT_FILES.length} files)`,
      question: QUESTION,
      scope: "ACLOSE-4 — one independent review of the Agent Bridge execution contract",
      allowed: { files: [...SNAPSHOT_FILES], systems: [] },
      requestedOutput: "each reviewer's own findings, grounded only in the frozen snapshot",
      providers: { a: "CODEX_SUBSCRIPTION", b: "CLAUDE_CODE_SUBSCRIPTION" },
      idempotencyKey: `aclose4:${new Date().toISOString().slice(0, 13)}`,
    },
  );

  /*
   * THE WHOLE OUTCOME, NOT THE FIRST TWELVE THOUSAND CHARACTERS OF IT.
   *
   * A truncated print cut the isolation proof and the comparison off the end of
   * the first real ACLOSE-4 run — the two things the run exists to produce.
   * Every seat's conclusion is durable in the job log either way, but the proof
   * and the comparison are computed here and printed nowhere else.
   */
  console.log(JSON.stringify(outcome, null, 2));
}

const mode = process.argv.includes("--probe")
  ? "probe"
  : process.argv.includes("--review")
    ? "review"
    : process.argv.includes("--job")
      ? "job"
      : arg("provider") !== null
        ? "job"
        : "probe";

if (mode === "probe") {
  reportProbe();
} else if (mode === "job") {
  await runOneJob(arg("provider") ?? "codex");
} else {
  await runReview();
}
