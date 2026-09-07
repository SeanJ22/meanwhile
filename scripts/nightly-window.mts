/**
 * `pnpm window:run` — THE SINGLE NIGHTLY PROMOTION DOOR, run in SHADOW.
 * (RULING 242.)
 *
 *   pnpm window:run --shadow                  run the window now, in shadow
 *   pnpm window:run --shadow --force          run even if today's window ran
 *   pnpm window:run --wakeup                  the BACKUP WAKEUP: nudge a live
 *                                             runner with RUN_WINDOW_NOW, or
 *                                             run the window itself if the
 *                                             runner is dead
 *   --provider=file      the file store instead of Postgres
 *   --skip-legacy        stage 1 SKIPPED by name (a diagnostic)
 *   --skip-verify        stage 3 SKIPPED by name (a diagnostic)
 *   --trigger=<T>        RUNNER_CLOCK | CATCH_UP | WAKEUP | MANUAL; the
 *                        runner passes what its clock decided
 *
 * INVARIANTS
 *   promotion is OFF: `ACTIVATION_GATE.promotionEnabled` is a literal false,
 *   the promoter handed to the promotion step throws, and this script has no
 *   writer for any reader-content path
 *   the legacy refresh runs in an ISOLATED worktree under .window/checkout
 *   and nothing is committed or pushed; the main checkout is never dirtied
 *   every stage failure opens an incident and the window record names it
 *   one window at a time, host-global, through the CAS lease
 *
 * Env var names only, never values.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { livenessOf } from "../lib/control-plane/owner-surface.ts";
import { ACTIVATION_GATE, readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { parseRefreshRunJson, parseRefreshRunMarkdown } from "../lib/control-plane/promotion/legacy-refresh.ts";
import { mapEvidenceIntoPipeline, mappingLines } from "../lib/control-plane/promotion/mapping.ts";
import { collectFactChains } from "../lib/control-plane/promotion/fact-chain.ts";
import { factAgreementIn } from "../lib/control-plane/promotion/meeting-facts.ts";
import { liveAuthority, promoteFacts, receiptSummary, verifyMaterialization, type PromotionReceipt } from "../lib/control-plane/promotion/promoter.ts";
import { standingFleetRuntime } from "../lib/control-plane/workers/standing.ts";
import {
  WINDOW_LEASE_TTL_MS,
  WINDOW_ZONE,
  WindowLockHeld,
  buildWindowDigest,
  decideRegression,
  evaluateItems,
  lastWindowLocalDate,
  openIncident,
  runPromotionStep,
  windowDue,
  windowHeadline,
  windowId as makeWindowId,
  withNightlyWindowLease,
} from "../lib/control-plane/promotion/window.ts";
import {
  WINDOW_FORMAT_VERSION,
  WINDOW_TRIGGERS,
  type ItemVerdict,
  type LegacyRefreshReading,
  type WindowIncident,
  type WindowIntent,
  type WindowRunRecord,
  type WindowStageRecord,
  type WindowTrigger,
} from "../lib/control-plane/promotion/types.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { today } from "./doc-dates.mjs";
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readCandidateStore, readMethodStore } from "../lib/method/candidate.ts";
import { METHOD_STORE } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { readConclusionStore } from "../lib/method/conclusions.ts";

const ROOT = process.cwd();
const HOST = hostname();
const NOW = new Date().toISOString();
const nowIso = (): string => new Date().toISOString();
const argv = process.argv.slice(2);

const shadow = argv.includes("--shadow");
const wakeup = argv.includes("--wakeup");
const force = argv.includes("--force");
const useFile = argv.includes("--provider=file");
const skipLegacy = argv.includes("--skip-legacy");
const skipVerify = argv.includes("--skip-verify");
const triggerArg = argv.find((a) => a.startsWith("--trigger="))?.slice("--trigger=".length) ?? null;

if (!shadow && !wakeup) {
  console.error("window:run · pass --shadow (run the window in shadow) or --wakeup (the backup wakeup). Nothing ran.");
  process.exit(1);
}
if (triggerArg !== null && !(WINDOW_TRIGGERS as readonly string[]).includes(triggerArg)) {
  console.error(`window:run · --trigger must be one of ${WINDOW_TRIGGERS.join(", ")}`);
  process.exit(1);
}

const WINDOW_INTENT_KEY = "nightly-window";
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const FALLBACK = join(ROOT, ".mirror");
const RUNS_DIR = join(ROOT, "data", "health", "nightly-window-runs");
const CHECKOUT = join(ROOT, ".window", "checkout");
const LEGACY_TIMEOUT_MS = 25 * 60_000;
const VERIFY_TIMEOUT_MS = 8 * 60_000;
const HOLDER = `nightly-window@${HOST}#${process.pid}`;

/* ------------------------------------------------------------- provider --- */

