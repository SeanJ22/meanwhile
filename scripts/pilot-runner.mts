/**
 * `pnpm pilot:run` — **THE MACHINE THAT KEEPS RUNNING.**
 * (Session C, PART G2, 2026-08-31.)
 *
 * ## What it is
 *
 * A long-lived process that runs `pnpm freshness:shadow`'s cycle on an
 * interval, forever, with no operator choosing what to work. It registers every
 * obligation provider, lets the scheduler decide what is due, dispatches it,
 * records the lifecycle, runs RULING 224's promotion tail to a STAGED state,
 * and writes ONE DIGEST PER CYCLE to a place the owner reads WITHOUT the repo.
 *
 * **Promotion stays OFF.** Nothing this process does changes what a reader is
 * told; `runCycle` has no parameter that could, and the tail writes only under
 * `data/control-plane/staging/`.
 *
 * ## The digest, and where it lands
 *
 * The Drive mirror is a SYNCED FILESYSTEM FOLDER and not an API, so delivery is
 * writing a file into it. `G:/My Drive/we-the-people` by default, overridable
 * by the `WTP_MIRROR` variable this repository already uses for the coverage
 * matrix, the owner intake and the photo review sheet.
 *
 * ```
 *   <mirror>/pilot-digest.md          THE CURRENT DIGEST — a STABLE name, so the
 *                                     owner opens the same file every morning
 *   <mirror>/pilot-digest-log.md      every cycle's headline, appended
 * ```
 *
 * A stable filename is deliberate. The owner reads this by glancing at Drive,
 * and a dated filename means finding today's before reading it. The log beside
 * it is what keeps the history the stable file overwrites.
 *
 * **When the mirror is unreachable the digest is written to `.mirror/` in the
 * repository and the runner SAYS SO in its own log.** A digest that silently
 * went nowhere is worse than no digest, because the owner reads its absence as
 * "nothing happened".
 *
 * ## What the digest carries, and what it refuses to invent
 *
 * ```
 *   PILOT HEALTH        the three contracts and the rollup, first (RULING 217)
 *   COST                total, by role, by model, and the CACHE HIT RATE
 *   LANE SHARE          deterministic vs bounded-model, as Attempts and as cost
 *   WHAT ADVANCED       dispositions, staged entries, and the walls by name
 * ```
 *
 * **The cache lines come from the cost ledger (2026-09-06).** `AttemptCost`
 * carries `cacheReadInputTokens`, `cacheCreationInputTokens` with its 5-minute
 * and 1-hour split, `uncachedInputTokens` and `batch`; the cycle computes the
 * hit rate, the uncached input per Attempt, the batch share and the dollar
 * effect of caching per role from its own ledger rows, and the window metrics
 * compute the same from the same ledger. A row written before the fields
 * existed prints NOT MEASURED by name — printing `0%` for it would assert that
 * every model read missed the cache, which is a measurement nobody took.
 *
 * ## Start and stop
 *
 * ```
 *   pnpm pilot:run                    run in this shell until Ctrl+C
 *   pnpm pilot:run --cycles=3         run exactly three cycles and exit
 *   pnpm pilot:run --interval=30      minutes between cycles (default 60)
 *   pnpm pilot:install                register the Windows Scheduled Task
 *   pnpm pilot:start / pnpm pilot:stop / pnpm pilot:status
 * ```
 *
 * ## The owner's intents, and the console (9.4.26 admin feedback)
 *
 * Between cycles the runner reads the owner's intent log once a minute.
 * PAUSE_RUNNER holds cycles and keeps the heartbeat alive with `pause` set,
 * so a deliberate pause reads as one and not as a red SILENT (ADM-5);
 * RESUME_RUNNER, RUN_CYCLE_NOW and a DISPATCH end the sleep early, and the
 * cycle puts the dispatched units first in both lanes (ADM-8). After every
 * cycle's digest the runner publishes the admin console ITSELF —
 * `publish-owner-snapshot.mts`, then `readiness-refresh.mts
 * --target=control-plane` — so the deployed pages never again wait on a
 * person (ADM-1). `pnpm pilot:stop` / `pilot:disable` / `pilot:start` write
 * the matching PAUSE_RUNNER / RESUME_RUNNER note through
 * `scripts/runner-pause-note.mts`, best effort.
 *
 * `scripts/pilot-task.ps1` registers a Scheduled Task that runs AT LOGON with
 * a restart-on-failure policy, which is what makes this survive a reboot of
 * this Windows 11 host. The exact commands are in that file's header and in
 * `docs/pilot-runner.md`.
 *
 * Env var names only, never values.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { readCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import {
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_LOG_KEY,
  readIntents,
  type ResearchIntent,
  type ResearchIntentRequest,
} from "../lib/control-plane/scheduler/research-policy.ts";
import type { CacheHitRate, ResearchMetrics } from "../lib/control-plane/research-metrics.ts";
import type { PrewarmOutcome } from "../lib/control-plane/scheduler/shadow-loop.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { costSection } from "../lib/control-plane/pilot-cost-digest.ts";
import { today } from "./doc-dates.mjs";
import {
  FLEET_SAFETY_BOUNDS,
  classifyProviderFailure,
  scheduledBlackoutAt,
  type FleetSafetySnapshot,
  type ProviderCircuit,
} from "../lib/control-plane/fleet-safety.ts";
import { installNeonCircuitBreaker, latchNeonCircuit, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";

const ROOT = process.cwd();
const argv = process.argv.slice(2);

const cyclesArg = argv.find((a) => a.startsWith("--cycles="));
const CYCLES = cyclesArg ? Number(cyclesArg.slice("--cycles=".length)) : Infinity;
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const INTERVAL_MIN = intervalArg ? Number(intervalArg.slice("--interval=".length)) : 60;
const maxArg = argv.find((a) => a.startsWith("--max="));
const requestedMax = maxArg ? Number(maxArg.slice("--max=".length)) : FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle;
const MAX = String(Number.isFinite(requestedMax) && requestedMax >= 0
  ? Math.min(requestedMax, FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle)
  : FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle);
const provider = argv.includes("--provider=file") ? "file" : "postgres";
const onlyArg = argv.find((a) => a.startsWith("--only="));
const idsArg = argv.find((a) => a.startsWith("--ids="));
const scoutMaxArg = argv.find((a) => a.startsWith("--scout-max="));
const canary = argv.includes("--canary");

/**
 * The Drive mirror. A SYNCED FOLDER, not an API — writing a file into it IS the
 * delivery. The variable name is the one this repository already uses.
 */
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const FALLBACK = join(ROOT, ".mirror");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");
if (provider === "postgres") installNeonCircuitBreaker(ROOT);
/**
 * Emergency recovery only: if Neon itself refuses billing/quota, it cannot
 * persist its own circuit. This host-local latch prevents an hourly retry
 * storm across runner restarts. It is not a spend ledger or control-plane
 * substitute; normal provider circuits remain in `research_state`.
 */
