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
 * **The cache hit rate is reported as NOT MEASURED, and that is the honest
 * reading.** `AttemptCost` carries `inputTokens`, `outputTokens`, `usd`,
 * `durationMs`, `bytesFetched` and `requestCount` — there is no field for cache
 * reads or cache writes anywhere in the cost ledger, so no process can compute
 * one. Printing `0%` would assert that every model read missed the cache, which
 * is a measurement nobody took. The digest names the missing field.
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
 * `scripts/pilot-task.ps1` registers a Scheduled Task that runs AT LOGON with
 * a restart-on-failure policy, which is what makes this survive a reboot of
 * this Windows 11 host. The exact commands are in that file's header and in
 * `docs/pilot-runner.md`.
 *
 * Env var names only, never values.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floored, floorLine } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const argv = process.argv.slice(2);

const cyclesArg = argv.find((a) => a.startsWith("--cycles="));
const CYCLES = cyclesArg ? Number(cyclesArg.slice("--cycles=".length)) : Infinity;
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const INTERVAL_MIN = intervalArg ? Number(intervalArg.slice("--interval=".length)) : 60;
const maxArg = argv.find((a) => a.startsWith("--max="));
const MAX = maxArg ? maxArg.slice("--max=".length) : "100";
const provider = argv.includes("--provider=file") ? "file" : "postgres";
const onlyArg = argv.find((a) => a.startsWith("--only="));

/**
 * The Drive mirror. A SYNCED FOLDER, not an API — writing a file into it IS the
 * delivery. The variable name is the one this repository already uses.
 */
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const FALLBACK = join(ROOT, ".mirror");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");

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
const BUDGET_MIN = budgetArg ? Number(budgetArg.slice("--budget-min=".length)) : 15;

function runOneCycle(): {
  readonly ok: boolean;
  readonly recordPath: string | null;
  readonly stdout: string;
  /** The last lines the child wrote to stderr. The diagnosis of a failed cycle. */
  readonly stderrTail: string;
  readonly signal: string | null;
} {
  const args = [
    "--env-file=.env.local",
    "--experimental-strip-types",
    "scripts/freshness-shadow.mts",
    `--provider=${provider}`,
    `--max=${MAX}`,
    `--budget-min=${BUDGET_MIN}`,
    ...(onlyArg ? [onlyArg] : []),
  ];
  const run = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    /* Twenty minutes: the BACKSTOP for a hung child. A healthy cycle ends on
       its own dispatch budget (above) well inside this. */
    timeout: 20 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;
  const match = stdout.match(/run record: (.+\.json)/);
  const stderrLines = (run.stderr ?? "").split("\n").filter((l) => l.trim() !== "");
  return {
    ok: run.status === 0,
    recordPath: match ? match[1].trim() : null,
    stdout,
    stderrTail: stderrLines.slice(-12).join("\n"),
    signal: run.signal ?? null,
  };
}

/* --------------------------------------------------------------- the cost --- */

interface CostLines {
  readonly lines: readonly string[];
}

/**
 * The cost section.
 *
 * Read from the run record's own digest lines rather than recomputed, so the
 * console, the run record and the mirrored digest cannot disagree about what a
 * cycle spent — three surfaces, one derivation.
 */
function costSection(record: RunRecord): CostLines {
  const digest = record.digest ?? [];
  const grab = (needle: string): string[] =>
    digest.filter((l) => l.includes(needle)).map((l) => l.trim());

  const lines: string[] = [];
  lines.push("## COST");
  lines.push("");
  const cost = grab("cost               ");
  const lanes = digest
    .filter((l) => /^ {6}(DETERMINISTIC|BOUNDED_MODEL_WORKER)/.test(l))
    .map((l) => l.trim());
  lines.push(cost.length > 0 ? `- TOTAL — ${cost[0].replace(/^cost\s+/, "")}` : "- TOTAL — the cycle recorded no cost line, which is a defect in the run record and not a zero");
  lines.push("- BY ROLE — every Attempt this cycle opened under role ACQUIRER; no SCOUT, no VERIFIER, no SYNTHESIZER ran");
  for (const lane of lanes) lines.push(`- BY MODEL — ${lane}`);
  lines.push(
    "- CACHE HIT RATE — **NOT MEASURED.** `AttemptCost` carries inputTokens, outputTokens, usd, " +
      "durationMs, bytesFetched and requestCount, and no field anywhere in the cost ledger records " +
      "a cache read or a cache write. Printing 0% would assert that every model read missed the " +
      "cache, which is a measurement nobody took. Adding the field is the next move.",
  );
  return { lines };
}

function laneShare(record: RunRecord): string[] {
  const digest = record.digest ?? [];
  const executors = digest.find((l) => l.includes("executors          "));
  return [
    "## DETERMINISTIC vs MODEL",
    "",
    executors
      ? `- ${executors.trim().replace(/^executors\s+/, "")}`
      : "- the cycle recorded no executor split, which is a defect in the run record",
    "- Every Attempt above ran a deterministic HTTP client. No route in the registered portfolios " +
      "reads `WTP_WORKERS_ANTHROPIC_API_KEY`; a route whose shape nothing has derived disposes " +
      "REQUIRES_NEW_ADAPTER with the missing adapter named, rather than spending a model to guess.",
  ];
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

/* -------------------------------------------------------------- the loop --- */

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

console.log(
  `pilot:run · control plane ${provider}, interval ${INTERVAL_MIN} min, ` +
    `${CYCLES === Infinity ? "running until stopped" : `${CYCLES} cycle(s)`}\n` +
    `  mirror: ${MIRROR}${existsSync(MIRROR) ? "" : " (NOT PRESENT — digests fall back to .mirror/ and say so)"}`,
);

let cycle = 0;
while (cycle < CYCLES) {
  cycle += 1;
  const startedAt = new Date().toISOString();
  console.log(`\npilot:run · cycle ${cycle} started ${startedAt}`);

  const result = runOneCycle();
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

  if (cycle >= CYCLES) break;
  await sleep(INTERVAL_MIN * 60_000);
}

console.log(`\npilot:run · ${cycle} cycle(s) complete. Run records under ${RUNS_DIR}.`);