let repos: ControlPlaneRepositories;
if (useFile) {
  const root = join(ROOT, "data", "control-plane", "freshness-shadow");
  mkdirSync(root, { recursive: true });
  repos = await createFileRepositories(root);
} else {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(`window:run · ${CONTROL_PLANE_URL_VAR} is not set and --provider=file was not asked for. Nothing ran.`);
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
}
console.log(`window:run · ${repos.describe()}\n  mode SHADOW · zone ${WINDOW_ZONE} · host ${HOST} · holder ${HOLDER}`);

/* --------------------------------------------------------------- wakeup --- */

if (wakeup) {
  const beat = await repos.runnerHeartbeat.read(RUNNER_ID);
  const liveness = livenessOf(beat?.value ?? null, nowIso());
  if (liveness.state === "ALIVE") {
    const requestedAt = nowIso();
    const intent: WindowIntent = {
      formatVersion: WINDOW_FORMAT_VERSION,
      kind: "INTENT",
      intentId: `RUN_WINDOW_NOW:${requestedAt}`,
      action: "RUN_WINDOW_NOW",
      requestedAt,
      actor: `backup wakeup on ${HOST}`,
    };
    const out = await repos.windowIntents.append(WINDOW_INTENT_KEY, intent.intentId, intent, requestedAt);
    console.log(
      `  runner ${RUNNER_ID} is ${liveness.state} (${liveness.detail}); appended RUN_WINDOW_NOW ` +
        `${intent.intentId} (${out.appended ? "new" : "already held"}). The runner runs the window on its own clock; this process runs nothing.`,
    );
    process.exit(0);
  }
  console.log(`  runner ${RUNNER_ID} is ${liveness.state} (${liveness.detail}); the wakeup runs the window itself under the lease.`);
}

/* ---------------------------------------------------------------- due? --- */

const lastLocalDate = lastWindowLocalDate(await repos.windowRuns.readAll());
const due = windowDue({ nowIso: NOW, lastWindowLocalDate: lastLocalDate });
console.log(`  due: ${due.due ? "YES" : "no"} — ${due.reason}`);
if (!due.due && !force) {
  console.log("  nothing to run; pass --force to run the window for this local date again (recorded as MANUAL).");
  process.exit(0);
}
const trigger: WindowTrigger = (triggerArg as WindowTrigger | null) ?? (wakeup ? "WAKEUP" : force && !due.due ? "MANUAL" : due.trigger);
const windowId = makeWindowId(due.localDate, NOW, HOST);
console.log(`  window ${windowId} for ${due.localDate}, trigger ${trigger}, boundary ${due.boundary}${due.caughtUp.length > 0 ? `, catching up ${due.caughtUp.join(", ")}` : ""}`);

/* ------------------------------------------------------------- helpers --- */

type StageOutcome = WindowStageRecord["outcome"];

const stages: WindowStageRecord[] = [];
const incidents: WindowIncident[] = [];