interface RunRecord {
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly provider?: string;
  readonly registry?: {
    readonly providers?: readonly {
      readonly providerId: string;
      readonly records: number;
      readonly units: number;
      readonly readFailure: string | null;
      readonly emptyReason: string | null;
    }[];
    readonly registeredUnits?: number;
    readonly nonMeetingUnits?: number;
  };
  readonly dueCount?: number;
  readonly dispatched?: number;
  readonly worked?: readonly string[];
  readonly dispositions?: readonly { obligationId: string; disposition: string | null; artifacts: number }[];
  readonly staged?: readonly {
    readonly obligationId: string;
    readonly state: string;
    readonly rowCount: number;
    readonly declaredTotal: number | null;
    readonly complete: boolean;
    readonly readerSentence: string;
    readonly snapshotPath: string | null;
  }[];
  readonly health?: { readonly green?: boolean; readonly readings?: readonly { contract: string; state: string; reason: string }[] };
  readonly debts?: number;
  readonly incidents?: readonly { cause: string; target: string; obligationsAffected: number; nextRetryAt: string }[];
  readonly promotedToReaderTruth?: boolean;
  readonly digest?: readonly string[];
  /** Level 1 — Research, as the cycle recorded it. Absent on a record written before activation. */
  readonly research?: {
    readonly state?: {
      /** RULING 244 / Work Item 5: the metrics the cycle computed. Absent on a record written before them. */
      readonly metrics?: ResearchMetrics | null;
      readonly modelLaneEnabled?: boolean;
      readonly modelLaneDisabledReason?: string | null;
      readonly workerCredential?: { readonly name?: string; readonly configured?: boolean };
      readonly model?: string;
      readonly spend?: { readonly windowUsd?: number | null; readonly measuredAttempts?: number; readonly unmeasuredAttempts?: number };
      readonly bounds?: { readonly dailyCeilingUsd?: number; readonly maxConcurrentScouts?: number; readonly maxScoutDispatchesPerCycle?: number };
      readonly queue?: { readonly modelClassDue?: number; readonly modelClassUnits?: number; readonly modelClassDispatchedThisCycle?: number };
      readonly runtimeConditions?: readonly string[];
      readonly fleetSafety?: FleetSafetySnapshot | null;
    };
    readonly lanes?: {
      readonly deterministic?: { readonly due?: number; readonly dispatched?: number };
      readonly model?: {
        readonly due?: number; readonly dispatched?: number; readonly deferred?: number; readonly deferredBy?: Readonly<Record<string, number>>;
        /** The cycle's pre-warm of the Scout static prefix (2026-09-06). Null when no Scout was admitted; absent on older records. */
        readonly prewarm?: PrewarmOutcome | null;
      };
    } | null;
    /**
     * The cache-by-role rows for THIS cycle's cost-ledger rows (2026-09-06),
     * computed by the cycle from the same ledger the window metrics read, so the
     * COST section and the RESEARCH METRICS section cannot disagree. Absent on a
     * record written before.
     */
    readonly cacheThisCycle?: readonly CacheHitRate[] | null;
    readonly scouts?: readonly {
      readonly obligationId: string;
      readonly attemptId: string | null;
      readonly outcome: string | null;
      readonly disposition: string | null;
      readonly worker: { readonly role?: string; readonly provider?: string; readonly version?: string } | null;
      readonly cost: { readonly usd?: number | null; readonly inputTokens?: number | null; readonly outputTokens?: number | null } | null;
      readonly artifacts: number;
    }[];
    readonly results?: readonly {
      readonly obligationId: string;
      readonly outcome: string;
      readonly refused: boolean;
      readonly stoppedBy: string;
      readonly rungs: number;
      readonly distinctEvidenceRungs: number;
      readonly candidates: number;
      readonly usd: number | null;
      readonly elapsedMs: number;
    }[];
  };
}

/* ------------------------------------------------------------- one cycle --- */

/**
 * The child's dispatch budget, in minutes, passed through so the cycle stops
 * starting work BEFORE this supervisor's ceiling and exits clean. The ceiling
 * below is the backstop for a child that hangs, never the normal end of a
 * healthy-but-slow cycle — a kill mid-dispatch leaks open occurrences that the
 * next cycle must resume and pay for again.
 */
const budgetArg = argv.find((a) => a.startsWith("--budget-min="));
const requestedBudgetMin = budgetArg ? Number(budgetArg.slice("--budget-min=".length)) : FLEET_SAFETY_BOUNDS.maxWallMsPerCycle / 60_000;
const BUDGET_MIN = Number.isFinite(requestedBudgetMin) && requestedBudgetMin >= 0
  ? Math.min(requestedBudgetMin, FLEET_SAFETY_BOUNDS.maxWallMsPerCycle / 60_000)
  : FLEET_SAFETY_BOUNDS.maxWallMsPerCycle / 60_000;