function recordStage(stage: WindowStageRecord["stage"], startedAt: string, outcome: StageOutcome, reason: string | null): void {
  stages.push({ stage, outcome, startedAt, finishedAt: nowIso(), reason });
  console.log(`  ${stage} ${outcome}${reason ? ` — ${reason}` : ""}`);
}

function incident(stage: WindowIncident["stage"], code: string, detail: string, missedScope: readonly string[]): void {
  const i = openIncident({ windowId, stage, code, detail, openedAt: nowIso(), missedScope });
  incidents.push(i);
  console.error(`  INCIDENT ${i.incidentId} at ${stage}: ${code} — ${detail}`);
}

/*
 * PRDY-6 (2026-09-06): THE GOVERNED PROMOTER, WIRED AND UNREACHABLE.
 *
 * `runPromotionStep` calls `promote` only when the live gate is ON. It is OFF,
 * so the batch below stays empty, no fact is loaded from the vault, and this
 * function is never entered. When it is entered, the promoter accepts only
 * PROMOTE_WOULD items of an open record class, refuses a fact a later reading
 * of its source superseded, materializes through the Reader's own snapshot
 * writer into this checkout, keeps the before-state bytes beside its receipt,
 * runs the local half of the verification contract, and reverts on a failure.
 * Carrying that materialization to main stays with the existing allowlisted
 * door; this script still writes no history and moves no branch.
 */
const promotionReceipts: NonNullable<WindowRunRecord["promotionReceipts"]>[number][] = [];
async function promoteBatch(batch: readonly ItemVerdict[], gate: ReturnType<typeof readActivationGate>): Promise<PromotionReceipt> {
  const fleet = standingFleetRuntime({ root: ROOT, repos, now: nowIso });
  const collected = await collectFactChains(repos, { readArtifactText: async (id) => (await fleet.readEvidence(id)).text, now: nowIso(), root: ROOT });
  const facts = new Map(collected.items.map((item) => [item.itemId, item.fact]));
  const holds = new Map<string, string>();
  for (const item of collected.items) {
    if (item.newerSameSource === null) continue;
    const agreement = factAgreementIn(item.fact, item.newerSameSource);
    if (agreement.present && !agreement.sameFact) holds.set(item.itemId, `FACT_SUPERSEDED: ${agreement.detail}`);
  }
  return promoteFacts({ target: { kind: "READER", root: ROOT }, authority: liveAuthority(gate), verdicts: batch, facts, holds, now: nowIso(), windowId, verify: verifyMaterialization });
}

function git(args: readonly string[], cwd: string): { ok: boolean; out: string } {
  const r = spawnSync("git", [...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/** A pnpm-family command line. One string under a shell on Windows (a .cmd shim), argv elsewhere. */
function shellCommand(
  file: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; env?: NodeJS.ProcessEnv },
): ReturnType<typeof spawnSync> {
  const common = { cwd: options.cwd, encoding: "utf8" as const, timeout: options.timeout, maxBuffer: 64 * 1024 * 1024, env: options.env };
  return process.platform === "win32"
    ? spawnSync([file, ...args].join(" "), { ...common, shell: true })
    : spawnSync(file, [...args], common);
}

/* -------------------------------------------------------------- stage 1 --- */

function legacyRefreshInShadow(): { reading: LegacyRefreshReading | null; outcome: StageOutcome; reason: string | null; failedSources: string[] } {
  const fetched = git(["fetch", "origin", "main"], ROOT);
  if (!fetched.ok) return { reading: null, outcome: "FAILED", reason: `git fetch origin main failed: ${fetched.out.slice(0, 300)}`, failedSources: [] };

  mkdirSync(join(ROOT, ".window"), { recursive: true });
  if (!existsSync(join(CHECKOUT, ".git"))) {
    git(["worktree", "prune"], ROOT);
    const added = git(["worktree", "add", "--detach", CHECKOUT, "origin/main"], ROOT);
    if (!added.ok) return { reading: null, outcome: "FAILED", reason: `git worktree add failed: ${added.out.slice(0, 300)}`, failedSources: [] };
  } else {
    const reset = git(["checkout", "--detach", "origin/main"], CHECKOUT);
    if (!reset.ok) return { reading: null, outcome: "FAILED", reason: `checkout of origin/main in the window worktree failed: ${reset.out.slice(0, 300)}`, failedSources: [] };
    git(["reset", "--hard", "origin/main"], CHECKOUT);
    git(["clean", "-fd", "-e", "node_modules"], CHECKOUT);
  }
  if (!existsSync(join(CHECKOUT, "node_modules"))) {
    try {
      symlinkSync(join(ROOT, "node_modules"), join(CHECKOUT, "node_modules"), "junction");
    } catch (error) {
      return { reading: null, outcome: "FAILED", reason: `node_modules junction failed: ${error instanceof Error ? error.message : String(error)}`, failedSources: [] };
    }
  }
  const corepack = shellCommand("corepack", ["--version"], { cwd: ROOT });
  if (corepack.status !== 0) {
    return { reading: null, outcome: "FAILED", reason: "corepack is not on PATH; the legacy source commands run through `corepack pnpm` and cannot start", failedSources: [] };
  }

  console.log(`  $ corepack pnpm refresh:daily   (in ${CHECKOUT}, timeout ${LEGACY_TIMEOUT_MS / 60_000} min, nothing committed)`);
  const run = shellCommand("corepack", ["pnpm", "refresh:daily"], {
    cwd: CHECKOUT,
    timeout: LEGACY_TIMEOUT_MS,
    env: { ...process.env, WTP_RUN_ID: `nightly-window:${windowId}` },
  });
  const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.split("\n").filter((l) => l.trim() !== "").slice(-8).join("\n");
  const exit = run.status;

  let reading: LegacyRefreshReading | null = null;
  let readNote: string | null = null;
  const jsonPath = join(CHECKOUT, "docs", "refresh-run.json");
  const mdPath = join(CHECKOUT, "docs", "refresh-run.md");
  try {
    if (existsSync(jsonPath)) reading = parseRefreshRunJson(readFileSync(jsonPath, "utf8"));
    else if (existsSync(mdPath)) {
      reading = parseRefreshRunMarkdown(readFileSync(mdPath, "utf8"));
      readNote = "docs/refresh-run.json was ABSENT after the refresh (Lane A's contract not yet on origin/main); the Markdown table was parsed instead and outcomes are coarser";
    } else readNote = "neither docs/refresh-run.json nor docs/refresh-run.md existed after the refresh";
  } catch (error) {
    readNote = `the refresh report could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const changed = git(["status", "--porcelain", "--", "data/", "docs/refresh-run.md", "docs/refresh-run.json"], CHECKOUT).out
    .split("\n")
    .filter((l) => l.trim() !== "");
  console.log(`  ${changed.length} path(s) moved inside the isolated checkout; none committed:\n${changed.map((l) => `      ${l}`).join("\n") || "      (none)"}`);

  git(["reset", "--hard", "origin/main"], CHECKOUT);
  git(["clean", "-fd", "-e", "node_modules"], CHECKOUT);

  const failedSources = reading?.sources.filter((s) => s.ran && s.outcome === "ROUTE_UNREAD").map((s) => s.id) ?? [];
  if (run.signal !== null || exit === null) {
    return { reading, outcome: "FAILED", reason: `the legacy refresh did not finish (signal ${run.signal ?? "none"}, timeout ${LEGACY_TIMEOUT_MS / 60_000} min); last lines:\n${tail}`, failedSources: reading?.sources.filter((s) => s.due).map((s) => s.id) ?? [] };
  }
  if (exit !== 0) {
    return {
      reading,
      outcome: "FAILED",
      reason: `refresh:daily exited ${exit}${exit === 2 ? " (NH31 partial: some sources failed, the rest ran)" : ""}; failed source(s): ${failedSources.join(", ") || "not named by the report"}${readNote ? `; ${readNote}` : ""}; last lines:\n${tail}`,
      failedSources,
    };
  }
  if (reading === null) return { reading, outcome: "FAILED", reason: readNote ?? "no report was readable", failedSources: [] };
  return { reading, outcome: "COMPLETED", reason: readNote, failedSources };
}

/* -------------------------------------------------------------- stage 3 --- */

function verifyServedSurface(): { exitCode: number | null; verdict: string; detail: string; passed: boolean | null } {
  const r = shellCommand("pnpm", ["exec", "tsx", "scripts/staging-observer.mts", "--attempts=3"], {
    cwd: ROOT,
    timeout: VERIFY_TIMEOUT_MS,
    env: { ...process.env, WTP_RUN_ID: `nightly-window:${windowId}` },
  });
  const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.split("\n").filter((l) => l.trim() !== "").slice(-6).join(" | ");
  const exit = r.status;
  const verdict =
    exit === 0 ? "HELD" : exit === 1 ? "REFUSED" : exit === 2 ? "COULD_NOT_TELL" : exit === 3 ? "STAGING_BEHIND" : `EXIT_${exit ?? "NONE"}`;
  const passed = exit === 0 ? true : exit === 2 || exit === null ? null : false;
  return { exitCode: exit, verdict, detail: `staging observer (scripts/staging-observer.mts, no --write) against the named staging origin: ${tail || "(no output)"}`, passed };
}

/* ---------------------------------------------------------------- deliver --- */

function deliver(body: string, headline: string): { where: string; mirrored: boolean } {
  const target = existsSync(MIRROR) ? MIRROR : FALLBACK;
  const mirrored = target === MIRROR;
  if (!mirrored) mkdirSync(FALLBACK, { recursive: true });
  const path = join(target, "nightly-window-digest.md");
  writeFileSync(path, body, "utf8");
  appendFileSync(join(target, "nightly-window-log.md"), `${headline}\n`, "utf8");
  return { where: path, mirrored };
}

/* ------------------------------------------------------------- the window --- */

let exitCode = 0;
try {
  await withNightlyWindowLease(
    repos,
    HOLDER,
    nowIso,
    async (lock) => {
      const startedAt = nowIso();
      console.log(`  lease ${lock.leaseId} held until ${lock.expiresAt}`);

      /* Stage 1 — LEGACY REFRESH IN SHADOW. */
      const s1 = nowIso();
      let legacy: LegacyRefreshReading | null = null;
      let stage1Failed: string | null = null;
      if (skipLegacy) {
        recordStage("LEGACY_REFRESH", s1, "SKIPPED", "--skip-legacy was passed; the legacy sources were not run this window");
      } else {
        try {
          const r = legacyRefreshInShadow();
          legacy = r.reading;
          recordStage("LEGACY_REFRESH", s1, r.outcome, r.reason);
          if (r.outcome === "FAILED") {
            stage1Failed = r.reason;
            incident("LEGACY_REFRESH", "LEGACY_REFRESH_FAILED", r.reason ?? "unnamed", r.failedSources.length > 0 ? r.failedSources.map((s) => `legacy source ${s}`) : ["the whole legacy refresh for this local date"]);
          }
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          recordStage("LEGACY_REFRESH", s1, "FAILED", detail);
          stage1Failed = detail;
          incident("LEGACY_REFRESH", "LEGACY_REFRESH_THREW", detail, ["the whole legacy refresh for this local date"]);
        }
      }

      /* Stage 2 — PIPELINE EVALUATION. */
      const s2 = nowIso();
      const gate = readActivationGate(ROOT);
      console.log(`  gate: ${gate.reason}`);
      let evaluation: ReturnType<typeof evaluateItems> = { verdicts: [], byRecordClass: [] };
      let counts = { items: 0, byStage: { SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 }, refused: 0 };
      try {
        const mapping = await mapEvidenceIntoPipeline(repos, ROOT, nowIso());
        for (const line of mappingLines(mapping)) console.log(line);
        counts = { items: mapping.counts.items, byStage: mapping.counts.byStage, refused: mapping.counts.refused };
        evaluation = evaluateItems(mapping.states, gate);
        const batch: ItemVerdict[] = [];
        const step = await runPromotionStep({
          gate: { promotionEnabled: ACTIVATION_GATE.promotionEnabled && stage1Failed === null },
          verdicts: evaluation.verdicts,
          promote: async (v) => { batch.push(v); },
        });
        console.log(`  promotion step: ${step.reason}`);
        if (batch.length > 0) {
          const receipt = await promoteBatch(batch, gate);
          promotionReceipts.push(receiptSummary(receipt));
          for (const line of receipt.lines) console.log(line);
          if (receipt.incident) incidents.push(receipt.incident);
        }
        const none = mapping.counts.items === 0 ? "the pipeline holds no item; a zero here is the mapped state, not an empty read" : undefined;
        for (const [subject, verdict] of [["items the window WOULD promote", "PROMOTE_WOULD"], ["items REFUSED with a stated reason", "REFUSE_WOULD"], ["items DEFERRED with a stated reason", "DEFER"]] as const) {
          console.log(
            `  ${floorLine(floored(subject, "the pipeline this window evaluated", mapping.counts.items, evaluation.verdicts.filter((v) => v.verdict === verdict).length, none))}`,
          );
        }
        recordStage("PIPELINE_EVALUATION", s2, "COMPLETED", none ?? null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        recordStage("PIPELINE_EVALUATION", s2, "FAILED", detail);
        incident("PIPELINE_EVALUATION", "PIPELINE_EVALUATION_THREW", detail, ["the pipeline evaluation for this local date"]);
      }

      /* Stage 3 — POST-PROMOTION VERIFICATION, AS IF PROMOTED. */
      const s3 = nowIso();
      let verification: WindowRunRecord["postPromotionVerification"] = null;
      if (skipVerify) {
        recordStage("POST_PROMOTION_VERIFICATION", s3, "SKIPPED", "--skip-verify was passed");
      } else {
        try {
          const v = verifyServedSurface();
          verification = { instrument: "scripts/staging-observer.mts", asIfPromoted: true, exitCode: v.exitCode, verdict: v.verdict, detail: v.detail };
          const regression = decideRegression({ promotedCount: 0, verifications: [{ instrument: v.detail, exitCode: v.exitCode, passed: v.passed, detail: v.detail }] });
          console.log(`  regression decision: ${regression.action} — ${regression.reason}`);
          recordStage("POST_PROMOTION_VERIFICATION", s3, v.exitCode === null ? "FAILED" : "COMPLETED", `observer ${v.verdict} (exit ${v.exitCode ?? "none"}); regression ${regression.action}`);
          if (v.exitCode === null) incident("POST_PROMOTION_VERIFICATION", "OBSERVER_DID_NOT_FINISH", v.detail, ["the served-surface check for this local date"]);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          recordStage("POST_PROMOTION_VERIFICATION", s3, "FAILED", detail);
          incident("POST_PROMOTION_VERIFICATION", "OBSERVER_THREW", detail, ["the served-surface check for this local date"]);
        }
      }

      /* Stage 4 — DIGEST AND RECORD. */
      const s4 = nowIso();
      const recordPath = nextRunRecordPath(RUNS_DIR, today());
      const target = existsSync(MIRROR) ? MIRROR : FALLBACK;
      const finishedAt = nowIso();
      let researchProgression: WindowRunRecord["researchProgression"];
      try {
        researchProgression = await readResearchProgression(repos, {
          windowId, through: finishedAt, gate,
          candidates: readCandidateStore(join(ROOT,"data","method","candidates.json")).candidates,
          knowledge: readMethodStore(join(ROOT,...METHOD_STORE)),
          conclusions: readConclusionStore(join(ROOT,"data","method","conclusions.json")),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        incident("DIGEST", "RESEARCH_PROGRESSION_UNAVAILABLE", detail, ["research advancement and bottleneck facts for this completed window"]);
        exitCode = 2;
      }
      const record: WindowRunRecord = {
        formatVersion: WINDOW_FORMAT_VERSION,
        windowId,
        localDate: due.localDate,
        zone: WINDOW_ZONE,
        scheduledFor: due.boundary,
        trigger,
        mode: "SHADOW",
        startedAt,
        finishedAt,
        host: HOST,
        testedSha: headSha(ROOT),
        provider: repos.describe(),
        caughtUp: due.caughtUp,
        lock: { ...lock, releasedAt: null },
        activationGate: gate,
        stages: [...stages, { stage: "DIGEST", outcome: "COMPLETED", startedAt: s4, finishedAt: nowIso(), reason: null }],
        legacyRefresh: legacy,
        pipeline: { items: counts.items, byStage: counts.byStage, refused: counts.refused, verdicts: evaluation.verdicts, byRecordClass: evaluation.byRecordClass },
        ...(researchProgression ? {researchProgression} : {}),
        promoted: promotionReceipts.reduce((sum, receipt) => sum + receipt.promoted, 0),
        postPromotionVerification: verification,
        controls: null,
        incidents,
        promotionReceipts,
        digestPath: join(target, "nightly-window-digest.md"),
        mirrored: target === MIRROR,
        recordPath,
      };
      const delivered = deliver(buildWindowDigest(record), windowHeadline(record));
      writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      await repos.windowRuns.append(due.localDate, windowId, record, nowIso());
      for (const i of incidents) await repos.windowIncidents.append(windowId, i.incidentId, i, nowIso());
      const pending = (await repos.windowIntents.read(WINDOW_INTENT_KEY)).filter(
        (r): r is Extract<WindowIntent, { kind: "INTENT" }> => r.kind === "INTENT",
      );
      const honored = new Set((await repos.windowIntents.read(WINDOW_INTENT_KEY)).filter((r) => r.kind === "HONORED").map((r) => (r as Extract<WindowIntent, { kind: "HONORED" }>).honors));
      for (const p of pending) {
        if (honored.has(p.intentId)) continue;
        const honoredAt = nowIso();
        await repos.windowIntents.append(WINDOW_INTENT_KEY, `${p.intentId}:honored`, { formatVersion: WINDOW_FORMAT_VERSION, kind: "HONORED", intentId: `${p.intentId}:honored`, honors: p.intentId, action: p.action, honoredAt, honoredBy: HOLDER, detail: `honored by window ${windowId}` }, honoredAt);
      }
      console.log(`  digest: ${delivered.where}${delivered.mirrored ? "" : "  (MIRROR NOT REACHABLE — repo fallback)"}`);
      console.log(`  run record: ${recordPath}`);
      console.log(`  ${windowHeadline(record)}`);
      if (stages.some((s) => s.outcome === "FAILED")) exitCode = 2;
    },
    WINDOW_LEASE_TTL_MS,
  );
} catch (error) {
  if (error instanceof WindowLockHeld) {
    console.error(`window:run · REFUSED — ${error.message}`);
    process.exit(3);
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`window:run · the window did not finish: ${detail}`);
  try {
    const i = openIncident({ windowId, stage: "DIGEST", code: "WINDOW_CRASHED", detail: detail.split("\n")[0], openedAt: nowIso(), missedScope: [`the whole window for ${due.localDate}`] });
    await repos.windowIncidents.append(windowId, i.incidentId, i, nowIso());
    mkdirSync(RUNS_DIR, { recursive: true });
    writeFileSync(nextRunRecordPath(RUNS_DIR, today()), `${JSON.stringify({ windowId, localDate: due.localDate, crashed: true, error: detail, stages, incidents: [...incidents, i] }, null, 2)}\n`, "utf8");
  } catch (writeError) {
    console.error(`window:run · and the crash record could not be written: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }
  process.exit(1);
}
process.exit(exitCode);