function runOneCycle(): {
  readonly ok: boolean;
  readonly recordPath: string | null;
  readonly stdout: string;
  /** The last lines the child wrote to stderr. The diagnosis of a failed cycle. */
  readonly stderrTail: string;
  readonly signal: string | null;
  readonly circuit: ProviderCircuit | null;
} {
  const before = new Date().toISOString();
  const latched = provider === "postgres" ? readNeonCircuit(ROOT, before) : null;
  if (latched) {
    return { ok: false, recordPath: null, stdout: "", stderrTail: `${latched.provider}: ${latched.condition}; no automated retry before ${latched.eligibleAt}`, signal: null, circuit: latched };
  }
  const args = [
    ...(canary && !existsSync(".env.local") ? [] : ["--env-file=.env.local"]),
    "--experimental-strip-types",
    /* PRDY-3: the fact bridge reaches the Reader's own renderer, which imports by the `@/` alias the loader resolves. */
    "--import", "./scripts/register-test-loader.mjs",
    "scripts/freshness-shadow.mts",
    `--provider=${provider}`,
    `--max=${MAX}`,
    `--budget-min=${BUDGET_MIN}`,
    /* So the child's heartbeat can state when the next cycle is due. */
    `--interval=${INTERVAL_MIN}`,
    ...(onlyArg ? [onlyArg] : []),
    ...(idsArg ? [idsArg] : []),
    ...(scoutMaxArg ? [scoutMaxArg] : []),
    ...(canary ? ["--canary"] : []),
  ];
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    /* The supervisor is the aggregate wall-clock backstop. */
    timeout: FLEET_SAFETY_BOUNDS.maxWallMsPerCycle,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const match = stdout.match(/run record: (.+\.json)/);
  const stderrLines = (run.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
  const failure = classifyProviderFailure(new Error(`${run.stderr ?? ""}\n${run.stdout ?? ""}`));
  const databaseNamed = /neon|postgres|database|control plane|transfer allowance|compute quota|storage quota/i.test(failure.condition);
  const circuit = provider === "postgres" && run.status !== 0 && failure.class === "HARD" && databaseNamed
    ? latchNeonCircuit(ROOT, failure.condition, new Date().toISOString())
    : null;
  return {
    ok: run.status === 0,
    recordPath: match ? match[1].trim() : null,
    stdout,
    stderrTail: stderrLines.slice(-12).join("\n"),
    signal: run.signal ?? null,
    circuit,
  };
}

/* --------------------------------------------------------------- the cost --- */

/* The COST section moved to lib/control-plane/pilot-cost-digest.ts (2026-09-06) so it can be rendered over any run record and tested. */

function laneShare(record: RunRecord): string[] {
  const digest = record.digest ?? [];
  const executors = digest.find((l) => l.includes("executors          "));
  const research = record.research;
  const state = research?.state;
  const lanes = research?.lanes ?? null;
  const out = [
    "## DETERMINISTIC vs MODEL",
    "",
    executors
      ? `- ${executors.trim().replace(/^executors\s+/, "")}`
      : "- the cycle recorded no executor split, which is a defect in the run record",
  ];
  if (!research) {
    out.push("- this record was written before Level 1 — Research was wired; it carries no Scout lane");
    return out;
  }
  const safety = state?.fleetSafety;
  out.push("", "## FLEET SAFETY", "");
  if (!safety) {
    out.push("- no aggregate safety snapshot was recorded; this is not a zero-use reading");
  } else {
    out.push(
      `- state: **${safety.status}**`,
      `- model spend: cycle ${safety.cycle.modelUsd === null ? "UNMEASURED" : `$${safety.cycle.modelUsd.toFixed(4)}`} / $${safety.bounds.cycleModelUsd.toFixed(2)}; ` +
        `operational night ${safety.operationalNight.modelUsd === null ? "UNMEASURED" : `$${safety.operationalNight.modelUsd.toFixed(4)}`} / $${safety.bounds.operationalNightModelUsd.toFixed(2)}; ` +
        `rolling 24h ${safety.rolling24Hours.modelUsd === null ? "UNMEASURED" : `$${safety.rolling24Hours.modelUsd.toFixed(4)}`} / $${safety.bounds.rolling24HourModelUsd.toFixed(2)}`,
      `- aggregate: requests ${safety.cycle.requests}/${safety.bounds.maxProviderRequestsPerCycle}; payload bytes ${safety.cycle.payloadBytes}/${safety.bounds.maxPayloadBytesPerCycle}; ` +
        `dispatches ${safety.cycle.dispatches}/${safety.bounds.maxDispatchesPerCycle}; wall ${safety.cycle.elapsedMs}/${safety.bounds.maxWallMsPerCycle}ms`,
      `- stopped because: ${safety.stoppedBecause.join("; ") || "no ceiling or circuit stopped work"}`,
      `- provider circuits: ${safety.providerCircuits.map(c => `${c.provider} until ${c.eligibleAt}: ${c.condition}`).join("; ") || "none"}`,
      `- last successful Fleet activity: ${safety.lastSuccessfulActivity ?? "none recorded"}`,
    );
  }
  out.push(
    `- deterministic lane: ${lanes?.deterministic?.dispatched ?? 0} dispatched of ${lanes?.deterministic?.due ?? 0} due`,
    `- Scout lane: ${lanes?.model?.dispatched ?? 0} dispatched of ${lanes?.model?.due ?? 0} due model-class` +
      ` · deferred ${lanes?.model?.deferred ?? 0}` +
      (lanes?.model?.deferredBy && Object.keys(lanes.model.deferredBy).length > 0
        ? ` (${Object.entries(lanes.model.deferredBy).map(([k, v]) => `${k} ${v}`).join(", ")})`
        : ""),
  );
  out.push("", "## RESEARCH — LEVEL 1 (RULING 240)", "");
  out.push(
    `- lane: ${state?.modelLaneEnabled ? "ENABLED" : `CLOSED — ${state?.modelLaneDisabledReason ?? "reason unrecorded"}`}`,
    `- credential: ${state?.workerCredential?.name ?? "WTP_WORKERS_ANTHROPIC_API_KEY"} configured in the cycle process: ${state?.workerCredential?.configured ? "yes" : "NO"} (by name)`,
    `- model: ${state?.model ?? "unrecorded"} · concurrency ${state?.bounds?.maxConcurrentScouts ?? "?"} · per cycle ${state?.bounds?.maxScoutDispatchesPerCycle ?? "?"}`,
    `- spend: ${state?.spend?.windowUsd === null || state?.spend?.windowUsd === undefined ? "UNMEASURED" : `$${state.spend.windowUsd.toFixed(4)}`} of $${state?.bounds?.dailyCeilingUsd ?? "?"} rolling ceiling` +
      ` (measured ${state?.spend?.measuredAttempts ?? 0}, unmeasured ${state?.spend?.unmeasuredAttempts ?? 0})`,
  );
  for (const r of research.results ?? []) {
    out.push(
      `  - ${r.refused ? "REFUSED" : r.outcome} (${r.stoppedBy}) — \`${r.obligationId}\` — ${r.rungs} rung(s), ` +
        `${r.distinctEvidenceRungs} evidence-backed, ${r.candidates} candidate(s), ` +
        `${r.usd === null ? "usd UNMEASURED" : `$${r.usd.toFixed(4)}`}, ${Math.round(r.elapsedMs / 1000)}s`,
    );
  }
  if ((state?.runtimeConditions ?? []).length > 0) {
    out.push(`- runtime conditions: ${(state?.runtimeConditions ?? []).join("; ")}`);
  }
  out.push("- PROMOTION: OFF. A Scout finding is inventory and a candidate; nothing it produced changed what a reader is told.");
  /* The metrics travel on the research state the cycle wrote; a record without them says so rather than printing zeros. */
  out.push("", "## RESEARCH METRICS (RULING 244 · reader-impact ordering)", "");
  if (state?.metrics) {
    for (const line of researchDigestLines(state.metrics)) out.push(`- ${line.trim()}`);
  } else {
    out.push("- not yet computed by a cycle: this record's research state carries no metrics (a cycle on code before Work Item 5, or a cycle that did not reach the metrics step)");
  }
  return out;
}

/* ------------------------------------------------------------- the digest --- */

function buildDigest(record: RunRecord, cycle: number, at: string, ok: boolean): string {
  const out: string[] = [];
  const health = record.health;
  out.push(`# Pilot digest — cycle ${cycle}, ${at}`);
  out.push("");
  out.push(
    `Written by \`pnpm pilot:run\` on the \`${record.provider ?? "unknown"}\` control plane. ` +
      "Promotion is OFF: nothing here changed what a reader is told.",
  );
  out.push("");

  /* RULING 217: health first, activity under. A digest that leads with counts
     reads as health and measures effort. */
  out.push("## PILOT HEALTH");
  out.push("");
  if (health?.readings) {
    for (const r of health.readings) {
      out.push(`- **${r.contract} — ${r.state}**`);
      out.push(`  - ${r.reason}`);
    }
    out.push(`- **ROLLUP — ${health.green ? "GREEN" : "NOT GREEN"}**`);
  } else {
    out.push("- the cycle produced no health rollup. That is a defect in the run and not a green.");
  }
  out.push("");

  out.push(...costSection(record).lines);
  out.push("");
  out.push(...laneShare(record));
  out.push("");

  out.push("## WHAT ADVANCED, UNATTENDED");
  out.push("");
  const registry = record.registry;
  out.push(
    `- ${registry?.registeredUnits ?? 0} scheduled unit(s) registered across ` +
      `${registry?.providers?.length ?? 0} provider(s); ${registry?.nonMeetingUnits ?? 0} are NOT meetings`,
  );
  for (const p of registry?.providers ?? []) {
    out.push(
      `  - \`${p.providerId}\` — ${p.records} record(s) -> ${p.units} route unit(s)` +
        (p.readFailure ? ` — **READ FAILURE:** ${p.readFailure}` : "") +
        (p.units === 0 && p.emptyReason ? ` — ${p.emptyReason}` : ""),
    );
  }
  out.push(
    `- ${floorLine(
      floored(
        "obligations DUE this cycle",
        "the whole registry",
        registry?.registeredUnits ?? 0,
        record.dueCount ?? 0,
        (registry?.registeredUnits ?? 0) === 0
          ? "the registry produced no units, which is a defect and not an idle night"
          : undefined,
      ),
    )}`,
  );
  out.push(
    `- ${floorLine(
      floored(
        "DISCHARGED",
        "what was dispatched",
        record.dispatched ?? 0,
        (record.worked ?? []).length,
        (record.dispatched ?? 0) === 0 ? "nothing was dispatched this cycle" : undefined,
      ),
    )}`,
  );
  for (const d of record.dispositions ?? []) {
    out.push(`  - \`${d.disposition}\` — ${d.obligationId} (${d.artifacts} artifact(s))`);
  }
  out.push("");

  out.push("## STAGED, PROMOTION-READY (RULING 224)");
  out.push("");
  const staged = record.staged ?? [];
  const ready = staged.filter((s) => s.state === "STAGED_PROMOTION_READY");
  const gaps = staged.filter((s) => s.state === "STAGED_GAP");
  out.push(
    `${staged.length} entry(ies) staged — ${ready.length} promotion-ready, ${gaps.length} honest gap(s). ` +
      "The last mile is a session's, under existing law.",
  );
  out.push("");
  for (const s of ready) {
    out.push(
      `- **READY** \`${s.obligationId}\` — ${s.rowCount} of ${s.declaredTotal ?? "an undeclared total"}` +
        `${s.complete ? " (RESPONSE WHOLE — not the whole index)" : " (PARTIAL — the rest is still owed)"} at \`${s.snapshotPath}\``,
    );
  }
  for (const s of gaps) {
    out.push(`- **GAP** \`${s.obligationId}\` — ${s.readerSentence}`);
  }
  out.push("");

  out.push("## DEBT AND WALLS");
  out.push("");
  out.push(`${record.debts ?? 0} debt row(s) across ${(record.incidents ?? []).length} incident(s).`);
  for (const i of record.incidents ?? []) {
    out.push(
      `- \`${i.cause}\` at ${i.target} — ${i.obligationsAffected} obligation(s), next retry ${i.nextRetryAt}`,
    );
  }
  out.push("");
  out.push(
    `Promotion to reader truth: **${record.promotedToReaderTruth === false ? "none" : "UNSTATED — investigate"}**. ` +
      `Cycle process exit: ${ok ? "clean" : "NON-ZERO — the cycle did not finish and this digest describes a partial run"}.`,
  );
  out.push("");
  return `${out.join("\n")}\n`;
}

/* ---------------------------------------------------------------- delivery --- */

function deliver(body: string, headline: string): { readonly where: string; readonly mirrored: boolean } {
  const target = existsSync(MIRROR) ? MIRROR : FALLBACK;
  const mirrored = target === MIRROR;
  if (!mirrored) mkdirSync(FALLBACK, { recursive: true });
  const path = join(target, "pilot-digest.md");
  writeFileSync(path, body, "utf8");
  appendFileSync(join(target, "pilot-digest-log.md"), `${headline}\n`, "utf8");
  return { where: path, mirrored };
}

/* -------------------------------------------------------- console publish --- */

/**
 * **THE ADMIN CONSOLE IS PUBLISHED BY THE MACHINE, EVERY CYCLE.** (ADM-1,
 * 9.4.26 admin feedback, 2026-09-04.)
 *
 * The deployed admin pages read a PUBLISHED control-plane record, never this
 * host's files — and until now nothing scheduled `pnpm owner:publish` or
 * `pnpm readiness:publish`. They ran when a person ran them, so the console
 * went stale the moment a person stopped: the readiness panel read
 * REQUIRES_REPUBLISH for a day while the runner cycled underneath it, doing
 * work the console could not show. The standing runner is the one process
 * that is always here, so it publishes after every cycle's digest, succeeded
 * or failed — a failed cycle is exactly the reading the console must carry.
 *
 * Each publisher is its own child process under its own five-minute ceiling.
 * A failure is PRINTED with its exit and last stderr line, never thrown and
 * never silent, and never stops the loop: a console one cycle stale is a
 * defect the next cycle repairs; a runner that stopped cycling because the
 * console could not publish would be two defects.
 *
 * The file provider is a local proof with no deployed console to publish to;
 * it says so rather than publishing a proof run over production.
 */
const PUBLISH_TIMEOUT_MS = 5 * 60_000;
const ROUTINE_DATA_TIMEOUT_MS = 35 * 60_000;
const CONSOLE_PUBLISHERS: readonly { readonly name: string; readonly args: readonly string[] }[] = [
  /*
   * ADM-16 (9.4.26 evening): the owner's recorded decisions are applied to the
   * tracker BEFORE the snapshot is republished, so the cards he answered leave
   * the queue on the same cycle. `scripts/apply-owner-decisions.mts` runs the
   * pull → move --only=dashboard → canonicalize legs and is idempotent.
   */
  { name: "decision sync", args: ["scripts/apply-owner-decisions.mts"] },
  { name: "owner snapshot", args: ["scripts/publish-owner-snapshot.mts"] },
  { name: "readiness", args: ["scripts/readiness-refresh.mts", "--target=control-plane"] },
];

function publishConsole(): void {
  if (provider !== "postgres") {
    console.log("  console publish: skipped — the file provider is a local proof with no deployed console to publish to");
    return;
  }
  for (const publisher of CONSOLE_PUBLISHERS) {
    const started = Date.now();
    const run = spawnSync(
      process.execPath,
      ["--env-file=.env.local", "--experimental-strip-types", ...publisher.args],
      { cwd: ROOT, encoding: "utf8", timeout: PUBLISH_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 },
    );
    const seconds = Math.round((Date.now() - started) / 1000);
    if (run.status === 0) {
      console.log(`  console publish: ${publisher.name} OK (${seconds}s)`);
      continue;
    }
    const stderrLines = (run.stderr ?? "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
    const last = stderrLines.at(-1) ?? (run.error ? run.error.message : "(nothing on stderr)");
    const exit = run.status === null ? `signal ${run.signal ?? "none"}` : String(run.status);
    console.error(`  console publish: ${publisher.name} FAILED exit ${exit} — ${last}`);
  }
}

/** The same standing clock runs the production data plane after each cycle. */
function runRoutineCivicData(): void {
  if (provider !== "postgres" || canary) {
    console.log("  routine civic data: skipped — only the standing production runner owns this data plane");
    return;
  }
  const run = spawnSync(
    process.execPath,
    ["--env-file=.env.local", "--experimental-strip-types", "scripts/routine-civic-data-runner.mts"],
    { cwd: ROOT, encoding: "utf8", timeout: ROUTINE_DATA_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n").filter((line) => /^(RCD_|RCD_RECEIPT=)/.test(line));
  for (const line of lines) console.log(`  ${line}`);
  if (run.status !== 0) {
    console.error(`  routine civic data: one or more sources held LKG (exit ${run.status ?? `signal ${run.signal ?? "none"}`})`);
  }
}

/* -------------------------------------------------------------- the loop --- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * **THE OWNER'S STANDING INTENTS ARE READ BETWEEN CYCLES.** (Level 1
 * activation, 2026-09-01. PAUSE_RUNNER / RESUME_RUNNER and DISPATCH added for
 * the 9.4.26 admin feedback, ADM-5 and ADM-8, 2026-09-04.)
 *
 * The interval sleep is taken in one-minute slices. Each minute the research
 * intent log is read ONCE and asked three things, in this order:
 *
 * ```
 *   HOLD       a PAUSE_RUNNER stands (no later RESUME_RUNNER). No cycle
 *              starts. The first time it is seen the runner prints the owner's
 *              reason and appends its own HONORED record beside the pause; every
 *              thirty minutes it re-writes the heartbeat with `pause` set, so
 *              the dashboard reads "alive, deliberately idle" rather than a red
 *              SILENT that cannot be told from a crash. The owner disabled the
 *              scheduled task on purpose once and the page called it a failure
 *              for a day; that is the defect this closes.
 *   START_NOW  a RESUME_RUNNER with no HONORED record (the pause is over, or
 *              `pnpm pilot:start` just wrote one), a pending RUN_CYCLE_NOW, or
 *              a pending DISPATCH. The sleep ends and the next cycle starts at
 *              once. RUN_CYCLE_NOW and DISPATCH are honored by the cycle that
 *              runs; RESUME_RUNNER is honored HERE, by the runner, because a
 *              resume is about the runner and not about any cycle.
 *   NOTHING    the ordinary interval stands.
 * ```
 *
 * A store that cannot be read keeps the ordinary behaviour — an intent nobody
 * can read is not an intent nobody sent, so the failure is printed, once. The
 * file provider is a local proof and carries no owner intents.
 *
 * The nightly window (RULING 242) keeps its own clock through a pause: a pause
 * holds CYCLES; the reader-truth door runs in shadow and catches up on its own.
 */
const POLL_MS = 60_000;
const PAUSE_BEAT_MS = 30 * 60_000;
let intentRepos: ControlPlaneRepositories | null = null;
let intentReadFailed = false;
let pauseBeatFailed = false;
/** The PAUSE_RUNNER intent whose reason was printed; null while not paused. */
let announcedPause: string | null = null;
let lastPauseBeatMs = 0;
/** Intent ids this process already acted on, so a failed HONORED append is retried but never re-triggers a cycle. */
const actedOn = new Set<string>();
const honorFailurePrinted = new Set<string>();

async function ownerRepositories(): Promise<ControlPlaneRepositories | null> {
  if (provider !== "postgres") return null;
  if (intentRepos === null) {
    const url = controlPlaneUrlFromEnv();
    if (url === null) return null;
    intentRepos = await createPgRepositories(url, new Date().toISOString());
  }
  return intentRepos;
}

/** The latest RESUME_RUNNER with no HONORED record beside it, or null. */
function unhonoredResume(log: readonly ResearchIntent[]): ResearchIntentRequest | null {
  const honored = new Set(log.filter((r) => r.kind === "HONORED").map((r) => r.honors));
  const resumes = log
    .filter((r): r is ResearchIntentRequest => r.kind === "INTENT" && r.action === "RESUME_RUNNER")
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0));
  const latest = resumes.at(-1) ?? null;
  return latest !== null && !honored.has(latest.intentId) ? latest : null;
}

/**
 * The runner's own HONORED record beside an owner intent — the same shape the
 * cycle writes for RUN_CYCLE_NOW. Never edits the intent. A failed append is
 * printed once per intent and retried at the next poll.
 */
async function honorRunnerIntent(
  repos: ControlPlaneRepositories,
  intent: ResearchIntentRequest,
  detail: string,
): Promise<boolean> {
  const id = `${intent.intentId}:honored`;
  const at = new Date().toISOString();
  try {
    await repos.researchIntents.append(
      RESEARCH_INTENT_LOG_KEY,
      id,
      {
        formatVersion: RESEARCH_FORMAT_VERSION,
        kind: "HONORED",
        intentId: id,
        honors: intent.intentId,
        action: intent.action,
        honoredAt: at,
        honoredBy: `pilot-runner@${hostname()}#${process.pid}`,
        detail,
      },
      at,
    );
    return true;
  } catch (error) {
    if (!honorFailurePrinted.has(intent.intentId)) {
      honorFailurePrinted.add(intent.intentId);
      console.error(
        `  intent ${intent.intentId} (${intent.action}) could not be marked honored ` +
          `(${error instanceof Error ? error.message : String(error)}); retried at the next poll. This is printed once.`,
      );
    }
    return false;
  }
}

/**
 * Keep the heartbeat alive while idling on the owner's pause (ADM-5): the SAME
 * fields as the last beat — or a minimal one naming this host and SHA when no
 * beat exists — with `beatAt` now and `pause` naming the intent. `put` is
 * create-only, so an existing beat is moved by `compareAndSet` against the
 * revision just read.
 */
async function beatWhilePaused(repos: ControlPlaneRepositories, intent: ResearchIntentRequest): Promise<void> {
  const now = new Date().toISOString();
  const current = await repos.runnerHeartbeat.read(RUNNER_ID);
  const base: RunnerHeartbeat = current?.value ?? {
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    beatAt: now,
    lastCycleStartedAt: null,
    lastCycleFinishedAt: null,
    nextCycleDueAt: null,
    lastCycleOk: null,
    testedSha: headSha(ROOT),
    host: hostname(),
    /* PRDY-1: a paused runner still says which code it holds; no fetch while idling. */
    codeIdentity: readCodeIdentity({ cwd: ROOT, runnerTestedSha: headSha(ROOT), now, fetch: false }),
  };
  const next: RunnerHeartbeat = {
    ...base,
    beatAt: now,
    pause: { intentId: intent.intentId, since: intent.requestedAt, note: intent.note },
  };
  if (current === null) await repos.runnerHeartbeat.put(RUNNER_ID, next, now);
  else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, current.revision, next, now);
}

type OwnerSays = "HOLD" | "START_NOW" | "NOTHING";

/** ONE read of the intent log; every check above is answered from it. */
async function ownerSays(): Promise<OwnerSays> {
  let repos: ControlPlaneRepositories | null;
  let log: readonly ResearchIntent[];
  try {
    repos = await ownerRepositories();
    if (repos === null) return "NOTHING";
    log = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
  } catch (error) {
    if (!intentReadFailed) {
      intentReadFailed = true;
      console.error(
        `  research intents could not be read while waiting (${error instanceof Error ? error.message : String(error)}); ` +
          "the ordinary interval stands. This is printed once.",
      );
    }
    return "NOTHING";
  }
  const reading = readIntents(log);
  const pause = reading.runnerPause;

  if (pause.paused && pause.intent !== null) {
    if (announcedPause !== pause.intent.intentId) {
      announcedPause = pause.intent.intentId;
      lastPauseBeatMs = 0;
      console.log(`  runner paused by owner since ${pause.intent.requestedAt}: ${pause.intent.note ?? "(no reason given)"}`);
    }
    if (pause.honored === null) {
      await honorRunnerIntent(repos, pause.intent, "idling on the owner's pause; no cycle starts until RESUME_RUNNER");
    }
    if (Date.now() - lastPauseBeatMs >= PAUSE_BEAT_MS) {
      try {
        await beatWhilePaused(repos, pause.intent);
        lastPauseBeatMs = Date.now();
      } catch (error) {
        if (!pauseBeatFailed) {
          pauseBeatFailed = true;
          console.error(
            `  the paused heartbeat could not be written (${error instanceof Error ? error.message : String(error)}); ` +
              "the dashboard may read this deliberate pause as SILENT. Retried at the next poll; this is printed once.",
          );
        }
      }
    }
    return "HOLD";
  }
  announcedPause = null;

  const resume = unhonoredResume(log);
  if (resume !== null) {
    const first = !actedOn.has(resume.intentId);
    actedOn.add(resume.intentId);
    await honorRunnerIntent(repos, resume, "resumed; next cycle starts now");
    if (first) {
      console.log(
        `  runner resumed by owner (${resume.requestedAt}${resume.note ? `: ${resume.note}` : ""}) — ` +
          `starting the next cycle now at ${new Date().toISOString()}`,
      );
      return "START_NOW";
    }
  }
  if (reading.pendingRunNow.length > 0) {
    console.log(`  a RUN_CYCLE_NOW intent is pending — starting the next cycle early at ${new Date().toISOString()}`);
    return "START_NOW";
  }
  if (reading.pendingDispatch.length > 0) {
    const first = reading.pendingDispatch[0];
    console.log(
      `  ${reading.pendingDispatch.length} DISPATCH intent(s) pending (oldest: "${first.note ?? ""}") — ` +
        `starting the next cycle early at ${new Date().toISOString()}`,
    );
    return "START_NOW";
  }
  return "NOTHING";
}
/* ===================== LANE E — THE NIGHTLY WINDOW (RULING 242) — begin =====================
 *
 * The window is scheduled INSIDE this runner, on the machine's own clock:
 * between cycles the one-minute poll asks whether the 04:00 America/New_York
 * window for the current local date has run, and runs it when it has not. A
 * runner that was down across 04:00 runs the missed window at its first poll,
 * and the window record names the catch-up. The backup wakeup (the Scheduled
 * Task from `pilot-task.ps1 -Action install-window`, and the GitHub workflow
 * behind it) only appends RUN_WINDOW_NOW; it is not this clock.
 *
 * Promotion stays OFF: the child runs with `--shadow` and nothing else.
 */
const WINDOW_INTENT_KEY = "nightly-window";
const WINDOW_TIMEOUT_MS = 45 * 60_000;
let windowCheckFailed = false;

async function windowDecision(): Promise<{ readonly run: boolean; readonly trigger: string; readonly reason: string }> {
  if (provider !== "postgres") return { run: false, trigger: "", reason: "file provider" };
  if (canary) return { run: false, trigger: "", reason: "live canary is scoped to its one named cycle" };
  const checkedAt = new Date().toISOString();
  if (scheduledBlackoutAt(checkedAt)) {
    return { run: false, trigger: "", reason: "SCHEDULED BLACKOUT — nightly work and wakeups are suppressed" };
  }
  try {
    if (intentRepos === null) {
      const url = controlPlaneUrlFromEnv();
      if (url === null) return { run: false, trigger: "", reason: "no control plane" };
      intentRepos = await createPgRepositories(url, new Date().toISOString());
    }
    const { windowDue, lastWindowLocalDate } = await import("../lib/control-plane/promotion/window.ts");
    const last = lastWindowLocalDate(await intentRepos.windowRuns.readAll());
    const due = windowDue({ nowIso: new Date().toISOString(), lastWindowLocalDate: last });
    if (due.due) return { run: true, trigger: due.trigger, reason: due.reason };
    const log = await intentRepos.windowIntents.read(WINDOW_INTENT_KEY);
    const honored = new Set(log.filter((r) => r.kind === "HONORED").map((r) => (r as { honors: string }).honors));
    const pending = log.filter((r) => r.kind === "INTENT" && !honored.has(r.intentId));
    if (pending.length > 0) return { run: true, trigger: "WAKEUP", reason: `${pending.length} RUN_WINDOW_NOW intent(s) pending` };
    return { run: false, trigger: "", reason: due.reason };
  } catch (error) {
    if (!windowCheckFailed) {
      windowCheckFailed = true;
      console.error(
        `  the nightly window's due-check could not read the control plane (${error instanceof Error ? error.message : String(error)}); ` +
          "the window is not run on a guess. This is printed once.",
      );
    }
    return { run: false, trigger: "", reason: "unreadable" };
  }
}

function runNightlyWindow(trigger: string): void {
  const startedAt = new Date().toISOString();
  if (scheduledBlackoutAt(startedAt)) {
    console.log("\npilot:run · SCHEDULED BLACKOUT — nightly window refused before process launch");
    return;
  }
  console.log(`\npilot:run · nightly window (${trigger}) started ${startedAt} — SHADOW`);
  const run = spawnSync(
    process.execPath,
    ["--env-file=.env.local", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "scripts/nightly-window.mts", "--shadow", trigger === "WAKEUP" ? "--force" : "", `--trigger=${trigger}`].filter((a) => a !== ""),
    { cwd: ROOT, encoding: "utf8", timeout: WINDOW_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n").filter((l) => l.trim() !== "");
  for (const l of lines.slice(-12)) console.log(`  ${l}`);
  console.log(`  nightly window exit ${run.status ?? `signal ${run.signal ?? "none"}`} (0 clean, 2 a stage FAILED and is recorded, 3 lock held)`);
}
/* ===================== LANE E — THE NIGHTLY WINDOW (RULING 242) — end ===================== */

async function sleepUnlessRunNow(totalMs: number): Promise<void> {
  const until = Date.now() + totalMs;
  while (Date.now() < until) {
    await sleep(Math.min(POLL_MS, until - Date.now()));
    /* One read: a pause holds, a resume / RUN_CYCLE_NOW / DISPATCH ends the sleep early. */
    if ((await ownerSays()) === "START_NOW") return;
    /* LANE E — the nightly window runs between cycles, on this clock. */
    const decision = await windowDecision();
    if (decision.run) runNightlyWindow(decision.trigger);
  }
}

/**
 * Before a cycle starts: while the owner's PAUSE_RUNNER stands, idle here —
 * polling once a minute, beating every thirty — and return the moment it is
 * lifted. Not paused, or unreadable: return at once and the cycle starts.
 *
 * The nightly window is held too. "I paused the runner" means the WHOLE
 * runner: the owner's stated reason on 9.4.26 was usage, and the shadow window
 * spends exactly as a cycle does. A window skipped while paused is caught up
 * by the next window decision after RESUME_RUNNER (it reads the last window
 * run, not this clock).
 */
async function holdWhilePaused(): Promise<void> {
  if (canary) return;
  while ((await ownerSays()) === "HOLD") {
    await sleep(POLL_MS);
  }
}

console.log(
  `pilot:run · control plane ${provider}, interval ${INTERVAL_MIN} min, ` +
    `${CYCLES === Infinity ? "running until stopped" : `${CYCLES} cycle(s)`}\n` +
    `  mirror: ${MIRROR}${existsSync(MIRROR) ? "" : " (NOT PRESENT — digests fall back to .mirror/ and say so)"}`,
);

/**
 * **THE CONSOLE IS PUBLISHED BEFORE THE FIRST CYCLE, NOT ONLY AFTER ONE.**
 * (9.6.26 owner feedback, ACLOSE-6.)
 *
 * ADM-1 put `publishConsole()` after every cycle's digest, which fixed a
 * console that went stale for a day. It left one window open, and the owner
 * walked straight into it: the readiness derivation contract was bumped to `@2`
 * and merged at 08:32Z, this host's working tree fast-forwarded onto that code
 * at 08:53Z, and the newest published readiness record was the one the PREVIOUS
 * cycle wrote at 08:25Z under `@1`. Every state therefore read
 * "REQUIRES REPUBLISH" — correctly, and for up to a whole cycle, because the
 * only thing that would republish was the END of a cycle that had just started.
 *
 * Publishing once at startup and then after every cycle bounds that window by
 * the gap between cycles rather than by the length of one. It costs a single
 * pass of three cheap child processes, it is idempotent (each publisher is a
 * read-derive-compare-and-set), and it means a runner that has just been
 * restarted onto new code says so on the console immediately instead of
 * fifteen minutes into its first cycle.
 *
 * The copy on the panel is the other half of this and lives with the panel: a
 * state in this window now reads as "the system is rebuilding this summary
 * automatically", not as a shell command the owner is expected to run.
 */
console.log("\npilot:run · publishing the console before the first cycle (the runner may have just come up on new code)");
publishConsole();

let cycle = 0;
while (cycle < CYCLES) {
  /* ADM-5: the owner's PAUSE_RUNNER holds the next cycle until RESUME_RUNNER. */
  await holdWhilePaused();
  cycle += 1;
  const startedAt = new Date().toISOString();
  console.log(`\npilot:run · cycle ${cycle} started ${startedAt}`);

  const result = runOneCycle();
  if (result.circuit) {
    const c = result.circuit;
    const headline = `${new Date().toISOString()} - cycle ${cycle} - CIRCUIT BROKEN - ${c.provider} latched until ${c.eligibleAt}`;
    const digest =
      `# Pilot digest — cycle ${cycle}, ${today()}\n\n` +
      `## FLEET SAFETY\n\n- **CIRCUIT BROKEN**\n- provider: ${c.provider}\n- exact condition: ${c.condition}\n` +
      `- first observed: ${c.firstObservedAt}\n- work deferred: ${c.workDeferred.join("; ")}\n` +
      `- next automated eligibility: ${c.eligibleAt}\n- no provider probe, paid substitution, control-plane test write, or promotion was attempted\n`;
    const delivered = deliver(digest, headline);
    console.error(`  ${headline}`);
    console.log(`  digest: ${delivered.where}${delivered.mirrored ? "" : "  (MIRROR NOT REACHABLE — repo fallback)"}`);
    if (cycle >= CYCLES) break;
    // The latched provider is not polled through owner/window bookkeeping.
    await sleep(INTERVAL_MIN * 60_000);
    continue;
  }
  let record: RunRecord = {};
  if (result.recordPath !== null && existsSync(result.recordPath)) {
    try {
      record = JSON.parse(readFileSync(result.recordPath, "utf8")) as RunRecord;
    } catch (error) {
      console.error(
        `  the run record at ${result.recordPath} could not be parsed (${
          error instanceof Error ? error.message : String(error)
        }). The digest will say the cycle produced no readable record rather than reporting zeros.`,
      );
    }
  } else {
    console.error(
      "  this cycle produced NO run record. That is a failed cycle, and the digest says so — it is " +
        "not a cycle with nothing to report.",
    );
  }

  /*
   * THE HEADLINE CARRIES ITS DENOMINATORS (RULING 159). "4 discharged" is the
   * shape that reads as health; "4 of 7 dispatched" is the shape that can be
   * argued with, and a cycle that dispatched nothing says COULD NOT ASSERT
   * rather than printing a measured-looking zero.
   */
  const stagedRows = record.staged ?? [];
  const discharge = floored(
    "obligations DISCHARGED",
    "what this cycle dispatched",
    record.dispatched ?? 0,
    (record.worked ?? []).length,
    (record.dispatched ?? 0) === 0
      ? "this cycle dispatched nothing, so there is no population to measure a discharge rate over"
      : undefined,
  );
  const readiness = floored(
    "staged entries PROMOTION-READY",
    "this cycle's promotion tail",
    stagedRows.length,
    stagedRows.filter((s) => s.state === "STAGED_PROMOTION_READY").length,
    stagedRows.length === 0 ? "this cycle staged nothing" : undefined,
  );

  /*
   * A cycle that ran out of dispatch budget dispatched little or nothing ON
   * PURPOSE. Read from the record's own digest line (one derivation, three
   * surfaces) so the headline says "budget spent" rather than letting a
   * deliberate deferral read as an idle night.
   */
  const budgetLine = (record.digest ?? []).find((l) => l.includes("dispatch budget"));
  const budgetSpent = budgetLine !== undefined && /SPENT/.test(budgetLine);
  const headline =
    `${new Date().toISOString()} - cycle ${cycle} - ` +
    `${floorLine(discharge)} - ${floorLine(readiness)} - ` +
    `health ${record.health?.green ? "GREEN" : "NOT GREEN"} - ` +
    (budgetSpent ? "dispatch budget SPENT, rest deferred by name - " : "") +
    `exit ${result.ok ? "clean" : "NON-ZERO"}`;

  /*
   * A FAILED CYCLE CARRIES ITS OWN DIAGNOSIS. Before this the child's stderr
   * was discarded, so seven hours of NON-ZERO cycles left nothing to read but
   * "0 providers". The last stderr lines and the kill signal (the supervisor's
   * ceiling, when it fired) travel into the digest and onto the console.
   */
  let failureSection = "";
  if (!result.ok) {
    failureSection =
      "\n## WHY THE CYCLE DID NOT FINISH\n\n" +
      `- process signal: ${result.signal ?? "none (the child exited non-zero on its own)"}\n` +
      "- last stderr lines from the cycle:\n\n```\n" +
      (result.stderrTail || "(the child wrote nothing to stderr)") +
      "\n```\n";
    console.error(
      `  the cycle exited NON-ZERO${result.signal ? ` (signal ${result.signal})` : ""}; last stderr:\n` +
        (result.stderrTail || "    (nothing on stderr)")
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n"),
    );
  }

  const delivered = deliver(buildDigest(record, cycle, today(), result.ok) + failureSection, headline);
  console.log(`  digest: ${delivered.where}${delivered.mirrored ? "" : "  (MIRROR NOT REACHABLE — repo fallback)"}`);
  console.log(`  ${headline}`);

  /* ADM-1: the console is published by the machine after every digest, succeeded or failed. */
  publishConsole();

  /* RCD-7: data-plane promotion has its own cadence and creates no software release. */
  runRoutineCivicData();

  if (cycle >= CYCLES) break;
  await sleepUnlessRunNow(INTERVAL_MIN * 60_000);
}

console.log(`\npilot:run · ${cycle} cycle(s) complete. Run records under ${RUNS_DIR}.`);
